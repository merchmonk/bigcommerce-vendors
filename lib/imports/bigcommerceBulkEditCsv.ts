import type { NormalizedMediaAsset, NormalizedProduct, NormalizedVariant } from '../etl/productNormalizer';
import { projectProductPricing } from '../etl/pricingProjector';
import { buildVendorManagedMediaDescription } from './vendorManagedMedia';

const DEFAULT_PRODUCT_TAX_CLASS = 'Default Tax Class';
const MAX_PRODUCT_IMAGES = 250;
const PRODUCT_IMAGE_COLUMN_PREFIX = 'Product Image';

export interface BuildBulkEditCsvInput {
  templateHeaders: string[];
  products: NormalizedProduct[];
  vendorId: number;
  markupPercent: number;
}

export interface BulkEditParityReport {
  product_count: number;
  variant_count: number;
  rule_count: number;
  products_with_modifiers: number;
  products_with_pricing_configuration: number;
  products_with_related_vendor_product_ids: number;
  unsupported_features: string[];
}

export interface BuildBulkEditCsvResult {
  rows: Array<Record<string, string>>;
  report: BulkEditParityReport;
}

interface VariantImageSelection {
  imageUrl?: string;
  imageDescription?: string;
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2);
}

function formatWeight(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(4);
}

function formatInteger(value: number | undefined): string {
  if (value === undefined) {
    return '';
  }
  return String(Math.max(0, Math.round(value)));
}

function buildEmptyRow(headers: string[]): Record<string, string> {
  return Object.fromEntries(headers.map(header => [header, '']));
}

function formatCategoryValue(categories: string[] | undefined): string {
  if (!categories || categories.length === 0) {
    return '';
  }

  return categories.map(category => category.replace(/\s*>\s*/g, '/')).join(';');
}

function buildVariantSelectionLabel(optionValues: NormalizedVariant['option_values']): string {
  return optionValues.map(optionValue => `[RB]${optionValue.option_display_name}=${optionValue.label}`).join(',');
}

function buildProductCustomFields(product: NormalizedProduct, input: { vendorId: number; markupPercent: number }): string {
  const fields = [
    ...(product.custom_fields ?? []),
    { name: 'vendor_id', value: String(input.vendorId) },
    { name: 'duplicate', value: 'false' },
    ...(product.shared_option_values?.size ? [{ name: 'size', value: product.shared_option_values.size }] : []),
    { name: 'product_cost_markup', value: String(input.markupPercent) },
  ];

  const deduped = fields.filter(
    (field, index) =>
      fields.findIndex(candidate => candidate.name === field.name && candidate.value === field.value) === index,
  );

  return deduped.map(field => `${field.name}=${field.value}`).join(';');
}

function fillProductImageColumns(
  row: Record<string, string>,
  product: NormalizedProduct,
  assets: NormalizedMediaAsset[],
): void {
  assets.slice(0, MAX_PRODUCT_IMAGES).forEach((asset, index) => {
    const slot = index + 1;
    const fileColumn = `${PRODUCT_IMAGE_COLUMN_PREFIX} File - ${slot}`;
    const descriptionColumn = `${PRODUCT_IMAGE_COLUMN_PREFIX} Description - ${slot}`;
    const thumbnailColumn = `${PRODUCT_IMAGE_COLUMN_PREFIX} Is Thumbnail - ${slot}`;
    const sortColumn = `${PRODUCT_IMAGE_COLUMN_PREFIX} Sort - ${slot}`;

    if (!(fileColumn in row)) {
      return;
    }

    row[fileColumn] = asset.url;
    if (descriptionColumn in row) {
      row[descriptionColumn] = buildVendorManagedMediaDescription(product, asset);
    }
    if (thumbnailColumn in row) {
      row[thumbnailColumn] = index === 0 ? 'Y' : 'N';
    }
    if (sortColumn in row) {
      row[sortColumn] = String(index);
    }
  });
}

function buildVariantImageSelection(product: NormalizedProduct, variant: NormalizedVariant): VariantImageSelection {
  const images = (product.media_assets ?? []).filter(asset => asset.media_type === 'Image');
  const exactMatch = images.find(asset => asset.part_id && asset.part_id === variant.part_id);
  if (exactMatch) {
    return {
      imageUrl: exactMatch.url,
      imageDescription: buildVendorManagedMediaDescription(product, exactMatch),
    };
  }

  const fallback = images[0];
  return fallback
    ? {
        imageUrl: fallback.url,
        imageDescription: buildVendorManagedMediaDescription(product, fallback),
      }
    : {};
}

export function buildBulkEditCsv(input: BuildBulkEditCsvInput): BuildBulkEditCsvResult {
  const rows: Array<Record<string, string>> = [];
  let variantCount = 0;
  let ruleCount = 0;
  let productsWithModifiers = 0;
  let productsWithPricingConfiguration = 0;
  let productsWithRelatedVendorProductIds = 0;

  for (const product of input.products) {
    const pricing = projectProductPricing(product, {
      markup_percent: input.markupPercent,
      price_list_id: 1,
      currency: 'USD',
    });

    const productRow = buildEmptyRow(input.templateHeaders);
    productRow['Item Type'] = 'Product';
    productRow['Product Name'] = product.name;
    productRow['Product Type'] = 'P';
    productRow['Product Code/SKU'] = product.sku;
    productRow['Brand Name'] = product.brand_name ?? '';
    productRow['Option Set Align'] = 'Right';
    productRow['Product Description'] = product.description ?? '';
    productRow['Price'] = formatMoney(pricing.product_fallback.price);
    productRow['Cost Price'] = formatMoney(pricing.product_fallback.cost_price);
    productRow['Retail Price'] = '0.00';
    productRow['Sale Price'] = '0.00';
    productRow['Fixed Shipping Cost'] = '0.0000';
    productRow['Free Shipping'] = 'N';
    productRow['Product Warranty'] = '';
    productRow['Product Weight'] = formatWeight(product.weight);
    productRow['Product Width'] = formatWeight(
      product.location_decoration_data && typeof product.location_decoration_data === 'object'
        ? Number((product.location_decoration_data as { dimensions?: { width?: number } }).dimensions?.width)
        : undefined,
    );
    productRow['Product Height'] = formatWeight(
      product.location_decoration_data && typeof product.location_decoration_data === 'object'
        ? Number((product.location_decoration_data as { dimensions?: { height?: number } }).dimensions?.height)
        : undefined,
    );
    productRow['Product Depth'] = formatWeight(
      product.location_decoration_data && typeof product.location_decoration_data === 'object'
        ? Number((product.location_decoration_data as { dimensions?: { depth?: number } }).dimensions?.depth)
        : undefined,
    );
    productRow['Allow Purchases?'] = 'Y';
    productRow['Product Visible?'] = 'N';
    productRow['Track Inventory'] = product.variants?.length ? 'by option' : 'by product';
    productRow['Current Stock Level'] = formatInteger(
      product.variants?.reduce((total, variant) => total + (variant.inventory_level ?? 0), 0) ??
        product.inventory_level ??
        0,
    );
    productRow['Low Stock Level'] = '0';
    productRow['Category'] = formatCategoryValue(product.categories);
    productRow['Search Keywords'] = product.search_keywords ?? '';
    productRow['Product Condition'] = 'New';
    productRow['Show Product Condition?'] = 'N';
    productRow['Sort Order'] = '0';
    productRow['Product Tax Class'] = DEFAULT_PRODUCT_TAX_CLASS;
    productRow['Stop Processing Rules'] = 'N';
    productRow['Product Custom Fields'] = buildProductCustomFields(product, {
      vendorId: input.vendorId,
      markupPercent: input.markupPercent,
    });

    const productImages = (product.media_assets ?? []).filter(asset => asset.media_type === 'Image');
    fillProductImageColumns(productRow, product, productImages);
    rows.push(productRow);

    if (product.modifier_blueprint?.locations.length) {
      productsWithModifiers += 1;
    }
    if (product.pricing_configuration) {
      productsWithPricingConfiguration += 1;
    }
    if (product.related_vendor_product_ids?.length) {
      productsWithRelatedVendorProductIds += 1;
    }

    const variants = product.variants ?? [];
    const projectedVariantPricing = new Map(pricing.variants.map(variant => [variant.sku, variant]));

    for (const variant of variants) {
      variantCount += 1;
      const projected = projectedVariantPricing.get(variant.sku);

      const skuRow = buildEmptyRow(input.templateHeaders);
      skuRow['Item Type'] = 'SKU';
      skuRow['Product Name'] = buildVariantSelectionLabel(variant.option_values);
      skuRow['Product Code/SKU'] = variant.sku;
      skuRow['Price'] = formatMoney(projected?.price ?? variant.price);
      skuRow['Cost Price'] = formatMoney(projected?.cost_price ?? variant.cost_price);
      skuRow['Free Shipping'] = 'N';
      skuRow['Current Stock Level'] = formatInteger(variant.inventory_level ?? 0);
      skuRow['Low Stock Level'] = '0';
      rows.push(skuRow);

      const ruleRow = buildEmptyRow(input.templateHeaders);
      ruleRow['Item Type'] = 'Rule';
      ruleRow['Product Code/SKU'] = variant.sku;
      ruleRow['Price'] = projected?.price !== undefined ? `[FIXED]${formatMoney(projected.price)}` : '';
      ruleRow['Allow Purchases?'] = 'Y';
      ruleRow['Product Visible?'] = 'Y';
      ruleRow['Stop Processing Rules'] = 'N';
      const variantImage = buildVariantImageSelection(product, variant);
      if (variantImage.imageUrl && 'Product Image File - 1' in ruleRow) {
        ruleRow['Product Image File - 1'] = variantImage.imageUrl;
        if ('Product Image Description - 1' in ruleRow) {
          ruleRow['Product Image Description - 1'] = variantImage.imageDescription ?? '';
        }
        if ('Product Image Is Thumbnail - 1' in ruleRow) {
          ruleRow['Product Image Is Thumbnail - 1'] = 'N';
        }
      }
      rows.push(ruleRow);
      ruleCount += 1;
    }
  }

  const unsupportedFeatures = [
    'CSV import does not recreate MerchMonk product/variant metafields, so designer contract data still needs an API follow-up.',
    'CSV import does not recreate BigCommerce modifier structures for decoration options, so decoration modifiers still need an API follow-up.',
    'CSV import does not recreate B2B price list records or price-list bulk tiers, so B2B pricing still needs an API follow-up.',
  ];

  return {
    rows,
    report: {
      product_count: input.products.length,
      variant_count: variantCount,
      rule_count: ruleCount,
      products_with_modifiers: productsWithModifiers,
      products_with_pricing_configuration: productsWithPricingConfiguration,
      products_with_related_vendor_product_ids: productsWithRelatedVendorProductIds,
      unsupported_features: unsupportedFeatures,
    },
  };
}
