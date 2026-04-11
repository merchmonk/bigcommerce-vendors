import type {
  NormalizedMediaAsset,
  NormalizedPhysicalDimensions,
  NormalizedProduct,
  ProductDataSnapshot,
  NormalizedVariantPhysical,
  PricingConfigurationCharge,
  PricingConfigurationDecorationColor,
  PricingConfigurationDecoration,
  PricingConfigurationFobPoint,
  PricingConfigurationLocation,
  PricingConfigurationPart,
  PricingConfigurationPartPriceTier,
} from './productNormalizer';
import { deriveSellingPrice } from './syncSemantics';

export const PRODUCT_CONTRACT_VERSION = '2026-03-22.1';

export interface ProductContractProjectionContext {
  price_list_id: number;
  currency: string;
  markup_percent: number;
  markup_namespace: string;
  markup_key: string;
}

export interface ProductContractProjection {
  product_designer_defaults: Record<string, unknown>;
  variant_designer_overrides: Array<{
    sku: string;
    value: Record<string, unknown>;
  }>;
  product_internal_metafields: Array<{
    key: string;
    value: Record<string, unknown>;
  }>;
}

type AnyRecord = Record<string, unknown>;

const PRODUCT_PRICING_CONFIGURATION_CONFIGURATION_KEY = 'pricing_configuration_configuration';
const PRODUCT_PRICING_CONFIGURATION_AVAILABLE_LOCATIONS_KEY = 'pricing_configuration_available_locations';
const PRODUCT_PRICING_CONFIGURATION_DECORATION_COLORS_KEY = 'pricing_configuration_decoration_colors';
const PRODUCT_PRICING_CONFIGURATION_AVAILABLE_CHARGES_KEY = 'pricing_configuration_available_charges';
const PRODUCT_PRICING_CONFIGURATION_FOB_POINTS_KEY = 'pricing_configuration_fob_points';
const PRODUCT_DATA_PRODUCT_KEY = 'product_data_product';
const PRODUCT_DATA_MARKETING_POINTS_KEY = 'product_data_marketing_points';
const PRODUCT_DATA_CATEGORIES_KEY = 'product_data_categories';
const PRODUCT_DATA_RELATED_PRODUCTS_KEY = 'product_data_related_products';
const PRODUCT_DATA_PRICE_GROUPS_KEY = 'product_data_price_groups';
const PRODUCT_DATA_LOCATION_DECORATIONS_KEY = 'product_data_location_decorations';
const PRODUCT_DATA_FOB_POINTS_KEY = 'product_data_fob_points';
const PRODUCT_DATA_PARTS_KEY = 'product_data_parts';

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function slugify(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || undefined;
}

function buildMetafieldBase(product: NormalizedProduct): Record<string, unknown> {
  return {
    contractVersion: PRODUCT_CONTRACT_VERSION,
    source: {
      ...(product.vendor_product_id ? { vendorProductId: product.vendor_product_id } : {}),
      ...(product.source_sku ? { sourceSku: product.source_sku } : {}),
      sku: product.sku,
    },
  };
}

function projectPartPriceTier(tier: PricingConfigurationPartPriceTier): Record<string, unknown> {
  return {
    minQuantity: tier.min_quantity,
    ...(tier.quantity_max !== undefined ? { quantityMax: tier.quantity_max } : {}),
    price: tier.price,
    ...(tier.price_uom ? { priceUom: tier.price_uom } : {}),
    ...(tier.discount_code ? { discountCode: tier.discount_code } : {}),
    ...(tier.price_effective_date ? { priceEffectiveDate: tier.price_effective_date } : {}),
    ...(tier.price_expiry_date ? { priceExpiryDate: tier.price_expiry_date } : {}),
  };
}

function projectPricingConfigurationPart(part: PricingConfigurationPart): Record<string, unknown> {
  return {
    partId: part.part_id,
    ...(part.part_description ? { partDescription: part.part_description } : {}),
    ...(part.part_group ? { partGroup: part.part_group } : {}),
    ...(part.next_part_group ? { nextPartGroup: part.next_part_group } : {}),
    ...(part.part_group_required !== undefined ? { partGroupRequired: part.part_group_required } : {}),
    ...(part.part_group_description ? { partGroupDescription: part.part_group_description } : {}),
    ...(part.ratio !== undefined ? { ratio: part.ratio } : {}),
    ...(part.default_part !== undefined ? { defaultPart: part.default_part } : {}),
    ...(part.location_ids?.length ? { locationIds: part.location_ids } : {}),
    priceTiers: part.price_tiers.map(projectPartPriceTier),
  };
}

function projectPricingConfigurationFobPoint(point: PricingConfigurationFobPoint): Record<string, unknown> {
  return {
    ...(point.fob_id ? { fobId: point.fob_id } : {}),
    ...(point.postal_code ? { fobPostalCode: point.postal_code } : {}),
    ...(point.city ? { fobCity: point.city } : {}),
    ...(point.state ? { fobState: point.state } : {}),
    ...(point.country ? { fobCountry: point.country } : {}),
    ...(point.supported_currencies?.length ? { supportedCurrencies: point.supported_currencies } : {}),
    ...(point.product_ids?.length ? { productIds: point.product_ids } : {}),
  };
}

function projectDecorationColor(decorationColor: PricingConfigurationDecorationColor): Record<string, unknown> {
  return {
    ...(decorationColor.product_id ? { productId: decorationColor.product_id } : {}),
    ...(decorationColor.location_id ? { locationId: decorationColor.location_id } : {}),
    ...(decorationColor.pms_match !== undefined ? { pmsMatch: decorationColor.pms_match } : {}),
    ...(decorationColor.full_color !== undefined ? { fullColor: decorationColor.full_color } : {}),
    colors: decorationColor.colors.map(color => ({
      ...(color.color_id ? { colorId: color.color_id } : {}),
      ...(color.color_name ? { colorName: color.color_name } : {}),
    })),
    decorationMethods: decorationColor.decoration_methods.map(method => ({
      ...(method.decoration_id ? { decorationId: method.decoration_id } : {}),
      ...(method.decoration_name ? { decorationName: method.decoration_name } : {}),
    })),
  };
}

function projectPrintArea(decoration: PricingConfigurationDecoration): Record<string, unknown> | undefined {
  const geometry = decoration.decoration_geometry;
  const width = decoration.decoration_width;
  const height = decoration.decoration_height;
  const diameter = decoration.decoration_diameter;
  const uom = decoration.decoration_uom;

  if (geometry === undefined && width === undefined && height === undefined && diameter === undefined && uom === undefined) {
    return undefined;
  }

  return {
    ...(geometry ? { geometry } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(diameter !== undefined ? { diameter } : {}),
    ...(uom ? { uom } : {}),
  };
}

function projectCharge(charge: PricingConfigurationCharge): Record<string, unknown> {
  return {
    ...(charge.charge_id ? { id: charge.charge_id } : {}),
    ...(charge.charge_name ? { name: charge.charge_name } : {}),
    ...(charge.charge_description ? { description: charge.charge_description } : {}),
    ...(charge.charge_type ? { type: charge.charge_type } : {}),
    ...(charge.charges_applies_ltm !== undefined ? { appliesLtm: charge.charges_applies_ltm } : {}),
    ...(charge.charges_per_location !== undefined ? { appliesPerLocation: charge.charges_per_location } : {}),
    ...(charge.charges_per_color !== undefined ? { appliesPerColor: charge.charges_per_color } : {}),
    tiers: charge.charge_price_tiers.map(tier => ({
      minQuantity: tier.x_min_qty,
      ...(tier.x_uom ? { quantityUom: tier.x_uom } : {}),
      ...(tier.y_min_qty !== undefined ? { minUnits: tier.y_min_qty } : {}),
      ...(tier.y_uom ? { unitsUom: tier.y_uom } : {}),
      price: tier.price,
      ...(tier.repeat_price !== undefined ? { repeatPrice: tier.repeat_price } : {}),
      ...(tier.discount_code ? { discountCode: tier.discount_code } : {}),
      ...(tier.repeat_discount_code ? { repeatDiscountCode: tier.repeat_discount_code } : {}),
      ...(tier.price_effective_date ? { priceEffectiveDate: tier.price_effective_date } : {}),
      ...(tier.price_expiry_date ? { priceExpiryDate: tier.price_expiry_date } : {}),
    })),
  };
}

function buildLocationDecorationHints(product: NormalizedProduct): Map<string, AnyRecord> {
  const hints = new Map<string, AnyRecord>();
  const locationDecorationArray = asRecord(product.location_decoration_data)?.LocationDecoration;

  for (const item of asArray(locationDecorationArray)) {
    const record = asRecord(item);
    if (!record) continue;

    const locationName = typeof record.locationName === 'string' ? record.locationName : undefined;
    const decorationName = typeof record.decorationName === 'string' ? record.decorationName : undefined;
    const key = `${locationName ?? ''}|${decorationName ?? ''}`;
    hints.set(key, record);
  }

  return hints;
}

function projectLocation(
  location: PricingConfigurationLocation,
  locationDecorationHints: Map<string, AnyRecord>,
): Record<string, unknown> {
  const locationId = slugify(location.location_id ?? location.location_name);
  return {
    ...(locationId ? { id: locationId } : {}),
    ...(location.location_id ? { locationId: location.location_id } : {}),
    ...(location.location_name ? { name: location.location_name } : {}),
    ...(location.decorations_included !== undefined ? { includedDecorations: location.decorations_included } : {}),
    ...(location.min_decoration !== undefined ? { minDecorations: location.min_decoration } : {}),
    ...(location.max_decoration !== undefined ? { maxDecorations: location.max_decoration } : {}),
    ...(location.default_location !== undefined ? { isDefault: location.default_location } : {}),
    ...(location.location_rank !== undefined ? { rank: location.location_rank } : {}),
    methods: location.decorations.map(decoration => {
      const hintKey = `${location.location_name ?? ''}|${decoration.decoration_name ?? ''}`;
      const hint = locationDecorationHints.get(hintKey);
      const printArea = projectPrintArea(decoration);
      return {
        ...(slugify(decoration.decoration_id ?? decoration.decoration_name) ? { id: slugify(decoration.decoration_id ?? decoration.decoration_name) } : {}),
        ...(decoration.decoration_id ? { decorationId: decoration.decoration_id } : {}),
        ...(decoration.decoration_name ? { name: decoration.decoration_name } : {}),
        ...(printArea ? { printArea } : {}),
        ...(decoration.decoration_units_included !== undefined ? { unitsIncluded: decoration.decoration_units_included } : {}),
        ...(decoration.decoration_units_included_uom ? { unitsIncludedUom: decoration.decoration_units_included_uom } : {}),
        ...(decoration.decoration_units_max !== undefined ? { unitsMax: decoration.decoration_units_max } : {}),
        ...(decoration.default_decoration !== undefined ? { isDefault: decoration.default_decoration } : {}),
        ...(decoration.allow_sub_for_default_location !== undefined
          ? { allowSubForDefaultLocation: decoration.allow_sub_for_default_location }
          : {}),
        ...(decoration.allow_sub_for_default_method !== undefined
          ? { allowSubForDefaultMethod: decoration.allow_sub_for_default_method }
          : {}),
        ...(decoration.item_part_quantity_ltm !== undefined ? { itemPartQuantityLtm: decoration.item_part_quantity_ltm } : {}),
        ...(decoration.lead_time_days !== undefined ? { leadTimeDays: decoration.lead_time_days } : {}),
        ...(decoration.rush_lead_time_days !== undefined ? { rushLeadTimeDays: decoration.rush_lead_time_days } : {}),
        ...(hint
          ? {
              sourceHints: {
                ...(typeof hint.maxImprintColors === 'number' ? { maxImprintColors: hint.maxImprintColors } : {}),
                ...(typeof hint.locationDecorationComboDefault === 'boolean'
                  ? { locationDecorationComboDefault: hint.locationDecorationComboDefault }
                  : {}),
                ...(typeof hint.priceIncludes === 'boolean' ? { priceIncludes: hint.priceIncludes } : {}),
              },
            }
          : {}),
        charges: decoration.charges.map(projectCharge),
      };
    }),
  };
}

function projectPhysical(physical: NormalizedVariantPhysical | undefined): Record<string, unknown> | undefined {
  if (!physical) return undefined;
  const dimension = physical.dimension
    ? projectDimensions(physical.dimension)
    : undefined;

  if (physical.shape === undefined && physical.lead_time_days === undefined && physical.rush_service === undefined && !dimension) {
    return undefined;
  }

  return {
    ...(physical.shape ? { shape: physical.shape } : {}),
    ...(physical.lead_time_days !== undefined ? { leadTimeDays: physical.lead_time_days } : {}),
    ...(physical.rush_service !== undefined ? { rushService: physical.rush_service } : {}),
    ...(dimension ? { dimension } : {}),
  };
}

function projectDimensions(dimension: NormalizedPhysicalDimensions): Record<string, unknown> | undefined {
  if (
    dimension.height === undefined &&
    dimension.width === undefined &&
    dimension.depth === undefined &&
    dimension.diameter === undefined &&
    dimension.uom === undefined
  ) {
    return undefined;
  }

  return {
    ...(dimension.height !== undefined ? { height: dimension.height } : {}),
    ...(dimension.width !== undefined ? { width: dimension.width } : {}),
    ...(dimension.depth !== undefined ? { depth: dimension.depth } : {}),
    ...(dimension.diameter !== undefined ? { diameter: dimension.diameter } : {}),
    ...(dimension.uom ? { uom: dimension.uom } : {}),
  };
}

function projectVariantCatalog(product: NormalizedProduct, markupPercent: number): Array<Record<string, unknown>> {
  const partsById = new Map((product.pricing_configuration?.parts ?? []).map(part => [part.part_id, part]));

  return (product.variants ?? []).map(variant => {
    const part = partsById.get(variant.part_id ?? variant.sku);
    const priceTiers = (part?.price_tiers ?? [])
      .map(tier => {
        const sellPrice = deriveSellingPrice(tier.price, markupPercent);
        if (sellPrice === undefined) return null;
        return {
          minQuantity: tier.min_quantity,
          ...(tier.quantity_max !== undefined ? { quantityMax: tier.quantity_max } : {}),
          price: sellPrice,
          ...(tier.price_uom ? { priceUom: tier.price_uom } : {}),
          ...(tier.discount_code ? { discountCode: tier.discount_code } : {}),
          ...(tier.price_effective_date ? { priceEffectiveDate: tier.price_effective_date } : {}),
          ...(tier.price_expiry_date ? { priceExpiryDate: tier.price_expiry_date } : {}),
        };
      })
      .filter((tier): tier is NonNullable<typeof tier> => !!tier);

    return {
      sku: variant.sku,
      ...(variant.part_id ? { partId: variant.part_id } : {}),
      ...(variant.color ? { color: variant.color } : {}),
      ...(variant.size ? { size: variant.size } : {}),
      ...(variant.min_purchase_quantity !== undefined ? { minPurchaseQuantity: variant.min_purchase_quantity } : {}),
      ...(variant.max_purchase_quantity !== undefined ? { maxPurchaseQuantity: variant.max_purchase_quantity } : {}),
      optionValues: variant.option_values.map(optionValue => ({
        optionDisplayName: optionValue.option_display_name,
        label: optionValue.label,
      })),
      ...(priceTiers.length > 0 ? { priceTiers } : {}),
    };
  });
}

function dedupeProjectedMediaAssets(assets: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return assets.filter(
    (asset, index) =>
      assets.findIndex(
        candidate =>
          candidate.url === asset.url &&
          candidate.kind === asset.kind &&
          candidate.partId === asset.partId &&
          JSON.stringify(candidate.locationIds ?? []) === JSON.stringify(asset.locationIds ?? []) &&
          JSON.stringify(candidate.decorationIds ?? []) === JSON.stringify(asset.decorationIds ?? []) &&
          candidate.locationId === asset.locationId,
      ) === index,
  );
}

function rankMediaAsset(asset: NormalizedMediaAsset): number {
  const classes = (asset.class_types ?? []).map(value => value.toLowerCase());
  if (classes.includes('primary')) return 400;
  if (classes.includes('blank') || classes.includes('hero')) return 300;
  if (classes.includes('finished') || classes.includes('decorated')) return 200;
  if (classes.includes('marketing') || classes.includes('lifestyle')) return 100;
  return 0;
}

function projectMediaAsset(
  asset: NormalizedMediaAsset,
  kind: 'product' | 'variant' | 'location' | 'method',
  extras?: {
    locationId?: string;
  },
): Record<string, unknown> {
  return {
    url: asset.url,
    ...(asset.description ? { alt: asset.description } : {}),
    ...(asset.description ? { description: asset.description } : {}),
    kind,
    ...(asset.part_id ? { partId: asset.part_id } : {}),
    ...(asset.location_ids?.length ? { locationIds: asset.location_ids } : {}),
    ...(asset.decoration_ids?.length ? { decorationIds: asset.decoration_ids } : {}),
    ...(asset.class_types?.length ? { classTypes: asset.class_types } : {}),
    ...(asset.color ? { color: asset.color } : {}),
    ...(asset.single_part !== undefined ? { singlePart: asset.single_part } : {}),
    ...(asset.change_timestamp ? { changeTimestamp: asset.change_timestamp } : {}),
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
    ...(asset.dpi !== undefined ? { dpi: asset.dpi } : {}),
    ...(extras?.locationId ? { locationId: extras.locationId } : {}),
  };
}

function sortMediaAssets(assets: NormalizedMediaAsset[]): NormalizedMediaAsset[] {
  return [...assets].sort((left, right) => {
    const scoreDelta = rankMediaAsset(right) - rankMediaAsset(left);
    if (scoreDelta !== 0) return scoreDelta;
    return left.url.localeCompare(right.url);
  });
}

function projectStructuredMedia(product: NormalizedProduct): Record<string, unknown> | undefined {
  const assets = sortMediaAssets(product.media_assets ?? []);
  if (assets.length === 0) {
    return undefined;
  }

  const createGroups = (filtered: NormalizedMediaAsset[]): Record<string, unknown> => {
    const gallery = dedupeProjectedMediaAssets(
      filtered
        .filter(asset => !asset.part_id && !(asset.location_ids?.length) && !(asset.decoration_ids?.length))
        .map(asset => projectMediaAsset(asset, 'product')),
    );

    const variantAssets = Object.fromEntries(
      Array.from(
        filtered.reduce((map, asset) => {
          if (!asset.part_id) return map;
          const list = map.get(asset.part_id) ?? [];
          list.push(projectMediaAsset(asset, 'variant'));
          map.set(asset.part_id, list);
          return map;
        }, new Map<string, Array<Record<string, unknown>>>()),
      ).map(([partId, partAssets]) => [partId, dedupeProjectedMediaAssets(partAssets)]),
    );

    const locationAssets = Object.fromEntries(
      Array.from(
        filtered.reduce((map, asset) => {
          for (const locationId of asset.location_ids ?? []) {
            const list = map.get(locationId) ?? [];
            list.push(projectMediaAsset(asset, 'location'));
            map.set(locationId, list);
          }
          return map;
        }, new Map<string, Array<Record<string, unknown>>>()),
      ).map(([locationId, locationAssetList]) => [locationId, dedupeProjectedMediaAssets(locationAssetList)]),
    );

    const methodAssets = Object.fromEntries(
      Array.from(
        filtered.reduce((map, asset) => {
          for (const decorationId of asset.decoration_ids ?? []) {
            const list = map.get(decorationId) ?? [];
            if (asset.location_ids?.length) {
              asset.location_ids.forEach(locationId => {
                list.push(projectMediaAsset(asset, 'method', { locationId }));
              });
            } else {
              list.push(projectMediaAsset(asset, 'method'));
            }
            map.set(decorationId, list);
          }
          return map;
        }, new Map<string, Array<Record<string, unknown>>>()),
      ).map(([decorationId, methodAssetList]) => [decorationId, dedupeProjectedMediaAssets(methodAssetList)]),
    );

    return {
      ...(gallery.length > 0 ? { gallery } : {}),
      ...(Object.keys(variantAssets).length > 0 ? { variantAssets } : {}),
      ...(Object.keys(locationAssets).length > 0 ? { locationAssets } : {}),
      ...(Object.keys(methodAssets).length > 0 ? { methodAssets } : {}),
    };
  };

  const imageGroups = createGroups(assets.filter(asset => asset.media_type !== 'Video'));
  if (Object.keys(imageGroups).length === 0) {
    return undefined;
  }

  return imageGroups;
}

function projectPricingConfigurationMetafields(product: NormalizedProduct): Array<{ key: string; value: Record<string, unknown> }> {
  const pricingConfiguration = product.pricing_configuration;
  if (!pricingConfiguration) {
    return [];
  }

  const metafieldBase = buildMetafieldBase(product);
  const metafields: Array<{ key: string; value: Record<string, unknown> }> = [];

  metafields.push({
    key: PRODUCT_PRICING_CONFIGURATION_CONFIGURATION_KEY,
    value: {
      ...metafieldBase,
      ...(pricingConfiguration.product_id ? { productId: pricingConfiguration.product_id } : {}),
      ...(pricingConfiguration.currency ? { currency: pricingConfiguration.currency } : {}),
      ...(pricingConfiguration.price_type ? { priceType: pricingConfiguration.price_type } : {}),
      ...(pricingConfiguration.fob_postal_code ? { fobPostalCode: pricingConfiguration.fob_postal_code } : {}),
      ...(product.min_purchase_quantity !== undefined ? { minPurchaseQuantity: product.min_purchase_quantity } : {}),
      ...(product.max_purchase_quantity !== undefined ? { maxPurchaseQuantity: product.max_purchase_quantity } : {}),
      parts: pricingConfiguration.parts.map(projectPricingConfigurationPart),
      locations: pricingConfiguration.locations.map(location => ({
        ...(location.location_id ? { locationId: location.location_id } : {}),
        ...(location.location_name ? { locationName: location.location_name } : {}),
        ...(location.decorations_included !== undefined ? { decorationsIncluded: location.decorations_included } : {}),
        ...(location.default_location !== undefined ? { defaultLocation: location.default_location } : {}),
        ...(location.max_decoration !== undefined ? { maxDecoration: location.max_decoration } : {}),
        ...(location.min_decoration !== undefined ? { minDecoration: location.min_decoration } : {}),
        ...(location.location_rank !== undefined ? { locationRank: location.location_rank } : {}),
        decorations: location.decorations.map(decoration => ({
          ...(decoration.decoration_id ? { decorationId: decoration.decoration_id } : {}),
          ...(decoration.decoration_name ? { decorationName: decoration.decoration_name } : {}),
          ...(decoration.decoration_geometry ? { decorationGeometry: decoration.decoration_geometry } : {}),
          ...(decoration.decoration_height !== undefined ? { decorationHeight: decoration.decoration_height } : {}),
          ...(decoration.decoration_width !== undefined ? { decorationWidth: decoration.decoration_width } : {}),
          ...(decoration.decoration_diameter !== undefined ? { decorationDiameter: decoration.decoration_diameter } : {}),
          ...(decoration.decoration_uom ? { decorationUom: decoration.decoration_uom } : {}),
          ...(decoration.allow_sub_for_default_location !== undefined
            ? { allowSubForDefaultLocation: decoration.allow_sub_for_default_location }
            : {}),
          ...(decoration.allow_sub_for_default_method !== undefined
            ? { allowSubForDefaultMethod: decoration.allow_sub_for_default_method }
            : {}),
          ...(decoration.item_part_quantity_ltm !== undefined ? { itemPartQuantityLtm: decoration.item_part_quantity_ltm } : {}),
          ...(decoration.decoration_units_included !== undefined ? { decorationUnitsIncluded: decoration.decoration_units_included } : {}),
          ...(decoration.decoration_units_included_uom ? { decorationUnitsIncludedUom: decoration.decoration_units_included_uom } : {}),
          ...(decoration.decoration_units_max !== undefined ? { decorationUnitsMax: decoration.decoration_units_max } : {}),
          ...(decoration.default_decoration !== undefined ? { defaultDecoration: decoration.default_decoration } : {}),
          ...(decoration.lead_time_days !== undefined ? { leadTime: decoration.lead_time_days } : {}),
          ...(decoration.rush_lead_time_days !== undefined ? { rushLeadTime: decoration.rush_lead_time_days } : {}),
          charges: decoration.charges.map(projectCharge),
        })),
      })),
      variants: (product.variants ?? []).map(variant => ({
        sku: variant.sku,
        ...(variant.part_id ? { partId: variant.part_id } : {}),
        ...(variant.min_purchase_quantity !== undefined ? { minPurchaseQuantity: variant.min_purchase_quantity } : {}),
        ...(variant.max_purchase_quantity !== undefined ? { maxPurchaseQuantity: variant.max_purchase_quantity } : {}),
      })),
    },
  });

  if (pricingConfiguration.available_locations?.length) {
    metafields.push({
      key: PRODUCT_PRICING_CONFIGURATION_AVAILABLE_LOCATIONS_KEY,
      value: {
        ...metafieldBase,
        availableLocations: pricingConfiguration.available_locations.map(location => ({
          ...(location.location_id ? { locationId: location.location_id } : {}),
          ...(location.location_name ? { locationName: location.location_name } : {}),
        })),
      },
    });
  }

  if (pricingConfiguration.decoration_colors?.length) {
    metafields.push({
      key: PRODUCT_PRICING_CONFIGURATION_DECORATION_COLORS_KEY,
      value: {
        ...metafieldBase,
        decorationColors: pricingConfiguration.decoration_colors.map(projectDecorationColor),
      },
    });
  }

  if (pricingConfiguration.available_charges?.length) {
    metafields.push({
      key: PRODUCT_PRICING_CONFIGURATION_AVAILABLE_CHARGES_KEY,
      value: {
        ...metafieldBase,
        availableCharges: pricingConfiguration.available_charges.map(charge => ({
          ...(charge.charge_id ? { chargeId: charge.charge_id } : {}),
          ...(charge.charge_name ? { chargeName: charge.charge_name } : {}),
          ...(charge.charge_description ? { chargeDescription: charge.charge_description } : {}),
          ...(charge.charge_type ? { chargeType: charge.charge_type } : {}),
        })),
      },
    });
  }

  if (pricingConfiguration.fob_points.length > 0) {
    metafields.push({
      key: PRODUCT_PRICING_CONFIGURATION_FOB_POINTS_KEY,
      value: {
        ...metafieldBase,
        fobPoints: pricingConfiguration.fob_points.map(projectPricingConfigurationFobPoint),
      },
    });
  }

  return metafields;
}

function projectProductDataMetafields(product: NormalizedProduct): Array<{ key: string; value: Record<string, unknown> }> {
  const productData = product.product_data;
  if (!productData) {
    return [];
  }

  const metafieldBase = buildMetafieldBase(product);
  const metafields: Array<{ key: string; value: Record<string, unknown> }> = [];

  const {
    marketing_points,
    categories,
    related_products,
    product_price_groups,
    location_decorations,
    fob_points,
    parts,
    ...productFields
  } = productData;

  metafields.push({
    key: PRODUCT_DATA_PRODUCT_KEY,
    value: {
      ...metafieldBase,
      productData: productFields as Record<string, unknown>,
    },
  });

  const appendArrayMetafield = (key: string, valueKey: string, items: unknown[] | undefined): void => {
    if (!items || items.length === 0) {
      return;
    }

    metafields.push({
      key,
      value: {
        ...metafieldBase,
        [valueKey]: items as unknown as Record<string, unknown>,
      } as Record<string, unknown>,
    });
  };

  appendArrayMetafield(PRODUCT_DATA_MARKETING_POINTS_KEY, 'marketingPoints', marketing_points);
  appendArrayMetafield(PRODUCT_DATA_CATEGORIES_KEY, 'categories', categories);
  appendArrayMetafield(PRODUCT_DATA_RELATED_PRODUCTS_KEY, 'relatedProducts', related_products);
  appendArrayMetafield(PRODUCT_DATA_PRICE_GROUPS_KEY, 'productPriceGroups', product_price_groups);
  appendArrayMetafield(PRODUCT_DATA_LOCATION_DECORATIONS_KEY, 'locationDecorations', location_decorations);
  appendArrayMetafield(PRODUCT_DATA_FOB_POINTS_KEY, 'fobPoints', fob_points);
  appendArrayMetafield(PRODUCT_DATA_PARTS_KEY, 'parts', parts);

  return metafields;
}

export function projectBigCommerceProductContract(
  product: NormalizedProduct,
  context: ProductContractProjectionContext,
): ProductContractProjection {
  const locationDecorationHints = buildLocationDecorationHints(product);
  const locations = (product.pricing_configuration?.locations ?? []).map(location =>
    projectLocation(location, locationDecorationHints),
  );

  const defaultLocationIds = new Set(
    (product.pricing_configuration?.locations ?? [])
      .map(location => location.location_id)
      .filter((value): value is string => !!value),
  );

  const productDesignerDefaults: Record<string, unknown> = {
    contractVersion: PRODUCT_CONTRACT_VERSION,
    source: {
      ...(product.vendor_product_id ? { vendorProductId: product.vendor_product_id } : {}),
      ...(product.source_sku ? { sourceSku: product.source_sku } : {}),
      partIds: (product.variants ?? []).map(variant => variant.part_id ?? variant.sku),
    },
    pricing: {
      priceListId: context.price_list_id,
      currency: context.currency,
      markupPercent: context.markup_percent,
      markupSource: {
        namespace: context.markup_namespace,
        key: context.markup_key,
      },
      ...(product.pricing_configuration?.price_type ? { priceType: product.pricing_configuration.price_type } : {}),
      ...(product.min_purchase_quantity !== undefined ? { minPurchaseQuantity: product.min_purchase_quantity } : {}),
      ...(product.max_purchase_quantity !== undefined ? { maxPurchaseQuantity: product.max_purchase_quantity } : {}),
      variantCatalog: projectVariantCatalog(product, context.markup_percent),
    },
    locations,
    ...(product.pricing_configuration?.available_charges
      ? { availableCharges: product.pricing_configuration.available_charges }
      : {}),
    ...(projectStructuredMedia(product) ? { media: projectStructuredMedia(product) } : {}),
    ...(product.pricing_configuration?.fob_points
      ? {
          fobPoints: product.pricing_configuration.fob_points.map(point => ({
            ...(point.fob_id ? { id: point.fob_id } : {}),
            ...(point.city ? { city: point.city } : {}),
            ...(point.state ? { state: point.state } : {}),
            ...(point.postal_code ? { postalCode: point.postal_code } : {}),
            ...(point.country ? { country: point.country } : {}),
          })),
        }
      : {}),
  };

  const partMap = new Map(
    (product.pricing_configuration?.parts ?? []).map(part => [part.part_id, part]),
  );

  const variantDesignerOverrides = (product.variants ?? [])
    .map(variant => {
      const part = partMap.get(variant.part_id ?? variant.sku);
      const hasDistinctLocationSet =
        !!part?.location_ids &&
        (
          part.location_ids.length !== defaultLocationIds.size ||
          part.location_ids.some(locationId => !defaultLocationIds.has(locationId))
        );
      const applicableLocationIds = hasDistinctLocationSet ? part?.location_ids : undefined;
      const physical = projectPhysical(variant.physical);

      if ((!applicableLocationIds || applicableLocationIds.length === 0) && !physical) {
        return null;
      }

      return {
        sku: variant.sku,
        value: {
          contractVersion: PRODUCT_CONTRACT_VERSION,
          ...(variant.part_id ? { partId: variant.part_id } : {}),
          ...(variant.size ? { size: variant.size } : {}),
          ...(variant.color ? { color: variant.color } : {}),
          ...(variant.min_purchase_quantity !== undefined ? { minPurchaseQuantity: variant.min_purchase_quantity } : {}),
          ...(variant.max_purchase_quantity !== undefined ? { maxPurchaseQuantity: variant.max_purchase_quantity } : {}),
          ...(applicableLocationIds && applicableLocationIds.length > 0
            ? { applicableLocationIds }
            : {}),
          ...(physical ? { physical } : {}),
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => !!item);

  return {
    product_designer_defaults: productDesignerDefaults,
    variant_designer_overrides: variantDesignerOverrides,
    product_internal_metafields: [
      ...projectPricingConfigurationMetafields(product),
      ...projectProductDataMetafields(product),
    ],
  };
}
