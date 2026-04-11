import { createReadStream } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { XMLParser } from 'fast-xml-parser';
import type {
  ProductDataCategorySnapshot,
  ProductDataColorSnapshot,
  ProductDataDimensionSnapshot,
  ProductDataPackageSnapshot,
  ProductDataPartSnapshot,
  ProductDataSnapshot,
} from '../etl/productNormalizer';
import type {
  PcnaDecorationRow,
  PcnaMediaRow,
  PcnaPricingRow,
  PcnaProductDataRow,
} from './pcnaCatalogImport';

export interface PcnaXmlCatalogLoadResult {
  productDataRows: PcnaProductDataRow[];
  pricingRows: PcnaPricingRow[];
  decorationRows: PcnaDecorationRow[];
  mediaRowsByStyle: Map<string, PcnaMediaRow[]>;
  productDataSnapshotsByStyle: Map<string, ProductDataSnapshot>;
  sourceFiles: string[];
}

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
});

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): XmlRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as XmlRecord;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&reg;|&#174;/gi, '®')
    .replace(/&trade;|&#8482;/gi, '™')
    .replace(/&copy;|&#169;/gi, '©')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    })
    .replace(/&#(\d+);/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    });
}

function normalizeText(value: string | number | boolean | undefined | null): string {
  if (value === null || value === undefined) {
    return '';
  }

  return decodeHtmlEntities(String(value)).replace(/\s+/g, ' ').trim();
}

function getString(node: XmlRecord | null | undefined, key: string): string {
  if (!node) {
    return '';
  }

  const value = node[key];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return normalizeText(value);
  }

  const record = asRecord(value);
  if (!record) {
    return '';
  }

  const textValue = record['#text'];
  if (typeof textValue === 'string' || typeof textValue === 'number' || typeof textValue === 'boolean') {
    return normalizeText(textValue);
  }

  return '';
}

function getAttribute(node: XmlRecord | null | undefined, key: string): string {
  if (!node) {
    return '';
  }

  return normalizeText(node[`@_${key}`] as string | number | boolean | undefined | null);
}

function getNumber(node: XmlRecord | null | undefined, key: string): number | undefined {
  const value = getString(node, key);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getBoolean(node: XmlRecord | null | undefined, key: string): boolean | undefined {
  const value = getString(node, key).toLowerCase();
  if (!value) {
    return undefined;
  }

  if (['true', 'yes', 'y', '1'].includes(value)) {
    return true;
  }
  if (['false', 'no', 'n', '0'].includes(value)) {
    return false;
  }

  return undefined;
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
}

function formatDecimal(value: number | undefined): string {
  if (value === undefined) {
    return '';
  }

  return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function parseNumberString(value: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDimensionsString(node: XmlRecord | null | undefined): string {
  if (!node) {
    return '';
  }

  const height = getNumber(node, 'Height');
  const width = getNumber(node, 'Width');
  const depth = getNumber(node, 'Depth');

  if (height === undefined && width === undefined && depth === undefined) {
    return '';
  }

  return `${formatDecimal(height)} H x ${formatDecimal(width)} W x ${formatDecimal(depth)} L`.trim();
}

function buildDimensionSnapshot(node: XmlRecord | null | undefined): ProductDataDimensionSnapshot | undefined {
  if (!node) {
    return undefined;
  }

  const depth = getNumber(node, 'Depth');
  const height = getNumber(node, 'Height');
  const width = getNumber(node, 'Width');
  const dimensionUom = getAttribute(node, 'Unit');

  const snapshot: ProductDataDimensionSnapshot = {
    ...(dimensionUom ? { dimension_uom: dimensionUom } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(width !== undefined ? { width } : {}),
  };

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function buildPackageSnapshot(
  node: XmlRecord | null | undefined,
  packageType: string,
): ProductDataPackageSnapshot | undefined {
  if (!node) {
    return undefined;
  }

  const dimensions = buildDimensionSnapshot(asRecord(node.Dimensions));
  const weight = normalizeText(node.Weight as string | number | boolean | undefined | null);
  const weightUom = getAttribute(asRecord(node.Weight), 'Unit');
  const quantity = getNumber(node, 'CasePack');
  const parsedWeight = parseNumberString(weight);

  const snapshot: ProductDataPackageSnapshot = {
    package_type: packageType,
    ...(quantity !== undefined ? { quantity } : {}),
    ...(dimensions?.dimension_uom ? { dimension_uom: dimensions.dimension_uom } : {}),
    ...(dimensions?.depth !== undefined ? { depth: dimensions.depth } : {}),
    ...(dimensions?.height !== undefined ? { height: dimensions.height } : {}),
    ...(dimensions?.width !== undefined ? { width: dimensions.width } : {}),
    ...(weightUom ? { weight_uom: weightUom } : {}),
    ...(parsedWeight !== undefined ? { weight: parsedWeight } : {}),
  };

  return Object.keys(snapshot).length > 1 ? snapshot : undefined;
}

function buildPackagingDetails(skuNode: XmlRecord | null): string {
  if (!skuNode) {
    return '';
  }

  const packages: Array<{ label: string; record: XmlRecord | null }> = [
    { label: 'Giftbox', record: asRecord(skuNode.Giftbox) },
    { label: 'MasterCarton', record: asRecord(skuNode.MasterCarton) },
  ];

  const entries = packages
    .map(({ label, record }) => {
      if (!record) {
        return '';
      }

      const parts = [
        getNumber(record, 'CasePack') !== undefined ? `CasePack ${getNumber(record, 'CasePack')}` : '',
        formatDimensionsString(asRecord(record.Dimensions)),
        normalizeText(record.Weight as string | number | boolean | undefined | null)
          ? `${normalizeText(record.Weight as string | number | boolean | undefined | null)} ${getAttribute(asRecord(record.Weight), 'Unit')}`.trim()
          : '',
      ].filter(Boolean);

      return parts.length > 0 ? `${label}: ${parts.join(', ')}` : '';
    })
    .filter(Boolean);

  return entries.join(' | ');
}

function cleanSubcategory(value: string): string {
  return normalizeText(value).replace(/^\{[^}]+\}\s*/, '');
}

function buildColorSnapshot(colorNode: XmlRecord | null): ProductDataColorSnapshot | undefined {
  if (!colorNode) {
    return undefined;
  }

  const colorName = getString(colorNode, '#text');
  const marketColor = getAttribute(colorNode, 'MarketColor');
  const hex = getAttribute(colorNode, 'HexCode');
  const snapshot: ProductDataColorSnapshot = {
    ...(colorName ? { color_name: colorName } : {}),
    ...(hex ? { hex } : {}),
    ...(marketColor ? { standard_color_name: marketColor } : {}),
  };

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function buildProductPartSnapshot(skuNode: XmlRecord | null): ProductDataPartSnapshot | undefined {
  if (!skuNode) {
    return undefined;
  }

  const colorNode = asRecord(skuNode.Color);
  const dimension = buildDimensionSnapshot(asRecord(skuNode.Dimensions));
  const weight = normalizeText(skuNode.Weight as string | number | boolean | undefined | null);
  const weightUom = getAttribute(asRecord(skuNode.Weight), 'Unit');
  const parsedWeight = parseNumberString(weight);
  const primaryColor = buildColorSnapshot(colorNode);
  const packaging = dedupePackageSnapshots([
    buildPackageSnapshot(asRecord(skuNode.Giftbox), 'Giftbox'),
    buildPackageSnapshot(asRecord(skuNode.MasterCarton), 'MasterCarton'),
  ]);
  const flags = asRecord(skuNode.Flags);

  const snapshot: ProductDataPartSnapshot = {
    ...(getAttribute(skuNode, 'Number') ? { part_id: getAttribute(skuNode, 'Number') } : {}),
    ...(primaryColor ? { colors: [primaryColor], primary_color: primaryColor } : {}),
    ...(normalizeText(skuNode.MaterialsDescription as string | number | boolean | undefined | null)
      ? { primary_material: normalizeText(skuNode.MaterialsDescription as string | number | boolean | undefined | null) }
      : {}),
    ...(dimension
        ? {
            dimension: {
              ...dimension,
            ...(parsedWeight !== undefined ? { weight: parsedWeight } : {}),
            ...(weightUom ? { weight_uom: weightUom } : {}),
          },
        }
      : weight || weightUom
        ? {
            dimension: {
              ...(parsedWeight !== undefined ? { weight: parsedWeight } : {}),
              ...(weightUom ? { weight_uom: weightUom } : {}),
            },
          }
        : {}),
    ...(normalizeText(skuNode.Size as string | number | boolean | undefined | null)
      ? {
          apparel_size: {
            custom_size: normalizeText(skuNode.Size as string | number | boolean | undefined | null),
          },
        }
      : {}),
    ...(packaging.length > 0 ? { product_packaging: packaging } : {}),
    ...(getBoolean(flags, 'Caution') !== undefined ? { is_caution: getBoolean(flags, 'Caution') } : {}),
    ...(getAttribute(asRecord(flags?.Caution), 'Comments')
      ? { caution_comment: getAttribute(asRecord(flags?.Caution), 'Comments') }
      : {}),
    ...(getBoolean(flags, 'Hazmat') !== undefined ? { is_hazmat: getBoolean(flags, 'Hazmat') } : {}),
  };

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function dedupePackageSnapshots(
  values: Array<ProductDataPackageSnapshot | undefined>,
): ProductDataPackageSnapshot[] {
  const seen = new Set<string>();
  const output: ProductDataPackageSnapshot[] = [];

  for (const value of values) {
    if (!value) {
      continue;
    }

    const key = JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

function dedupeCategorySnapshots(values: ProductDataCategorySnapshot[]): ProductDataCategorySnapshot[] {
  const seen = new Set<string>();
  const output: ProductDataCategorySnapshot[] = [];

  for (const value of values) {
    const key = `${normalizeText(value.category).toLowerCase()}|${normalizeText(value.sub_category).toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(value);
  }

  return output;
}

async function streamXmlElements(
  filePath: string,
  elementName: string,
  onElement: (xml: string) => Promise<void> | void,
): Promise<void> {
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });
  const startPattern = new RegExp(`<${elementName}(\\s|>)`);
  const endTag = `</${elementName}>`;
  let buffer: string[] = [];
  let capturing = false;

  for await (const rawLine of lineReader) {
    const line = buffer.length === 0 ? rawLine.replace(/^\uFEFF/, '') : rawLine;

    if (!capturing) {
      const startIndex = line.search(startPattern);
      if (startIndex < 0) {
        continue;
      }

      capturing = true;
      buffer = [line.slice(startIndex)];
    } else {
      buffer.push(line);
    }

    if (!line.includes(endTag)) {
      continue;
    }

    await onElement(buffer.join('\n'));
    buffer = [];
    capturing = false;
  }

  if (capturing) {
    throw new Error(`Unexpected EOF while parsing ${path.basename(filePath)} ${elementName} records.`);
  }
}

function parseElementRecord(xml: string, elementName: string): XmlRecord {
  const parsed = parser.parse(xml);
  return asRecord(parsed[elementName]) ?? {};
}

function buildProductDataRowsFromItem(item: XmlRecord): {
  rows: PcnaProductDataRow[];
  snapshot?: ProductDataSnapshot;
} {
  const style = getString(item, 'Style');
  if (!style) {
    return { rows: [] };
  }

  const division = getString(item, 'Division');
  const brand = getString(item, 'Brand');
  const category = getString(item, 'Category');
  const description = getString(item, 'Description');
  const seriesName = getString(item, 'SeriesName') || style;
  const flags = asRecord(item.Flags);
  const subcategory = cleanSubcategory(getString(flags, 'GlobalSubCategory'));
  const lineName = getString(flags, 'SeriesName');
  const normalizedLineName = lineName.toLowerCase() === 'none' ? '' : lineName;
  const effectiveDate = getString(flags, 'IntroductionDate');
  const packagingFallback = getString(flags, 'PackagingDetails');
  const canonicalUrl = getString(flags, 'CanonicalURL');
  const skuNodes = asArray(asRecord(item.Skus)?.Sku).map(sku => asRecord(sku)).filter((sku): sku is XmlRecord => !!sku);

  const rows = skuNodes.map(skuNode => {
    const colorNode = asRecord(skuNode.Color);
    const size = getString(skuNode, 'Size');
    const row: PcnaProductDataRow = {
      Division: division,
      Brand: brand,
      PCNA_Style_Number: style,
      PCNA_SKU_Number: getAttribute(skuNode, 'Number'),
      CategoryWeb: category,
      SubCategoryWeb: subcategory,
      ItemName: seriesName,
      SeriesName: normalizedLineName,
      Description: description,
      MARKET_COLORS: getAttribute(colorNode, 'MarketColor') || getString(colorNode, '#text'),
      Product_Dimensions: formatDimensionsString(asRecord(skuNode.Dimensions)),
      Product_Size: size,
      Product_Weight: normalizeText(skuNode.Weight as string | number | boolean | undefined | null)
        ? `${normalizeText(skuNode.Weight as string | number | boolean | undefined | null)} ${getAttribute(asRecord(skuNode.Weight), 'Unit')}`.trim()
        : '',
      MaterialsDescription: getString(skuNode, 'MaterialsDescription'),
      EffectiveDate: effectiveDate,
      PackagingDetails: buildPackagingDetails(skuNode) || packagingFallback,
      MemorySize: getString(flags, 'MemoryCapacity'),
      Hazmat: getString(asRecord(skuNode.Flags), 'Hazmat') || getString(flags, 'Hazmat'),
      Caution: getString(asRecord(skuNode.Flags), 'Caution'),
      CautionComments: getAttribute(asRecord(asRecord(skuNode.Flags)?.Caution), 'Comments'),
      ColorHexCode: getAttribute(colorNode, 'HexCode'),
      CanonicalUrl: canonicalUrl,
      UnitOfMeasure: getString(item, 'UnitOfMeasure'),
    };

    return row;
  });

  const categories = dedupeCategorySnapshots(
    [
      {
        ...(category ? { category } : {}),
        ...(subcategory ? { sub_category: subcategory } : {}),
      },
    ].filter(item => Object.keys(item).length > 0),
  );
  const parts = skuNodes
    .map(buildProductPartSnapshot)
    .filter((part): part is ProductDataPartSnapshot => !!part);
  const snapshot: ProductDataSnapshot = {
    product_id: style,
    product_name: seriesName,
    ...(description ? { description: [description] } : {}),
    ...(brand ? { product_brand: brand } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(effectiveDate ? { effective_date: effectiveDate } : {}),
    ...(normalizedLineName ? { line_name: normalizedLineName } : {}),
    ...(parts.length > 0 ? { parts } : {}),
    ...(dedupeStrings([division, brand, category, subcategory]).length > 0
      ? { keywords: dedupeStrings([division, brand, category, subcategory]) }
      : {}),
  };

  return {
    rows,
    snapshot,
  };
}

function buildPricingRowsFromItemPrice(itemPrice: XmlRecord): PcnaPricingRow[] {
  const sku = getString(itemPrice, 'SKU');
  const style = getString(itemPrice, 'Style');

  return asArray(asRecord(itemPrice.Prices)?.Price)
    .map(priceNode => asRecord(priceNode))
    .filter((priceNode): priceNode is XmlRecord => !!priceNode)
    .map(priceNode => ({
      SKU: sku,
      Style: style,
      quantityMin: getString(priceNode, 'quantityMin'),
      price: getString(priceNode, 'price'),
      discountCode: getString(priceNode, 'discountCode'),
      CurrencyID: getString(priceNode, 'CurrencyID'),
      PriceType: getString(priceNode, 'PriceType'),
      PriceDescription: getString(priceNode, 'PriceDescription'),
    }));
}

function buildDecorationRowsFromItemDecoration(itemDecoration: XmlRecord): PcnaDecorationRow[] {
  const decoration = asRecord(itemDecoration.Decoration);
  const details = asArray(asRecord(decoration?.DecorationDetails)?.DecorationDetail)
    .map(detail => asRecord(detail))
    .filter((detail): detail is XmlRecord => !!detail);

  return details.map(detail => ({
    SKU: getString(itemDecoration, 'SKU'),
    Style: getString(itemDecoration, 'Style'),
    DecorationId: getString(decoration, 'DecorationId'),
    DecorationName: getString(decoration, 'DecorationName'),
    Priority: getString(decoration, 'Priority'),
    MaxLength: getString(detail, 'MaxLength'),
    MaxHeight: getString(detail, 'MaxHeight'),
    LocationName: getString(detail, 'LocationName'),
    LocationId: getString(detail, 'LocationId'),
  }));
}

function buildMediaRowFromMediaContent(mediaContent: XmlRecord): PcnaMediaRow | undefined {
  const productId = getString(mediaContent, 'productId');
  const partId = getString(mediaContent, 'partId');
  const url = getString(mediaContent, 'url');

  if (!productId || !url) {
    return undefined;
  }

  const classTypes = asArray(asRecord(mediaContent.ClassTypeArray)?.ClassType)
    .map(classType => asRecord(classType))
    .filter((classType): classType is XmlRecord => !!classType);

  return {
    Style: partId,
    Sku: productId,
    Url: url,
    Description: getString(mediaContent, 'description'),
    MediaType: getString(mediaContent, 'mediaType'),
    ClassTypeName: classTypes.map(classType => getString(classType, 'classTypeName')).filter(Boolean).join(','),
    ClassTypeId: classTypes.map(classType => getString(classType, 'classTypeId')).filter(Boolean).join(','),
  };
}

export async function loadPcnaCatalogFromXml(importsDir: string): Promise<PcnaXmlCatalogLoadResult> {
  const productDataFile = path.join(importsDir, 'Pcna.ProductData.xml');
  const pricingFile = path.join(importsDir, 'Pcna.ProductPricing.xml');
  const mediaFile = path.join(importsDir, 'Pcna.ProductMedia.xml');
  const decorationFile = path.join(importsDir, 'Pcna.ProductDecoration.xml');
  const productDataRows: PcnaProductDataRow[] = [];
  const pricingRows: PcnaPricingRow[] = [];
  const decorationRows: PcnaDecorationRow[] = [];
  const mediaRowsByStyle = new Map<string, PcnaMediaRow[]>();
  const productDataSnapshotsByStyle = new Map<string, ProductDataSnapshot>();

  await streamXmlElements(productDataFile, 'Item', async xml => {
    const item = parseElementRecord(xml, 'Item');
    const built = buildProductDataRowsFromItem(item);
    productDataRows.push(...built.rows);

    if (built.snapshot) {
      productDataSnapshotsByStyle.set(built.snapshot.product_id, built.snapshot);
    }
  });

  await streamXmlElements(pricingFile, 'ItemPrice', async xml => {
    pricingRows.push(...buildPricingRowsFromItemPrice(parseElementRecord(xml, 'ItemPrice')));
  });

  await streamXmlElements(decorationFile, 'ItemDecoration', async xml => {
    decorationRows.push(...buildDecorationRowsFromItemDecoration(parseElementRecord(xml, 'ItemDecoration')));
  });

  await streamXmlElements(mediaFile, 'MediaContent', async xml => {
    const row = buildMediaRowFromMediaContent(parseElementRecord(xml, 'MediaContent'));
    if (!row) {
      return;
    }

    const styleNumber = normalizeText(row.Sku);
    const entries = mediaRowsByStyle.get(styleNumber) ?? [];
    entries.push(row);
    mediaRowsByStyle.set(styleNumber, entries);
  });

  return {
    productDataRows,
    pricingRows,
    decorationRows,
    mediaRowsByStyle,
    productDataSnapshotsByStyle,
    sourceFiles: [
      'imports/Pcna.ProductData.xml',
      'imports/Pcna.ProductPricing.xml',
      'imports/Pcna.ProductMedia.xml',
      'imports/Pcna.ProductDecoration.xml',
      'imports/out/Price-List-Import.csv',
    ],
  };
}
