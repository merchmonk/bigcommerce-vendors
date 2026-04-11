import { buildPriceListTargets } from '../etl/bigcommercePricingContext';
import type { NormalizedProduct, NormalizedVariant } from '../etl/productNormalizer';
import { projectProductPricing } from '../etl/pricingProjector';
import {
  PRODUCT_CONTRACT_VERSION,
  projectBigCommerceProductContract,
} from '../etl/productContractProjector';
import {
  buildVendorManagedMediaDescription,
  getSortedProductImageAssets,
  selectVariantPrimaryImage,
} from './vendorManagedMedia';
import { buildManagedSkuProjection } from './managedSkuProjection';

export interface BuildBigCommerceExportBundleInput {
  productsTemplateHeaders: string[];
  skuTemplateHeaders: string[];
  products: NormalizedProduct[];
  vendorId: number;
  markupPercent: number;
}

export interface BuildBigCommerceExportBundleResult {
  productRows: Array<Record<string, string>>;
  skuRows: Array<Record<string, string>>;
  productMetafieldRows: Array<Record<string, string>>;
  variantMetafieldRows: Array<Record<string, string>>;
  report: {
    product_count: number;
    product_row_count: number;
    sku_row_count: number;
    product_metafield_count: number;
    variant_metafield_count: number;
  };
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function createEmptyRow(headers: string[]): Record<string, string> {
  return Object.fromEntries(headers.map(header => [header, '']));
}

function formatMoney(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(2);
}

function formatWeight(value: number | undefined): string {
  return value === undefined ? '' : value.toFixed(4);
}

function formatInventory(value: number | undefined): string {
  return String(Math.max(0, Math.round(value ?? 0)));
}

function formatBooleanFlag(value: boolean): string {
  return value ? '1' : '0';
}

function formatCategoryString(categories: string[] | undefined): string {
  if (!categories || categories.length === 0) {
    return '';
  }

  return categories.map(category => category.replace(/\s*>\s*/g, '/')).join(';');
}

function formatBrandAndName(product: NormalizedProduct): string {
  const brand = normalizeText(product.brand_name);
  return brand ? `${brand}  ${product.name}` : product.name;
}

function formatVariantRuleLabel(variant: NormalizedVariant): string {
  return variant.option_values.map(optionValue => `[RB]${optionValue.option_display_name}=${optionValue.label}`).join(',');
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
  return deduped.map(field => `${field.name}=${field.value}`).join(';');
}

function fillProductCoreFields(
  row: Record<string, string>,
  product: NormalizedProduct,
  input: {
    vendorId: number;
    markupPercent: number;
    price: number | undefined;
    costPrice: number | undefined;
    stockLevel: number;
  },
): void {
  row['Item Type'] = 'Product';
  row['Product SKU'] = product.sku;
  row['Product Name'] = product.name;
  row['Category String'] = formatCategoryString(product.categories);
  row['Weight'] = formatWeight(product.weight);
  row['Description'] = product.description ?? '';
  row['Price'] = formatMoney(input.price);
  row['Retail Price'] = '0.00';
  row['Sale Price'] = '0.00';
  row['Cost Price'] = formatMoney(input.costPrice);
  row['Calculated Price'] = formatMoney(input.price);
  row['Stock Level'] = formatInventory(input.stockLevel);
  row['Low Stock Level'] = '0';
  row['Track Inventory'] = product.variants?.length ? 'by option' : 'by product';
  row['Product Inventoried'] = '1';
  row['Sort Order'] = '0';
  row['Product Not Visible'] = '1';
  row['Product Visible'] = '0';
  row['Allow Purchases'] = '1';
  row['Minimum Purchase Quantity'] = '0';
  row['Maximum Purchase Quantity'] = '0';
  row['Free Shipping'] = '0';
  row['Fixed Shipping Price'] = '0.0000';
  row['Width'] = '0.0000';
  row['Height'] = '0.0000';
  row['Depth'] = '0.0000';
  row['Brand + Name'] = formatBrandAndName(product);
  row['Brand'] = product.brand_name ?? '';
  row['Product Condition'] = 'New';
  row['Show Product Condition'] = '0';
  row['Product UPC/EAN'] = product.gtin ?? '';
  row['Product Tax Class'] = 'Default Tax Class';
  row['Search Keywords'] = product.search_keywords ?? '';
  row['Option Set'] = '';
  row['Option Set Align'] = 'Right';
  row['Stop Processing Rules'] = '0';
  row['Product Custom Fields'] = buildCustomFieldString(product, input);
  row['Product Type'] = 'P';
  row['Event Date Required'] = '0';
  row['Event Date Is Limited'] = '0';
}

function buildProductRows(
  product: NormalizedProduct,
  headers: string[],
  input: {
    vendorId: number;
    markupPercent: number;
    price: number | undefined;
    costPrice: number | undefined;
    stockLevel: number;
  },
): Array<Record<string, string>> {
  const images = getSortedProductImageAssets(product);
  const baseRow = createEmptyRow(headers);
  fillProductCoreFields(baseRow, product, input);

  if (images.length === 0) {
    return [baseRow];
  }

  return images.map((image, index) => {
    const row = { ...baseRow };
    row['Product Image File'] = image.url.split('/').pop() ?? image.url;
    row['Product Image URL'] = image.url;
    row['Product Image Description'] = buildVendorManagedMediaDescription(product, image);
    row['Product Image Is Thumbnail'] = index === 0 ? '1' : '0';
    row['Product Image Index'] = String(index);
    return row;
  });
}

function buildSkuRows(
  product: NormalizedProduct,
  headers: string[],
  pricingBySku: Map<string, { price: number; costPrice: number }>,
  imageAssets: ReturnType<typeof getSortedProductImageAssets>,
): Array<Record<string, string>> {
  return (product.variants ?? []).flatMap(variant => {
    const pricing = pricingBySku.get(variant.sku);

    const skuRow = createEmptyRow(headers);
    skuRow['Item Type'] = '  SKU';
    skuRow['Product SKU'] = variant.sku;
    skuRow['Product Name'] = formatVariantRuleLabel(variant);
    skuRow['Price'] = formatMoney(pricing?.price ?? variant.price);
    skuRow['Cost Price'] = formatMoney(pricing?.costPrice ?? variant.cost_price);
    skuRow['Stock Level'] = formatInventory(variant.inventory_level);
    skuRow['Low Stock Level'] = '0';
    skuRow['Free Shipping'] = '0';

    const ruleRow = createEmptyRow(headers);
    ruleRow['Item Type'] = '  Rule';
    ruleRow['Product SKU'] = variant.sku;
    ruleRow['Price'] = pricing?.price !== undefined ? `[FIXED]${formatMoney(pricing.price)}` : '';
    ruleRow['Product Visible'] = 'Y';
    ruleRow['Allow Purchases'] = '1';
    ruleRow['Stop Processing Rules'] = '0';
    const primaryImage = selectVariantPrimaryImage(imageAssets, variant);
    if (primaryImage) {
      ruleRow['Product Image File'] = primaryImage.url.split('/').pop() ?? primaryImage.url;
      ruleRow['Product Image URL'] = primaryImage.url;
      ruleRow['Product Image Description'] = buildVendorManagedMediaDescription(product, primaryImage);
      ruleRow['Product Image Is Thumbnail'] = '0';
    }

    return [skuRow, ruleRow];
  });
}

function buildSkuExportRows(product: NormalizedProduct, headers: string[]): Array<Record<string, string>> {
  const variants = product.variants ?? [];
  if (variants.length === 0) {
    const row = createEmptyRow(headers);
    row['Product SKU'] = product.sku;
    row['Product UPC/EAN'] = product.gtin ?? '';
    row['Stock Level'] = formatInventory(product.inventory_level);
    row['Free Shipping'] = '0';
    row['Product Weight'] = formatWeight(product.weight);
    return [row];
  }

  return variants.map(variant => {
    const row = createEmptyRow(headers);
    row['Product SKU'] = variant.sku;
    row['Product UPC/EAN'] = variant.gtin ?? '';
    row['Stock Level'] = formatInventory(variant.inventory_level);
    row['Free Shipping'] = '0';
    row['Product Weight'] = formatWeight(variant.weight ?? product.weight);
    return row;
  });
}

export function buildBigCommerceExportBundle(
  input: BuildBigCommerceExportBundleInput,
): BuildBigCommerceExportBundleResult {
  const productRows: Array<Record<string, string>> = [];
  const skuRows: Array<Record<string, string>> = [];
  const productMetafieldRows: Array<Record<string, string>> = [];
  const variantMetafieldRows: Array<Record<string, string>> = [];
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
    const pricingBySku = new Map(
      pricing.variants.map(variant => [variant.sku, { price: variant.price, costPrice: variant.cost_price }]),
    );
    const stockLevel = (product.variants ?? []).reduce((sum, variant) => sum + (variant.inventory_level ?? 0), 0);
    const imageAssets = getSortedProductImageAssets(product);

    productRows.push(
      ...buildProductRows(product, input.productsTemplateHeaders, {
        vendorId: input.vendorId,
        markupPercent: input.markupPercent,
        price: pricing.product_fallback.price,
        costPrice: pricing.product_fallback.cost_price,
        stockLevel,
      }),
    );
    productRows.push(...buildSkuRows(product, input.productsTemplateHeaders, pricingBySku, imageAssets));
    skuRows.push(...buildSkuExportRows(product, input.skuTemplateHeaders));

    const contract = projectBigCommerceProductContract(product, {
      price_list_id: 1,
      currency: 'USD',
      markup_percent: input.markupPercent,
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    });

    productMetafieldRows.push({
      id: '',
      sku: managedSkuProjection.productSku,
      namespace: 'merchmonk',
      key: 'product_designer_defaults',
      description: '',
      permission_set: 'write_and_sf_access',
      value: JSON.stringify(contract.product_designer_defaults),
    });

    for (const metafield of contract.product_internal_metafields) {
      productMetafieldRows.push({
        id: '',
        sku: managedSkuProjection.productSku,
        namespace: 'merchmonk',
        key: metafield.key,
        description: '',
        permission_set: 'app_only',
        value: JSON.stringify(metafield.value),
      });
    }

    for (const override of contract.variant_designer_overrides) {
      variantMetafieldRows.push({
        id: '',
        sku: managedSkuProjection.variantSkuBySourceSku.get(override.sku) ?? override.sku,
        namespace: 'merchmonk',
        key: 'variant_designer_override',
        description: '',
        permission_set: 'write_and_sf_access',
        value: JSON.stringify(override.value),
      });
    }
  }

  return {
    productRows,
    skuRows,
    productMetafieldRows,
    variantMetafieldRows,
    report: {
      product_count: input.products.length,
      product_row_count: productRows.length,
      sku_row_count: skuRows.length,
      product_metafield_count: productMetafieldRows.length,
      variant_metafield_count: variantMetafieldRows.length,
    },
  };
}

export const BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS = [
  'id',
  'sku',
  'namespace',
  'key',
  'description',
  'permission_set',
  'value',
];

export { PRODUCT_CONTRACT_VERSION };
