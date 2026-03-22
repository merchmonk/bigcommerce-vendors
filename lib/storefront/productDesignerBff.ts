import type {
  BasePricing,
  ContractMediaAsset,
  ContractMediaGroups,
  ProductDesignerDefaultsContract,
  ProductDesignerPayload,
  SelectedBlankVariant,
  VariantDesignerOverrideContract,
} from './productDesignerTypes';
import {
  buildPricingPreview,
  flattenOverrideKeys,
  resolveBasePricing,
  resolveContractVariantCatalogEntry,
  resolveDesignerContract,
} from './productDesignerResolver';
import {
  loadBigCommerceDesignerRuntimeBundle,
  type BigCommerceDesignerRuntimeBundle,
  type BigCommerceRuntimeProduct,
  type BigCommerceRuntimeVariant,
} from './bigcommerceRuntimeReader';

const DEFAULT_CONTRACT_NAMESPACE = 'merchmonk';
const DEFAULT_PRODUCT_CONTRACT_KEY = 'product_designer_defaults';
const DEFAULT_VARIANT_OVERRIDE_KEY = 'variant_designer_override';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMetafieldValue<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function splitKeywords(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function readCustomField(product: BigCommerceRuntimeProduct, fieldName: string): string | undefined {
  return product.custom_fields?.find(field => field.name === fieldName)?.value?.trim() || undefined;
}

function resolveProductContractKey(): { namespace: string; productKey: string; variantKey: string } {
  return {
    namespace: process.env.BIGCOMMERCE_PRODUCT_CONTRACT_NAMESPACE?.trim() || DEFAULT_CONTRACT_NAMESPACE,
    productKey: process.env.BIGCOMMERCE_PRODUCT_DESIGNER_DEFAULTS_KEY?.trim() || DEFAULT_PRODUCT_CONTRACT_KEY,
    variantKey: process.env.BIGCOMMERCE_VARIANT_DESIGNER_OVERRIDE_KEY?.trim() || DEFAULT_VARIANT_OVERRIDE_KEY,
  };
}

function findProductDesignerDefaults(
  bundle: BigCommerceDesignerRuntimeBundle,
): ProductDesignerDefaultsContract {
  const { namespace, productKey } = resolveProductContractKey();
  const metafield = bundle.productMetafields.find(
    item => item.namespace === namespace && item.key === productKey,
  );
  const parsed = parseMetafieldValue<ProductDesignerDefaultsContract>(metafield?.value);
  if (!parsed) {
    throw new Error(`Product ${bundle.product.id} is missing the required designer contract metafield.`);
  }
  return parsed;
}

function findVariantDesignerOverride(
  bundle: BigCommerceDesignerRuntimeBundle,
): VariantDesignerOverrideContract | undefined {
  const { namespace, variantKey } = resolveProductContractKey();
  const metafield = bundle.variantMetafields.find(
    item => item.namespace === namespace && item.key === variantKey,
  );
  return parseMetafieldValue<VariantDesignerOverrideContract>(metafield?.value);
}

function resolveSelectedVariant(
  variant: BigCommerceRuntimeVariant,
  variantOverride: VariantDesignerOverrideContract | undefined,
  productDesignerDefaults: ProductDesignerDefaultsContract,
): SelectedBlankVariant {
  const variantCatalog = resolveContractVariantCatalogEntry(productDesignerDefaults, { sku: variant.sku });
  const options = Object.fromEntries(
    (variant.option_values ?? []).map(optionValue => [optionValue.option_display_name.trim().toLowerCase(), optionValue.label]),
  ) as Record<string, string | undefined>;

  return {
    variantId: variant.id,
    sku: variant.sku,
    partId: variantOverride?.partId ?? variantCatalog?.partId ?? variant.sku,
    options: {
      color: variantOverride?.color ?? variantCatalog?.color ?? options.color,
      size: variantOverride?.size ?? variantCatalog?.size ?? options.size,
      part: variantCatalog?.partId ?? variantOverride?.partId,
    },
    ...(variantOverride?.physical ? { physical: variantOverride.physical } : {}),
    overrideKeysApplied: flattenOverrideKeys(variantOverride),
  };
}

function resolveInventorySnapshot(product: BigCommerceRuntimeProduct, variant: BigCommerceRuntimeVariant) {
  const available = typeof variant.inventory_level === 'number' ? variant.inventory_level : null;
  const inventoryTracked = product.inventory_tracking === 'variant' || product.inventory_tracking === 'product';

  if (!inventoryTracked) {
    return {
      available,
      inventoryTracked: false,
      status: 'made_to_order' as const,
    };
  }

  if (available === null) {
    return {
      available,
      inventoryTracked: true,
      status: 'made_to_order' as const,
    };
  }

  if (available <= 0) {
    return {
      available,
      inventoryTracked: true,
      status: 'out_of_stock' as const,
    };
  }

  if (available <= 24) {
    return {
      available,
      inventoryTracked: true,
      status: 'low_stock' as const,
    };
  }

  return {
    available,
    inventoryTracked: true,
    status: 'in_stock' as const,
  };
}

function dedupeMediaAssets(assets: ContractMediaAsset[]): ContractMediaAsset[] {
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

function normalizeMediaGroups(groups: ContractMediaGroups | undefined) {
  return {
    gallery: dedupeMediaAssets(groups?.gallery ?? []),
    variantAssets: Object.fromEntries(
      Object.entries(groups?.variantAssets ?? {}).map(([key, assets]) => [key, dedupeMediaAssets(assets ?? [])]),
    ),
    locationAssets: Object.fromEntries(
      Object.entries(groups?.locationAssets ?? {}).map(([key, assets]) => [key, dedupeMediaAssets(assets ?? [])]),
    ),
    methodAssets: Object.fromEntries(
      Object.entries(groups?.methodAssets ?? {}).map(([key, assets]) => [key, dedupeMediaAssets(assets ?? [])]),
    ),
  };
}

function resolveMedia(
  productDesignerDefaults: ProductDesignerDefaultsContract,
) {
  const videoGroups = normalizeMediaGroups(productDesignerDefaults.media?.videos);

  return {
    gallery: [],
    variantAssets: {},
    locationAssets: {},
    methodAssets: {},
    videos: videoGroups,
  };
}

function resolveProductSummary(
  bundle: BigCommerceDesignerRuntimeBundle,
  productDesignerDefaults: ProductDesignerDefaultsContract,
) {
  const vendorId = Number(readCustomField(bundle.product, 'vendor_id'));
  const resolvedVendorId = Number.isFinite(vendorId) ? vendorId : undefined;

  return {
    productId: bundle.product.id,
    name: bundle.product.name,
    sku: bundle.product.sku,
    ...(bundle.product.custom_url?.url ? { path: bundle.product.custom_url.url } : {}),
    ...(bundle.brand?.name ? { brand: bundle.brand.name } : {}),
    ...(bundle.product.description ? { description: bundle.product.description } : {}),
    categories: bundle.categories.map(category => category.name),
    searchKeywords: splitKeywords(bundle.product.search_keywords),
    source: {
      ...(resolvedVendorId !== undefined ? { vendorId: resolvedVendorId } : {}),
      ...(productDesignerDefaults.source?.vendorProductId
        ? { vendorProductId: productDesignerDefaults.source.vendorProductId }
        : {}),
      ...(productDesignerDefaults.contractVersion ? { contractVersion: productDesignerDefaults.contractVersion } : {}),
    },
  };
}

function resolveRelatedProducts(bundle: BigCommerceDesignerRuntimeBundle) {
  return bundle.relatedProducts.map(product => ({
    productId: product.id,
    name: product.name,
    ...(product.custom_url?.url ? { path: product.custom_url.url } : {}),
  }));
}

function resolveFallbackUnitBlankPrice(
  variant: BigCommerceRuntimeVariant,
  product: BigCommerceRuntimeProduct,
): number {
  return variant.price ?? variant.cost_price ?? product.price ?? 0;
}

function resolveBasePricingForBundle(input: {
  quantity: number;
  bundle: BigCommerceDesignerRuntimeBundle;
  productDesignerDefaults: ProductDesignerDefaultsContract;
  selectedVariant: BigCommerceRuntimeVariant;
}): BasePricing {
  const variantCatalog = resolveContractVariantCatalogEntry(input.productDesignerDefaults, {
    sku: input.selectedVariant.sku,
  });
  const fallbackUnitBlankPrice =
    input.selectedVariant.price ??
    input.selectedVariant.cost_price ??
    resolveFallbackUnitBlankPrice(input.selectedVariant, input.bundle.product);

  return resolveBasePricing({
    quantity: input.quantity,
    variantCatalog,
    productDesignerDefaults: input.productDesignerDefaults,
    fallbackUnitBlankPrice,
  });
}

export async function getProductDesignerPayload(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  variantId: number;
  quantity: number;
}): Promise<ProductDesignerPayload> {
  const bundle = await loadBigCommerceDesignerRuntimeBundle({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    variantId: input.variantId,
  });

  const productDesignerDefaults = findProductDesignerDefaults(bundle);
  const variantOverride = findVariantDesignerOverride(bundle);
  const selectedVariant = bundle.variants.find(variant => variant.id === input.variantId);

  if (!selectedVariant) {
    throw new Error(`Variant ${input.variantId} is not available for product ${input.productId}.`);
  }

  const resolvedDesigner = resolveDesignerContract(productDesignerDefaults, variantOverride);
  const resolvedSelectedVariant = resolveSelectedVariant(selectedVariant, variantOverride, productDesignerDefaults);
  const basePricing = resolveBasePricingForBundle({
    quantity: input.quantity,
    bundle,
    productDesignerDefaults,
    selectedVariant,
  });

  return {
    product: resolveProductSummary(bundle, productDesignerDefaults),
    selectedVariant: resolvedSelectedVariant,
    basePricing,
    inventory: resolveInventorySnapshot(bundle.product, selectedVariant),
    designer: resolvedDesigner,
    media: resolveMedia(productDesignerDefaults),
    relatedProducts: resolveRelatedProducts(bundle),
    pricingPreview: buildPricingPreview({
      quantity: input.quantity,
      currencyCode: basePricing.currencyCode,
      blankUnitPrice: basePricing.unitBlankPrice,
      designer: resolvedDesigner,
    }),
  };
}
