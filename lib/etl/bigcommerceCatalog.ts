import type { BigCommercePricingContext } from './bigcommercePricingContext';
import { syncProjectedProductContract } from './bigcommerceMetafields';
import { upsertPriceListRecords } from './bigcommercePriceLists';
import {
  projectBigCommerceProductContract,
} from './productContractProjector';
import type { NormalizedBulkPricingRule, NormalizedMediaAsset, NormalizedProduct } from './productNormalizer';
import { projectProductPricing } from './pricingProjector';
import {
  reconcileProjectedPricingTargets,
  type PricingReconciliationSummary,
} from './pricingReconciliation';
import {
  BigCommerceCatalogListResponse,
  BigCommerceCatalogResponse,
  buildApiBase,
  requestJson,
} from './bigcommerceApi';
import {
  canonicalizeTaxonomyName,
  classifyDuplicateDecision,
  type ProductCandidate,
} from './syncSemantics';

interface BigCommerceCatalogProduct {
  id: number;
  sku: string;
  name: string;
  base_variant_id?: number;
  custom_fields?: Array<{ name: string; value: string }>;
}

interface BigCommerceBrand {
  id: number;
  name: string;
}

interface BigCommerceCategory {
  id: number;
  name: string;
  parent_id: number;
}

interface BigCommerceVariant {
  id: number;
  sku: string;
}

interface BigCommerceOptionValue {
  id: number;
  label: string;
}

interface BigCommerceProductOption {
  id: number;
  display_name: string;
  option_values?: BigCommerceOptionValue[];
}

interface BigCommerceBulkPricingRule {
  id: number;
}

interface BigCommerceModifier {
  id: number;
  display_name: string;
}

interface BigCommerceImage {
  id: number;
  description?: string;
}

interface BigCommerceVideo {
  id: number;
  description?: string;
}

interface VendorManagedMediaMetadata {
  mediaType: 'Image' | 'Video';
  url: string;
  partId?: string;
  locationIds?: string[];
  decorationIds?: string[];
}

interface DesiredBigCommerceImage {
  image_url: string;
  description: string;
  is_thumbnail?: boolean;
}

interface DesiredBigCommerceVideo {
  title: string;
  description: string;
  type: 'youtube';
  video_id: string;
}

const VENDOR_MEDIA_MARKER_PREFIX = 'mm_media:';
const BIGCOMMERCE_CATEGORY_NAME_MAX_LENGTH = 50;
const BIGCOMMERCE_BRAND_NAME_MAX_LENGTH = 100;

export interface UpsertBigCommerceProductInput {
  accessToken: string;
  storeHash: string;
  vendorId: number;
  product: NormalizedProduct;
  defaultMarkupPercent?: number;
  pricingContext?: BigCommercePricingContext;
}

export interface UpsertBigCommerceProductResult {
  product: BigCommerceCatalogProduct;
  duplicate: boolean;
  action: 'create' | 'update';
  resolvedSku: string;
  markupPercent: number;
  pricingReconciliation: PricingReconciliationSummary;
}

function dedupeProducts(products: BigCommerceCatalogProduct[]): BigCommerceCatalogProduct[] {
  return products.filter(
    (product, index) => products.findIndex(candidate => candidate.id === product.id) === index,
  );
}

function readVendorMarker(product: BigCommerceCatalogProduct): string | undefined {
  const field = (product.custom_fields ?? []).find(item => item.name === 'vendor_id');
  return field?.value?.trim() || undefined;
}

function toCandidate(product: BigCommerceCatalogProduct): ProductCandidate {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    vendor_marker: readVendorMarker(product),
  };
}

async function listProductsBySku(
  accessToken: string,
  storeHash: string,
  sku: string,
): Promise<BigCommerceCatalogProduct[]> {
  const url = `${buildApiBase(storeHash)}/catalog/products?sku=${encodeURIComponent(sku)}&include=custom_fields&limit=250`;
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCatalogProduct>>(
    accessToken,
    url,
    { method: 'GET' },
    'Failed to list BigCommerce products by SKU',
  );
  return response.data ?? [];
}

async function listProductsByName(
  accessToken: string,
  storeHash: string,
  name: string,
): Promise<BigCommerceCatalogProduct[]> {
  const url = `${buildApiBase(storeHash)}/catalog/products?name=${encodeURIComponent(name)}&include=custom_fields&limit=250`;
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCatalogProduct>>(
    accessToken,
    url,
    { method: 'GET' },
    'Failed to list BigCommerce products by name',
  );
  return (response.data ?? []).filter(item => item.name === name);
}

async function listProductCandidates(
  accessToken: string,
  storeHash: string,
  product: NormalizedProduct,
): Promise<BigCommerceCatalogProduct[]> {
  const bySku = await listProductsBySku(accessToken, storeHash, product.sku);
  const byName = await listProductsByName(accessToken, storeHash, product.name);
  return dedupeProducts([...bySku, ...byName]);
}

async function resolveAvailableSku(
  accessToken: string,
  storeHash: string,
  desiredSku: string,
  currentProductId?: number,
): Promise<string> {
  let candidate = desiredSku;
  let attempt = 0;
  while (attempt < 30) {
    const matches = await listProductsBySku(accessToken, storeHash, candidate);
    const hasCollision = matches.some(product => product.id !== currentProductId);
    if (!hasCollision) {
      return candidate;
    }
    attempt += 1;
    candidate = `${desiredSku}_${attempt}`;
  }
  throw new Error(`Unable to find available SKU for ${desiredSku}`);
}

function dedupeCustomFields(fields: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return fields.filter(
    (field, index) => fields.findIndex(item => item.name === field.name && item.value === field.value) === index,
  );
}

function withSharedFields(
  product: NormalizedProduct,
  input: {
    vendorId: number;
    duplicate: boolean;
    markupPercent: number;
  },
): Array<{ name: string; value: string }> {
  const existing = product.custom_fields ?? [];
  const withoutReserved = existing.filter(
    field => !['vendor_id', 'duplicate', 'size', 'product_cost_markup'].includes(field.name),
  );
  return dedupeCustomFields([
    ...withoutReserved,
    { name: 'vendor_id', value: String(input.vendorId) },
    { name: 'duplicate', value: input.duplicate ? 'true' : 'false' },
    ...(product.shared_option_values?.size ? [{ name: 'size', value: product.shared_option_values.size }] : []),
    { name: 'product_cost_markup', value: String(input.markupPercent) },
  ]);
}

function buildBigCommercePayload(
  product: NormalizedProduct,
  options: {
    brandId?: number;
    categoryIds?: number[];
    includeVariants?: boolean;
    sku: string;
    markupPercent: number;
    duplicate: boolean;
    vendorId: number;
    productFallback: {
      cost_price?: number;
      price?: number;
      bulk_pricing_rules?: NormalizedBulkPricingRule[];
    };
    variants: Array<{
      sku: string;
      cost_price: number;
      price: number;
      option_values: Array<{ option_display_name: string; label: string }>;
    }>;
  },
): Record<string, unknown> {
  const variantPayload = options.variants
    .filter(variant => variant.option_values.length > 0)
    .map(variant => ({
      sku: variant.sku,
      cost_price: variant.cost_price,
      price: variant.price,
      inventory_level:
        (product.variants ?? []).find(candidate => candidate.sku === variant.sku)?.inventory_level ??
        product.inventory_level ??
        0,
      option_values: variant.option_values,
    }));

  const hasVariants = variantPayload.length > 0;

  return {
    name: product.name,
    type: 'physical',
    sku: options.sku,
    description: product.description ?? '',
    ...(options.productFallback.cost_price !== undefined ? { cost_price: options.productFallback.cost_price } : {}),
    ...(options.productFallback.price !== undefined ? { price: options.productFallback.price } : {}),
    inventory_tracking: hasVariants ? 'variant' : 'product',
    ...(!hasVariants && product.inventory_level !== undefined ? { inventory_level: product.inventory_level } : {}),
    search_keywords: product.search_keywords ?? undefined,
    custom_fields: withSharedFields(product, {
      vendorId: options.vendorId,
      duplicate: options.duplicate,
      markupPercent: options.markupPercent,
    }),
    ...(options.brandId ? { brand_id: options.brandId } : {}),
    ...(options.categoryIds && options.categoryIds.length > 0 ? { categories: options.categoryIds } : {}),
    ...(options.productFallback.bulk_pricing_rules && options.productFallback.bulk_pricing_rules.length > 0
      ? { bulk_pricing_rules: options.productFallback.bulk_pricing_rules }
      : {}),
    ...(options.includeVariants && variantPayload.length > 0 ? { variants: variantPayload } : {}),
  };
}

async function ensureBrandId(
  accessToken: string,
  storeHash: string,
  brandName: string | undefined,
): Promise<number | undefined> {
  const normalizedBrandName = brandName?.trim();
  if (!normalizedBrandName) return undefined;
  if (normalizedBrandName.length > BIGCOMMERCE_BRAND_NAME_MAX_LENGTH) {
    console.warn(`Skipping invalid BigCommerce brand "${normalizedBrandName}" because it exceeds ${BIGCOMMERCE_BRAND_NAME_MAX_LENGTH} characters.`);
    return undefined;
  }
  const canonicalBrand = canonicalizeTaxonomyName(normalizedBrandName);

  const brandsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceBrand>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/brands?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce brands',
  );
  const existingBrand = (brandsResponse.data ?? []).find(
    brand => canonicalizeTaxonomyName(brand.name) === canonicalBrand,
  );
  if (existingBrand) return existingBrand.id;

  const created = await requestJson<BigCommerceCatalogResponse<BigCommerceBrand>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/brands`,
    {
      method: 'POST',
      body: JSON.stringify({ name: normalizedBrandName }),
    },
    'Failed to create BigCommerce brand',
  ).catch(error => {
    if (
      error instanceof Error &&
      /Failed to create BigCommerce brand \(422\)/.test(error.message) &&
      /Invalid field\(s\): name|\"name\":/i.test(error.message)
    ) {
      console.warn(`Skipping invalid BigCommerce brand "${normalizedBrandName}".`);
      return null;
    }
    throw error;
  });
  return created?.data?.id;
}

function parseCategoryPath(category: string): string[] {
  const parts = category
    .split('>')
    .map(value => value.trim())
    .filter(Boolean);

  if (parts.some(part => part.length === 0 || part.length > BIGCOMMERCE_CATEGORY_NAME_MAX_LENGTH)) {
    return [];
  }

  return parts;
}

function isInvalidCategoryNameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Failed to create BigCommerce category \(422\)/.test(error.message) &&
    /Invalid field\(s\): name|\"name\":/i.test(error.message)
  );
}

async function ensureCategoryPath(
  accessToken: string,
  storeHash: string,
  categoryPath: string,
  categoryCache: BigCommerceCategory[],
): Promise<number | undefined> {
  const parts = parseCategoryPath(categoryPath);
  if (parts.length === 0) return undefined;

  let parentId = 0;
  let leafId: number | undefined;
  for (const part of parts) {
    const canonicalPart = canonicalizeTaxonomyName(part);
    const existing = categoryCache.find(
      category =>
        category.parent_id === parentId &&
        canonicalizeTaxonomyName(category.name) === canonicalPart,
    );
    if (existing) {
      parentId = existing.id;
      leafId = existing.id;
      continue;
    }

    let created: BigCommerceCatalogResponse<BigCommerceCategory>;
    try {
      created = await requestJson<BigCommerceCatalogResponse<BigCommerceCategory>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/categories`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: part,
            parent_id: parentId,
            is_visible: true,
          }),
        },
        'Failed to create BigCommerce category',
      );
    } catch (error) {
      if (isInvalidCategoryNameError(error)) {
        console.warn(`Skipping invalid BigCommerce category path segment "${part}" from "${categoryPath}".`);
        return undefined;
      }
      throw error;
    }
    categoryCache.push(created.data);
    parentId = created.data.id;
    leafId = created.data.id;
  }

  return leafId;
}

async function ensureCategoryIds(
  accessToken: string,
  storeHash: string,
  categories: string[] | undefined,
): Promise<number[] | undefined> {
  if (!categories || categories.length === 0) return undefined;

  const listResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceCategory>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/categories?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce categories',
  );
  const categoryCache = [...(listResponse.data ?? [])];
  const categoryIds: number[] = [];
  for (const categoryPath of categories) {
    const categoryId = await ensureCategoryPath(accessToken, storeHash, categoryPath, categoryCache);
    if (!categoryId) continue;
    if (!categoryIds.includes(categoryId)) {
      categoryIds.push(categoryId);
    }
  }

  return categoryIds.length > 0 ? categoryIds : undefined;
}

async function ensureVariantOptions(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
): Promise<void> {
  const variants = product.variants ?? [];
  if (variants.length === 0) return;

  const optionsNeeded = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const option of variant.option_values ?? []) {
      const key = option.option_display_name.trim();
      const label = option.label.trim();
      if (!key || !label) continue;
      const labels = optionsNeeded.get(key) ?? new Set<string>();
      labels.add(label);
      optionsNeeded.set(key, labels);
    }
  }
  if (optionsNeeded.size === 0) return;

  const optionsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceProductOption>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/options?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product options',
  );
  const existingOptions = optionsResponse.data ?? [];

  for (const [displayName, labelsSet] of Array.from(optionsNeeded.entries())) {
    const labels = Array.from(labelsSet);
    const existingOption = existingOptions.find(
      option => option.display_name.toLowerCase() === displayName.toLowerCase(),
    );

    if (!existingOption) {
      await requestJson<BigCommerceCatalogResponse<BigCommerceProductOption>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/options`,
        {
          method: 'POST',
          body: JSON.stringify({
            display_name: displayName,
            type: 'radio_buttons',
            option_values: labels.map(label => ({ label })),
          }),
        },
        'Failed to create BigCommerce product option',
      );
      continue;
    }

    const existingLabels = new Set(
      (existingOption.option_values ?? []).map(optionValue => optionValue.label.toLowerCase()),
    );
    for (const label of labels) {
      if (existingLabels.has(label.toLowerCase())) continue;
      try {
        await requestJson<BigCommerceCatalogResponse<BigCommerceOptionValue>>(
          accessToken,
          `${buildApiBase(storeHash)}/catalog/products/${productId}/options/${existingOption.id}/values`,
          {
            method: 'POST',
            body: JSON.stringify({ label }),
          },
          'Failed to create BigCommerce product option value',
        );
      } catch {
        // Duplicate or validation race can happen when values already exist.
      }
    }
  }
}

async function listProductVariants(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceVariant[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceVariant>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/variants?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce variants',
  );
  return response.data ?? [];
}

async function syncVariants(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
  pricingProjection: ReturnType<typeof projectProductPricing>,
): Promise<Map<string, number>> {
  const variants = (product.variants ?? []).filter(variant => variant.option_values.length > 0);
  if (variants.length === 0) {
    return new Map();
  }

  await ensureVariantOptions(accessToken, storeHash, productId, product);

  const existingBySku = new Map(
    (await listProductVariants(accessToken, storeHash, productId)).map(variant => [variant.sku, variant]),
  );

  for (const variant of variants) {
    const projected = pricingProjection.variants.find(item => item.sku === variant.sku);
    const payload = {
      sku: variant.sku,
      cost_price: projected?.cost_price ?? variant.cost_price ?? variant.price ?? product.cost_price ?? product.price ?? 0,
      price: projected?.price ?? variant.price ?? product.price ?? 0,
      inventory_level: variant.inventory_level ?? product.inventory_level ?? 0,
      option_values: variant.option_values,
    };
    const existing = existingBySku.get(variant.sku);
    if (existing) {
      await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${existing.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        'Failed to update BigCommerce variant',
      );
      continue;
    }

    await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/variants`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Failed to create BigCommerce variant',
    );
  }

  const refreshed = await listProductVariants(accessToken, storeHash, productId);
  return new Map(refreshed.map(variant => [variant.sku, variant.id]));
}

async function syncBulkPricingRules(
  accessToken: string,
  storeHash: string,
  productId: number,
  bulkPricingRules: NormalizedBulkPricingRule[] | undefined,
): Promise<void> {
  const existingRulesResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceBulkPricingRule>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules`,
    { method: 'GET' },
    'Failed to list BigCommerce bulk pricing rules',
  );

  for (const rule of existingRulesResponse.data ?? []) {
    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules/${rule.id}`,
      { method: 'DELETE' },
      'Failed to delete existing BigCommerce bulk pricing rule',
    );
  }

  for (const rule of bulkPricingRules ?? []) {
    const payload: Record<string, unknown> = {
      quantity_min: rule.quantity_min,
      type: rule.type,
      amount: rule.amount,
    };
    if (typeof rule.quantity_max === 'number') {
      payload.quantity_max = rule.quantity_max;
    }

    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Failed to create BigCommerce bulk pricing rule',
    );
  }
}

async function listProductModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceModifier[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceModifier>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers?limit=250`,
    { method: 'GET' },
    'Failed to list product modifiers',
  );
  return response.data ?? [];
}

async function ensureModifier(
  accessToken: string,
  storeHash: string,
  productId: number,
  input: {
    display_name: string;
    option_values: Array<{ label: string; adjuster_value?: number }>;
  },
): Promise<void> {
  const existingModifiers = await listProductModifiers(accessToken, storeHash, productId);
  const existing = existingModifiers.find(
    modifier => modifier.display_name.toLowerCase() === input.display_name.toLowerCase(),
  );

  const payload = {
    display_name: input.display_name,
    type: 'dropdown',
    required: false,
    option_values: input.option_values.map((value, index) => ({
      label: value.label,
      sort_order: index,
      is_default: index === 0,
      ...(value.adjuster_value !== undefined
        ? {
            adjusters: {
              price: {
                adjuster: 'relative',
                adjuster_value: value.adjuster_value,
              },
            },
          }
        : {}),
    })),
  };

  if (existing) {
    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers/${existing.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Failed to update product modifier',
    );
    return;
  }

  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Failed to create product modifier',
  );
}

async function ensureSharedOptionModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
  input: {
    vendorId: number;
    duplicate: boolean;
    size?: string;
    markupPercent: number;
  },
): Promise<void> {
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'vendor_id',
    option_values: [{ label: String(input.vendorId) }],
  });
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'duplicate',
    option_values: [{ label: input.duplicate ? 'true' : 'false' }],
  });
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'product_cost_markup',
    option_values: [{ label: String(input.markupPercent) }],
  });
  if (input.size) {
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'size',
      option_values: [{ label: input.size }],
    });
  }
}

function buildModifierCounts(min?: number, max?: number): number[] {
  const floorMin = min && min > 0 ? Math.floor(min) : 1;
  const floorMax = max && max >= floorMin ? Math.floor(max) : floorMin;
  const span = floorMax - floorMin;
  if (span > 15) return [floorMin, floorMax];
  const values: number[] = [];
  for (let value = floorMin; value <= floorMax; value += 1) {
    values.push(value);
  }
  return values;
}

async function ensureConfigurationModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
): Promise<void> {
  const blueprint = product.modifier_blueprint;
  if (!blueprint || blueprint.locations.length === 0) return;

  const locationValues = blueprint.locations.map(location => ({ label: location.location }));
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'Decoration Location',
    option_values: locationValues,
  });

  const methods = blueprint.locations.flatMap(location =>
    location.methods.map(method => ({
      label: `${location.location}: ${method.method}`,
      adjuster_value: method.charge_amount,
    })),
  );
  if (methods.length > 0) {
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'Decoration Method',
      option_values: methods,
    });
  }

  const definedMins = blueprint.locations
    .map(location => location.min_decorations)
    .filter((value): value is number => value !== undefined);
  const definedMaxes = blueprint.locations
    .map(location => location.max_decorations)
    .filter((value): value is number => value !== undefined);
  const min = definedMins.length > 0 ? Math.min(...definedMins) : undefined;
  const max = definedMaxes.length > 0 ? Math.max(...definedMaxes) : undefined;

  if (min !== undefined || max !== undefined) {
    const counts = buildModifierCounts(min ?? 1, max ?? 1);
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'Decoration Count',
      option_values: counts.map(count => {
        const charge = blueprint.charges.find(item => item.count === count);
        return {
          label: String(count),
          adjuster_value: charge?.amount,
        };
      }),
    });
  }
}

function ensureBaseVariantMapping(
  variantIdsBySku: Map<string, number>,
  productRecord: BigCommerceCatalogProduct,
  product: NormalizedProduct,
  resolvedSku: string,
): Map<string, number> {
  if (variantIdsBySku.size > 0 || !productRecord.base_variant_id) {
    return variantIdsBySku;
  }

  const next = new Map(variantIdsBySku);
  next.set(product.sku, productRecord.base_variant_id);
  next.set(resolvedSku, productRecord.base_variant_id);
  if (product.source_sku) {
    next.set(product.source_sku, productRecord.base_variant_id);
  }
  return next;
}

function buildVendorManagedMediaMarker(asset: NormalizedMediaAsset): string {
  const metadata: VendorManagedMediaMetadata = {
    mediaType: asset.media_type,
    url: asset.url,
    ...(asset.part_id ? { partId: asset.part_id } : {}),
    ...(asset.location_ids?.length ? { locationIds: asset.location_ids } : {}),
    ...(asset.decoration_ids?.length ? { decorationIds: asset.decoration_ids } : {}),
  };

  return `${VENDOR_MEDIA_MARKER_PREFIX}${JSON.stringify(metadata)}`;
}

function buildVendorManagedDescription(asset: NormalizedMediaAsset): string {
  const marker = buildVendorManagedMediaMarker(asset);
  return asset.description ? `${asset.description} | ${marker}` : marker;
}

function parseVendorManagedMarker(description: string | undefined): VendorManagedMediaMetadata | null {
  if (!description) return null;
  const markerIndex = description.indexOf(VENDOR_MEDIA_MARKER_PREFIX);
  if (markerIndex < 0) return null;
  const payload = description.slice(markerIndex + VENDOR_MEDIA_MARKER_PREFIX.length).trim();
  try {
    return JSON.parse(payload) as VendorManagedMediaMetadata;
  } catch {
    return null;
  }
}

function isVendorManagedDescription(description: string | undefined): boolean {
  return !!parseVendorManagedMarker(description);
}

function rankMediaAsset(asset: NormalizedMediaAsset): number {
  const classes = (asset.class_types ?? []).map(value => value.toLowerCase());
  if (classes.includes('primary')) return 400;
  if (classes.includes('blank') || classes.includes('hero')) return 300;
  if (classes.includes('finished') || classes.includes('decorated')) return 200;
  if (classes.includes('marketing') || classes.includes('lifestyle')) return 100;
  return 0;
}

function dedupeMediaAssets(assets: NormalizedMediaAsset[]): NormalizedMediaAsset[] {
  return assets.filter(
    (asset, index) =>
      assets.findIndex(
        candidate =>
          candidate.media_type === asset.media_type &&
          candidate.url === asset.url &&
          candidate.part_id === asset.part_id &&
          JSON.stringify(candidate.location_ids ?? []) === JSON.stringify(asset.location_ids ?? []) &&
          JSON.stringify(candidate.decoration_ids ?? []) === JSON.stringify(asset.decoration_ids ?? []),
      ) === index,
  );
}

function resolveVendorMediaAssets(product: NormalizedProduct): NormalizedMediaAsset[] {
  const structured = dedupeMediaAssets(product.media_assets ?? []);
  if (structured.length > 0) {
    return structured.sort((left, right) => {
      const productLevelDelta = Number(!right.part_id) - Number(!left.part_id);
      if (productLevelDelta !== 0) return productLevelDelta;
      const scoreDelta = rankMediaAsset(right) - rankMediaAsset(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.url.localeCompare(right.url);
    });
  }

  return dedupeMediaAssets(
    (product.images ?? []).map(image => ({
      url: image.image_url,
      media_type: 'Image' as const,
    })),
  );
}

function buildDesiredBigCommerceImages(product: NormalizedProduct): DesiredBigCommerceImage[] {
  const imageAssets = resolveVendorMediaAssets(product).filter(asset => asset.media_type === 'Image');
  return imageAssets.map((asset, index) => ({
    image_url: asset.url,
    description: buildVendorManagedDescription(asset),
    ...(index === 0 ? { is_thumbnail: true } : {}),
  }));
}

function extractYouTubeVideoId(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v')?.trim();
      return videoId || undefined;
    }
    if (host === 'youtu.be') {
      const videoId = parsed.pathname.replace(/^\/+/, '').trim();
      return videoId || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function buildDesiredBigCommerceVideos(product: NormalizedProduct): DesiredBigCommerceVideo[] {
  const videoAssets = resolveVendorMediaAssets(product).filter(asset => asset.media_type === 'Video');
  return videoAssets
    .map(asset => {
      const videoId = extractYouTubeVideoId(asset.url);
      if (!videoId) return null;
      return {
        title: asset.description || product.name,
        description: buildVendorManagedDescription(asset),
        type: 'youtube' as const,
        video_id: videoId,
      };
    })
    .filter((video): video is DesiredBigCommerceVideo => !!video);
}

function isDuplicateOrValidationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /duplicate|already exists|validation/i.test(error.message);
}

async function listProductImages(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceImage[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceImage>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/images?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product images',
  );
  return response.data ?? [];
}

async function createProductImage(
  accessToken: string,
  storeHash: string,
  productId: number,
  image: DesiredBigCommerceImage,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/images`,
    {
      method: 'POST',
      body: JSON.stringify(image),
    },
    'Failed to create BigCommerce product image',
  );
}

async function deleteProductImage(
  accessToken: string,
  storeHash: string,
  productId: number,
  imageId: number,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/images/${imageId}`,
    { method: 'DELETE' },
    'Failed to delete BigCommerce product image',
  );
}

async function listProductVideos(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceVideo[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceVideo>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/videos?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product videos',
  );
  return response.data ?? [];
}

async function createProductVideo(
  accessToken: string,
  storeHash: string,
  productId: number,
  video: DesiredBigCommerceVideo,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/videos`,
    {
      method: 'POST',
      body: JSON.stringify(video),
    },
    'Failed to create BigCommerce product video',
  );
}

async function deleteProductVideo(
  accessToken: string,
  storeHash: string,
  productId: number,
  videoId: number,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/videos/${videoId}`,
    { method: 'DELETE' },
    'Failed to delete BigCommerce product video',
  );
}

async function replaceVendorManagedImages(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  desiredImages: DesiredBigCommerceImage[];
}): Promise<void> {
  const deleteExisting = async (): Promise<void> => {
    const existingImages = await listProductImages(input.accessToken, input.storeHash, input.productId);
    const vendorManaged = existingImages.filter(image => isVendorManagedDescription(image.description));
    for (const image of vendorManaged) {
      await deleteProductImage(input.accessToken, input.storeHash, input.productId, image.id);
    }
  };

  if (input.desiredImages.length === 0) {
    await deleteExisting();
    return;
  }

  const existingImages = await listProductImages(input.accessToken, input.storeHash, input.productId);
  const vendorManaged = existingImages.filter(image => isVendorManagedDescription(image.description));

  try {
    for (const image of input.desiredImages) {
      await createProductImage(input.accessToken, input.storeHash, input.productId, image);
    }
    for (const image of vendorManaged) {
      await deleteProductImage(input.accessToken, input.storeHash, input.productId, image.id);
    }
  } catch (error) {
    if (!isDuplicateOrValidationError(error)) {
      throw error;
    }
    await deleteExisting();
    for (const image of input.desiredImages) {
      await createProductImage(input.accessToken, input.storeHash, input.productId, image);
    }
  }
}

async function replaceVendorManagedVideos(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  desiredVideos: DesiredBigCommerceVideo[];
}): Promise<void> {
  const deleteExisting = async (): Promise<void> => {
    const existingVideos = await listProductVideos(input.accessToken, input.storeHash, input.productId);
    const vendorManaged = existingVideos.filter(video => isVendorManagedDescription(video.description));
    for (const video of vendorManaged) {
      await deleteProductVideo(input.accessToken, input.storeHash, input.productId, video.id);
    }
  };

  if (input.desiredVideos.length === 0) {
    await deleteExisting();
    return;
  }

  const existingVideos = await listProductVideos(input.accessToken, input.storeHash, input.productId);
  const vendorManaged = existingVideos.filter(video => isVendorManagedDescription(video.description));

  try {
    for (const video of input.desiredVideos) {
      await createProductVideo(input.accessToken, input.storeHash, input.productId, video);
    }
    for (const video of vendorManaged) {
      await deleteProductVideo(input.accessToken, input.storeHash, input.productId, video.id);
    }
  } catch (error) {
    if (!isDuplicateOrValidationError(error)) {
      throw error;
    }
    await deleteExisting();
    for (const video of input.desiredVideos) {
      await createProductVideo(input.accessToken, input.storeHash, input.productId, video);
    }
  }
}

async function syncVendorManagedProductMedia(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  product: NormalizedProduct;
}): Promise<void> {
  const desiredImages = buildDesiredBigCommerceImages(input.product);
  const desiredVideos = buildDesiredBigCommerceVideos(input.product);

  await replaceVendorManagedImages({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    desiredImages,
  });
  await replaceVendorManagedVideos({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    desiredVideos,
  });
}

export async function upsertBigCommerceProduct(
  input: UpsertBigCommerceProductInput,
): Promise<UpsertBigCommerceProductResult> {
  const candidates = await listProductCandidates(input.accessToken, input.storeHash, input.product);
  const decision = classifyDuplicateDecision({
    source_sku: input.product.sku,
    source_name: input.product.name,
    vendor_id: input.vendorId,
    candidates: candidates.map(toCandidate),
  });

  const markupPercent = input.pricingContext?.markup_percent ?? input.defaultMarkupPercent ?? 30;
  const priceListId = input.pricingContext?.price_list_id ?? Number(process.env.BIGCOMMERCE_B2B_PRICE_LIST_ID ?? 1);
  const currency = input.pricingContext?.currency ?? process.env.BIGCOMMERCE_PRICE_LIST_CURRENCY ?? 'USD';

  const pricingProjection = projectProductPricing(input.product, {
    markup_percent: markupPercent,
    price_list_id: priceListId,
    currency,
  });

  const resolvedSku = await resolveAvailableSku(
    input.accessToken,
    input.storeHash,
    decision.resolved_sku,
    decision.target_product_id,
  );
  const brandId = await ensureBrandId(input.accessToken, input.storeHash, input.product.brand_name);
  const categoryIds = await ensureCategoryIds(input.accessToken, input.storeHash, input.product.categories);

  const createPayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeVariants: true,
    sku: resolvedSku,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
    productFallback: pricingProjection.product_fallback,
    variants: pricingProjection.variants,
  });
  const updatePayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeVariants: false,
    sku: resolvedSku,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
    productFallback: pricingProjection.product_fallback,
    variants: pricingProjection.variants,
  });

  const productRecord =
    decision.action === 'create' || !decision.target_product_id
      ? (
          await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
            input.accessToken,
            `${buildApiBase(input.storeHash)}/catalog/products`,
            {
              method: 'POST',
              body: JSON.stringify(createPayload),
            },
            'Failed to create BigCommerce product',
          )
        ).data
      : (
          await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
            input.accessToken,
            `${buildApiBase(input.storeHash)}/catalog/products/${decision.target_product_id}`,
            {
              method: 'PUT',
              body: JSON.stringify(updatePayload),
            },
            'Failed to update BigCommerce product',
          )
        ).data;

  let variantIdsBySku = await syncVariants(
    input.accessToken,
    input.storeHash,
    productRecord.id,
    input.product,
    pricingProjection,
  );
  variantIdsBySku = ensureBaseVariantMapping(variantIdsBySku, productRecord, input.product, resolvedSku);

  await syncBulkPricingRules(
    input.accessToken,
    input.storeHash,
    productRecord.id,
    pricingProjection.product_fallback.bulk_pricing_rules,
  );

  await ensureSharedOptionModifiers(input.accessToken, input.storeHash, productRecord.id, {
    vendorId: input.vendorId,
    duplicate: decision.duplicate,
    size: input.product.shared_option_values?.size,
    markupPercent,
  });
  await ensureConfigurationModifiers(input.accessToken, input.storeHash, productRecord.id, input.product);

  const contractProjection = projectBigCommerceProductContract(input.product, {
    price_list_id: priceListId,
    currency,
    markup_percent: markupPercent,
    markup_namespace: input.pricingContext?.markup_namespace ?? process.env.BIGCOMMERCE_MARKUP_METAFIELD_NAMESPACE ?? 'merchmonk',
    markup_key: input.pricingContext?.markup_key ?? process.env.BIGCOMMERCE_MARKUP_METAFIELD_KEY ?? 'product_markup',
  });

  await syncProjectedProductContract({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: productRecord.id,
    productDesignerDefaults: contractProjection.product_designer_defaults,
    variantDesignerOverrides: contractProjection.variant_designer_overrides,
    variantIdsBySku,
  });

  try {
    await syncVendorManagedProductMedia({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: productRecord.id,
      product: input.product,
    });
  } catch (error) {
    console.warn(`Failed to sync vendor-managed media for product ${productRecord.id}:`, error);
  }

  const priceListRecords = pricingProjection.variants
    .map(variant => {
      const variantId = variantIdsBySku.get(variant.sku);
      if (!variantId) return null;
      return {
        variant_id: variantId,
        price: variant.price,
        ...(variant.price_list_bulk_tiers ? { bulk_pricing_tiers: variant.price_list_bulk_tiers } : {}),
      };
    })
    .filter((record): record is { variant_id: number; price: number; bulk_pricing_tiers?: Array<{ quantity_min: number; quantity_max?: number; price: number }> } => !!record);

  const pricingReconciliation = reconcileProjectedPricingTargets({
    pricingProjection,
    variantIdsBySku,
  });

  await upsertPriceListRecords({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    price_list_id: priceListId,
    records: priceListRecords,
  });

  return {
    product: {
      ...productRecord,
      sku: resolvedSku,
    },
    duplicate: decision.duplicate,
    action: decision.action === 'create' || !decision.target_product_id ? 'create' : 'update',
    resolvedSku,
    markupPercent,
    pricingReconciliation,
  };
}

export async function upsertRelatedProducts(input: {
  accessToken: string;
  storeHash: string;
  sourceProductId: number;
  targetProductIds: number[];
}): Promise<void> {
  if (input.targetProductIds.length === 0) return;

  const existingResponse = await requestJson<BigCommerceCatalogListResponse<{ related_product_id?: number; id?: number }>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.sourceProductId}/related-products?limit=250`,
    { method: 'GET' },
    'Failed to list related products',
  );
  const existing = new Set(
    (existingResponse.data ?? [])
      .map(row => row.related_product_id ?? row.id)
      .filter((value): value is number => typeof value === 'number'),
  );

  for (const relatedProductId of input.targetProductIds) {
    if (existing.has(relatedProductId)) continue;
    try {
      await requestJson<Record<string, unknown>>(
        input.accessToken,
        `${buildApiBase(input.storeHash)}/catalog/products/${input.sourceProductId}/related-products`,
        {
          method: 'POST',
          body: JSON.stringify({ related_product_id: relatedProductId }),
        },
        'Failed to create related product link',
      );
    } catch {
      // Duplicate or validation race can happen when sync runs overlap.
    }
  }
}
