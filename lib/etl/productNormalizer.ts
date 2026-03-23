export interface SharedOptionValues {
  vendor_id?: string;
  duplicate?: boolean;
  size?: string;
  product_cost_markup?: number;
}

export type NormalizedMediaType = 'Image' | 'Video';

export interface NormalizedMediaAsset {
  url: string;
  media_type: NormalizedMediaType;
  part_id?: string;
  location_ids?: string[];
  location_names?: string[];
  decoration_ids?: string[];
  decoration_names?: string[];
  description?: string;
  class_types?: string[];
  color?: string;
  single_part?: boolean;
  change_timestamp?: string;
  width?: number;
  height?: number;
  dpi?: number;
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

export interface NormalizedPhysicalDimensions {
  height?: number;
  width?: number;
  depth?: number;
  diameter?: number;
  uom?: string;
}

export interface NormalizedVariantPhysical {
  shape?: string;
  dimension?: NormalizedPhysicalDimensions;
  lead_time_days?: number;
  rush_service?: boolean;
}

export interface PricingConfigurationPartPriceTier {
  min_quantity: number;
  price: number;
  quantity_max?: number;
  price_uom?: string;
  discount_code?: string;
  price_effective_date?: string;
  price_expiry_date?: string;
}

export interface PricingConfigurationChargeTier {
  x_min_qty: number;
  x_uom?: string;
  y_min_qty?: number;
  y_uom?: string;
  price: number;
  repeat_price?: number;
  discount_code?: string;
  repeat_discount_code?: string;
  price_effective_date?: string;
  price_expiry_date?: string;
}

export interface PricingConfigurationCharge {
  charge_id?: string;
  charge_name?: string;
  charge_description?: string;
  charge_type?: string;
  charges_applies_ltm?: boolean;
  charges_per_location?: number;
  charges_per_color?: number;
  charge_price_tiers: PricingConfigurationChargeTier[];
}

export interface PricingConfigurationDecoration {
  decoration_id?: string;
  decoration_name?: string;
  decoration_geometry?: string;
  decoration_height?: number;
  decoration_width?: number;
  decoration_diameter?: number;
  decoration_uom?: string;
  allow_sub_for_default_location?: boolean;
  allow_sub_for_default_method?: boolean;
  item_part_quantity_ltm?: number;
  decoration_units_included?: number;
  decoration_units_included_uom?: string;
  decoration_units_max?: number;
  default_decoration?: boolean;
  lead_time_days?: number;
  rush_lead_time_days?: number;
  charges: PricingConfigurationCharge[];
}

export interface PricingConfigurationLocation {
  location_id?: string;
  location_name?: string;
  decorations_included?: number;
  default_location?: boolean;
  max_decoration?: number;
  min_decoration?: number;
  location_rank?: number;
  decorations: PricingConfigurationDecoration[];
}

export interface PricingConfigurationPart {
  part_id: string;
  part_description?: string;
  part_group?: string;
  next_part_group?: string;
  part_group_required?: boolean;
  part_group_description?: string;
  ratio?: number;
  default_part?: boolean;
  location_ids?: string[];
  price_tiers: PricingConfigurationPartPriceTier[];
}

export interface PricingConfigurationFobPoint {
  fob_id?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface ProductPricingConfiguration {
  product_id?: string;
  currency?: string;
  price_type?: string;
  parts: PricingConfigurationPart[];
  locations: PricingConfigurationLocation[];
  fob_points: PricingConfigurationFobPoint[];
  available_locations?: Array<{ location_id?: string; location_name?: string }>;
  available_charges?: Array<{
    charge_id?: string;
    charge_name?: string;
    charge_description?: string;
    charge_type?: string;
  }>;
}

export interface NormalizedProduct {
  sku: string;
  source_sku?: string;
  name: string;
  description?: string;
  gtin?: string;
  price?: number;
  cost_price?: number;
  weight?: number;
  inventory_level?: number;
  vendor_product_id?: string;
  brand_name?: string;
  categories?: string[];
  variants?: NormalizedVariant[];
  bulk_pricing_rules?: NormalizedBulkPricingRule[];
  images?: Array<{ image_url: string; is_thumbnail?: boolean }>;
  media_assets?: NormalizedMediaAsset[];
  custom_fields?: Array<{ name: string; value: string }>;
  search_keywords?: string;
  related_vendor_product_ids?: string[];
  location_decoration_data?: Record<string, unknown>;
  shared_option_values?: SharedOptionValues;
  modifier_blueprint?: ProductModifierBlueprint;
  pricing_configuration?: ProductPricingConfiguration;
  enrichment_status?: ProductEnrichmentStatus;
}

export interface NormalizedVariant {
  sku: string;
  source_sku?: string;
  part_id?: string;
  gtin?: string;
  price?: number;
  cost_price?: number;
  weight?: number;
  inventory_level?: number;
  color?: string;
  size?: string;
  physical?: NormalizedVariantPhysical;
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

function getNestedQuantityValue(value: unknown): number | undefined {
  const direct = toNumber(value);
  if (direct !== undefined) {
    return direct;
  }

  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const nestedQuantity = asRecord(record.Quantity) ?? asRecord(record.quantity);
  return (
    toNumber(nestedQuantity?.value) ??
    toNumber(nestedQuantity?.Value) ??
    toNumber(record.value) ??
    toNumber(record.Value)
  );
}

function getFirstInventoryNumber(node: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    if (!Object.hasOwn(node, key)) {
      continue;
    }

    const value = getNestedQuantityValue(node[key]);
    if (value !== undefined) {
      return value;
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

function normalizeWeightToPounds(weight: number, uom?: string): number | undefined {
  if (!Number.isFinite(weight) || weight <= 0) return undefined;

  const normalizedUom = uom?.trim().toUpperCase();
  if (!normalizedUom || normalizedUom === 'LB' || normalizedUom === 'LBS' || normalizedUom === 'POUND' || normalizedUom === 'POUNDS') {
    return weight;
  }
  if (normalizedUom === 'OZ' || normalizedUom === 'OUNCE' || normalizedUom === 'OUNCES') {
    return weight / 16;
  }
  if (normalizedUom === 'KG' || normalizedUom === 'KGS' || normalizedUom === 'KILOGRAM' || normalizedUom === 'KILOGRAMS') {
    return weight * 2.2046226218;
  }
  if (normalizedUom === 'G' || normalizedUom === 'GRAM' || normalizedUom === 'GRAMS') {
    return weight / 453.59237;
  }

  return weight;
}

function extractWeightInPounds(node: AnyRecord): number | undefined {
  const dimension = asRecord(node.Dimension);
  const weightFromDimension = toNumber(dimension?.weight);
  const weightUomFromDimension = getFirstString(dimension ?? {}, ['weightUom', 'uom']);
  const normalizedDimensionWeight =
    weightFromDimension !== undefined ? normalizeWeightToPounds(weightFromDimension, weightUomFromDimension) : undefined;
  if (normalizedDimensionWeight !== undefined) {
    return normalizedDimensionWeight;
  }

  const directWeight = getFirstNumber(node, ['weight', 'Weight']);
  const directWeightUom = getFirstString(node, ['weightUom', 'WeightUom', 'uom']);
  if (directWeight !== undefined) {
    return normalizeWeightToPounds(directWeight, directWeightUom);
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

function dedupeMediaAssets(assets: NormalizedMediaAsset[]): NormalizedMediaAsset[] {
  const seen = new Set<string>();
  const output: NormalizedMediaAsset[] = [];

  for (const asset of assets) {
    const key = [
      asset.media_type,
      asset.url,
      asset.part_id ?? '',
      (asset.location_ids ?? []).join(','),
      (asset.location_names ?? []).join(','),
      (asset.decoration_ids ?? []).join(','),
      (asset.decoration_names ?? []).join(','),
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(asset);
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
    const uniqueVariants = mergeVariantsBySku(mergedVariants);

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
    const mergedMediaAssets = [...(existing.media_assets ?? []), ...(product.media_assets ?? [])];
    const uniqueMediaAssets = dedupeMediaAssets(mergedMediaAssets);

    bySku.set(product.sku, {
      sku: product.sku,
      source_sku: product.source_sku ?? existing.source_sku,
      vendor_product_id: product.vendor_product_id ?? existing.vendor_product_id,
      name: product.name || existing.name,
      description: product.description ?? existing.description,
      price: product.price ?? existing.price,
      cost_price: product.cost_price ?? existing.cost_price,
      weight: product.weight ?? existing.weight,
      inventory_level: product.inventory_level ?? existing.inventory_level,
      brand_name: product.brand_name ?? existing.brand_name,
      categories: uniqueCategories.length > 0 ? uniqueCategories : undefined,
      variants: uniqueVariants.length > 0 ? uniqueVariants : undefined,
      bulk_pricing_rules: uniqueBulkRules.length > 0 ? uniqueBulkRules : undefined,
      images: uniqueImages.length > 0 ? uniqueImages : undefined,
      media_assets: uniqueMediaAssets.length > 0 ? uniqueMediaAssets : undefined,
      custom_fields: uniqueCustomFields.length > 0 ? uniqueCustomFields : undefined,
      search_keywords: product.search_keywords ?? existing.search_keywords,
      related_vendor_product_ids: uniqueRelated.length > 0 ? uniqueRelated : undefined,
      location_decoration_data: product.location_decoration_data ?? existing.location_decoration_data,
      shared_option_values: {
        ...(existing.shared_option_values ?? {}),
        ...(product.shared_option_values ?? {}),
      },
      modifier_blueprint: product.modifier_blueprint ?? existing.modifier_blueprint,
      pricing_configuration: product.pricing_configuration ?? existing.pricing_configuration,
      enrichment_status: product.enrichment_status ?? existing.enrichment_status,
    });
  }
  return Array.from(bySku.values());
}

function mergeVariantsBySku(variants: NormalizedVariant[]): NormalizedVariant[] {
  const bySku = new Map<string, NormalizedVariant>();
  for (const variant of variants) {
    const existing = bySku.get(variant.sku);
    if (!existing) {
      bySku.set(variant.sku, variant);
      continue;
    }

    bySku.set(variant.sku, {
      ...existing,
      ...variant,
      source_sku: variant.source_sku ?? existing.source_sku,
      part_id: variant.part_id ?? existing.part_id,
      price: variant.price ?? existing.price,
      cost_price: variant.cost_price ?? existing.cost_price,
      weight: variant.weight ?? existing.weight,
      inventory_level: variant.inventory_level ?? existing.inventory_level,
      color: variant.color ?? existing.color,
      size: variant.size ?? existing.size,
      physical: variant.physical ?? existing.physical,
      option_values: variant.option_values.length > 0 ? variant.option_values : existing.option_values,
    });
  }
  return Array.from(bySku.values());
}

function shouldOmitFlatVendorCategory(category: string): boolean {
  const normalized = category.trim().toLowerCase();
  if (normalized.length === 0) return true;
  if (normalized === 'branding solutions') return true;
  return normalized.startsWith('made in ');
}

function extractProductCategories(node: AnyRecord): string[] {
  const categoryArray = asRecord(node.ProductCategoryArray);
  if (!categoryArray) return [];

  const categories = asArray(categoryArray.ProductCategory)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => {
      const category = getFirstString(item, ['category']);
      const subCategory = getFirstString(item, ['subCategory']);
      return {
        category: category?.trim(),
        subCategory: subCategory?.trim(),
      };
    })
    .filter(value => !!value.category && value.category.length > 0 && value.category.length <= 50);

  const hierarchical = categories
    .filter(value => !!value.subCategory && value.subCategory.length > 0 && value.subCategory.length <= 50)
    .map(value => `${value.category} > ${value.subCategory}`);

  if (hierarchical.length > 0) {
    return dedupeStrings(hierarchical);
  }

  return dedupeStrings(
    categories
      .map(value => value.category)
      .filter((value): value is string => !!value && !shouldOmitFlatVendorCategory(value)),
  );
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

function extractGtin(node: AnyRecord): string | undefined {
  const direct = getFirstString(node, [
    'gtin',
    'GTIN',
    'upc',
    'UPC',
    'ean',
    'EAN',
    'barcode',
    'Barcode',
  ]);
  if (direct) {
    return direct;
  }

  const identifierArray = asRecord(node.ProductIdentifierArray ?? node.PartIdentifierArray ?? node.IdentifierArray);
  if (!identifierArray) {
    return undefined;
  }

  const identifiers = asArray(
    identifierArray.ProductIdentifier ??
      identifierArray.PartIdentifier ??
      identifierArray.Identifier,
  )
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item);

  for (const identifier of identifiers) {
    const type = getFirstString(identifier, ['type', 'identifierType', 'IdentifierType'])?.trim().toLowerCase();
    if (type && !['gtin', 'upc', 'ean', 'barcode'].includes(type)) {
      continue;
    }

    const value = getFirstString(identifier, ['value', 'identifier', 'identifierValue', 'IdentifierValue']);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function extractPartPhysical(part: AnyRecord): NormalizedVariantPhysical | undefined {
  const dimension = asRecord(part.Dimension);
  const physical: NormalizedVariantPhysical = {
    shape: getFirstString(part, ['shape']),
    lead_time_days: getFirstNumber(part, ['leadTime']),
    rush_service:
      typeof part.isRushService === 'boolean'
        ? part.isRushService
        : typeof part.isRushService === 'string'
          ? part.isRushService.toLowerCase() === 'true'
          : undefined,
  };

  if (dimension) {
    physical.dimension = {
      height: getFirstNumber(dimension, ['height']),
      width: getFirstNumber(dimension, ['width']),
      depth: getFirstNumber(dimension, ['depth']),
      diameter: getFirstNumber(dimension, ['diameter']),
      uom: getFirstString(dimension, ['dimensionUom', 'uom']),
    };
  }

  if (
    physical.shape === undefined &&
    physical.lead_time_days === undefined &&
    physical.rush_service === undefined &&
    !physical.dimension
  ) {
    return undefined;
  }

  return physical;
}

function extractVariantsFromProduct(
  node: AnyRecord,
  fallbackPrice?: number,
): {
  variants: NormalizedVariant[];
  preferredBaseSku?: string;
  discoveredSizes: string[];
  preferredWeight?: number;
  preferredBaseGtin?: string;
} {
  const partArray = asRecord(node.ProductPartArray);
  if (!partArray) return { variants: [], discoveredSizes: [] };

  const parts = asArray(partArray.ProductPart)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item);
  if (parts.length === 0) return { variants: [], discoveredSizes: [] };

  const variants: NormalizedVariant[] = [];
  const discoveredSizes: string[] = [];
  let preferredWeight: number | undefined;
  let preferredBaseGtin: string | undefined;
  for (const part of parts) {
    const partSku = getFirstString(part, ['partId', 'partID', 'sku', 'SKU']);
    if (!partSku) continue;
    const partWeight = extractWeightInPounds(part);
    const partGtin = extractGtin(part);
    if (preferredWeight === undefined && partWeight !== undefined) {
      preferredWeight = partWeight;
    }
    if (preferredBaseGtin === undefined && partGtin) {
      preferredBaseGtin = partGtin;
    }

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
        part_id: partSku,
        gtin: partGtin,
        price: fallbackPrice,
        cost_price: fallbackPrice,
        weight: partWeight,
        color,
        size,
        physical: extractPartPhysical(part),
        option_values: optionValues,
      });
    }
  }

  const uniqueVariants = ensureUniqueVariantOptionCombinations(variants);
  const firstPartSku = getFirstString(parts[0], ['partId', 'partID', 'sku', 'SKU']);
  return {
    variants: uniqueVariants,
    preferredBaseSku: firstPartSku,
    discoveredSizes: dedupeStrings(discoveredSizes),
    preferredWeight,
    preferredBaseGtin,
  };
}

function serializeVariantOptionCombination(
  optionValues: NormalizedVariant['option_values'],
): string {
  return optionValues
    .map(optionValue => {
      const displayName = optionValue.option_display_name.trim().toLowerCase();
      const label = optionValue.label.trim().toLowerCase();
      return `${displayName}:${label}`;
    })
    .sort()
    .join('|');
}

function ensureUniqueVariantOptionCombinations(
  variants: NormalizedVariant[],
): NormalizedVariant[] {
  const combinationCounts = new Map<string, number>();
  for (const variant of variants) {
    const key = serializeVariantOptionCombination(variant.option_values);
    combinationCounts.set(key, (combinationCounts.get(key) ?? 0) + 1);
  }

  return variants.map(variant => {
    const key = serializeVariantOptionCombination(variant.option_values);
    if ((combinationCounts.get(key) ?? 0) <= 1) {
      return variant;
    }

    const hasPartOption = variant.option_values.some(
      optionValue => optionValue.option_display_name.trim().toLowerCase() === 'part',
    );
    if (hasPartOption) {
      return variant;
    }

    return {
      ...variant,
      option_values: [
        ...variant.option_values,
        {
          option_display_name: 'Part',
          label: variant.part_id ?? variant.sku,
        },
      ],
    };
  });
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
  const {
    variants,
    preferredBaseSku,
    discoveredSizes,
    preferredWeight,
    preferredBaseGtin,
  } = extractVariantsFromProduct(productNode, basePrice);
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
  const productWeight = extractWeightInPounds(productNode) ?? preferredWeight;
  const productGtin = extractGtin(productNode) ?? preferredBaseGtin;

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
      gtin: productGtin,
      cost_price: basePrice,
      price: basePrice,
      weight: productWeight,
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
    const inventoryLevel = getFirstInventoryNumber(node, INVENTORY_KEYS);

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
