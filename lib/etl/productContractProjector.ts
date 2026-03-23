import type {
  NormalizedMediaAsset,
  NormalizedPhysicalDimensions,
  NormalizedProduct,
  NormalizedVariantPhysical,
  PricingConfigurationCharge,
  PricingConfigurationDecoration,
  PricingConfigurationLocation,
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
}

type AnyRecord = Record<string, unknown>;

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
        };
      })
      .filter((tier): tier is NonNullable<typeof tier> => !!tier);

    return {
      sku: variant.sku,
      ...(variant.part_id ? { partId: variant.part_id } : {}),
      ...(variant.color ? { color: variant.color } : {}),
      ...(variant.size ? { size: variant.size } : {}),
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

 /* const videoGroups = createGroups(assets.filter(asset => asset.media_type === 'Video'));
  if (Object.keys(videoGroups).length === 0) {
    return undefined;
  }

  return {
    videos: videoGroups,
  };*/
  return undefined;
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
  };
}
