export interface SharedOptionValues {
  vendor_id?: string;
  duplicate?: boolean;
  size?: string;
  product_cost_markup?: number;
}

export type EnrichmentSourceStatus = 'SUCCESS' | 'FAILED' | 'MISSING' | 'SKIPPED';

export interface ProductEnrichmentStatus {
  pricing: EnrichmentSourceStatus;
  inventory: EnrichmentSourceStatus;
  media: EnrichmentSourceStatus;
  gating_reasons?: string[];
  media_errors?: string[];
}

export interface ModifierCharge {
  location?: string;
  method?: string;
  count?: number;
  amount: number;
  code?: string;
  type?: string;
}

export interface DecorationMethodModel {
  method: string;
  charge_amount?: number;
}

export interface LocationModifierModel {
  location: string;
  min_decorations?: number;
  max_decorations?: number;
  methods: DecorationMethodModel[];
  included_decorations?: number;
}

export interface ProductModifierBlueprint {
  locations: LocationModifierModel[];
  charges: ModifierCharge[];
  metadata?: Record<string, unknown>;
}

export interface NormalizedProduct {
  sku: string;
  source_sku?: string;
  name: string;
  description?: string;
  price?: number;
  cost_price?: number;
  inventory_level?: number;
  vendor_product_id?: string;
  brand_name?: string;
  categories?: string[];
  variants?: NormalizedVariant[];
  bulk_pricing_rules?: NormalizedBulkPricingRule[];
  images?: Array<{ image_url: string; is_thumbnail?: boolean }>;
  custom_fields?: Array<{ name: string; value: string }>;
  search_keywords?: string;
  related_vendor_product_ids?: string[];
  location_decoration_data?: Record<string, unknown>;
  shared_option_values?: SharedOptionValues;
  modifier_blueprint?: ProductModifierBlueprint;
  enrichment_status?: ProductEnrichmentStatus;
}

export interface NormalizedVariant {
  sku: string;
  source_sku?: string;
  price?: number;
  cost_price?: number;
  inventory_level?: number;
  option_values: Array<{
    option_display_name: string;
    label: string;
  }>;
}

export interface NormalizedBulkPricingRule {
  quantity_min: number;
  quantity_max?: number;
  type: 'price' | 'percent';
  amount: number;
}

export interface ProductReference {
  productId: string;
  partId?: string;
}

type AnyRecord = Record<string, unknown>;

const SKU_KEYS = ['sku', 'SKU', 'partId', 'PartID', 'partID', 'itemNumber', 'ItemNumber', 'ProductID'];
const NAME_KEYS = ['name', 'Name', 'productName', 'ProductName', 'description', 'Description'];
const DESCRIPTION_KEYS = ['description', 'Description', 'productDescription', 'ProductDescription'];
const PRICE_KEYS = ['price', 'Price', 'netPrice', 'NetPrice', 'listPrice', 'ListPrice'];
const INVENTORY_KEYS = ['inventory', 'Inventory', 'qty', 'Qty', 'quantity', 'Quantity', 'quantityAvailable'];

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function getFirstString(node: AnyRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function getFirstNumber(node: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function walkNodes(value: unknown, callback: (node: AnyRecord) => void): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => walkNodes(item, callback));
    return;
  }
  if (typeof value !== 'object') return;

  const node = value as AnyRecord;
  callback(node);
  Object.values(node).forEach(child => walkNodes(child, callback));
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function mergeProducts(products: NormalizedProduct[]): NormalizedProduct[] {
  const bySku = new Map<string, NormalizedProduct>();
  for (const product of products) {
    const existing = bySku.get(product.sku);
    if (!existing) {
      bySku.set(product.sku, product);
      continue;
    }

    const mergedCustomFields = [...(existing.custom_fields ?? []), ...(product.custom_fields ?? [])];
    const uniqueCustomFields = mergedCustomFields.filter(
      (field, index) =>
        mergedCustomFields.findIndex(item => item.name === field.name && item.value === field.value) === index,
    );
    const mergedCategories = [...(existing.categories ?? []), ...(product.categories ?? [])];
    const uniqueCategories = mergedCategories.filter((value, index) => mergedCategories.indexOf(value) === index);
    const mergedRelated = [...(existing.related_vendor_product_ids ?? []), ...(product.related_vendor_product_ids ?? [])];
    const uniqueRelated = mergedRelated.filter((value, index) => mergedRelated.indexOf(value) === index);

    const mergedVariants = [...(existing.variants ?? []), ...(product.variants ?? [])];
    const uniqueVariants = mergedVariants.filter(
      (variant, index) => mergedVariants.findIndex(item => item.sku === variant.sku) === index,
    );

    const mergedBulkRules = [...(existing.bulk_pricing_rules ?? []), ...(product.bulk_pricing_rules ?? [])];
    const uniqueBulkRules = mergedBulkRules.filter(
      (rule, index) =>
        mergedBulkRules.findIndex(
          item =>
            item.quantity_min === rule.quantity_min &&
            item.quantity_max === rule.quantity_max &&
            item.amount === rule.amount &&
            item.type === rule.type,
        ) === index,
    );

    const mergedImages = [...(existing.images ?? []), ...(product.images ?? [])];
    const uniqueImages = mergedImages.filter(
      (image, index) => mergedImages.findIndex(item => item.image_url === image.image_url) === index,
    );

    bySku.set(product.sku, {
      sku: product.sku,
      source_sku: product.source_sku ?? existing.source_sku,
      vendor_product_id: product.vendor_product_id ?? existing.vendor_product_id,
      name: product.name || existing.name,
      description: product.description ?? existing.description,
      price: product.price ?? existing.price,
      cost_price: product.cost_price ?? existing.cost_price,
      inventory_level: product.inventory_level ?? existing.inventory_level,
      brand_name: product.brand_name ?? existing.brand_name,
      categories: uniqueCategories.length > 0 ? uniqueCategories : undefined,
      variants: uniqueVariants.length > 0 ? uniqueVariants : undefined,
      bulk_pricing_rules: uniqueBulkRules.length > 0 ? uniqueBulkRules : undefined,
      images: uniqueImages.length > 0 ? uniqueImages : undefined,
      custom_fields: uniqueCustomFields.length > 0 ? uniqueCustomFields : undefined,
      search_keywords: product.search_keywords ?? existing.search_keywords,
      related_vendor_product_ids: uniqueRelated.length > 0 ? uniqueRelated : undefined,
      location_decoration_data: product.location_decoration_data ?? existing.location_decoration_data,
      shared_option_values: {
        ...(existing.shared_option_values ?? {}),
        ...(product.shared_option_values ?? {}),
      },
      modifier_blueprint: product.modifier_blueprint ?? existing.modifier_blueprint,
      enrichment_status: product.enrichment_status ?? existing.enrichment_status,
    });
  }
  return Array.from(bySku.values());
}

function extractProductCategories(node: AnyRecord): string[] {
  const categoryArray = asRecord(node.ProductCategoryArray);
  if (!categoryArray) return [];

  return asArray(categoryArray.ProductCategory)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => {
      const category = getFirstString(item, ['category']);
      const subCategory = getFirstString(item, ['subCategory']);
      if (!category) return undefined;
      return subCategory ? `${category} > ${subCategory}` : category;
    })
    .filter((value): value is string => !!value);
}

function extractProductKeywords(node: AnyRecord): string[] {
  const keywordArray = asRecord(node.ProductKeywordArray);
  if (!keywordArray) return [];

  return asArray(keywordArray.ProductKeyword)
    .map(item => {
      if (typeof item === 'string') return item;
      const record = asRecord(item);
      return record ? getFirstString(record, ['keyword', 'Keyword', 'value']) : undefined;
    })
    .filter((value): value is string => !!value);
}

function extractRelatedProducts(node: AnyRecord): string[] {
  const relatedArray = asRecord(node.RelatedProductArray);
  if (!relatedArray) return [];

  return asArray(relatedArray.RelatedProduct)
    .map(item => {
      if (typeof item === 'string') return item;
      const record = asRecord(item);
      if (!record) return undefined;
      return getFirstString(record, ['productId', 'relatedProductId', 'id']);
    })
    .filter((value): value is string => !!value);
}

function extractProductPriceData(node: AnyRecord): {
  basePrice?: number;
  bulkPricingRules?: NormalizedBulkPricingRule[];
} {
  const productPriceGroupArray = asRecord(node.ProductPriceGroupArray);
  if (!productPriceGroupArray) return {};

  const tiers: Array<{ quantityMin: number; quantityMax?: number; price: number }> = [];
  for (const group of asArray(productPriceGroupArray.ProductPriceGroup)) {
    const groupRecord = asRecord(group);
    if (!groupRecord) continue;
    const productPriceArray = asRecord(groupRecord.ProductPriceArray);
    if (!productPriceArray) continue;

    for (const tier of asArray(productPriceArray.ProductPrice)) {
      const tierRecord = asRecord(tier);
      if (!tierRecord) continue;

      const quantityMin = toNumber(tierRecord.quantityMin);
      const quantityMax = toNumber(tierRecord.quantityMax);
      const price = toNumber(tierRecord.price);
      if (quantityMin === undefined || price === undefined) continue;

      tiers.push({
        quantityMin,
        quantityMax,
        price,
      });
    }
  }

  if (tiers.length === 0) return {};

  tiers.sort((a, b) => a.quantityMin - b.quantityMin);
  const baseTier = tiers[0];
  const bulkPricingRules = tiers
    .filter(tier => tier.quantityMin > baseTier.quantityMin)
    .map(tier => ({
      quantity_min: tier.quantityMin,
      quantity_max: tier.quantityMax,
      type: 'price' as const,
      amount: tier.price,
    }));

  return {
    basePrice: baseTier.price,
    bulkPricingRules: bulkPricingRules.length > 0 ? bulkPricingRules : undefined,
  };
}

function extractPartColor(part: AnyRecord): string | undefined {
  const primaryColor = asRecord(part.primaryColor);
  const primaryColorNode = asRecord(primaryColor?.Color);
  const colorFromPrimary = primaryColorNode
    ? getFirstString(primaryColorNode, ['colorName', 'standardColorName'])
    : undefined;
  if (colorFromPrimary) return colorFromPrimary;

  const colorArray = asRecord(part.ColorArray);
  const colorNode = asRecord(asArray(colorArray?.Color)[0]);
  return colorNode ? getFirstString(colorNode, ['colorName', 'standardColorName']) : undefined;
}

function extractPartSize(part: AnyRecord): string | undefined {
  const apparelSize = asRecord(part.ApparelSize);
  if (!apparelSize) return undefined;

  const customSize = getFirstString(apparelSize, ['customSize']);
  if (customSize) return customSize;
  return getFirstString(apparelSize, ['labelSize', 'labelSizeEnum']);
}

function extractVariantsFromProduct(
  node: AnyRecord,
  fallbackPrice?: number,
): { variants: NormalizedVariant[]; preferredBaseSku?: string; discoveredSizes: string[] } {
  const partArray = asRecord(node.ProductPartArray);
  if (!partArray) return { variants: [], discoveredSizes: [] };

  const parts = asArray(partArray.ProductPart)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item);
  if (parts.length === 0) return { variants: [], discoveredSizes: [] };

  const variants: NormalizedVariant[] = [];
  const discoveredSizes: string[] = [];
  for (const part of parts) {
    const partSku = getFirstString(part, ['partId', 'partID', 'sku', 'SKU']);
    if (!partSku) continue;

    const optionValues: NormalizedVariant['option_values'] = [];
    const color = extractPartColor(part);
    if (color) {
      optionValues.push({
        option_display_name: 'Color',
        label: color,
      });
    }

    const size = extractPartSize(part);
    if (size) {
      discoveredSizes.push(size);
      optionValues.push({
        option_display_name: 'Size',
        label: size,
      });
    }

    if (optionValues.length === 0 && parts.length > 1) {
      optionValues.push({
        option_display_name: 'Part',
        label: partSku,
      });
    }

    if (parts.length > 1 || optionValues.length > 0) {
      variants.push({
        sku: partSku,
        source_sku: partSku,
        price: fallbackPrice,
        cost_price: fallbackPrice,
        option_values: optionValues,
      });
    }
  }

  const firstPartSku = getFirstString(parts[0], ['partId', 'partID', 'sku', 'SKU']);
  return {
    variants,
    preferredBaseSku: firstPartSku,
    discoveredSizes: dedupeStrings(discoveredSizes),
  };
}

function normalizeProductDataGetProduct(
  endpointName: string,
  endpointVersion: string,
  operationName: string,
  payload: unknown,
  transformSchema?: Record<string, unknown>,
): NormalizedProduct[] {
  let productNode: AnyRecord | null = null;
  walkNodes(payload, node => {
    if (productNode) return;
    const productId = getFirstString(node, ['productId']);
    const productName = getFirstString(node, ['productName']);
    if (productId && productName) {
      productNode = node;
    }
  });

  if (!productNode) return [];

  const productId = getFirstString(productNode, ['productId']);
  const productName = getFirstString(productNode, ['productName']);
  if (!productId || !productName) return [];

  const descriptions = asArray(productNode.description)
    .map(item => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);
  const description = descriptions.length > 0 ? descriptions.join('\n') : undefined;

  const { basePrice, bulkPricingRules } = extractProductPriceData(productNode);
  const { variants, preferredBaseSku, discoveredSizes } = extractVariantsFromProduct(productNode, basePrice);
  const categories = extractProductCategories(productNode);
  const brandName = getFirstString(productNode, ['productBrand']);
  const primaryImageUrl = getFirstString(productNode, ['primaryImageUrl']);
  const lineName = getFirstString(productNode, ['lineName']);
  const keywords = extractProductKeywords(productNode);
  const relatedProducts = extractRelatedProducts(productNode);
  const sizeLabel = getFirstString(productNode, ['labelSizeEnum', 'labelSize']) ?? discoveredSizes[0];
  const locationDecorationData = asRecord(productNode.LocationDecorationArray) ?? undefined;
  const isCloseout = productNode.isCloseout;
  const isCloseoutValue =
    typeof isCloseout === 'boolean'
      ? String(isCloseout)
      : typeof isCloseout === 'string'
        ? isCloseout
        : undefined;

  const mappedCustomFields = Array.isArray(transformSchema?.custom_fields)
    ? (transformSchema?.custom_fields as Array<{ name?: string; value?: string }>)
        .filter(field => field?.name && field?.value !== undefined)
        .map(field => ({ name: String(field.name), value: String(field.value) }))
    : [];

  const customFields: Array<{ name: string; value: string }> = [
    { name: 'vendor_endpoint', value: endpointName },
    { name: 'vendor_version', value: endpointVersion },
    { name: 'vendor_operation', value: operationName },
    { name: 'vendor_product_id', value: productId },
    ...mappedCustomFields,
  ];
  if (lineName) {
    customFields.push({ name: 'line_name', value: lineName });
  }
  if (isCloseoutValue) {
    customFields.push({ name: 'is_closeout', value: isCloseoutValue });
  }

  const sku = variants.length > 0 ? productId : preferredBaseSku ?? productId;

  return [
    {
      sku,
      source_sku: sku,
      vendor_product_id: productId,
      name: productName,
      description,
      cost_price: basePrice,
      price: basePrice,
      brand_name: brandName,
      categories,
      variants: variants.length > 0 ? variants : undefined,
      bulk_pricing_rules: bulkPricingRules,
      images: primaryImageUrl ? [{ image_url: primaryImageUrl, is_thumbnail: true }] : undefined,
      custom_fields: customFields,
      search_keywords: keywords.length > 0 ? keywords.join(', ') : undefined,
      related_vendor_product_ids: relatedProducts.length > 0 ? relatedProducts : undefined,
      location_decoration_data: locationDecorationData,
      shared_option_values: {
        size: sizeLabel,
      },
    },
  ];
}

export function extractProductReferencesFromPayload(payload: unknown): ProductReference[] {
  const discovered: ProductReference[] = [];
  const seen = new Set<string>();

  walkNodes(payload, node => {
    const productId = getFirstString(node, ['productId']);
    if (!productId) return;
    const partId = getFirstString(node, ['partId', 'partID']);
    const key = `${productId}|${partId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    discovered.push({
      productId,
      partId,
    });
  });

  return discovered;
}

export function normalizeProductsFromEndpoint(
  endpointName: string,
  endpointVersion: string,
  operationName: string,
  payload: unknown,
  transformSchema?: Record<string, unknown>,
): NormalizedProduct[] {
  if (endpointName === 'ProductData' && operationName === 'getProduct') {
    const productDataResult = normalizeProductDataGetProduct(
      endpointName,
      endpointVersion,
      operationName,
      payload,
      transformSchema,
    );
    if (productDataResult.length > 0) {
      return productDataResult;
    }
  }

  const discovered: NormalizedProduct[] = [];
  const mappedCustomFields = Array.isArray(transformSchema?.custom_fields)
    ? (transformSchema?.custom_fields as Array<{ name?: string; value?: string }>)
        .filter(field => field?.name && field?.value !== undefined)
        .map(field => ({ name: String(field.name), value: String(field.value) }))
    : [];

  walkNodes(payload, node => {
    const sku = getFirstString(node, SKU_KEYS);
    if (!sku) return;

    const name = getFirstString(node, NAME_KEYS) ?? `Vendor product ${sku}`;
    const description = getFirstString(node, DESCRIPTION_KEYS);
    const price = getFirstNumber(node, PRICE_KEYS);
    const inventoryLevel = getFirstNumber(node, INVENTORY_KEYS);

    discovered.push({
      sku,
      source_sku: sku,
      name,
      description,
      price,
      cost_price: price,
      inventory_level: inventoryLevel,
      custom_fields: [
        { name: 'vendor_endpoint', value: endpointName },
        { name: 'vendor_version', value: endpointVersion },
        { name: 'vendor_operation', value: operationName },
        ...mappedCustomFields,
      ],
    });
  });

  return mergeProducts(discovered);
}
