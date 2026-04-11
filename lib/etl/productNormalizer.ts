export interface SharedOptionValues {
  vendor_id?: string;
  duplicate?: boolean;
  size?: string;
  product_cost_markup?: number;
}

export type NormalizedMediaType = 'Image' | 'Video';

export interface NormalizedMediaClassType {
  class_type_id?: string;
  class_type_name?: string;
}

export interface NormalizedMediaAsset {
  url: string;
  media_type: NormalizedMediaType;
  product_id?: string;
  part_id?: string;
  location_ids?: string[];
  location_names?: string[];
  decoration_ids?: string[];
  decoration_names?: string[];
  description?: string;
  class_type_array?: NormalizedMediaClassType[];
  class_types?: string[];
  file_size?: number;
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
  currency?: string;
  price_type?: string;
  configuration_type?: string;
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
  supported_currencies?: string[];
  product_ids?: string[];
}

export interface PricingConfigurationDecorationColor {
  product_id?: string;
  location_id?: string;
  pms_match?: boolean;
  full_color?: boolean;
  colors: Array<{
    color_id?: string;
    color_name?: string;
  }>;
  decoration_methods: Array<{
    decoration_id?: string;
    decoration_name?: string;
  }>;
}

export interface ProductPricingConfiguration {
  product_id?: string;
  currency?: string;
  price_type?: string;
  configuration_type?: string;
  fob_postal_code?: string;
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
  decoration_colors?: PricingConfigurationDecorationColor[];
}

export interface ProductDataColorSnapshot {
  color_name?: string;
  hex?: string;
  approximate_pms?: string;
  standard_color_name?: string;
}

export interface ProductDataSpecificationSnapshot {
  specification_type?: string;
  specification_uom?: string;
  measurement_value?: string;
}

export interface ProductDataApparelSizeSnapshot {
  apparel_style?: string;
  label_size?: string;
  custom_size?: string;
}

export interface ProductDataDimensionSnapshot {
  dimension_uom?: string;
  depth?: number;
  height?: number;
  width?: number;
  weight_uom?: string;
  weight?: number;
}

export interface ProductDataPackageSnapshot {
  default?: boolean;
  package_type?: string;
  description?: string;
  quantity?: number;
  dimension_uom?: string;
  depth?: number;
  height?: number;
  width?: number;
  weight_uom?: string;
  weight?: number;
}

export interface ProductDataRelatedProductSnapshot {
  relation_type?: string;
  product_id?: string;
  part_id?: string;
}

export interface ProductDataMarketingPointSnapshot {
  point_type?: string;
  point_copy?: string;
}

export interface ProductDataCategorySnapshot {
  category?: string;
  sub_category?: string;
}

export interface ProductDataLocationDecorationSnapshot {
  location_name?: string;
  max_imprint_colors?: number;
  decoration_name?: string;
  location_decoration_combo_default?: boolean;
  price_includes?: boolean;
}

export interface ProductDataFobPointSnapshot {
  fob_id?: string;
  fob_postal_code?: string;
  fob_city?: string;
  fob_state?: string;
  fob_country?: string;
}

export interface ProductDataPriceSnapshot {
  quantity_min?: number;
  quantity_max?: number;
  price?: number;
  discount_code?: string;
}

export interface ProductDataPriceGroupSnapshot {
  group_name?: string;
  currency?: string;
  description?: string;
  prices: ProductDataPriceSnapshot[];
}

export interface ProductDataPartSnapshot {
  part_id?: string;
  description?: string[];
  country_of_origin?: string;
  colors?: ProductDataColorSnapshot[];
  primary_color?: ProductDataColorSnapshot;
  primary_material?: string;
  specifications?: ProductDataSpecificationSnapshot[];
  shape?: string;
  apparel_size?: ProductDataApparelSizeSnapshot;
  dimension?: ProductDataDimensionSnapshot;
  lead_time?: number;
  unspsc?: string;
  gtin?: string;
  is_rush_service?: boolean;
  product_packaging?: ProductDataPackageSnapshot[];
  shipping_packages?: ProductDataPackageSnapshot[];
  end_date?: string;
  effective_date?: string;
  is_closeout?: boolean;
  is_caution?: boolean;
  caution_comment?: string;
  nmfc_code?: number;
  nmfc_description?: string;
  nmfc_number?: string;
  is_on_demand?: boolean;
  is_hazmat?: boolean;
}

export interface ProductDataSnapshot {
  product_id: string;
  product_name: string;
  description?: string[];
  price_expires_date?: string;
  marketing_points?: ProductDataMarketingPointSnapshot[];
  keywords?: string[];
  product_brand?: string;
  export?: boolean;
  categories?: ProductDataCategorySnapshot[];
  related_products?: ProductDataRelatedProductSnapshot[];
  last_change_date?: string;
  creation_date?: string;
  end_date?: string;
  effective_date?: string;
  is_caution?: boolean;
  caution_comment?: string;
  is_closeout?: boolean;
  line_name?: string;
  primary_image_url?: string;
  product_price_groups?: ProductDataPriceGroupSnapshot[];
  compliance_info_available?: boolean;
  unspsc_commodity_code?: number;
  imprint_size?: string;
  default_set_up_charge?: string;
  default_run_charge?: string;
  fob_points?: ProductDataFobPointSnapshot[];
  location_decorations?: ProductDataLocationDecorationSnapshot[];
  parts?: ProductDataPartSnapshot[];
}

export interface NormalizedProduct {
  sku: string;
  source_sku?: string;
  name: string;
  description?: string;
  gtin?: string;
  price?: number;
  cost_price?: number;
  min_purchase_quantity?: number;
  max_purchase_quantity?: number;
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
  product_data?: ProductDataSnapshot;
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
  min_purchase_quantity?: number;
  max_purchase_quantity?: number;
  weight?: number;
  inventory_level?: number;
  color?: string;
  color_hex?: string;
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

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }

  return undefined;
}

function extractDescriptionArray(value: unknown): string[] | undefined {
  const descriptions = asArray(value)
    .map(item => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
    .filter(Boolean);

  return descriptions.length > 0 ? descriptions : undefined;
}

function extractProductDataColor(value: unknown): ProductDataColorSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const color = {
    ...(getFirstString(record, ['colorName']) ? { color_name: getFirstString(record, ['colorName']) } : {}),
    ...(getFirstString(record, ['hex']) ? { hex: getFirstString(record, ['hex']) } : {}),
    ...(getFirstString(record, ['approximatePms']) ? { approximate_pms: getFirstString(record, ['approximatePms']) } : {}),
    ...(getFirstString(record, ['standardColorName']) ? { standard_color_name: getFirstString(record, ['standardColorName']) } : {}),
  };

  return Object.keys(color).length > 0 ? color : undefined;
}

function extractProductDataColors(node: AnyRecord): ProductDataColorSnapshot[] | undefined {
  const colorArray = asRecord(node.ColorArray);
  if (!colorArray) return undefined;

  const colors = asArray(colorArray.Color)
    .map(extractProductDataColor)
    .filter((value): value is ProductDataColorSnapshot => !!value);

  return colors.length > 0 ? colors : undefined;
}

function extractProductDataSpecification(value: unknown): ProductDataSpecificationSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const specification = {
    ...(getFirstString(record, ['specificationType']) ? { specification_type: getFirstString(record, ['specificationType']) } : {}),
    ...(getFirstString(record, ['specificationUom']) ? { specification_uom: getFirstString(record, ['specificationUom']) } : {}),
    ...(getFirstString(record, ['measurementValue']) ? { measurement_value: getFirstString(record, ['measurementValue']) } : {}),
  };

  return Object.keys(specification).length > 0 ? specification : undefined;
}

function extractProductDataSpecifications(node: AnyRecord): ProductDataSpecificationSnapshot[] | undefined {
  const specificationArray = asRecord(node.SpecificationArray);
  if (!specificationArray) return undefined;

  const specifications = asArray(specificationArray.Specification)
    .map(extractProductDataSpecification)
    .filter((value): value is ProductDataSpecificationSnapshot => !!value);

  return specifications.length > 0 ? specifications : undefined;
}

function extractProductDataApparelSize(value: unknown): ProductDataApparelSizeSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const apparelSize = {
    ...(getFirstString(record, ['apparelStyle']) ? { apparel_style: getFirstString(record, ['apparelStyle']) } : {}),
    ...(getFirstString(record, ['labelSize', 'labelSizeEnum']) ? { label_size: getFirstString(record, ['labelSize', 'labelSizeEnum']) } : {}),
    ...(getFirstString(record, ['customSize']) ? { custom_size: getFirstString(record, ['customSize']) } : {}),
  };

  return Object.keys(apparelSize).length > 0 ? apparelSize : undefined;
}

function extractProductDataDimension(value: unknown): ProductDataDimensionSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const dimension = {
    ...(getFirstString(record, ['dimensionUom', 'uom']) ? { dimension_uom: getFirstString(record, ['dimensionUom', 'uom']) } : {}),
    ...(getFirstNumber(record, ['depth']) !== undefined ? { depth: getFirstNumber(record, ['depth']) } : {}),
    ...(getFirstNumber(record, ['height']) !== undefined ? { height: getFirstNumber(record, ['height']) } : {}),
    ...(getFirstNumber(record, ['width']) !== undefined ? { width: getFirstNumber(record, ['width']) } : {}),
    ...(getFirstString(record, ['weightUom']) ? { weight_uom: getFirstString(record, ['weightUom']) } : {}),
    ...(getFirstNumber(record, ['weight']) !== undefined ? { weight: getFirstNumber(record, ['weight']) } : {}),
  };

  return Object.keys(dimension).length > 0 ? dimension : undefined;
}

function extractProductDataPackage(value: unknown): ProductDataPackageSnapshot | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const productPackage = {
    ...(toBoolean(record.default) !== undefined ? { default: toBoolean(record.default) } : {}),
    ...(getFirstString(record, ['packageType']) ? { package_type: getFirstString(record, ['packageType']) } : {}),
    ...(getFirstString(record, ['description']) ? { description: getFirstString(record, ['description']) } : {}),
    ...(getFirstNumber(record, ['quantity']) !== undefined ? { quantity: getFirstNumber(record, ['quantity']) } : {}),
    ...(getFirstString(record, ['dimensionUom']) ? { dimension_uom: getFirstString(record, ['dimensionUom']) } : {}),
    ...(getFirstNumber(record, ['depth']) !== undefined ? { depth: getFirstNumber(record, ['depth']) } : {}),
    ...(getFirstNumber(record, ['height']) !== undefined ? { height: getFirstNumber(record, ['height']) } : {}),
    ...(getFirstNumber(record, ['width']) !== undefined ? { width: getFirstNumber(record, ['width']) } : {}),
    ...(getFirstString(record, ['weightUom']) ? { weight_uom: getFirstString(record, ['weightUom']) } : {}),
    ...(getFirstNumber(record, ['weight']) !== undefined ? { weight: getFirstNumber(record, ['weight']) } : {}),
  };

  return Object.keys(productPackage).length > 0 ? productPackage : undefined;
}

function extractProductDataPackages(node: AnyRecord, key: 'ProductPackagingArray' | 'ShippingPackageArray'): ProductDataPackageSnapshot[] | undefined {
  const packageArray = asRecord(node[key]);
  if (!packageArray) return undefined;
  const recordKey = key === 'ProductPackagingArray' ? 'ProductPackaging' : 'ShippingPackage';
  const packages = asArray(packageArray[recordKey])
    .map(extractProductDataPackage)
    .filter((value): value is ProductDataPackageSnapshot => !!value);

  return packages.length > 0 ? packages : undefined;
}

function extractProductDataMarketingPoints(node: AnyRecord): ProductDataMarketingPointSnapshot[] | undefined {
  const marketingPointArray = asRecord(node.ProductMarketingPointArray);
  if (!marketingPointArray) return undefined;

  const marketingPoints = asArray(marketingPointArray.ProductMarketingPoint)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => ({
      ...(getFirstString(item, ['pointType']) ? { point_type: getFirstString(item, ['pointType']) } : {}),
      ...(getFirstString(item, ['pointCopy']) ? { point_copy: getFirstString(item, ['pointCopy']) } : {}),
    }))
    .filter(item => Object.keys(item).length > 0);

  return marketingPoints.length > 0 ? marketingPoints : undefined;
}

function extractProductDataCategories(node: AnyRecord): ProductDataCategorySnapshot[] | undefined {
  const categoryArray = asRecord(node.ProductCategoryArray);
  if (!categoryArray) return undefined;

  const categories = asArray(categoryArray.ProductCategory)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => ({
      ...(getFirstString(item, ['category']) ? { category: getFirstString(item, ['category']) } : {}),
      ...(getFirstString(item, ['subCategory']) ? { sub_category: getFirstString(item, ['subCategory']) } : {}),
    }))
    .filter(item => Object.keys(item).length > 0);

  return categories.length > 0 ? categories : undefined;
}

function extractProductDataRelatedProducts(node: AnyRecord): ProductDataRelatedProductSnapshot[] | undefined {
  const relatedArray = asRecord(node.RelatedProductArray);
  if (!relatedArray) return undefined;

  const relatedProducts = asArray(relatedArray.RelatedProduct)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => ({
      ...(getFirstString(item, ['relationType']) ? { relation_type: getFirstString(item, ['relationType']) } : {}),
      ...(getFirstString(item, ['productId']) ? { product_id: getFirstString(item, ['productId']) } : {}),
      ...(getFirstString(item, ['partId', 'partID']) ? { part_id: getFirstString(item, ['partId', 'partID']) } : {}),
    }))
    .filter(item => Object.keys(item).length > 0);

  return relatedProducts.length > 0 ? relatedProducts : undefined;
}

function extractProductDataLocationDecorations(node: AnyRecord): ProductDataLocationDecorationSnapshot[] | undefined {
  const locationDecorationArray = asRecord(node.LocationDecorationArray);
  if (!locationDecorationArray) return undefined;

  const locationDecorations = asArray(locationDecorationArray.LocationDecoration)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => ({
      ...(getFirstString(item, ['locationName']) ? { location_name: getFirstString(item, ['locationName']) } : {}),
      ...(getFirstNumber(item, ['maxImprintColors']) !== undefined ? { max_imprint_colors: getFirstNumber(item, ['maxImprintColors']) } : {}),
      ...(getFirstString(item, ['decorationName']) ? { decoration_name: getFirstString(item, ['decorationName']) } : {}),
      ...(toBoolean(item.locationDecorationComboDefault) !== undefined
        ? { location_decoration_combo_default: toBoolean(item.locationDecorationComboDefault) }
        : {}),
      ...(toBoolean(item.priceIncludes) !== undefined ? { price_includes: toBoolean(item.priceIncludes) } : {}),
    }))
    .filter(item => Object.keys(item).length > 0);

  return locationDecorations.length > 0 ? locationDecorations : undefined;
}

function extractProductDataFobPoints(node: AnyRecord): ProductDataFobPointSnapshot[] | undefined {
  const fobPointArray = asRecord(node.FobPointArray);
  if (!fobPointArray) return undefined;

  const fobPoints = asArray(fobPointArray.FobPoint)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => ({
      ...(getFirstString(item, ['fobId']) ? { fob_id: getFirstString(item, ['fobId']) } : {}),
      ...(getFirstString(item, ['fobPostalCode']) ? { fob_postal_code: getFirstString(item, ['fobPostalCode']) } : {}),
      ...(getFirstString(item, ['fobCity']) ? { fob_city: getFirstString(item, ['fobCity']) } : {}),
      ...(getFirstString(item, ['fobState']) ? { fob_state: getFirstString(item, ['fobState']) } : {}),
      ...(getFirstString(item, ['fobCountry']) ? { fob_country: getFirstString(item, ['fobCountry']) } : {}),
    }))
    .filter(item => Object.keys(item).length > 0);

  return fobPoints.length > 0 ? fobPoints : undefined;
}

function extractProductDataPriceGroups(node: AnyRecord): ProductDataPriceGroupSnapshot[] | undefined {
  const productPriceGroupArray = asRecord(node.ProductPriceGroupArray);
  if (!productPriceGroupArray) return undefined;

  const groups = asArray(productPriceGroupArray.ProductPriceGroup)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => {
      const productPriceArray = asRecord(item.ProductPriceArray);
      const prices = asArray(productPriceArray?.ProductPrice)
        .map(priceItem => asRecord(priceItem))
        .filter((priceItem): priceItem is AnyRecord => !!priceItem)
        .map(priceItem => ({
          ...(getFirstNumber(priceItem, ['quantityMin']) !== undefined ? { quantity_min: getFirstNumber(priceItem, ['quantityMin']) } : {}),
          ...(getFirstNumber(priceItem, ['quantityMax']) !== undefined ? { quantity_max: getFirstNumber(priceItem, ['quantityMax']) } : {}),
          ...(getFirstNumber(priceItem, ['price']) !== undefined ? { price: getFirstNumber(priceItem, ['price']) } : {}),
          ...(getFirstString(priceItem, ['discountCode']) ? { discount_code: getFirstString(priceItem, ['discountCode']) } : {}),
        }))
        .filter(price => Object.keys(price).length > 0);

      return {
        ...(getFirstString(item, ['groupName']) ? { group_name: getFirstString(item, ['groupName']) } : {}),
        ...(getFirstString(item, ['currency']) ? { currency: getFirstString(item, ['currency']) } : {}),
        ...(getFirstString(item, ['description']) ? { description: getFirstString(item, ['description']) } : {}),
        prices,
      };
    })
    .filter(group => group.prices.length > 0 || Object.keys(group).length > 1);

  return groups.length > 0 ? groups : undefined;
}

function extractProductDataPartSnapshots(node: AnyRecord): ProductDataPartSnapshot[] | undefined {
  const partArray = asRecord(node.ProductPartArray);
  if (!partArray) return undefined;

  const parts = asArray(partArray.ProductPart)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(part => ({
      ...(getFirstString(part, ['partId', 'partID']) ? { part_id: getFirstString(part, ['partId', 'partID']) } : {}),
      ...(extractDescriptionArray(part.description) ? { description: extractDescriptionArray(part.description) } : {}),
      ...(getFirstString(part, ['countryOfOrigin']) ? { country_of_origin: getFirstString(part, ['countryOfOrigin']) } : {}),
      ...(extractProductDataColors(part) ? { colors: extractProductDataColors(part) } : {}),
      ...(extractProductDataColor(asRecord(asRecord(part.primaryColor)?.Color)) ? { primary_color: extractProductDataColor(asRecord(asRecord(part.primaryColor)?.Color)) } : {}),
      ...(getFirstString(part, ['primaryMaterial']) ? { primary_material: getFirstString(part, ['primaryMaterial']) } : {}),
      ...(extractProductDataSpecifications(part) ? { specifications: extractProductDataSpecifications(part) } : {}),
      ...(getFirstString(part, ['shape']) ? { shape: getFirstString(part, ['shape']) } : {}),
      ...(extractProductDataApparelSize(part.ApparelSize) ? { apparel_size: extractProductDataApparelSize(part.ApparelSize) } : {}),
      ...(extractProductDataDimension(part.Dimension) ? { dimension: extractProductDataDimension(part.Dimension) } : {}),
      ...(getFirstNumber(part, ['leadTime']) !== undefined ? { lead_time: getFirstNumber(part, ['leadTime']) } : {}),
      ...(getFirstString(part, ['unspsc']) ? { unspsc: getFirstString(part, ['unspsc']) } : {}),
      ...(extractGtin(part) ? { gtin: extractGtin(part) } : {}),
      ...(toBoolean(part.isRushService) !== undefined ? { is_rush_service: toBoolean(part.isRushService) } : {}),
      ...(extractProductDataPackages(part, 'ProductPackagingArray') ? { product_packaging: extractProductDataPackages(part, 'ProductPackagingArray') } : {}),
      ...(extractProductDataPackages(part, 'ShippingPackageArray') ? { shipping_packages: extractProductDataPackages(part, 'ShippingPackageArray') } : {}),
      ...(getFirstString(part, ['endDate']) ? { end_date: getFirstString(part, ['endDate']) } : {}),
      ...(getFirstString(part, ['effectiveDate']) ? { effective_date: getFirstString(part, ['effectiveDate']) } : {}),
      ...(toBoolean(part.isCloseout) !== undefined ? { is_closeout: toBoolean(part.isCloseout) } : {}),
      ...(toBoolean(part.isCaution) !== undefined ? { is_caution: toBoolean(part.isCaution) } : {}),
      ...(getFirstString(part, ['cautionComment']) ? { caution_comment: getFirstString(part, ['cautionComment']) } : {}),
      ...(getFirstNumber(part, ['nmfcCode']) !== undefined ? { nmfc_code: getFirstNumber(part, ['nmfcCode']) } : {}),
      ...(getFirstString(part, ['nmfcDescription']) ? { nmfc_description: getFirstString(part, ['nmfcDescription']) } : {}),
      ...(getFirstString(part, ['nmfcNumber']) ? { nmfc_number: getFirstString(part, ['nmfcNumber']) } : {}),
      ...(toBoolean(part.isOnDemand) !== undefined ? { is_on_demand: toBoolean(part.isOnDemand) } : {}),
      ...(toBoolean(part.isHazmat) !== undefined ? { is_hazmat: toBoolean(part.isHazmat) } : {}),
    }))
    .filter(part => Object.keys(part).length > 0);

  return parts.length > 0 ? parts : undefined;
}

function buildProductDataSnapshot(node: AnyRecord, productId: string, productName: string): ProductDataSnapshot {
  return {
    product_id: productId,
    product_name: productName,
    ...(extractDescriptionArray(node.description) ? { description: extractDescriptionArray(node.description) } : {}),
    ...(getFirstString(node, ['priceExpiresDate']) ? { price_expires_date: getFirstString(node, ['priceExpiresDate']) } : {}),
    ...(extractProductDataMarketingPoints(node) ? { marketing_points: extractProductDataMarketingPoints(node) } : {}),
    ...(extractProductKeywords(node).length > 0 ? { keywords: extractProductKeywords(node) } : {}),
    ...(getFirstString(node, ['productBrand']) ? { product_brand: getFirstString(node, ['productBrand']) } : {}),
    ...(toBoolean(node.export) !== undefined ? { export: toBoolean(node.export) } : {}),
    ...(extractProductDataCategories(node) ? { categories: extractProductDataCategories(node) } : {}),
    ...(extractProductDataRelatedProducts(node) ? { related_products: extractProductDataRelatedProducts(node) } : {}),
    ...(getFirstString(node, ['lastChangeDate']) ? { last_change_date: getFirstString(node, ['lastChangeDate']) } : {}),
    ...(getFirstString(node, ['creationDate']) ? { creation_date: getFirstString(node, ['creationDate']) } : {}),
    ...(getFirstString(node, ['endDate']) ? { end_date: getFirstString(node, ['endDate']) } : {}),
    ...(getFirstString(node, ['effectiveDate']) ? { effective_date: getFirstString(node, ['effectiveDate']) } : {}),
    ...(toBoolean(node.isCaution) !== undefined ? { is_caution: toBoolean(node.isCaution) } : {}),
    ...(getFirstString(node, ['cautionComment']) ? { caution_comment: getFirstString(node, ['cautionComment']) } : {}),
    ...(toBoolean(node.isCloseout) !== undefined ? { is_closeout: toBoolean(node.isCloseout) } : {}),
    ...(getFirstString(node, ['lineName']) ? { line_name: getFirstString(node, ['lineName']) } : {}),
    ...(getFirstString(node, ['primaryImageUrl', 'primaryImageURL']) ? { primary_image_url: getFirstString(node, ['primaryImageUrl', 'primaryImageURL']) } : {}),
    ...(extractProductDataPriceGroups(node) ? { product_price_groups: extractProductDataPriceGroups(node) } : {}),
    ...(toBoolean(node.complianceInfoAvailable) !== undefined ? { compliance_info_available: toBoolean(node.complianceInfoAvailable) } : {}),
    ...(getFirstNumber(node, ['unspscCommodityCode']) !== undefined ? { unspsc_commodity_code: getFirstNumber(node, ['unspscCommodityCode']) } : {}),
    ...(getFirstString(node, ['imprintSize']) ? { imprint_size: getFirstString(node, ['imprintSize']) } : {}),
    ...(getFirstString(node, ['defaultSetUpCharge']) ? { default_set_up_charge: getFirstString(node, ['defaultSetUpCharge']) } : {}),
    ...(getFirstString(node, ['defaultRunCharge']) ? { default_run_charge: getFirstString(node, ['defaultRunCharge']) } : {}),
    ...(extractProductDataFobPoints(node) ? { fob_points: extractProductDataFobPoints(node) } : {}),
    ...(extractProductDataLocationDecorations(node) ? { location_decorations: extractProductDataLocationDecorations(node) } : {}),
    ...(extractProductDataPartSnapshots(node) ? { parts: extractProductDataPartSnapshots(node) } : {}),
  };
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
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push(current[index]);
      }
      continue;
    }

    if (typeof current !== 'object') continue;

    const node = current as AnyRecord;
    callback(node);

    const children = Object.values(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
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

function sanitizeProductName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
  return decoded || undefined;
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
      min_purchase_quantity: product.min_purchase_quantity ?? existing.min_purchase_quantity,
      max_purchase_quantity: product.max_purchase_quantity ?? existing.max_purchase_quantity,
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
      product_data: product.product_data ?? existing.product_data,
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
      min_purchase_quantity: variant.min_purchase_quantity ?? existing.min_purchase_quantity,
      max_purchase_quantity: variant.max_purchase_quantity ?? existing.max_purchase_quantity,
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
  const productName = sanitizeProductName(getFirstString(productNode, ['productName']));
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
  const primaryImageUrl = getFirstString(productNode, ['primaryImageUrl', 'primaryImageURL']);
  const lineName = getFirstString(productNode, ['lineName']);
  const keywords = extractProductKeywords(productNode);
  const relatedProducts = extractRelatedProducts(productNode);
  const sizeLabel = getFirstString(productNode, ['labelSizeEnum', 'labelSize']) ?? discoveredSizes[0];
  const locationDecorationData = asRecord(productNode.LocationDecorationArray) ?? undefined;
  const productData = buildProductDataSnapshot(productNode, productId, productName);
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
      product_data: productData,
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

    const name = sanitizeProductName(getFirstString(node, NAME_KEYS)) ?? `Vendor product ${sku}`;
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
