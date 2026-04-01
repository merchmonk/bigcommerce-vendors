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
  collapseBulkPricingRulesByRange,
  classifyDuplicateDecision,
  type ProductCandidate,
} from './syncSemantics';
import { encodeWebpUnderMaxBytes, stageWebpBufferForRemoteImageUrl } from './bigcommerceImageStaging';

interface BigCommerceCatalogProduct {
  id: number;
  sku: string;
  name: string;
  upc?: string;
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
  option_values?: Array<{
    option_id?: number;
    id?: number;
    option_display_name?: string;
    label?: string;
  }>;
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

interface BigCommerceVariantOptionValueInput {
  option_id: number;
  id: number;
  option_display_name?: string;
  label?: string;
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
  is_thumbnail?: boolean;
}

interface BigCommerceVideo {
  id: number;
  description?: string;
}

interface BigCommerceInventoryLocation {
  id: number;
  enabled?: boolean;
}

interface VendorManagedMediaMetadata {
  mediaType: 'Image' | 'Video';
  url: string;
  partId?: string;
  locationIds?: string[];
  locationNames?: string[];
  decorationIds?: string[];
  decorationNames?: string[];
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

const BIGCOMMERCE_MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024;

const VENDOR_MEDIA_MARKER_PREFIX = 'mm_media:';
const BIGCOMMERCE_CATEGORY_NAME_MAX_LENGTH = 50;
const BIGCOMMERCE_BRAND_NAME_MAX_LENGTH = 100;
const INVENTORY_ONLY_FOR_EXISTING_PRODUCTS = true;

function normalizeIdentifier(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function buildVariantIdentityKeys(variant: {
  sku?: string;
  source_sku?: string;
  part_id?: string;
  option_values?: Array<{ option_display_name?: string; label?: string }>;
}): string[] {
  const keys = new Set<string>();
  const add = (value: string | undefined) => {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      keys.add(normalized);
    }
  };

  add(variant.sku);
  add(variant.source_sku);
  add(variant.part_id);

  const partOption = (variant.option_values ?? []).find(
    optionValue => optionValue.option_display_name?.trim().toLowerCase() === 'part',
  );
  add(partOption?.label);

  return Array.from(keys);
}

function findMatchingExistingVariant(
  existingVariants: BigCommerceVariant[],
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  },
): BigCommerceVariant | undefined {
  const identityKeys = new Set(buildVariantIdentityKeys(variant));
  if (identityKeys.size === 0) {
    return undefined;
  }

  return existingVariants.find(existingVariant =>
    buildVariantIdentityKeys(existingVariant).some(key => identityKeys.has(key)),
  );
}

function buildInventorySyncTarget(input: {
  productId: number;
  product: NormalizedProduct;
  variantIdsBySku: Map<string, number>;
}): BigCommerceInventorySyncTarget | undefined {
  const variants = (input.product.variants ?? []).filter(variant => variant.option_values.length > 0);

  if (variants.length === 0) {
    if (input.product.inventory_level === undefined) {
      return undefined;
    }

    return {
      tracking: 'product',
      items: [
        {
          product_id: input.productId,
          quantity: input.product.inventory_level,
        },
      ],
    };
  }

  const items = variants
    .map(variant => {
      const variantId =
        input.variantIdsBySku.get(variant.sku) ??
        (variant.source_sku ? input.variantIdsBySku.get(variant.source_sku) : undefined);
      const quantity = variant.inventory_level;

      if (!variantId || quantity === undefined) {
        return null;
      }

      return {
        variant_id: variantId,
        quantity,
      };
    })
    .filter((item): item is { variant_id: number; quantity: number } => !!item);

  if (items.length === 0) {
    return undefined;
  }

  return {
    tracking: 'variant',
    items,
  };
}

export interface UpsertBigCommerceProductInput {
  accessToken: string;
  storeHash: string;
  vendorId: number;
  vendorName?: string;
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
  inventory_sync_target?: BigCommerceInventorySyncTarget;
}

export interface PartialBigCommerceUpsertResult {
  product: BigCommerceCatalogProduct;
  duplicate: boolean;
  action: 'create' | 'update';
  resolvedSku: string;
  markupPercent: number;
  pricingReconciliation?: PricingReconciliationSummary;
  inventory_sync_target?: BigCommerceInventorySyncTarget;
}

export interface BigCommerceInventorySyncTarget {
  tracking: 'product' | 'variant';
  items: Array<
    | {
        product_id: number;
        quantity: number;
      }
    | {
        variant_id: number;
        quantity: number;
      }
  >;
}

export type BigCommercePartialUpsertError = Error & {
  partial_upsert_result: PartialBigCommerceUpsertResult;
};

function buildPartialUpsertError(
  error: unknown,
  partialResult: PartialBigCommerceUpsertResult,
): BigCommercePartialUpsertError {
  const baseError =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : 'BigCommerce product upsert failed');

  return Object.assign(baseError, {
    partial_upsert_result: partialResult,
  });
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
    includeCustomFields?: boolean;
    includeVariants?: boolean;
    isVisible?: boolean;
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
      gtin?: string;
      cost_price: number;
      price: number;
      option_values: Array<{ option_display_name: string; label: string }>;
    }>;
  },
): Record<string, unknown> {
  const variantPayload = options.variants
    .filter(variant => variant.option_values.length > 0)
    .map(variant => {
      return {
        sku: variant.sku,
        ...(variant.gtin ? { upc: variant.gtin } : {}),
        cost_price: variant.cost_price,
        price: variant.price,
        option_values: variant.option_values,
      };
    });

  const hasVariants = variantPayload.length > 0;

  return {
    name: product.name,
    type: 'physical',
    sku: options.sku,
    ...(product.gtin ? { upc: product.gtin } : {}),
    description: product.description ?? '',
    weight: product.weight ?? 0,
    ...(options.productFallback.cost_price !== undefined ? { cost_price: options.productFallback.cost_price } : {}),
    ...(options.productFallback.price !== undefined ? { price: options.productFallback.price } : {}),
    inventory_tracking: hasVariants ? 'variant' : 'product',
    search_keywords: product.search_keywords ?? undefined,
    ...(options.includeCustomFields !== false
      ? {
          custom_fields: withSharedFields(product, {
            vendorId: options.vendorId,
            duplicate: options.duplicate,
            markupPercent: options.markupPercent,
          }),
        }
      : {}),
    ...(options.brandId ? { brand_id: options.brandId } : {}),
    ...(options.categoryIds && options.categoryIds.length > 0 ? { categories: options.categoryIds } : {}),
    ...(typeof options.isVisible === 'boolean' ? { is_visible: options.isVisible } : {}),
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

  const existingOptions = await listProductOptions(accessToken, storeHash, productId);

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

async function listProductOptions(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceProductOption[]> {
  const optionsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceProductOption>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/options?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product options',
  );
  return optionsResponse.data ?? [];
}

function buildVariantOptionLookup(
  options: BigCommerceProductOption[],
): Map<string, Map<string, BigCommerceVariantOptionValueInput>> {
  const lookup = new Map<string, Map<string, BigCommerceVariantOptionValueInput>>();
  for (const option of options) {
    const byLabel = new Map<string, BigCommerceVariantOptionValueInput>();
    for (const value of option.option_values ?? []) {
      byLabel.set(value.label.trim().toLowerCase(), {
        option_id: option.id,
        id: value.id,
      });
    }
    lookup.set(option.display_name.trim().toLowerCase(), byLabel);
  }
  return lookup;
}

function toBigCommerceVariantOptionValues(
  optionValues: Array<{ option_display_name: string; label: string }>,
  lookup: Map<string, Map<string, BigCommerceVariantOptionValueInput>>,
): Array<BigCommerceVariantOptionValueInput | { option_display_name: string; label: string }> {
  return optionValues.map(optionValue => {
    const optionLookup = lookup.get(optionValue.option_display_name.trim().toLowerCase());
    const resolved = optionLookup?.get(optionValue.label.trim().toLowerCase());
    return resolved ?? optionValue;
  });
}

function serializeBigCommerceVariantOptionValues(
  optionValues:
    | Array<{
        option_display_name?: string;
        label?: string;
        option_id?: number;
        id?: number;
      }>
    | undefined,
): string {
  return (optionValues ?? [])
    .map(optionValue => {
      if (typeof optionValue.option_id === 'number' && typeof optionValue.id === 'number') {
        return `id:${optionValue.option_id}:${optionValue.id}`;
      }

      const displayName = optionValue.option_display_name?.trim().toLowerCase() ?? '';
      const label = optionValue.label?.trim().toLowerCase() ?? '';
      return `label:${displayName}:${label}`;
    })
    .sort()
    .join('|');
}

function isDuplicateVariantOptionValuesError(error: unknown): boolean {
  return error instanceof Error && /same option values set exists/i.test(error.message);
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

async function syncInventoryOnlyForExistingProduct(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  product: NormalizedProduct;
}): Promise<Map<string, number>> {
  const variantIdsBySku = new Map<string, number>();
  const variants = (input.product.variants ?? []).filter(variant => variant.option_values.length > 0);

  if (variants.length === 0) {
    await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          inventory_tracking: 'product',
        }),
      },
      'Failed to update BigCommerce product inventory',
    );
    return variantIdsBySku;
  }

  await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        inventory_tracking: 'variant',
      }),
    },
    'Failed to update BigCommerce product inventory tracking',
  );

  const existingVariants = await listProductVariants(input.accessToken, input.storeHash, input.productId);

  for (const variant of variants) {
    const existing = findMatchingExistingVariant(existingVariants, variant);
    if (!existing) {
      continue;
    }

    variantIdsBySku.set(variant.sku, existing.id);
  }

  return variantIdsBySku;
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
  const variantOptionLookup = buildVariantOptionLookup(
    await listProductOptions(accessToken, storeHash, productId),
  );

  const existingVariants = await listProductVariants(accessToken, storeHash, productId);
  const existingBySku = new Map(
    existingVariants.map(variant => [variant.sku, variant]),
  );
  const variantIdsBySku = new Map<string, number>(
    Array.from(existingBySku.entries()).map(([sku, variant]) => [sku, variant.id]),
  );

  for (const variant of variants) {
    const projected = pricingProjection.variants.find(item => item.sku === variant.sku);
    const payload = {
      sku: variant.sku,
      ...(variant.gtin ? { upc: variant.gtin } : {}),
      cost_price: projected?.cost_price ?? variant.cost_price ?? variant.price ?? product.cost_price ?? product.price ?? 0,
      price: projected?.price ?? variant.price ?? product.price ?? 0,
      option_values: toBigCommerceVariantOptionValues(variant.option_values, variantOptionLookup),
    };
    const existing = existingBySku.get(variant.sku) ?? findMatchingExistingVariant(existingVariants, variant);
    if (existing) {
      const updated = await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${existing.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        'Failed to update BigCommerce variant',
      );
      variantIdsBySku.set(variant.sku, updated.data?.id ?? existing.id);
      continue;
    }

    const created = await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/variants`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Failed to create BigCommerce variant',
    ).catch(async error => {
      if (!isDuplicateVariantOptionValuesError(error)) {
        throw error;
      }

      const refreshedVariants = await listProductVariants(accessToken, storeHash, productId);
      const targetOptionKey = serializeBigCommerceVariantOptionValues(payload.option_values);
      const matchingVariant = refreshedVariants.find(existingVariant => {
        if (existingVariant.sku === variant.sku) {
          return true;
        }
        return serializeBigCommerceVariantOptionValues(existingVariant.option_values) === targetOptionKey;
      });

      if (!matchingVariant) {
        throw error;
      }

      return requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${matchingVariant.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        'Failed to update existing BigCommerce variant after duplicate create conflict',
      );
    });
    if (created.data?.id) {
      variantIdsBySku.set(variant.sku, created.data.id);
    }
  }

  const refreshed = await listProductVariants(accessToken, storeHash, productId);
  for (const variant of refreshed) {
    variantIdsBySku.set(variant.sku, variant.id);
  }

  return variantIdsBySku;
}

async function resolveInventoryLocationId(
  accessToken: string,
  storeHash: string,
): Promise<number> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceInventoryLocation>>(
    accessToken,
    `${buildApiBase(storeHash)}/inventory/locations`,
    { method: 'GET' },
    'Failed to list BigCommerce inventory locations',
  );

  const locations = response.data ?? [];
  const preferredLocation = locations.find(location => location.enabled) ?? locations[0];
  if (!preferredLocation) {
    throw new Error('No BigCommerce inventory location is available.');
  }

  return preferredLocation.id;
}

export async function syncBigCommerceInventoryBatch(input: {
  accessToken: string;
  storeHash: string;
  targets: BigCommerceInventorySyncTarget[];
}): Promise<void> {
  const productItems = input.targets
    .filter(target => target.tracking === 'product')
    .flatMap(target => target.items)
    .filter((item): item is { product_id: number; quantity: number } => 'product_id' in item);
  const variantItems = input.targets
    .filter(target => target.tracking === 'variant')
    .flatMap(target => target.items)
    .filter((item): item is { variant_id: number; quantity: number } => 'variant_id' in item);

  if (productItems.length === 0 && variantItems.length === 0) {
    return;
  }

  const locationId = await resolveInventoryLocationId(input.accessToken, input.storeHash);

  if (productItems.length > 0) {
    await requestJson<Record<string, unknown>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/inventory/adjustments/absolute`,
      {
        method: 'PUT',
        body: JSON.stringify({
          items: productItems.map(item => ({
            location_id: locationId,
            product_id: item.product_id,
            quantity: item.quantity,
          })),
        }),
      },
      'Failed to update BigCommerce product inventory via Inventory API',
    );
  }

  if (variantItems.length > 0) {
    await requestJson<Record<string, unknown>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/inventory/adjustments/absolute`,
      {
        method: 'PUT',
        body: JSON.stringify({
          items: variantItems.map(item => ({
            location_id: locationId,
            variant_id: item.variant_id,
            quantity: item.quantity,
          })),
        }),
      },
      'Failed to update BigCommerce variant inventory via Inventory API',
    );
  }
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

  const collapsedRules = collapseBulkPricingRulesByRange(bulkPricingRules ?? []);

  for (const rule of dedupeBulkPricingRuleRanges(normalizeBulkPricingRuleRanges(collapsedRules))) {
    const payload: Record<string, unknown> = {
      quantity_min: rule.quantity_min,
      quantity_max: typeof rule.quantity_max === 'number' ? rule.quantity_max : 0,
      type: rule.type,
      amount: rule.amount,
    };

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

function dedupeBulkPricingRuleRanges(
  rules: NormalizedBulkPricingRule[],
): NormalizedBulkPricingRule[] {
  const seen = new Set<string>();
  return rules.filter(rule => {
    const key = [
      rule.quantity_min,
      typeof rule.quantity_max === 'number' ? rule.quantity_max : 'open',
      rule.type,
      rule.amount,
    ].join(':');

    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeBulkPricingRuleRanges(
  rules: NormalizedBulkPricingRule[],
): NormalizedBulkPricingRule[] {
  const sorted = [...rules].sort((left, right) => left.quantity_min - right.quantity_min);

  return sorted.map((rule, index) => {
    const next = sorted[index + 1];
    const nextUpperBound =
      next && next.quantity_min > rule.quantity_min ? next.quantity_min - 1 : undefined;
    const normalizedQuantityMax =
      typeof nextUpperBound === 'number'
        ? typeof rule.quantity_max === 'number'
          ? Math.min(rule.quantity_max, nextUpperBound)
          : nextUpperBound
        : rule.quantity_max;

    return {
      ...rule,
      ...(typeof normalizedQuantityMax === 'number' ? { quantity_max: normalizedQuantityMax } : {}),
    };
  });
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

function shouldRecreateModifier(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /Failed to update product modifier \(422\)/.test(error.message) ||
    /already used on this option/i.test(error.message) ||
    /not more than one default/i.test(error.message)
  );
}

async function deleteProductModifier(
  accessToken: string,
  storeHash: string,
  productId: number,
  modifierId: number,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers/${modifierId}`,
    { method: 'DELETE' },
    'Failed to delete product modifier',
  );
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

  const buildPayload = (includeDefault: boolean) => ({
    display_name: input.display_name,
    type: 'dropdown',
    required: false,
    option_values: input.option_values.map((value, index) => ({
      label: value.label,
      sort_order: index,
      ...(includeDefault ? { is_default: index === 0 } : {}),
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
  });

  if (existing) {
    try {
      await requestJson<Record<string, unknown>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers/${existing.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(buildPayload(false)),
        },
        'Failed to update product modifier',
      );
      return;
    } catch (error) {
      if (!shouldRecreateModifier(error)) {
        throw error;
      }

      await deleteProductModifier(accessToken, storeHash, productId, existing.id);
    }
  }

  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers`,
    {
      method: 'POST',
      body: JSON.stringify(buildPayload(true)),
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
    vendorName?: string;
    duplicate: boolean;
    size?: string;
    markupPercent: number;
  },
): Promise<void> {
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'vendor_id',
    option_values: [{ label: String(input.vendorId) }],
  });
  if (input.vendorName?.trim()) {
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'vendor_name',
      option_values: [{ label: input.vendorName.trim() }],
    });
  }
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
  if (!productRecord.base_variant_id) {
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

function resolveMediaLocationNames(product: NormalizedProduct, asset: NormalizedMediaAsset): string[] | undefined {
  const explicitNames = asset.location_names?.filter(value => value.trim());
  if (explicitNames && explicitNames.length > 0) {
    return explicitNames;
  }

  const names = (asset.location_ids ?? [])
    .map(locationId =>
      product.pricing_configuration?.locations?.find(location => String(location.location_id) === String(locationId))?.location_name,
    )
    .filter((value): value is string => !!value?.trim());

  return names.length > 0 ? names : undefined;
}

function resolveMediaDecorationNames(product: NormalizedProduct, asset: NormalizedMediaAsset): string[] | undefined {
  const explicitNames = asset.decoration_names?.filter(value => value.trim());
  if (explicitNames && explicitNames.length > 0) {
    return explicitNames;
  }

  const names = (asset.decoration_ids ?? [])
    .map(decorationId => {
      for (const location of product.pricing_configuration?.locations ?? []) {
        const match = location.decorations.find(
          decoration => String(decoration.decoration_id) === String(decorationId),
        );
        if (match?.decoration_name?.trim()) {
          return match.decoration_name;
        }
      }
      return undefined;
    })
    .filter((value): value is string => !!value?.trim());

  return names.length > 0 ? names : undefined;
}

function buildVendorManagedMediaMarker(product: NormalizedProduct, asset: NormalizedMediaAsset): string {
  const metadata: VendorManagedMediaMetadata = {
    mediaType: asset.media_type,
    url: asset.url,
    ...(asset.part_id ? { partId: asset.part_id } : {}),
    ...(asset.location_ids?.length ? { locationIds: asset.location_ids } : {}),
    ...(resolveMediaLocationNames(product, asset)?.length
      ? { locationNames: resolveMediaLocationNames(product, asset) }
      : {}),
    ...(asset.decoration_ids?.length ? { decorationIds: asset.decoration_ids } : {}),
    ...(resolveMediaDecorationNames(product, asset)?.length
      ? { decorationNames: resolveMediaDecorationNames(product, asset) }
      : {}),
  };

  return `${VENDOR_MEDIA_MARKER_PREFIX}${JSON.stringify(metadata)}`;
}

function buildVendorManagedDescription(product: NormalizedProduct, asset: NormalizedMediaAsset): string {
  const marker = buildVendorManagedMediaMarker(product, asset);
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

function serializeVendorManagedImageSignature(input: {
  marker: VendorManagedMediaMetadata;
  isThumbnail: boolean;
}): string {
  return JSON.stringify({
    mediaType: input.marker.mediaType,
    url: input.marker.url,
    partId: input.marker.partId,
    locationIds: input.marker.locationIds ?? [],
    locationNames: input.marker.locationNames ?? [],
    decorationIds: input.marker.decorationIds ?? [],
    decorationNames: input.marker.decorationNames ?? [],
    isThumbnail: input.isThumbnail,
  });
}

function buildVendorManagedImageSignature(input: {
  description?: string;
  is_thumbnail?: boolean;
}): string | null {
  const marker = parseVendorManagedMarker(input.description);
  if (!marker || marker.mediaType !== 'Image') {
    return null;
  }

  return serializeVendorManagedImageSignature({
    marker,
    isThumbnail: !!input.is_thumbnail,
  });
}

function buildDesiredImageSignature(image: DesiredBigCommerceImage): string {
  const marker = parseVendorManagedMarker(image.description);
  if (!marker || marker.mediaType !== 'Image') {
    return JSON.stringify({
      mediaType: 'Image',
      url: image.image_url,
      isThumbnail: !!image.is_thumbnail,
    });
  }

  return serializeVendorManagedImageSignature({
    marker,
    isThumbnail: !!image.is_thumbnail,
  });
}

function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrementCount(counts: Map<string, number>, key: string): void {
  const current = counts.get(key) ?? 0;
  if (current <= 1) {
    counts.delete(key);
    return;
  }

  counts.set(key, current - 1);
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
        JSON.stringify(candidate.location_names ?? []) === JSON.stringify(asset.location_names ?? []) &&
        JSON.stringify(candidate.decoration_ids ?? []) === JSON.stringify(asset.decoration_ids ?? []) &&
        JSON.stringify(candidate.decoration_names ?? []) === JSON.stringify(asset.decoration_names ?? []),
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
  return imageAssets
    .map(asset => {
      const normalizedUrl = normalizeBigCommerceImageUrl(asset.url);
      if (!normalizedUrl) {
        return null;
      }

      return {
        image_url: normalizedUrl,
        description: buildVendorManagedDescription(product, asset),
      };
    })
    .filter((image): image is Omit<DesiredBigCommerceImage, 'is_thumbnail'> => !!image)
    .map((image, index) => ({
      ...image,
      ...(index === 0 ? { is_thumbnail: true } : {}),
    }));
}

function normalizeBigCommerceImageUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
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
        description: buildVendorManagedDescription(product, asset),
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

function isOversizedBigCommerceImageError(error: unknown): boolean {
  return error instanceof Error && /maximum of 8 MB size limit for upload image is exceeded/i.test(error.message);
}

interface RemoteImageProbeResult {
  ok: boolean;
  contentLength?: number;
  status?: number;
  contentType?: string;
}

function parseRemoteContentLength(response: Response): number | undefined {
  const header = response.headers.get('content-length');
  if (!header) {
    return undefined;
  }

  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readRemoteContentType(response: Response): string | undefined {
  const contentType = response.headers.get('content-type')?.trim().toLowerCase();
  return contentType || undefined;
}

function isAcceptedRemoteImageContentType(contentType: string | undefined): boolean {
  if (!contentType) {
    return true;
  }

  return contentType.startsWith('image/');
}

async function fetchRemoteImageProbe(
  url: string,
  options: RequestInit,
): Promise<RemoteImageProbeResult> {
  try {
    const response = await fetch(url, {
      ...options,
      redirect: 'follow',
    });

    const contentType = readRemoteContentType(response);
    const contentLength = parseRemoteContentLength(response);

    if (options.method !== 'HEAD') {
      await response.body?.cancel();
    }

    return {
      ok: response.ok && isAcceptedRemoteImageContentType(contentType),
      status: response.status,
      contentType,
      contentLength,
    };
  } catch {
    return { ok: false };
  }
}

async function probeRemoteImageUrl(url: string): Promise<RemoteImageProbeResult> {
  const headProbe = await fetchRemoteImageProbe(url, { method: 'HEAD' });
  if (headProbe.ok) {
    return headProbe;
  }

  return fetchRemoteImageProbe(url, { method: 'GET' });
}

function buildRemoteImageLogContext(input: { productId: number; variantId?: number }): string {
  if (input.variantId) {
    return `product ${input.productId} variant ${input.variantId}`;
  }

  return `product ${input.productId}`;
}

function describeRemoteImageFailure(probe: RemoteImageProbeResult): string {
  if (probe.contentType && !isAcceptedRemoteImageContentType(probe.contentType)) {
    return `remote asset returned non-image content-type ${probe.contentType}`;
  }

  if (probe.status) {
    return `remote asset returned HTTP ${probe.status}`;
  }

  return 'remote asset could not be reached';
}

async function resolveUploadableRemoteImageUrl(input: {
  productId: number;
  imageUrl: string;
  variantId?: number;
}): Promise<string | null> {
  const probe = await probeRemoteImageUrl(input.imageUrl);
  const logContext = buildRemoteImageLogContext(input);
  if (!probe.ok) {
    console.warn(
      `Skipping BigCommerce image for ${logContext}; ${describeRemoteImageFailure(probe)}: ${input.imageUrl}`,
    );
    return null;
  }

  if (
    typeof probe.contentLength === 'number' &&
    probe.contentLength > BIGCOMMERCE_MAX_REMOTE_IMAGE_BYTES
  ) {
    const response = await fetch(input.imageUrl);
    if (!response.ok) {
      console.warn(
        `Failed to fetch BigCommerce image for ${logContext}: ${input.imageUrl}`,
      );
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const optimized = await encodeWebpUnderMaxBytes(buffer, BIGCOMMERCE_MAX_REMOTE_IMAGE_BYTES);
    if (!optimized) {
      console.warn(
        `Skipping BigCommerce image for ${logContext}; could not compress under 8 MB: ${input.imageUrl}`,
      );
      return null;
    }
    const stagedUrl = await stageWebpBufferForRemoteImageUrl(optimized);
    if (!stagedUrl) {
      console.warn(
        `Skipping BigCommerce image for ${logContext}; set BIGCOMMERCE_IMAGE_STAGING_BUCKET (and optional BIGCOMMERCE_IMAGE_STAGING_PUBLIC_BASE_URL) to stage oversized images. Source: ${input.imageUrl}`,
      );
      return null;
    }
    return stagedUrl;
  }

  return input.imageUrl;
}

async function filterUploadableProductImages(
  productId: number,
  images: DesiredBigCommerceImage[],
): Promise<DesiredBigCommerceImage[]> {
  const uploadable: DesiredBigCommerceImage[] = [];

  for (const image of images) {
    const uploadableUrl = await resolveUploadableRemoteImageUrl({
      productId,
      imageUrl: image.image_url,
    });
    if (!uploadableUrl) {
      continue;
    }

    uploadable.push({ ...image, image_url: uploadableUrl });
  }

  return uploadable;
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

async function tryCreateProductImage(
  accessToken: string,
  storeHash: string,
  productId: number,
  image: DesiredBigCommerceImage,
): Promise<boolean> {
  try {
    await createProductImage(accessToken, storeHash, productId, image);
    return true;
  } catch (error) {
    if (!isOversizedBigCommerceImageError(error)) {
      throw error;
    }

    console.warn(
      `Skipping BigCommerce product image for product ${productId} because the remote asset exceeds BigCommerce's 8 MB upload limit: ${image.image_url}`,
    );
    return false;
  }
}

async function createProductVariantImage(
  accessToken: string,
  storeHash: string,
  productId: number,
  variantId: number,
  imageUrl: string,
): Promise<void> {
  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${variantId}/image`,
    {
      method: 'POST',
      body: JSON.stringify({
        image_url: imageUrl,
      }),
    },
    'Failed to create BigCommerce product variant image',
  );
}

async function tryCreateProductVariantImage(
  accessToken: string,
  storeHash: string,
  productId: number,
  variantId: number,
  imageUrl: string,
): Promise<boolean> {
  try {
    await createProductVariantImage(accessToken, storeHash, productId, variantId, imageUrl);
    return true;
  } catch (error) {
    if (!isOversizedBigCommerceImageError(error)) {
      throw error;
    }

    console.warn(
      `Skipping BigCommerce variant image for product ${productId} variant ${variantId} because the remote asset exceeds BigCommerce's 8 MB upload limit: ${imageUrl}`,
    );
    return false;
  }
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

  const uploadableImages = await filterUploadableProductImages(input.productId, input.desiredImages);
  const existingImages = await listProductImages(input.accessToken, input.storeHash, input.productId);
  const vendorManaged = existingImages.filter(image => isVendorManagedDescription(image.description));

  if (uploadableImages.length === 0) {
    return;
  }

  const missingDesiredCounts = new Map<string, number>();
  for (const image of input.desiredImages) {
    incrementCount(missingDesiredCounts, buildDesiredImageSignature(image));
  }

  const imagesToDelete: BigCommerceImage[] = [];
  for (const image of vendorManaged) {
    const signature = buildVendorManagedImageSignature(image);
    if (signature && (missingDesiredCounts.get(signature) ?? 0) > 0) {
      decrementCount(missingDesiredCounts, signature);
      continue;
    }

    imagesToDelete.push(image);
  }

  const availableUploadCounts = new Map<string, number>();
  for (const image of uploadableImages) {
    const signature = buildDesiredImageSignature(image);
    if ((missingDesiredCounts.get(signature) ?? 0) > 0) {
      incrementCount(availableUploadCounts, signature);
    }
  }

  const canReachDesiredState = Array.from(missingDesiredCounts.entries()).every(
    ([signature, count]) => (availableUploadCounts.get(signature) ?? 0) >= count,
  );

  const imagesToCreate: DesiredBigCommerceImage[] = [];
  const pendingCreateCounts = new Map(missingDesiredCounts);
  for (const image of uploadableImages) {
    const signature = buildDesiredImageSignature(image);
    if ((pendingCreateCounts.get(signature) ?? 0) <= 0) {
      continue;
    }

    imagesToCreate.push(image);
    decrementCount(pendingCreateCounts, signature);
  }

  if (imagesToCreate.length === 0 && imagesToDelete.length === 0) {
    return;
  }

  const createdCounts = new Map<string, number>();
  for (const image of imagesToCreate) {
    const created = await tryCreateProductImage(input.accessToken, input.storeHash, input.productId, image);
    if (created) {
      incrementCount(createdCounts, buildDesiredImageSignature(image));
    }
  }

  const createdAllMissingImages = Array.from(missingDesiredCounts.entries()).every(
    ([signature, count]) => (createdCounts.get(signature) ?? 0) >= count,
  );

  if (!canReachDesiredState || !createdAllMissingImages) {
    return;
  }

  for (const image of imagesToDelete) {
    await deleteProductImage(input.accessToken, input.storeHash, input.productId, image.id);
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
  variantIdsBySku?: Map<string, number>;
}): Promise<void> {
  const desiredImages = buildDesiredBigCommerceImages(input.product);

  await replaceVendorManagedImages({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    desiredImages,
  });

  await syncVariantImages({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    product: input.product,
    variantIdsBySku: input.variantIdsBySku,
  });
}

function findPreferredVariantImageUrl(
  product: NormalizedProduct,
  variant: NonNullable<NormalizedProduct['variants']>[number],
): string | undefined {
  const candidatePartIds = [variant.part_id, variant.source_sku, variant.sku]
    .map(value => value?.trim())
    .filter((value): value is string => !!value);

  if (candidatePartIds.length === 0) {
    return undefined;
  }

  const partAssets = resolveVendorMediaAssets(product)
    .filter(asset => asset.media_type === 'Image' && !!asset.part_id && candidatePartIds.includes(asset.part_id))
    .sort((left, right) => {
      const scoreDelta = rankMediaAsset(right) - rankMediaAsset(left);
      if (scoreDelta !== 0) return scoreDelta;
      return left.url.localeCompare(right.url);
    });

  return normalizeBigCommerceImageUrl(partAssets[0]?.url ?? '');
}

async function syncVariantImages(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  product: NormalizedProduct;
  variantIdsBySku?: Map<string, number>;
}): Promise<void> {
  if (!input.variantIdsBySku || input.variantIdsBySku.size === 0) {
    return;
  }

  for (const variant of input.product.variants ?? []) {
    if ((variant.option_values ?? []).length === 0) {
      continue;
    }

    const variantId =
      input.variantIdsBySku.get(variant.sku) ??
      (variant.source_sku ? input.variantIdsBySku.get(variant.source_sku) : undefined);
    if (!variantId) {
      continue;
    }

    const imageUrl = findPreferredVariantImageUrl(input.product, variant);
    if (!imageUrl) {
      continue;
    }

    const uploadableUrl = await resolveUploadableRemoteImageUrl({
      productId: input.productId,
      variantId,
      imageUrl,
    });
    if (!uploadableUrl) {
      continue;
    }

    await tryCreateProductVariantImage(
      input.accessToken,
      input.storeHash,
      input.productId,
      variantId,
      uploadableUrl,
    );
  }
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

  if (INVENTORY_ONLY_FOR_EXISTING_PRODUCTS && decision.action === 'update' && decision.target_product_id) {
    const existingProduct = candidates.find(candidate => candidate.id === decision.target_product_id);
    let partialResult: PartialBigCommerceUpsertResult = {
      product: {
        id: decision.target_product_id,
        sku: existingProduct?.sku ?? decision.resolved_sku,
        name: existingProduct?.name ?? input.product.name,
      },
      duplicate: decision.duplicate,
      action: 'update',
      resolvedSku: existingProduct?.sku ?? decision.resolved_sku,
      markupPercent,
    };

    try {
      const variantIdsBySku = await syncInventoryOnlyForExistingProduct({
        accessToken: input.accessToken,
        storeHash: input.storeHash,
        productId: decision.target_product_id,
        product: input.product,
      });
      await ensureSharedOptionModifiers(input.accessToken, input.storeHash, decision.target_product_id, {
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        duplicate: decision.duplicate,
        size: input.product.shared_option_values?.size,
        markupPercent,
      });
      await syncVendorManagedProductMedia({
        accessToken: input.accessToken,
        storeHash: input.storeHash,
        productId: decision.target_product_id,
        product: input.product,
        variantIdsBySku,
      });
      const pricingReconciliation = reconcileProjectedPricingTargets({
        pricingProjection,
        variantIdsBySku,
      });
      partialResult = {
        ...partialResult,
        pricingReconciliation,
        inventory_sync_target: buildInventorySyncTarget({
          productId: decision.target_product_id,
          product: input.product,
          variantIdsBySku,
        }),
      };

      return {
        ...partialResult,
        pricingReconciliation,
        inventory_sync_target: partialResult.inventory_sync_target,
      } satisfies UpsertBigCommerceProductResult;
    } catch (error) {
      throw buildPartialUpsertError(error, partialResult);
    }
  }

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
    includeCustomFields: true,
    includeVariants: true,
    isVisible: false,
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
    includeCustomFields: false,
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

  const action = decision.action === 'create' || !decision.target_product_id ? 'create' : 'update';
  let partialResult: PartialBigCommerceUpsertResult = {
    product: {
      ...productRecord,
      sku: resolvedSku,
    },
    duplicate: decision.duplicate,
    action,
    resolvedSku,
    markupPercent,
  };

  try {
    let variantIdsBySku = await syncVariants(
      input.accessToken,
      input.storeHash,
      productRecord.id,
      input.product,
      pricingProjection,
    );
    variantIdsBySku = ensureBaseVariantMapping(variantIdsBySku, productRecord, input.product, resolvedSku);

    const pricingReconciliation = reconcileProjectedPricingTargets({
      pricingProjection,
      variantIdsBySku,
    });
    const inventorySyncTarget = buildInventorySyncTarget({
      productId: productRecord.id,
      product: input.product,
      variantIdsBySku,
    });
    partialResult = {
      ...partialResult,
      pricingReconciliation,
      inventory_sync_target: inventorySyncTarget,
    };

    await syncBulkPricingRules(
      input.accessToken,
      input.storeHash,
      productRecord.id,
      pricingProjection.product_fallback.bulk_pricing_rules,
    );

    await ensureSharedOptionModifiers(input.accessToken, input.storeHash, productRecord.id, {
      vendorId: input.vendorId,
      vendorName: input.vendorName,
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

    await syncVendorManagedProductMedia({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: productRecord.id,
      product: input.product,
      variantIdsBySku,
    });

    const variantPriceListRecords = pricingProjection.variants
      .map(variant => {
        const variantId = variantIdsBySku.get(variant.sku);
        if (!variantId) return null;
        return {
          variant_id: variantId,
          price: variant.price,
          currency,
          ...(variant.price_list_bulk_tiers ? { bulk_pricing_tiers: variant.price_list_bulk_tiers } : {}),
        };
      })
      .filter((record): record is { variant_id: number; price: number; currency: string; bulk_pricing_tiers?: import('./pricingProjector').PriceListBulkPricingTier[] } => !!record);

    const basePriceListRecord =
      input.product.variants && input.product.variants.length > 0 && productRecord.base_variant_id && pricingProjection.product_fallback.price !== undefined
        ? {
            variant_id: productRecord.base_variant_id,
            price: pricingProjection.product_fallback.price,
            currency,
          }
        : null;

    const priceListRecords = [
      ...(basePriceListRecord ? [basePriceListRecord] : []),
      ...variantPriceListRecords,
    ].filter(
      (record, index, records) => records.findIndex(item => item.variant_id === record.variant_id) === index,
    );

    await upsertPriceListRecords({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      price_list_id: priceListId,
      records: priceListRecords,
    });

    return {
      ...partialResult,
      pricingReconciliation,
      inventory_sync_target: inventorySyncTarget,
    } satisfies UpsertBigCommerceProductResult;
  } catch (error) {
    throw buildPartialUpsertError(error, partialResult);
  }
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
