import { access, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
  buildBigCommerceExportBundle,
} from '../lib/imports/bigcommerceExportBundle';
import { chunkCsvRows, toCsv } from '../lib/imports/csvChunking';
import {
  BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS,
  buildBigCommerceV3ProductImport,
} from '../lib/imports/bigcommerceV3ProductImport';
import {
  buildPcnaCatalogImport,
  parseCsvText,
  type PcnaDecorationRow,
  type PcnaMediaRow,
  type PcnaPricingRow,
  type PcnaProductDataRow,
} from '../lib/imports/pcnaCatalogImport';
import { loadPcnaCatalogFromXml } from '../lib/imports/pcnaCatalogXml';
import { buildPriceListTargets } from '../lib/etl/bigcommercePricingContext';
import { projectProductPricing } from '../lib/etl/pricingProjector';
import type { NormalizedProduct } from '../lib/etl/productNormalizer';
import { buildManagedSkuProjection } from '../lib/imports/managedSkuProjection';

interface ScriptOptions {
  markupPercent: number;
  maxImportFileSizeMb: number;
  outputDir: string;
}

interface CategoryLookups {
  byPath: Map<string, string>;
  byVendorProductId: Map<string, string>;
}

const PRICE_LIST_IMPORT_BASE_HEADERS = [
  'Price List ID',
  'Price List Name',
  'Product Name',
  'Variant ID',
  'SKU',
  'Currency',
  'New Price',
  'New Sale Price',
  'New MSRP',
  'MAP',
] as const;

const CSV_SOURCE_FIELD_GAPS = {
  product_data: ['EffectiveDate', 'PackagingDetails', 'MemorySize', 'Hazmat', 'Caution', 'CautionComments'],
  product_pricing: ['Style'],
  product_decoration: ['SKU'],
};

const API_FIELDS_WITHOUT_CSV_SOURCES = [
  'Inventory quantities and inventory location assignments',
  'Pricing and configuration charge tiers',
  'FOB points and supported currencies',
  'Decoration colors / PMS metadata',
  'GTIN / UPC identifiers',
  'Remote media metadata such as file size, dimensions, DPI, color, and change timestamp',
] as const;

function readNumberFlag(flag: string, fallback: number): number {
  const rawIndex = process.argv.indexOf(flag);
  if (rawIndex < 0) {
    return fallback;
  }

  const rawValue = process.argv[rawIndex + 1];
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be followed by a number.`);
  }
  return parsed;
}

function readStringFlag(flag: string, fallback: string): string {
  const rawIndex = process.argv.indexOf(flag);
  if (rawIndex < 0) {
    return fallback;
  }

  const rawValue = process.argv[rawIndex + 1];
  if (!rawValue?.trim()) {
    throw new Error(`${flag} must be followed by a value.`);
  }
  return rawValue;
}

function parseOptions(): ScriptOptions {
  return {
    markupPercent: readNumberFlag('--markup-percent', 30),
    maxImportFileSizeMb: readNumberFlag('--max-import-file-size-mb', 19),
    outputDir: readStringFlag('--output-dir', path.join(process.cwd(), 'imports', 'out')),
  };
}

async function loadCsvRows<T extends Record<string, string>>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, 'utf8');
  return parseCsvText(raw) as T[];
}

async function hasFile(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeCategoryLookupKey(value: string | undefined | null): string {
  return normalizeText(value).replace(/\s*>\s*/g, '/');
}

async function findLatestBulkEditProductExport(importsDir: string): Promise<string | undefined> {
  const fileNames = await readdir(importsDir);
  const matches = fileNames
    .filter(fileName => /^bulk-edit-export-products.*\.csv$/i.test(fileName))
    .sort((left, right) => right.localeCompare(left));

  return matches[0] ? path.join(importsDir, matches[0]) : undefined;
}

function buildCategoryLookups(rows: Array<Record<string, string>>): CategoryLookups {
  const byPath = new Map<string, string>();
  const categoryIdsByVendorProductId = new Map<string, Set<string>>();

  for (const row of rows) {
    const categoryId = normalizeText(row['Category ID']);
    if (!/^\d+$/.test(categoryId)) {
      continue;
    }

    const vendorProductId = normalizeText(row['Product SKU']);
    if (vendorProductId) {
      const entries = categoryIdsByVendorProductId.get(vendorProductId) ?? new Set<string>();
      entries.add(categoryId);
      categoryIdsByVendorProductId.set(vendorProductId, entries);
    }

    for (const key of [row['Category Path'], row['Category String'], row['Category Name']]) {
      const normalizedKey = normalizeCategoryLookupKey(key);
      if (normalizedKey) {
        byPath.set(normalizedKey, categoryId);
      }
    }
  }

  return {
    byPath,
    byVendorProductId: new Map(
      Array.from(categoryIdsByVendorProductId.entries()).map(([vendorProductId, categoryIds]) => [
        vendorProductId,
        Array.from(categoryIds).sort((left, right) => Number(left) - Number(right)).join(';'),
      ]),
    ),
  };
}

function formatChunkFileName(baseFileName: string, index: number): string {
  return baseFileName.replace(/\.csv$/i, `.part-${String(index).padStart(3, '0')}.csv`);
}

async function writeChunkedCsvFile(input: {
  outputDir: string;
  baseFileName: string;
  rows: Array<Record<string, string | number | undefined>>;
  headers: string[];
  maxBytes: number;
}): Promise<
  Array<{
    file_name: string;
    row_count: number;
    bytes: number;
  }>
> {
  const chunks = chunkCsvRows({
    rows: input.rows,
    headers: input.headers,
    maxBytes: input.maxBytes,
  });

  const staleChunkPattern = new RegExp(
    `^${input.baseFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\.csv$/i, '')}\\.part-\\d+\\.csv$`,
  );
  const existingFiles = await readdir(input.outputDir);

  await Promise.all(
    existingFiles
      .filter(fileName => staleChunkPattern.test(fileName))
      .map(fileName => unlink(path.join(input.outputDir, fileName))),
  );

  await Promise.all(
    chunks.map(chunk =>
      writeFile(path.join(input.outputDir, formatChunkFileName(input.baseFileName, chunk.index)), chunk.text, 'utf8'),
    ),
  );

  return chunks.map(chunk => ({
    file_name: formatChunkFileName(input.baseFileName, chunk.index),
    row_count: chunk.rows.length,
    bytes: chunk.bytes,
  }));
}

async function removeGeneratedCsvArtifacts(outputDir: string, baseFileName: string): Promise<void> {
  const escapedBase = baseFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chunkPattern = new RegExp(`^${escapedBase.replace(/\\.csv$/i, '')}\\.part-\\d+\\.csv$`);
  const existingFiles = await readdir(outputDir);

  await Promise.all(
    existingFiles
      .filter(fileName => fileName === baseFileName || chunkPattern.test(fileName))
      .map(fileName => unlink(path.join(outputDir, fileName))),
  );
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2);
}

function buildScriptPricingContext(markupPercent: number) {
  return {
    markup_percent: markupPercent,
    price_list_id: Number(process.env.BIGCOMMERCE_B2B_PRICE_LIST_ID ?? 1),
    blanks_price_list_id: Number(process.env.BIGCOMMERCE_BLANKS_PRICE_LIST_ID ?? 2),
    currency: process.env.BIGCOMMERCE_PRICE_LIST_CURRENCY?.trim() || 'USD',
    markup_namespace: process.env.BIGCOMMERCE_MARKUP_METAFIELD_NAMESPACE?.trim() || 'merchmonk',
    markup_key: process.env.BIGCOMMERCE_MARKUP_METAFIELD_KEY?.trim() || 'product_markup',
  };
}

function getBulkTierSlotCountFromRows(rows: Array<Record<string, string>>): number {
  let maxSlot = 0;
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const match = key.match(/^Bulk Pricing Min - (\d+)$/);
      if (match) {
        maxSlot = Math.max(maxSlot, Number(match[1]));
      }
    }
  }
  return maxSlot;
}

function buildPriceListImportHeaders(maxBulkTierSlots: number): string[] {
  const headers = [...PRICE_LIST_IMPORT_BASE_HEADERS];
  for (let slot = 1; slot <= maxBulkTierSlots; slot += 1) {
    headers.push(`Bulk Pricing Min - ${slot}`);
    headers.push(`Bulk Pricing Type - ${slot}`);
    headers.push(`Bulk Pricing Value - ${slot}`);
  }
  return headers;
}

function createPriceListImportRow(headers: string[]): Record<string, string> {
  return Object.fromEntries(headers.map(header => [header, '']));
}

function buildPriceListImportRows(input: {
  vendorId: number;
  products: NormalizedProduct[];
  markupPercent: number;
  existingRows: Array<Record<string, string>>;
}): {
  headers: string[];
  rows: Array<Record<string, string>>;
  appended_count: number;
  skipped_existing_count: number;
  max_bulk_tier_slots: number;
} {
  const pricingContext = buildScriptPricingContext(input.markupPercent);
  const priceListTargets = buildPriceListTargets({ pricingContext });
  const targetIds = new Set(priceListTargets.map(target => String(target.price_list_id)));
  const replaceableSkus = new Set<string>();

  for (const product of input.products) {
    const managedSkuProjection = buildManagedSkuProjection({
      vendorId: input.vendorId,
      product,
    });

    replaceableSkus.add(product.sku);
    replaceableSkus.add(managedSkuProjection.productSku);

    for (const variant of product.variants ?? []) {
      replaceableSkus.add(variant.sku);
      const managedVariantSku = managedSkuProjection.variantSkuBySourceSku.get(variant.sku);
      if (managedVariantSku) {
        replaceableSkus.add(managedVariantSku);
      }
    }
  }

  const existingVariantIds = new Map(
    input.existingRows.map(row => [
      `${normalizeText(row['Price List ID'])}|${normalizeText(row.SKU).toLowerCase()}`,
      normalizeText(row['Variant ID']),
    ]),
  );
  const priceListNames = new Map(
    input.existingRows
      .filter(row => normalizeText(row['Price List ID']))
      .map(row => [normalizeText(row['Price List ID']), normalizeText(row['Price List Name'])]),
  );
  const preservedRows = input.existingRows.filter(row => {
    const priceListId = normalizeText(row['Price List ID']);
    const sku = normalizeText(row.SKU);
    return !(targetIds.has(priceListId) && replaceableSkus.has(sku));
  });

  const existingKeys = new Set(
    preservedRows.map(row => `${normalizeText(row['Price List ID'])}|${normalizeText(row.SKU).toLowerCase()}`),
  );
  let maxBulkTierSlots = getBulkTierSlotCountFromRows(input.existingRows);
  for (const product of input.products) {
    const managedSkuProjection = buildManagedSkuProjection({
      vendorId: input.vendorId,
      product,
    });
    for (const target of priceListTargets) {
      const projection = projectProductPricing(product, {
        markup_percent: target.markup_percent,
        price_list_id: target.price_list_id,
        currency: pricingContext.currency,
        family_preferences: target.family_preferences,
        require_family_match: target.require_family_match,
      });
      for (const variant of projection.variants) {
        maxBulkTierSlots = Math.max(maxBulkTierSlots, variant.price_list_bulk_tiers?.length ?? 0);
      }
    }
  }
  const headers = buildPriceListImportHeaders(maxBulkTierSlots);
  const appendedRows: Array<Record<string, string>> = [];
  let skippedExistingCount = 0;

  for (const product of input.products) {
    const managedSkuProjection = buildManagedSkuProjection({
      vendorId: input.vendorId,
      product,
    });

    for (const target of priceListTargets) {
      const projection = projectProductPricing(product, {
        markup_percent: target.markup_percent,
        price_list_id: target.price_list_id,
        currency: pricingContext.currency,
        family_preferences: target.family_preferences,
        require_family_match: target.require_family_match,
      });

      for (const variant of projection.variants) {
        const managedSku =
          product.variants && product.variants.length > 0
            ? managedSkuProjection.variantSkuBySourceSku.get(variant.sku) ?? variant.sku
            : managedSkuProjection.productSku;
        const key = `${target.price_list_id}|${managedSku.toLowerCase()}`;
        if (existingKeys.has(key)) {
          skippedExistingCount += 1;
          continue;
        }

        const row = createPriceListImportRow(headers);
        row['Price List ID'] = String(target.price_list_id);
        row['Price List Name'] =
          priceListNames.get(String(target.price_list_id)) ||
          (target.price_list_id === pricingContext.blanks_price_list_id ? 'Blanks' : 'Default');
        row['Product Name'] = product.name;
        row['Variant ID'] = existingVariantIds.get(key) ?? '';
        row.SKU = managedSku;
        row.Currency = projection.currency.toLowerCase();
        row['New Price'] = formatMoney(variant.price);

        for (const [index, tier] of (variant.price_list_bulk_tiers ?? []).entries()) {
          const slot = index + 1;
          row[`Bulk Pricing Min - ${slot}`] = String(tier.quantity_min);
          row[`Bulk Pricing Type - ${slot}`] = tier.type;
          row[`Bulk Pricing Value - ${slot}`] = formatMoney(tier.amount);
        }

        existingKeys.add(key);
        appendedRows.push(row);
      }
    }
  }

  return {
    headers,
    rows: [...preservedRows, ...appendedRows],
    appended_count: appendedRows.length,
    skipped_existing_count: skippedExistingCount,
    max_bulk_tier_slots: maxBulkTierSlots,
  };
}

async function main() {
  const options = parseOptions();
  const importsDir = path.join(process.cwd(), 'imports');
  const maxImportFileBytes = Math.floor(options.maxImportFileSizeMb * 1024 * 1024);
  const pricingContext = buildScriptPricingContext(options.markupPercent);
  const priceListTargets = buildPriceListTargets({ pricingContext });
  const latestBulkEditProductExport = await findLatestBulkEditProductExport(importsDir);
  const xmlSourceFiles = [
    path.join(importsDir, 'Pcna.ProductData.xml'),
    path.join(importsDir, 'Pcna.ProductPricing.xml'),
    path.join(importsDir, 'Pcna.ProductMedia.xml'),
    path.join(importsDir, 'Pcna.ProductDecoration.xml'),
  ];
  const xmlAvailable = (await Promise.all(xmlSourceFiles.map(filePath => hasFile(filePath)))).every(Boolean);

  const [existingPriceListRows, existingProductExportRows, xmlCatalogSource, csvCatalogSource] = await Promise.all([
    loadCsvRows<Record<string, string>>(path.join(process.cwd(), 'imports', 'out', 'Price-List-Import.csv')),
    latestBulkEditProductExport
      ? loadCsvRows<Record<string, string>>(latestBulkEditProductExport)
      : Promise.resolve([]),
    xmlAvailable ? loadPcnaCatalogFromXml(importsDir) : Promise.resolve(null),
    xmlAvailable
      ? Promise.resolve(null)
      : Promise.all([
          loadCsvRows<PcnaProductDataRow>(path.join(importsDir, 'Pcna.ProductData.csv')),
          loadCsvRows<PcnaPricingRow>(path.join(importsDir, 'Pcna.ProductPricing.csv')),
          loadCsvRows<PcnaMediaRow>(path.join(importsDir, 'Pcna.ProductMedia.csv')),
          loadCsvRows<PcnaDecorationRow>(path.join(importsDir, 'Pcna.ProductDecoration.csv')),
        ]).then(([productDataRows, pricingRows, mediaRows, decorationRows]) => ({
          productDataRows,
          pricingRows,
          mediaRows,
          decorationRows,
          sourceFiles: [
            'imports/Pcna.ProductData.csv',
            'imports/Pcna.ProductPricing.csv',
            'imports/Pcna.ProductMedia.csv',
            'imports/Pcna.ProductDecoration.csv',
            'imports/out/Price-List-Import.csv',
          ],
        })),
  ]);
  const categoryLookups = buildCategoryLookups(existingProductExportRows);
  const productDataRows = xmlCatalogSource?.productDataRows ?? csvCatalogSource?.productDataRows ?? [];
  const pricingRows = xmlCatalogSource?.pricingRows ?? csvCatalogSource?.pricingRows ?? [];
  const decorationRows = xmlCatalogSource?.decorationRows ?? csvCatalogSource?.decorationRows ?? [];
  const sourceFormat = xmlCatalogSource ? 'xml' : 'csv';
  const sourceFiles = xmlCatalogSource?.sourceFiles ?? csvCatalogSource?.sourceFiles ?? [];

  const catalogImport = buildPcnaCatalogImport({
    vendorId: 10,
    vendorName: 'PCNA',
    markupPercent: options.markupPercent,
    productDataRows,
    pricingRows,
    ...(xmlCatalogSource?.mediaRowsByStyle ? { mediaRowsByStyle: xmlCatalogSource.mediaRowsByStyle } : {}),
    ...(csvCatalogSource?.mediaRows ? { mediaRows: csvCatalogSource.mediaRows } : {}),
    decorationRows,
    ...(xmlCatalogSource?.productDataSnapshotsByStyle
      ? { productDataSnapshotsByStyle: xmlCatalogSource.productDataSnapshotsByStyle }
      : {}),
  });

  const pricingPreview = catalogImport.products.map(product => ({
    vendor_product_id: product.vendor_product_id,
    sku: product.sku,
    price_lists: priceListTargets.map(target => ({
      price_list_id: target.price_list_id,
      markup_percent: target.markup_percent,
      family_preferences: target.family_preferences,
      require_family_match: target.require_family_match ?? false,
      pricing: projectProductPricing(product, {
        markup_percent: target.markup_percent,
        price_list_id: target.price_list_id,
        currency: pricingContext.currency,
        family_preferences: target.family_preferences,
        require_family_match: target.require_family_match,
      }),
    })),
  }));

  const primaryPriceListId = priceListTargets[0]?.price_list_id ?? pricingContext.price_list_id;
  const primaryPricingBySku = new Map(
    pricingPreview.flatMap(productPreview => {
      const primary = productPreview.price_lists.find(priceList => priceList.price_list_id === primaryPriceListId);
      if (!primary) {
        return [];
      }

      return [
        [
          productPreview.sku,
          {
            price: primary.pricing.product_fallback.price,
            variants: new Map(primary.pricing.variants.map(variant => [variant.sku, variant.price])),
          },
        ] as const,
      ];
    }),
  );

  const priceListImport = buildPriceListImportRows({
    vendorId: 10,
    products: catalogImport.products,
    markupPercent: options.markupPercent,
    existingRows: existingPriceListRows,
  });

  const v3ProductImport = buildBigCommerceV3ProductImport({
    products: catalogImport.products,
    vendorId: 10,
    markupPercent: options.markupPercent,
    categoryIdsByPath: categoryLookups.byPath,
    categoryIdsByVendorProductId: categoryLookups.byVendorProductId,
  });
  const productRowsWithCategoryIds = v3ProductImport.rows.filter(
    row => row.Item === 'Product' && normalizeText(row.Categories),
  ).length;
  const categoryCoverage = {
    total_products: catalogImport.report.total_products,
    matched_category_ids: productRowsWithCategoryIds,
    missing_category_ids: Math.max(catalogImport.report.total_products - productRowsWithCategoryIds, 0),
  };
  const discrepancyReport = {
    source_format: sourceFormat,
    source_fields_not_currently_projected: sourceFormat === 'csv' ? CSV_SOURCE_FIELD_GAPS : {},
    api_fields_without_source_data: sourceFormat === 'csv' ? API_FIELDS_WITHOUT_CSV_SOURCES : [],
    category_id_lookup: categoryCoverage,
    notes: [
      'Price list rows are appended in the same CSV shape as the current BigCommerce export. Newly created CSV-imported variants still start with blank Variant ID cells in this file until BigCommerce assigns IDs.',
      'The manual import plus metafield replay can mirror the current product contract and media metadata, but it does not reproduce API-only runtime operations such as live inventory sync or modifier reconciliation.',
      ...(sourceFormat === 'xml'
        ? [
            `XML source data now contributes color hex values for swatch options and richer product snapshot metafields, but category IDs still depend on the existing BigCommerce export lookup and fall back to blank when no match is available (${categoryCoverage.matched_category_ids} of ${categoryCoverage.total_products} products matched).`,
          ]
        : []),
    ],
  };

  const exportBundle =
    BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS.length > 0
      ? buildBigCommerceExportBundle({
          productsTemplateHeaders: BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS as unknown as string[],
          skuTemplateHeaders: ['Product SKU'],
          products: catalogImport.products,
          vendorId: 10,
          markupPercent: options.markupPercent,
        })
      : null;

  const reviewRows = catalogImport.products.flatMap(product => {
    const categories = (product.categories ?? []).join(' | ');
    const images = (product.media_assets ?? [])
      .filter(asset => asset.media_type === 'Image')
      .slice(0, 5)
      .map(asset => asset.url)
      .join(' | ');
    const decorationLocations = (product.modifier_blueprint?.locations ?? [])
      .map(location => location.location)
      .join(' | ');
    const decorationMethods = Array.from(
      new Set(
        (product.modifier_blueprint?.locations ?? []).flatMap(location => location.methods.map(method => method.method)),
      ),
    ).join(' | ');

    if (!product.variants || product.variants.length === 0) {
      return [
        {
          vendor_product_id: product.vendor_product_id,
          item_type: 'product',
          product_sku: product.sku,
          variant_sku: '',
          product_name: product.name,
          brand_name: product.brand_name ?? '',
          categories,
          cost_price: product.cost_price ?? '',
          sell_price_preview: primaryPricingBySku.get(product.sku)?.price ?? '',
          weight_lb: product.weight ?? '',
          color: '',
          size: '',
          image_urls: images,
          decoration_locations: decorationLocations,
          decoration_methods: decorationMethods,
          search_keywords: product.search_keywords ?? '',
        },
      ];
    }

    const pricedVariants = primaryPricingBySku.get(product.sku)?.variants ?? new Map<string, number>();

    return product.variants.map(variant => ({
      vendor_product_id: product.vendor_product_id,
      item_type: 'variant',
      product_sku: product.sku,
      variant_sku: variant.sku,
      product_name: product.name,
      brand_name: product.brand_name ?? '',
      categories,
      cost_price: variant.cost_price ?? '',
      sell_price_preview: pricedVariants.get(variant.sku) ?? '',
      weight_lb: variant.weight ?? product.weight ?? '',
      color: variant.color ?? '',
      size: variant.size ?? '',
      image_urls: (product.media_assets ?? [])
        .filter(asset => asset.media_type === 'Image' && (!asset.part_id || asset.part_id === variant.part_id))
        .slice(0, 5)
        .map(asset => asset.url)
        .join(' | '),
      decoration_locations: decorationLocations,
      decoration_methods: decorationMethods,
      search_keywords: product.search_keywords ?? '',
    }));
  });

  await mkdir(options.outputDir, { recursive: true });
  await removeGeneratedCsvArtifacts(options.outputDir, 'vendor-10.pcna.bigcommerce-skus-import.csv');

  const chunkedImportFiles = exportBundle
    ? {
        products: await writeChunkedCsvFile({
          outputDir: options.outputDir,
          baseFileName: 'vendor-10.pcna.bigcommerce-products-import.csv',
          rows: v3ProductImport.rows,
          headers: BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS as unknown as string[],
          maxBytes: maxImportFileBytes,
        }),
        product_metafields: await writeChunkedCsvFile({
          outputDir: options.outputDir,
          baseFileName: 'vendor-10.pcna.bigcommerce-product-metafields.csv',
          rows: exportBundle.productMetafieldRows.map(row =>
            Object.fromEntries(BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS.map(header => [header, row[header] ?? ''])),
          ),
          headers: BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
          maxBytes: maxImportFileBytes,
        }),
        variant_metafields: await writeChunkedCsvFile({
          outputDir: options.outputDir,
          baseFileName: 'vendor-10.pcna.bigcommerce-variant-metafields.csv',
          rows: exportBundle.variantMetafieldRows.map(row =>
            Object.fromEntries(BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS.map(header => [header, row[header] ?? ''])),
          ),
          headers: BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
          maxBytes: maxImportFileBytes,
        }),
      }
    : null;

  await Promise.all([
    writeFile(
      path.join(options.outputDir, 'vendor-10.pcna.normalized-products.json'),
      `${JSON.stringify(catalogImport.products, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      path.join(options.outputDir, 'vendor-10.pcna.pricing-preview.json'),
      `${JSON.stringify(
        {
          markup_percent: options.markupPercent,
          price_list_targets: priceListTargets,
          products: pricingPreview,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      path.join(options.outputDir, 'vendor-10.pcna.review.csv'),
      toCsv(reviewRows),
      'utf8',
    ),
    writeFile(
      path.join(options.outputDir, 'vendor-10.pcna.report.json'),
      `${JSON.stringify(
        {
          ...catalogImport.report,
          markup_percent: options.markupPercent,
          max_import_file_size_mb: options.maxImportFileSizeMb,
          ...(exportBundle ? { bigcommerce_export_bundle: exportBundle.report } : {}),
          price_list_import: {
            appended_count: priceListImport.appended_count,
            skipped_existing_count: priceListImport.skipped_existing_count,
            max_bulk_tier_slots: priceListImport.max_bulk_tier_slots,
          },
          category_id_lookup: categoryCoverage,
          ...(chunkedImportFiles ? { chunked_import_files: chunkedImportFiles } : {}),
          source_format: sourceFormat,
          source_files: sourceFiles,
        },
        null,
        2,
      )}\n`,
      'utf8',
    ),
    writeFile(
      path.join(options.outputDir, 'vendor-10.pcna.discrepancies.json'),
      `${JSON.stringify(discrepancyReport, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      path.join(options.outputDir, 'Price-List-Import.csv'),
      toCsv(priceListImport.rows, priceListImport.headers),
      'utf8',
    ),
    ...(chunkedImportFiles
      ? [
          writeFile(
            path.join(options.outputDir, 'vendor-10.pcna.bigcommerce-import-manifest.json'),
            `${JSON.stringify(
              {
                max_import_file_size_mb: options.maxImportFileSizeMb,
                imports: [
                  {
                    type: 'products',
                    files: chunkedImportFiles.products,
                  },
                  {
                    type: 'product_metafields',
                    files: chunkedImportFiles.product_metafields,
                  },
                  {
                    type: 'variant_metafields',
                    files: chunkedImportFiles.variant_metafields,
                  },
                ],
              },
              null,
              2,
            )}\n`,
            'utf8',
          ),
        ]
      : []),
    ...(exportBundle
      ? [
          writeFile(
            path.join(options.outputDir, 'vendor-10.pcna.bigcommerce-products-import.csv'),
            toCsv(v3ProductImport.rows, BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS as unknown as string[]),
            'utf8',
          ),
          writeFile(
            path.join(options.outputDir, 'vendor-10.pcna.bigcommerce-product-metafields.csv'),
            toCsv(
              exportBundle.productMetafieldRows.map(row =>
                Object.fromEntries(BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS.map(header => [header, row[header] ?? ''])),
              ),
              BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
            ),
            'utf8',
          ),
          writeFile(
            path.join(options.outputDir, 'vendor-10.pcna.bigcommerce-variant-metafields.csv'),
            toCsv(
              exportBundle.variantMetafieldRows.map(row =>
                Object.fromEntries(BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS.map(header => [header, row[header] ?? ''])),
              ),
              BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
            ),
            'utf8',
          ),
        ]
      : []),
  ]);

  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        products: catalogImport.report.total_products,
        variant_products: catalogImport.report.variant_products,
        missing_pricing_rows: catalogImport.report.missing_pricing_rows,
        markup_percent: options.markupPercent,
        max_import_file_size_mb: options.maxImportFileSizeMb,
        v3_product_import_row_count: v3ProductImport.report.row_count,
        v3_variant_row_count: v3ProductImport.report.variant_row_count,
        price_list_import: {
          appended_count: priceListImport.appended_count,
          skipped_existing_count: priceListImport.skipped_existing_count,
          max_bulk_tier_slots: priceListImport.max_bulk_tier_slots,
        },
        ...(exportBundle ? exportBundle.report : {}),
        ...(chunkedImportFiles ? { chunked_import_files: chunkedImportFiles } : {}),
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
