import { buildPriceListTargets } from '../etl/bigcommercePricingContext';
import type { NormalizedProduct, NormalizedVariant } from '../etl/productNormalizer';
import { projectProductPricing } from '../etl/pricingProjector';
import {
  buildVendorManagedMediaDescription,
  getSortedProductImageAssets,
  selectPrimaryProductImage,
  selectVariantPrimaryImage,
} from './vendorManagedMedia';
import { buildManagedSkuProjection } from './managedSkuProjection';

export const BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS = [
  'Item',
  'ID',
  'Name',
  'Type',
  'SKU',
  'Options',
  'Inventory Tracking',
  'Current Stock',
  'Low Stock',
  'Price',
  'Cost Price',
  'Retail Price',
  'Sale Price',
  'Brand ID',
  'Channels',
  'Categories',
  'Description',
  'Custom Fields',
  'Page Title',
  'Product URL',
  'Meta Description',
  'Search Keywords',
  'Meta Keywords',
  'Bin Picking Number',
  'UPC/EAN',
  'Global Trade Number',
  'Manufacturer Part Number',
  'Free Shipping',
  'Fixed Shipping Cost',
  'Weight',
  'Width',
  'Height',
  'Depth',
  'Is Visible',
  'Is Featured',
  'Warranty',
  'Tax Class',
  'Product Condition',
  'Show Product Condition',
  'Sort Order',
  'Variant Image URL',
  'Internal Image URL (Export)',
  'Image URL (Import)',
  'Image Description',
  'Image is Thumbnail',
  'Image Sort Order',
  'YouTube ID',
  'Video Title',
  'Video Description',
  'Video Sort Order',
] as const;

export interface BuildBigCommerceV3ProductImportInput {
  products: NormalizedProduct[];
  vendorId: number;
  markupPercent: number;
  categoryIdsByPath?: Map<string, string>;
  categoryIdsByVendorProductId?: Map<string, string>;
}

export interface BuildBigCommerceV3ProductImportResult {
  rows: Array<Record<string, string>>;
  report: {
    product_count: number;
    variant_row_count: number;
    row_count: number;
  };
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function createEmptyRow(): Record<string, string> {
  return Object.fromEntries(BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS.map(header => [header, '']));
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2);
}

function formatWeight(value: number | undefined): string {
  return value === undefined ? '0.00' : value.toFixed(2);
}

function formatStock(value: number | undefined): string {
  return String(Math.max(0, Math.round(value ?? 0)));
}

function formatBoolean(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}

function formatCategoryString(categories: string[] | undefined): string {
  if (!categories || categories.length === 0) {
    return '';
  }

  return categories.map(category => category.replace(/\s*>\s*/g, '/')).join(';');
}

function normalizeCategoryLookupKey(value: string): string {
  return normalizeText(value).replace(/\s*>\s*/g, '/');
}

function formatCategoryIds(
  categories: string[] | undefined,
  categoryIdsByPath: Map<string, string> | undefined,
): string {
  if (!categories || categories.length === 0 || !categoryIdsByPath || categoryIdsByPath.size === 0) {
    return '';
  }

  const categoryIds = Array.from(
    new Set(
      categories
        .map(category => categoryIdsByPath.get(normalizeCategoryLookupKey(category)) ?? '')
        .filter(categoryId => /^\d+$/.test(categoryId)),
    ),
  );

  return categoryIds.join(';');
}

function findVariantColorHex(product: NormalizedProduct, variant: NormalizedVariant): string | undefined {
  const explicitHex = normalizeText(variant.color_hex).replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(explicitHex)) {
    return explicitHex.toLowerCase();
  }

  const identityKeys = new Set(
    [variant.part_id, variant.sku, variant.source_sku].map(value => normalizeText(value)).filter(Boolean),
  );
  const matchingPart = (product.product_data?.parts ?? []).find(part =>
    identityKeys.has(normalizeText(part.part_id)),
  );
  const rawHex = normalizeText(matchingPart?.primary_color?.hex ?? matchingPart?.colors?.[0]?.hex).replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(rawHex) ? rawHex.toLowerCase() : undefined;
}

function canUseSwatchOption(product: NormalizedProduct): boolean {
  const colorVariants = (product.variants ?? []).filter(variant =>
    variant.option_values.some(optionValue => normalizeText(optionValue.option_display_name).toLowerCase() === 'color'),
  );

  return colorVariants.length > 0 && colorVariants.every(variant => !!findVariantColorHex(product, variant));
}


function slugifyProductName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

    return slug ? `/${slug}/` : '';
}

function normalizeImportImageUrl(url: string | undefined): string {
  const trimmed = normalizeText(url);
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }

    return parsed.toString();
  } catch {
    return '';
  }
}

function buildCustomFieldString(
  product: NormalizedProduct,
  input: { vendorId: number; markupPercent: number },
): string {
  const fields = [
    ...(product.custom_fields ?? []),
    { name: 'vendor_id', value: String(input.vendorId) },
    { name: 'duplicate', value: 'false' },
    ...(product.shared_option_values?.size ? [{ name: 'size', value: product.shared_option_values.size }] : []),
    { name: 'product_cost_markup', value: String(input.markupPercent) },
    ...(product.related_vendor_product_ids?.length
      ? [{ name: 'related_vendor_product_ids', value: product.related_vendor_product_ids.join(',') }]
      : []),
  ];

  const deduped = fields.filter(
    (field, index) =>
      fields.findIndex(candidate => candidate.name === field.name && candidate.value === field.value) === index,
  );

  return JSON.stringify(deduped.map(field => ({ name: field.name, value: field.value })));
}

function getDimensions(
  product: NormalizedProduct,
): { width?: number; height?: number; depth?: number } {
  if (!product.location_decoration_data || typeof product.location_decoration_data !== 'object') {
    return {};
  }

  const raw = product.location_decoration_data as { dimensions?: { width?: number; height?: number; depth?: number } };
  return raw.dimensions ?? {};
}

function resolveOptionType(product: NormalizedProduct, optionName: string): string {
  if (!optionName.toLowerCase().includes('color')) {
    return 'Rectangle';
  }

  return canUseSwatchOption(product) ? 'Swatch' : 'Rectangle';
}

function buildOptionValueLabel(product: NormalizedProduct, variant: NormalizedVariant, optionName: string, label: string): string {
  if (!optionName.toLowerCase().includes('color')) {
    return label;
  }

  const colorHex = findVariantColorHex(product, variant);
  return colorHex && canUseSwatchOption(product) ? `${label}[#${colorHex}]` : label;
}

function buildVariantOptions(product: NormalizedProduct, variant: NormalizedVariant): string {
  return variant.option_values
    .map(optionValue => {
      const optionName = normalizeText(optionValue.option_display_name);
      const label = normalizeText(optionValue.label);
      const valueLabel = buildOptionValueLabel(product, variant, optionName, label);
      return `Type=${resolveOptionType(product, optionName)}|Name=${optionName}|Value=${valueLabel}`;
    })
    .join('');
}

function buildImageRows(
  product: NormalizedProduct,
  imageAssets: ReturnType<typeof getSortedProductImageAssets>,
): Array<Record<string, string>> {
  const primaryImage = selectPrimaryProductImage(imageAssets);
  return imageAssets.flatMap((asset, index) => {
    const imageUrl = normalizeImportImageUrl(asset.url);
    if (!imageUrl) {
      return [];
    }

    const row = createEmptyRow();
    row.Item = 'Image';
    row['Image URL (Import)'] = imageUrl;
    row['Image Description'] = buildVendorManagedMediaDescription(product, asset);
    row['Image is Thumbnail'] = formatBoolean(
      !!primaryImage && primaryImage.url === asset.url && primaryImage.part_id === asset.part_id,
    );
    row['Image Sort Order'] = String(index);
    return [row];
  });
}

export function buildBigCommerceV3ProductImport(
  input: BuildBigCommerceV3ProductImportInput,
): BuildBigCommerceV3ProductImportResult {
  const rows: Array<Record<string, string>> = [];
  let variantRowCount = 0;
  const primaryPriceTarget = buildPriceListTargets({
    pricingContext: {
      markup_percent: input.markupPercent,
      price_list_id: 1,
      blanks_price_list_id: 2,
      currency: 'USD',
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    },
  })[0];

  for (const product of input.products) {
    const managedSkuProjection = buildManagedSkuProjection({
      vendorId: input.vendorId,
      product,
    });
    const pricing = projectProductPricing(product, {
      markup_percent: primaryPriceTarget?.markup_percent ?? input.markupPercent,
      price_list_id: primaryPriceTarget?.price_list_id ?? 1,
      currency: 'USD',
      family_preferences: primaryPriceTarget?.family_preferences,
      require_family_match: primaryPriceTarget?.require_family_match,
    });
    const dimensions = getDimensions(product);
    const stockLevel = (product.variants ?? []).reduce((sum, variant) => sum + (variant.inventory_level ?? 0), 0);
    const pricingBySku = new Map(pricing.variants.map(variant => [variant.sku, variant]));
    const imageAssets = getSortedProductImageAssets(product);

    const productRow = createEmptyRow();
    productRow.Item = 'Product';
    productRow.ID = '';
    productRow.Name = product.name;
    productRow.Type = 'physical';
    productRow.SKU = managedSkuProjection.productSku;
    productRow.Options = '';
    productRow['Inventory Tracking'] = product.variants?.length ? 'variant' : 'product';
    productRow['Current Stock'] = formatStock(product.variants?.length ? stockLevel : product.inventory_level);
    productRow['Low Stock'] = '0';
    productRow.Price = formatMoney(pricing.product_fallback.price);
    productRow['Cost Price'] = formatMoney(pricing.product_fallback.cost_price);
    productRow['Retail Price'] = '0.00';
    productRow['Sale Price'] = '0.00';
    productRow['Brand ID'] = '';
    productRow.Channels = '1';
    productRow.Categories =
      input.categoryIdsByVendorProductId?.get(normalizeText(product.vendor_product_id)) ??
      formatCategoryIds(product.categories, input.categoryIdsByPath);
    productRow.Description = product.description ?? '';
    productRow['Custom Fields'] = buildCustomFieldString(product, input);
    productRow['Page Title'] = '';
    productRow['Product URL'] = slugifyProductName(product.name);
    productRow['Meta Description'] = '';
    productRow['Search Keywords'] = product.search_keywords ?? '';
    productRow['Meta Keywords'] = '';
    productRow['Bin Picking Number'] = '';
    productRow['UPC/EAN'] = product.gtin ?? '';
    productRow['Global Trade Number'] = product.gtin ?? '';
    productRow['Manufacturer Part Number'] = managedSkuProjection.productMpn ?? '';
    productRow['Free Shipping'] = formatBoolean(false);
    productRow['Fixed Shipping Cost'] = '0.00';
    productRow.Weight = formatWeight(product.weight);
    productRow.Width = formatWeight(dimensions.width);
    productRow.Height = formatWeight(dimensions.height);
    productRow.Depth = formatWeight(dimensions.depth);
    productRow['Is Visible'] = formatBoolean(false);
    productRow['Is Featured'] = formatBoolean(false);
    productRow.Warranty = '';
    productRow['Tax Class'] = '0';
    productRow['Product Condition'] = 'New';
    productRow['Show Product Condition'] = formatBoolean(false);
    productRow['Sort Order'] = '0';
    rows.push(productRow);

    for (const variant of product.variants ?? []) {
      variantRowCount += 1;
      const variantPrice = pricingBySku.get(variant.sku);
      const variantRow = createEmptyRow();
      const variantImage = selectVariantPrimaryImage(imageAssets, variant);

      variantRow.Item = 'Variant';
      variantRow.ID = '';
      variantRow.Name = '';
      variantRow.Type = '';
      variantRow.SKU = managedSkuProjection.variantSkuBySourceSku.get(variant.sku) ?? variant.sku;
      variantRow.Options = buildVariantOptions(product, variant);
      variantRow['Inventory Tracking'] = '';
      variantRow['Current Stock'] = formatStock(variant.inventory_level);
      variantRow['Low Stock'] = '0';
      variantRow.Price = formatMoney(variantPrice?.price ?? variant.price);
      variantRow['Cost Price'] = formatMoney(variantPrice?.cost_price ?? variant.cost_price);
      variantRow['Bin Picking Number'] = '0';
      variantRow['UPC/EAN'] = variant.gtin ?? '';
      variantRow['Global Trade Number'] = variant.gtin ?? '';
      variantRow['Manufacturer Part Number'] = managedSkuProjection.variantMpnBySourceSku.get(variant.sku) ?? '';
      variantRow['Free Shipping'] = formatBoolean(false);
      variantRow.Weight = variant.weight !== undefined ? formatWeight(variant.weight) : '';
      if (variantImage) {
        variantRow['Variant Image URL'] = normalizeImportImageUrl(variantImage.url);
      }
      rows.push(variantRow);
    }

    rows.push(...buildImageRows(product, imageAssets));
  }

  return {
    rows,
    report: {
      product_count: input.products.length,
      variant_row_count: variantRowCount,
      row_count: rows.length,
    },
  };
}
