import {
  buildPriceListTargets,
  type BigCommercePricingContext,
} from './bigcommercePricingContext';
import pluralize from 'pluralize';
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
  buildApiV2Base,
  requestJson,
} from './bigcommerceApi';
import {
  canonicalizeTaxonomyName,
  buildDuplicateSku,
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
  mpn?: string;
  base_variant_id?: number;
  related_products?: string | number[];
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
  mpn?: string;
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
  option_values?: Array<{
    id?: number;
    option_id?: number;
    is_default?: boolean;
    label?: string;
    sort_order?: number;
    adjusters?: {
      price?: {
        adjuster_value?: number | string;
      };
    };
  }>;
}

interface BigCommerceModifierValue {
  id: number;
  option_id?: number;
  label?: string;
  sort_order?: number;
  is_default?: boolean;
  adjusters?: {
    price?: {
      adjuster_value?: number | string;
    };
  };
}

interface BigCommerceImage {
  id: number;
  description?: string;
  is_thumbnail?: boolean;
}

interface BigCommerceCustomField {
  id: number;
  name: string;
  value: string;
}

interface BigCommerceVideo {
  id: number;
  description?: string;
}

const DEFAULT_BIGCOMMERCE_INVENTORY_LOCATION_ID = 1;

interface VendorManagedMediaMetadata {
  productId?: string;
  mediaType?: 'Image' | 'Video';
  url?: string;
  partId?: string;
  classTypeArray?: Array<{
    classTypeId?: string;
    classTypeName?: string;
  }>;
  classTypes?: string[];
  fileSize?: number;
  width?: number;
  height?: number;
  dpi?: number;
  color?: string;
  description?: string;
  singlePart?: boolean;
  changeTimeStamp?: string;
  decorationArray?: Array<{
    decorationId?: string;
    decorationName?: string;
  }>;
  locationArray?: Array<{
    locationId?: string;
    locationName?: string;
  }>;
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
const BIGCOMMERCE_MAX_IMAGE_DOWNLOAD_BYTES = 32 * 1024 * 1024;

const VENDOR_MEDIA_MARKER_PREFIX = 'mm_media:';
const VENDOR_MEDIA_DESCRIPTION_SEPARATOR = ' | ';
const BIGCOMMERCE_CATEGORY_NAME_MAX_LENGTH = 50;
const BIGCOMMERCE_BRAND_NAME_MAX_LENGTH = 100;
const BIGCOMMERCE_CUSTOM_FIELD_VALUE_MAX_LENGTH = 250;
const BIGCOMMERCE_RELATED_VENDOR_PRODUCT_IDS_FIELD = 'related_vendor_product_ids';
const INVENTORY_ONLY_FOR_EXISTING_PRODUCTS = true;

function toTitleCase(value: string): string {
  return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeCategorySegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return toTitleCase(pluralize(toTitleCase(trimmed)).trim());
}

function normalizeIdentifier(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function buildVariantIdentityKeys(variant: {
  sku?: string;
  source_sku?: string;
  part_id?: string;
  mpn?: string;
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
  add(variant.mpn);

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
    mpn?: string;
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

function readManagedIdentifier(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function hashManagedIdentifier(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100000000;
  }
  return String(hash).padStart(8, '0');
}

function buildManagedProductSku(productId: number): string {
  return `MM${productId}`;
}

function buildTemporaryManagedProductSku(input: {
  vendorId: number;
  product: NormalizedProduct;
  attempt?: number;
}): string {
  const identity = readManagedIdentifier(
    input.product.vendor_product_id,
    input.product.source_sku,
    input.product.sku,
  ) ?? `${input.vendorId}`;
  const suffix = hashManagedIdentifier(`${input.vendorId}:${identity}`);
  return input.attempt && input.attempt > 0
    ? `MMTMP${suffix}_${input.attempt}`
    : `MMTMP${suffix}`;
}

function buildManagedVariantIdentity(input: {
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  };
}): string {
  const optionKey = (input.variant.option_values ?? [])
    .map(optionValue => `${optionValue.option_display_name ?? ''}:${optionValue.label ?? ''}`)
    .join('|');
  return readManagedIdentifier(
    input.variant.part_id,
    input.variant.source_sku,
    input.variant.sku,
    optionKey,
  ) ?? 'variant';
}

function normalizeVariantSkuSegment(value: string | undefined): string {
  const normalized = value?.toUpperCase().replace(/[^A-Z0-9]+/g, '') ?? '';
  if (normalized.length >= 3) {
    return normalized.slice(0, 3);
  }
  if (normalized.length > 0) {
    return normalized.padEnd(3, 'X');
  }
  return 'VAR';
}

function resolveManagedVariantLabel(variant: {
  color?: string;
  size?: string;
  part_id?: string;
  source_sku?: string;
  sku?: string;
  option_values?: Array<{ option_display_name?: string; label?: string }>;
}): string {
  const preferredOptionLabel = (variant.option_values ?? [])
    .filter(optionValue => optionValue.option_display_name?.trim().toLowerCase() !== 'part')
    .map(optionValue => optionValue.label?.trim())
    .find((value): value is string => !!value);

  return (
    preferredOptionLabel ??
    variant.color?.trim() ??
    variant.size?.trim() ??
    variant.part_id?.trim() ??
    variant.source_sku?.trim() ??
    variant.sku?.trim() ??
    'VAR'
  );
}

function buildManagedVariantSkuLookup(input: {
  parentSku: string;
  variants: Array<{
    sku?: string;
    source_sku?: string;
    part_id?: string;
    color?: string;
    size?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  }>;
}): Map<string, string> {
  const lookup = new Map<string, string>();
  const usedSkus = new Set<string>();

  for (const variant of input.variants) {
    const identity = buildManagedVariantIdentity({ variant });
    const segment = normalizeVariantSkuSegment(resolveManagedVariantLabel(variant));
    let candidateSku = `${input.parentSku}-${segment}`;

    if (usedSkus.has(candidateSku)) {
      const hash = hashManagedIdentifier(identity);
      for (let length = 1; length <= hash.length; length += 1) {
        const nextCandidate = `${input.parentSku}-${segment}${hash.slice(0, length)}`;
        if (!usedSkus.has(nextCandidate)) {
          candidateSku = nextCandidate;
          break;
        }
      }
    }

    usedSkus.add(candidateSku);
    lookup.set(identity, candidateSku);
  }

  return lookup;
}

function getManagedVariantSku(input: {
  variantSkuLookup: Map<string, string>;
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  };
}): string {
  return input.variantSkuLookup.get(buildManagedVariantIdentity({ variant: input.variant })) ?? 'MM-VAR';
}

function buildVariantReferenceKeys(variant: {
  sku?: string;
  source_sku?: string;
  part_id?: string;
  mpn?: string;
}): string[] {
  const keys = [variant.part_id, variant.mpn, variant.source_sku, variant.sku]
    .map(value => value?.trim())
    .filter((value): value is string => !!value);

  return keys.filter((value, index) => keys.indexOf(value) === index);
}

function registerVariantId(
  variantIdsBySku: Map<string, number>,
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    mpn?: string;
  },
  variantId: number,
): void {
  for (const key of buildVariantReferenceKeys(variant)) {
    variantIdsBySku.set(key, variantId);
  }
}

function resolveVariantId(
  variantIdsBySku: Map<string, number>,
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    mpn?: string;
  },
): number | undefined {
  for (const key of buildVariantReferenceKeys(variant)) {
    const variantId = variantIdsBySku.get(key);
    if (variantId !== undefined) {
      return variantId;
    }
  }

  return undefined;
}

function resolveManagedProductMpn(product: NormalizedProduct): string | undefined {
  return readManagedIdentifier(product.vendor_product_id, product.source_sku, product.sku);
}

function resolveManagedVariantMpn(variant: {
  part_id?: string;
  source_sku?: string;
  sku?: string;
}): string | undefined {
  return readManagedIdentifier(variant.part_id, variant.source_sku, variant.sku);
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
      const variantId = resolveVariantId(input.variantIdsBySku, {
        ...variant,
        mpn: resolveManagedVariantMpn(variant),
      });
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
  existingBigCommerceProductId?: number;
  defaultMarkupPercent?: number;
  pricingContext?: BigCommercePricingContext;
  inventoryOnlyForExistingProducts?: boolean;
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

function buildManagedContractProduct(input: {
  product: NormalizedProduct;
  resolvedSku: string;
}): NormalizedProduct {
  const variantSkuLookup = buildManagedVariantSkuLookup({
    parentSku: input.resolvedSku,
    variants: input.product.variants ?? [],
  });

  return {
    ...input.product,
    sku: input.resolvedSku,
    variants: (input.product.variants ?? []).map(variant => ({
      ...variant,
      sku: getManagedVariantSku({
        variantSkuLookup,
        variant,
      }),
    })),
  };
}

function buildProjectedPriceListRecords(input: {
  pricingProjection: ReturnType<typeof projectProductPricing>;
  variantIdsBySku: Map<string, number>;
  hasOptionBearingVariants: boolean;
  baseVariantId?: number;
}): Array<{
  variant_id: number;
  price: number;
  currency: string;
  bulk_pricing_tiers?: import('./pricingProjector').PriceListBulkPricingTier[];
}> {
  const variantPriceListRecords = input.pricingProjection.variants
    .map(variant => {
      const variantId = input.variantIdsBySku.get(variant.sku);
      if (!variantId) return null;
      return {
        variant_id: variantId,
        price: variant.price,
        currency: input.pricingProjection.currency,
        ...(variant.price_list_bulk_tiers ? { bulk_pricing_tiers: variant.price_list_bulk_tiers } : {}),
      };
    })
    .filter(
      (
        record,
      ): record is {
        variant_id: number;
        price: number;
        currency: string;
        bulk_pricing_tiers?: import('./pricingProjector').PriceListBulkPricingTier[];
      } => !!record,
    );

  const basePriceListRecord =
    !input.hasOptionBearingVariants &&
    input.baseVariantId &&
    input.pricingProjection.product_fallback.price !== undefined
      ? {
          variant_id: input.baseVariantId,
          price: input.pricingProjection.product_fallback.price,
          currency: input.pricingProjection.currency,
        }
      : null;

  return [
    ...variantPriceListRecords,
    ...(basePriceListRecord ? [basePriceListRecord] : []),
  ].filter(
    (record, index, records) => records.findIndex(item => item.variant_id === record.variant_id) === index,
  );
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
    ...(product.upc ? { gtin: product.upc } : {}),
    vendor_marker: readVendorMarker(product),
  };
}

async function listProductsByGtin(
  accessToken: string,
  storeHash: string,
  gtin: string,
): Promise<BigCommerceCatalogProduct[]> {
  const normalizedGtin = gtin.trim();
  if (!normalizedGtin) {
    return [];
  }

  const url = `${buildApiBase(storeHash)}/catalog/products?upc=${encodeURIComponent(normalizedGtin)}&include=custom_fields&limit=250`;
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCatalogProduct>>(
    accessToken,
    url,
    { method: 'GET' },
    'Failed to list BigCommerce products by GTIN',
  );
  return (response.data ?? []).filter(item => item.upc?.trim() === normalizedGtin);
}

async function listProductCandidates(
  accessToken: string,
  storeHash: string,
  product: NormalizedProduct,
): Promise<BigCommerceCatalogProduct[]> {
  if (!product.gtin?.trim()) {
    return [];
  }

  const byGtin = await listProductsByGtin(accessToken, storeHash, product.gtin);
  return dedupeProducts(byGtin);
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
    field => !['vendor_id', 'duplicate', 'size', 'product_cost_markup', BIGCOMMERCE_RELATED_VENDOR_PRODUCT_IDS_FIELD].includes(field.name),
  );
  const relatedVendorProductIdsField = buildRelatedVendorProductIdsCustomField(product);
  return dedupeCustomFields([
    ...withoutReserved,
    { name: 'vendor_id', value: String(input.vendorId) },
    { name: 'duplicate', value: input.duplicate ? 'true' : 'false' },
    ...(product.shared_option_values?.size ? [{ name: 'size', value: product.shared_option_values.size }] : []),
    { name: 'product_cost_markup', value: String(input.markupPercent) },
    ...(relatedVendorProductIdsField ? [relatedVendorProductIdsField] : []),
  ]);
}

function buildRelatedVendorProductIdsCustomField(
  product: NormalizedProduct,
): { name: string; value: string } | null {
  const relatedVendorProductIds = Array.from(
    new Set(
      (product.related_vendor_product_ids ?? [])
        .map(value => value.trim())
        .filter(Boolean),
    ),
  );
  if (relatedVendorProductIds.length === 0) {
    return null;
  }

  const value = relatedVendorProductIds.join(',');
  if (value.length > BIGCOMMERCE_CUSTOM_FIELD_VALUE_MAX_LENGTH) {
    console.warn(
      `Skipping BigCommerce custom field "${BIGCOMMERCE_RELATED_VENDOR_PRODUCT_IDS_FIELD}" because the value exceeds ${BIGCOMMERCE_CUSTOM_FIELD_VALUE_MAX_LENGTH} characters for product ${product.vendor_product_id ?? product.sku}.`,
    );
    return null;
  }

  return {
    name: BIGCOMMERCE_RELATED_VENDOR_PRODUCT_IDS_FIELD,
    value,
  };
}

async function listProductCustomFields(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceCustomField[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCustomField>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/custom-fields?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product custom fields',
  );
  return response.data ?? [];
}

async function syncRelatedVendorProductIdsCustomField(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  product: NormalizedProduct;
}): Promise<void> {
  const desiredField = buildRelatedVendorProductIdsCustomField(input.product);
  if (!desiredField) {
    return;
  }

  const existingFields = await listProductCustomFields(input.accessToken, input.storeHash, input.productId);
  const matchingFields = existingFields.filter(field => field.name === BIGCOMMERCE_RELATED_VENDOR_PRODUCT_IDS_FIELD);
  const [currentField, ...duplicateFields] = matchingFields;

  for (const duplicateField of duplicateFields) {
    await requestJson<Record<string, unknown>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/custom-fields/${duplicateField.id}`,
      { method: 'DELETE' },
      'Failed to delete BigCommerce product custom field',
    );
  }

  if (!currentField) {
    await requestJson<BigCommerceCatalogResponse<BigCommerceCustomField>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/custom-fields`,
      {
        method: 'POST',
        body: JSON.stringify(desiredField),
      },
      'Failed to create BigCommerce product custom field',
    );
    return;
  }

  if (currentField.value === desiredField.value) {
    return;
  }

  await requestJson<BigCommerceCatalogResponse<BigCommerceCustomField>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/custom-fields/${currentField.id}`,
    {
      method: 'PUT',
      body: JSON.stringify(desiredField),
    },
    'Failed to update BigCommerce product custom field',
  );
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
    mpn?: string;
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
      mpn?: string;
      cost_price: number;
      price: number;
      min_purchase_quantity?: number;
      max_purchase_quantity?: number;
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
        ...(variant.mpn ? { mpn: variant.mpn } : {}),
        cost_price: variant.cost_price,
        price: variant.price,
        ...(variant.min_purchase_quantity !== undefined ? { min_purchase_quantity: variant.min_purchase_quantity } : {}),
        ...(variant.max_purchase_quantity !== undefined ? { max_purchase_quantity: variant.max_purchase_quantity } : {}),
        option_values: variant.option_values,
      };
    });

  const hasVariants = variantPayload.length > 0;

  return {
    name: product.name,
    type: 'physical',
    sku: options.sku,
    ...(options.mpn ? { mpn: options.mpn } : {}),
    ...(product.gtin ? { upc: product.gtin } : {}),
    description: product.description ?? '',
    weight: product.weight ?? 0,
    ...(options.productFallback.cost_price !== undefined ? { cost_price: options.productFallback.cost_price } : {}),
    ...(options.productFallback.price !== undefined ? { price: options.productFallback.price } : {}),
    ...(product.min_purchase_quantity !== undefined ? { min_purchase_quantity: product.min_purchase_quantity } : {}),
    ...(product.max_purchase_quantity !== undefined ? { max_purchase_quantity: product.max_purchase_quantity } : {}),
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
    .map(normalizeCategorySegment)
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
    const existing = findMatchingExistingVariant(existingVariants, {
      ...variant,
      mpn: resolveManagedVariantMpn(variant),
    });
    if (!existing) {
      continue;
    }

    registerVariantId(variantIdsBySku, {
      ...variant,
      mpn: resolveManagedVariantMpn(variant),
    }, existing.id);
  }

  return variantIdsBySku;
}

async function syncVariants(
  accessToken: string,
  storeHash: string,
  productId: number,
  parentSku: string,
  vendorId: number,
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
  const managedVariantSkuLookup = buildManagedVariantSkuLookup({
    parentSku,
    variants,
  });

  for (const variant of variants) {
    const projected = pricingProjection.variants.find(item => item.sku === variant.sku);
    const managedSku = getManagedVariantSku({
      variantSkuLookup: managedVariantSkuLookup,
      variant,
    });
    const payload = {
      sku: managedSku,
      ...(variant.gtin ? { upc: variant.gtin } : {}),
      ...(resolveManagedVariantMpn(variant) ? { mpn: resolveManagedVariantMpn(variant) } : {}),
      cost_price: projected?.cost_price ?? variant.cost_price ?? variant.price ?? product.cost_price ?? product.price ?? 0,
      price: projected?.price ?? variant.price ?? product.price ?? 0,
      ...(variant.min_purchase_quantity !== undefined ? { min_purchase_quantity: variant.min_purchase_quantity } : {}),
      ...(variant.max_purchase_quantity !== undefined ? { max_purchase_quantity: variant.max_purchase_quantity } : {}),
      option_values: toBigCommerceVariantOptionValues(variant.option_values, variantOptionLookup),
    };
    const existing =
      existingBySku.get(variant.sku) ??
      findMatchingExistingVariant(existingVariants, {
        ...variant,
        mpn: resolveManagedVariantMpn(variant),
      });
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
      registerVariantId(variantIdsBySku, {
        ...variant,
        mpn: resolveManagedVariantMpn(variant),
      }, updated.data?.id ?? existing.id);
      continue;
    }

    const createVariant = (variantPayload: Record<string, unknown>) =>
      requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/variants`,
        {
          method: 'POST',
          body: JSON.stringify(variantPayload),
        },
        'Failed to create BigCommerce variant',
      );

    const created = await createVariant(payload).catch(async error => {
      if (isDuplicateVariantOptionValuesError(error)) {
        const refreshedVariants = await listProductVariants(accessToken, storeHash, productId);
        const targetOptionKey = serializeBigCommerceVariantOptionValues(payload.option_values);
        const matchingVariant =
          findMatchingExistingVariant(refreshedVariants, {
            ...variant,
            mpn: resolveManagedVariantMpn(variant),
          }) ??
          refreshedVariants.find(existingVariant => {
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
      }

      if (!isDuplicateSkuError(error)) {
        throw error;
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const retryPayload = {
          ...payload,
          sku: buildSkuRetryCandidateSku({
            desiredSku: managedSku,
            vendorId,
            attempt,
          }),
        };

        try {
          return await createVariant(retryPayload);
        } catch (retryError) {
          if (!isDuplicateSkuError(retryError) || attempt === 4) {
            throw retryError;
          }
        }
      }

      throw error;
    });
    if (created.data?.id) {
      registerVariantId(variantIdsBySku, {
        ...variant,
        mpn: resolveManagedVariantMpn(variant),
      }, created.data.id);
    }
  }

  const refreshed = await listProductVariants(accessToken, storeHash, productId);
  for (const variant of refreshed) {
    registerVariantId(variantIdsBySku, variant, variant.id);
  }

  return variantIdsBySku;
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

  if (productItems.length > 0) {
    await requestJson<Record<string, unknown>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/inventory/adjustments/absolute`,
      {
        method: 'PUT',
        body: JSON.stringify({
          items: productItems.map(item => ({
            location_id: DEFAULT_BIGCOMMERCE_INVENTORY_LOCATION_ID,
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
            location_id: DEFAULT_BIGCOMMERCE_INVENTORY_LOCATION_ID,
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

function normalizeModifierOptionLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sleep(ms: number): Promise<void> {
  if (process.env.NODE_ENV === 'test' || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableModifierCreateError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /Failed to create product modifier \((500|502|503|504)\)/.test(error.message);
}

function findModifierByDisplayName(
  modifiers: BigCommerceModifier[],
  displayName: string,
): BigCommerceModifier | undefined {
  const normalizedDisplayName = displayName.trim().toLowerCase();
  return modifiers.find(modifier => modifier.display_name.trim().toLowerCase() === normalizedDisplayName);
}

function dedupeModifierOptionValues(
  optionValues: Array<{ label: string; adjuster_value?: number }>,
): Array<{ label: string; adjuster_value?: number }> {
  const deduped: Array<{ label: string; adjuster_value?: number }> = [];
  const indicesByLabel = new Map<string, number>();

  for (const optionValue of optionValues) {
    const label = optionValue.label.trim();
    if (!label) {
      continue;
    }

    const normalizedLabel = normalizeModifierOptionLabel(label);
    const existingIndex = indicesByLabel.get(normalizedLabel);
    if (existingIndex === undefined) {
      indicesByLabel.set(normalizedLabel, deduped.length);
      deduped.push({
        ...optionValue,
        label,
      });
      continue;
    }

    const existing = deduped[existingIndex];
    if (existing.adjuster_value === undefined && optionValue.adjuster_value !== undefined) {
      existing.adjuster_value = optionValue.adjuster_value;
    }
  }

  return deduped;
}

function readModifierAdjusterValue(
  value: { adjusters?: { price?: { adjuster_value?: number | string } } },
): number | undefined {
  const adjusterValue = value.adjusters?.price?.adjuster_value;
  if (typeof adjusterValue === 'number' && Number.isFinite(adjusterValue)) {
    return adjusterValue;
  }

  if (typeof adjusterValue === 'string' && adjusterValue.trim()) {
    const parsed = Number(adjusterValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizeExistingModifierOptionValues(
  optionValues: Array<{
    id?: number;
    label?: string;
    sort_order?: number;
    is_default?: boolean;
    adjusters?: {
      price?: {
        adjuster_value?: number | string;
      };
    };
  }>,
): Array<{ label: string; adjuster_value?: number }> {
  return optionValues
    .map((value, index) => ({
      label: normalizeModifierOptionLabel(value.label ?? ''),
      adjuster_value: readModifierAdjusterValue(value),
      sort_order: typeof value.sort_order === 'number' ? value.sort_order : index,
    }))
    .filter(value => value.label.length > 0)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map(({ label, adjuster_value }) => ({
      label,
      ...(adjuster_value !== undefined ? { adjuster_value } : {}),
    }));
}

async function listProductModifierValues(
  accessToken: string,
  storeHash: string,
  productId: number,
  modifierId: number,
): Promise<BigCommerceModifierValue[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceModifierValue>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers/${modifierId}/values?limit=250`,
    { method: 'GET' },
    'Failed to list product modifier values',
  );
  return response.data ?? [];
}

function buildModifierValuePayload(
  value: { label: string; adjuster_value?: number },
  sortOrder: number,
  isDefault: boolean,
): Record<string, unknown> {
  return {
    label: value.label,
    sort_order: sortOrder,
    is_default: isDefault,
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
  };
}

async function updateModifierValue(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  modifierId: number;
  valueId: number;
  value: { label: string; adjuster_value?: number };
  sortOrder: number;
  isDefault: boolean;
}): Promise<void> {
  await requestJson<BigCommerceCatalogResponse<BigCommerceModifierValue>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/modifiers/${input.modifierId}/values/${input.valueId}`,
    {
      method: 'PUT',
      body: JSON.stringify(buildModifierValuePayload(input.value, input.sortOrder, input.isDefault)),
    },
    'Failed to update product modifier value',
  );
}

async function createModifierValue(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  modifierId: number;
  value: { label: string; adjuster_value?: number };
  sortOrder: number;
  isDefault: boolean;
}): Promise<BigCommerceModifierValue> {
  const response = await requestJson<BigCommerceCatalogResponse<BigCommerceModifierValue>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/modifiers/${input.modifierId}/values`,
    {
      method: 'POST',
      body: JSON.stringify(buildModifierValuePayload(input.value, input.sortOrder, input.isDefault)),
    },
    'Failed to create product modifier value',
  );
  return response.data;
}

async function deleteModifierValue(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  modifierId: number;
  valueId: number;
}): Promise<void> {
  await requestJson<Record<string, unknown>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/modifiers/${input.modifierId}/values/${input.valueId}`,
    { method: 'DELETE' },
    'Failed to delete product modifier value',
  );
}

async function syncModifierValues(
  accessToken: string,
  storeHash: string,
  productId: number,
  modifierId: number,
  optionValues: Array<{ label: string; adjuster_value?: number }>,
): Promise<void> {
  const desiredValues = dedupeModifierOptionValues(optionValues);
  if (desiredValues.length === 0) {
    return;
  }

  const existingValues = await listProductModifierValues(accessToken, storeHash, productId, modifierId);
  if (normalizeExistingModifierOptionValues(existingValues).length === 0) {
    for (let index = 0; index < desiredValues.length; index += 1) {
      const value = desiredValues[index];
      await createModifierValue({
        accessToken,
        storeHash,
        productId,
        modifierId,
        value,
        sortOrder: index,
        isDefault: index === 0,
      });
    }
    return;
  }

  if (
    modifierAlreadyMatchesDesiredValues(
      {
        id: modifierId,
        display_name: '',
        option_values: existingValues,
      },
      desiredValues,
    )
  ) {
    return;
  }

  const sortedExistingValues = [...existingValues].sort((left, right) => {
    const leftOrder = typeof left.sort_order === 'number' ? left.sort_order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.sort_order === 'number' ? right.sort_order : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.id - right.id;
  });

  for (const extraValue of sortedExistingValues.slice(desiredValues.length)) {
    await deleteModifierValue({
      accessToken,
      storeHash,
      productId,
      modifierId,
      valueId: extraValue.id,
    });
  }

  for (let index = 0; index < desiredValues.length; index += 1) {
    const desiredValue = desiredValues[index];
    if (index === 0) {
      continue;
    }

    const existingValue = sortedExistingValues[index];
    if (existingValue) {
      await updateModifierValue({
        accessToken,
        storeHash,
        productId,
        modifierId,
        valueId: existingValue.id,
        value: desiredValue,
        sortOrder: index,
        isDefault: false,
      });
    } else {
      await createModifierValue({
        accessToken,
        storeHash,
        productId,
        modifierId,
        value: desiredValue,
        sortOrder: index,
        isDefault: false,
      });
    }
  }

  const defaultValue = desiredValues[0];
  const existingDefaultValue = sortedExistingValues[0];
  if (existingDefaultValue) {
    await updateModifierValue({
      accessToken,
      storeHash,
      productId,
      modifierId,
      valueId: existingDefaultValue.id,
      value: defaultValue,
      sortOrder: 0,
      isDefault: true,
    });
    return;
  }

  await createModifierValue({
    accessToken,
    storeHash,
    productId,
    modifierId,
    value: defaultValue,
    sortOrder: 0,
    isDefault: true,
  });
}

function normalizeDesiredModifierOptionValues(
  optionValues: Array<{ label: string; adjuster_value?: number }>,
): Array<{ label: string; adjuster_value?: number }> {
  return dedupeModifierOptionValues(optionValues).map(value => ({
    label: normalizeModifierOptionLabel(value.label),
    ...(value.adjuster_value !== undefined ? { adjuster_value: value.adjuster_value } : {}),
  }));
}

function modifierAlreadyMatchesDesiredValues(
  existing: BigCommerceModifier,
  optionValues: Array<{ label: string; adjuster_value?: number }>,
): boolean {
  if (!existing.option_values?.length) {
    return false;
  }

  const currentValues = normalizeExistingModifierOptionValues(existing.option_values);
  const desiredValues = normalizeDesiredModifierOptionValues(optionValues);

  if (currentValues.length !== desiredValues.length) {
    return false;
  }

  return desiredValues.every((desiredValue, index) => {
    const currentValue = currentValues[index];
    return (
      currentValue?.label === desiredValue.label &&
      currentValue?.adjuster_value === desiredValue.adjuster_value
    );
  });
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
  const existing = findModifierByDisplayName(existingModifiers, input.display_name);
  const optionValues = dedupeModifierOptionValues(input.option_values);

  if (optionValues.length === 0) {
    return;
  }

  if (existing && modifierAlreadyMatchesDesiredValues(existing, optionValues)) {
    return;
  }

  const buildPayload = (includeDefault: boolean) => ({
    display_name: input.display_name,
    type: 'dropdown',
    required: false,
    option_values: optionValues.map((value, index) => ({
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
  const createPayload = buildPayload(true);

  if (existing) {
    await syncModifierValues(accessToken, storeHash, productId, existing.id, optionValues);
    return;
  }

  const maxCreateAttemptsRaw = Number(process.env.BIGCOMMERCE_MODIFIER_CREATE_MAX_ATTEMPTS ?? 3);
  const maxCreateAttempts = Number.isFinite(maxCreateAttemptsRaw) && maxCreateAttemptsRaw > 0
    ? Math.floor(maxCreateAttemptsRaw)
    : 3;
  let attempt = 0;

  while (attempt < maxCreateAttempts) {
    attempt += 1;
    try {
      await requestJson<Record<string, unknown>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers`,
        {
          method: 'POST',
          body: JSON.stringify(createPayload),
        },
        'Failed to create product modifier',
      );
      return;
    } catch (error) {
      const refreshedModifiers = await listProductModifiers(accessToken, storeHash, productId);
      const refreshedExisting = findModifierByDisplayName(refreshedModifiers, input.display_name);

      if (refreshedExisting) {
        await syncModifierValues(accessToken, storeHash, productId, refreshedExisting.id, optionValues);
        return;
      }

      if (!isRetryableModifierCreateError(error) || attempt >= maxCreateAttempts) {
        throw error;
      }

      await sleep(250 * 2 ** (attempt - 1));
    }
  }
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
  const hasOptionBearingVariants = (product.variants ?? []).some(variant => variant.option_values.length > 0);
  if (!productRecord.base_variant_id || hasOptionBearingVariants) {
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

function buildMediaClassTypeArray(asset: NormalizedMediaAsset): VendorManagedMediaMetadata['classTypeArray'] {
  const directEntries = (asset.class_type_array ?? [])
    .map(entry => ({
      ...(entry.class_type_id?.trim() ? { classTypeId: entry.class_type_id.trim() } : {}),
      ...(entry.class_type_name?.trim() ? { classTypeName: entry.class_type_name.trim() } : {}),
    }))
    .filter(entry => Object.keys(entry).length > 0);

  if (directEntries.length > 0) {
    return directEntries;
  }

  const fallbackEntries = asset.class_types
    ?.map(classTypeName => classTypeName.trim())
    .filter(classTypeName => classTypeName.length > 0)
    .map(classTypeName => ({ classTypeName }));

  return fallbackEntries?.length ? fallbackEntries : undefined;
}

function buildMediaLocationArray(
  product: NormalizedProduct,
  asset: NormalizedMediaAsset,
): VendorManagedMediaMetadata['locationArray'] {
  const locationIds = asset.location_ids ?? [];
  const locationNames = resolveMediaLocationNames(product, asset) ?? [];
  const length = Math.max(locationIds.length, locationNames.length);
  if (length === 0) {
    return undefined;
  }

  const values = Array.from({ length }, (_, index) => ({
    ...(locationIds[index]?.trim() ? { locationId: locationIds[index]!.trim() } : {}),
    ...(locationNames[index]?.trim() ? { locationName: locationNames[index]!.trim() } : {}),
  })).filter(entry => Object.keys(entry).length > 0);

  return values.length > 0 ? values : undefined;
}

function buildMediaDecorationArray(
  product: NormalizedProduct,
  asset: NormalizedMediaAsset,
): VendorManagedMediaMetadata['decorationArray'] {
  const decorationIds = asset.decoration_ids ?? [];
  const decorationNames = resolveMediaDecorationNames(product, asset) ?? [];
  const length = Math.max(decorationIds.length, decorationNames.length);
  if (length === 0) {
    return undefined;
  }

  const values = Array.from({ length }, (_, index) => ({
    ...(decorationIds[index]?.trim() ? { decorationId: decorationIds[index]!.trim() } : {}),
    ...(decorationNames[index]?.trim() ? { decorationName: decorationNames[index]!.trim() } : {}),
  })).filter(entry => Object.keys(entry).length > 0);

  return values.length > 0 ? values : undefined;
}

function hasPrimaryClassType(asset: NormalizedMediaAsset): boolean {
  return (asset.class_type_array ?? []).some(
    entry => entry.class_type_name?.trim().toLowerCase() === 'primary',
  ) || (asset.class_types ?? []).some(classType => classType.trim().toLowerCase() === 'primary');
}

function buildVendorManagedMediaMarker(product: NormalizedProduct, asset: NormalizedMediaAsset): string {
  const classTypeArray = buildMediaClassTypeArray(asset);
  const classTypes = Array.from(
    new Set(
      [
        ...(classTypeArray ?? []).map(entry => entry.classTypeName ?? ''),
        ...(asset.class_types ?? []),
      ]
        .map(value => value.trim())
        .filter(value => value.length > 0),
    ),
  );
  const metadata: VendorManagedMediaMetadata = {
    ...(asset.part_id ? { partId: asset.part_id } : {}),
    ...(classTypes?.length ? { classTypes } : {}),
  };

  return JSON.stringify(metadata);
}

function buildVendorManagedDescription(product: NormalizedProduct, asset: NormalizedMediaAsset): string {
  const marker = buildVendorManagedMediaMarker(product, asset);
  return asset.description ? `${asset.description}${VENDOR_MEDIA_DESCRIPTION_SEPARATOR}${marker}` : marker;
}

function tryParseVendorManagedMarkerPayload(payload: string | undefined): VendorManagedMediaMetadata | null {
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as VendorManagedMediaMetadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseVendorManagedMarker(description: string | undefined): VendorManagedMediaMetadata | null {
  if (!description) return null;

  const legacyMarkerIndex = description.indexOf(VENDOR_MEDIA_MARKER_PREFIX);
  if (legacyMarkerIndex >= 0) {
    return tryParseVendorManagedMarkerPayload(
      description.slice(legacyMarkerIndex + VENDOR_MEDIA_MARKER_PREFIX.length).trim(),
    );
  }

  const trimmed = description.trim();
  const separatorIndex = trimmed.lastIndexOf(VENDOR_MEDIA_DESCRIPTION_SEPARATOR);
  if (separatorIndex >= 0) {
    const trailingPayload = trimmed.slice(separatorIndex + VENDOR_MEDIA_DESCRIPTION_SEPARATOR.length).trim();
    const parsedTrailingPayload = tryParseVendorManagedMarkerPayload(trailingPayload);
    if (parsedTrailingPayload) {
      return parsedTrailingPayload;
    }
  }

  return tryParseVendorManagedMarkerPayload(trimmed);
}

function isVendorManagedDescription(description: string | undefined): boolean {
  return !!parseVendorManagedMarker(description);
}

function extractVendorManagedVisibleDescription(description: string | undefined): string | undefined {
  if (!description) return undefined;

  const legacyMarkerIndex = description.indexOf(VENDOR_MEDIA_MARKER_PREFIX);
  if (legacyMarkerIndex >= 0) {
    const visibleDescription = description.slice(0, legacyMarkerIndex).replace(/\|\s*$/, '').trim();
    return visibleDescription || undefined;
  }

  const trimmed = description.trim();
  const separatorIndex = trimmed.lastIndexOf(VENDOR_MEDIA_DESCRIPTION_SEPARATOR);
  if (separatorIndex < 0) {
    return trimmed.startsWith('{') ? undefined : trimmed || undefined;
  }

  const trailingPayload = trimmed.slice(separatorIndex + VENDOR_MEDIA_DESCRIPTION_SEPARATOR.length).trim();
  if (!tryParseVendorManagedMarkerPayload(trailingPayload)) {
    return trimmed || undefined;
  }

  const visibleDescription = trimmed.slice(0, separatorIndex).trim();
  return visibleDescription || undefined;
}

function normalizeMarkerIdentityValues(values: string[] | undefined, options?: { lowercase?: boolean }): string[] {
  const normalized = (values ?? [])
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .map(value => (options?.lowercase ? value.toLowerCase() : value));

  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function buildMarkerIdentityValues(input: {
  ids?: string[];
  names?: string[];
}): string[] {
  const normalizedIds = normalizeMarkerIdentityValues(input.ids);
  if (normalizedIds.length > 0) {
    return normalizedIds;
  }

  return normalizeMarkerIdentityValues(input.names, { lowercase: true });
}

function serializeVendorManagedImageSignature(input: {
  marker: VendorManagedMediaMetadata;
  descriptionText?: string;
  isThumbnail: boolean;
  imageUrl?: string;
}): string {
  const descriptionText = input.descriptionText?.trim();
  const partId = input.marker.partId?.trim();
  const classTypes = normalizeMarkerIdentityValues(input.marker.classTypes, { lowercase: true });

  if (partId) {
    return JSON.stringify({
      descriptionText,
      partId,
      classTypes,
      isThumbnail: input.isThumbnail,
    });
  }

  if (descriptionText) {
    return JSON.stringify({
      descriptionText,
      isThumbnail: input.isThumbnail,
    });
  }

  return JSON.stringify({
    imageUrl: input.imageUrl?.trim() ?? input.marker.url?.trim(),
    isThumbnail: input.isThumbnail,
  });
}

function buildVendorManagedImageSignature(input: {
  description?: string;
  is_thumbnail?: boolean;
}): string | null {
  const marker = parseVendorManagedMarker(input.description);
  if (!marker) {
    return null;
  }

  return serializeVendorManagedImageSignature({
    marker,
    descriptionText: extractVendorManagedVisibleDescription(input.description),
    isThumbnail: !!input.is_thumbnail,
  });
}

function buildDesiredImageSignature(image: DesiredBigCommerceImage): string {
  const marker = parseVendorManagedMarker(image.description);
  if (!marker) {
    return JSON.stringify({
      mediaType: 'Image',
      url: image.image_url,
      isThumbnail: !!image.is_thumbnail,
    });
  }

  return serializeVendorManagedImageSignature({
    marker,
    descriptionText: extractVendorManagedVisibleDescription(image.description),
    isThumbnail: !!image.is_thumbnail,
    imageUrl: image.image_url,
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
  const classes = Array.from(
    new Set(
      [
        ...(asset.class_type_array ?? []).map(entry => entry.class_type_name ?? ''),
        ...(asset.class_types ?? []),
      ]
        .map(value => value.trim().toLowerCase())
        .filter(value => value.length > 0),
    ),
  );
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
  const desiredImages = imageAssets
    .map(asset => {
      const normalizedUrl = normalizeBigCommerceImageUrl(asset.url);
      if (!normalizedUrl) {
        return null;
      }

      return {
        asset,
        image_url: normalizedUrl,
        description: buildVendorManagedDescription(product, asset),
      };
    })
    .filter(
      (
        image,
      ): image is {
        asset: NormalizedMediaAsset;
        image_url: string;
        description: string;
      } => !!image,
    );

  const thumbnailIndex = Math.max(desiredImages.findIndex(image => hasPrimaryClassType(image.asset)), 0);

  return desiredImages.map(({ asset: _asset, ...image }, index) => ({
    ...image,
    ...(index === thumbnailIndex ? { is_thumbnail: true } : {}),
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

function isDuplicateSkuError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /sku.*(not unique|duplicate)|product sku is a duplicate/i.test(error.message)
  );
}

function buildSkuRetryCandidateSku(input: {
  desiredSku: string;
  vendorId: number;
  attempt: number;
}): string {
  const normalizedSku = input.desiredSku.trim();
  const vendorScopedSku = normalizedSku.includes(`__v${input.vendorId}`)
    ? normalizedSku
    : buildDuplicateSku(normalizedSku, input.vendorId);

  return input.attempt === 0 ? vendorScopedSku : `${vendorScopedSku}_${input.attempt}`;
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

async function readRemoteImageBufferWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= maxBytes ? buffer : null;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Ignore cancellation failures; the caller only needs the guardrail.
        }
        return null;
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
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
    if (probe.contentLength > BIGCOMMERCE_MAX_IMAGE_DOWNLOAD_BYTES) {
      console.warn(
        `Skipping BigCommerce image for ${logContext}; remote asset exceeds ${Math.floor(BIGCOMMERCE_MAX_IMAGE_DOWNLOAD_BYTES / (1024 * 1024))} MB download cap: ${input.imageUrl}`,
      );
      return null;
    }

    const response = await fetch(input.imageUrl, { redirect: 'follow' });
    if (!response.ok) {
      console.warn(
        `Failed to fetch BigCommerce image for ${logContext}: ${input.imageUrl}`,
      );
      return null;
    }

    const buffer = await readRemoteImageBufferWithinLimit(response, BIGCOMMERCE_MAX_IMAGE_DOWNLOAD_BYTES);
    if (!buffer) {
      console.warn(
        `Skipping BigCommerce image for ${logContext}; remote asset exceeded ${Math.floor(BIGCOMMERCE_MAX_IMAGE_DOWNLOAD_BYTES / (1024 * 1024))} MB download cap while staging: ${input.imageUrl}`,
      );
      return null;
    }

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

    const variantId = resolveVariantId(input.variantIdsBySku, {
      ...variant,
      mpn: resolveManagedVariantMpn(variant),
    });
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
  const mappedProductId =
    !input.product.gtin?.trim() && input.existingBigCommerceProductId
      ? input.existingBigCommerceProductId
      : undefined;
  const decision = mappedProductId
    ? {
        action: 'update' as const,
        duplicate: false,
        resolved_sku: input.product.sku,
        target_product_id: mappedProductId,
        reason: 'Matched persisted vendor product map.',
      }
    : classifyDuplicateDecision({
        source_sku: input.product.sku,
        source_name: input.product.name,
        source_gtin: input.product.gtin,
        vendor_id: input.vendorId,
        candidates: candidates.map(toCandidate),
      });

  const markupPercent = input.pricingContext?.markup_percent ?? input.defaultMarkupPercent ?? 30;
  const priceListId = input.pricingContext?.price_list_id ?? Number(process.env.BIGCOMMERCE_B2B_PRICE_LIST_ID ?? 1);
  const blanksPriceListId =
    input.pricingContext?.blanks_price_list_id ?? Number(process.env.BIGCOMMERCE_BLANKS_PRICE_LIST_ID ?? 2);
  const currency = input.pricingContext?.currency ?? process.env.BIGCOMMERCE_PRICE_LIST_CURRENCY ?? 'USD';
  const markupNamespace =
    input.pricingContext?.markup_namespace ?? process.env.BIGCOMMERCE_MARKUP_METAFIELD_NAMESPACE ?? 'merchmonk';
  const markupKey =
    input.pricingContext?.markup_key ?? process.env.BIGCOMMERCE_MARKUP_METAFIELD_KEY ?? 'product_markup';
  const priceListTargets = buildPriceListTargets({
    pricingContext: {
      markup_percent: markupPercent,
      price_list_id: priceListId,
      blanks_price_list_id: blanksPriceListId,
      currency,
      markup_namespace: markupNamespace,
      markup_key: markupKey,
    },
  });
  const primaryPriceListTarget = priceListTargets[0];

  const pricingProjection = projectProductPricing(input.product, {
    markup_percent: primaryPriceListTarget?.markup_percent ?? markupPercent,
    price_list_id: primaryPriceListTarget?.price_list_id ?? priceListId,
    currency,
    family_preferences: primaryPriceListTarget?.family_preferences,
    require_family_match: primaryPriceListTarget?.require_family_match,
  });

  if (
    INVENTORY_ONLY_FOR_EXISTING_PRODUCTS &&
    input.inventoryOnlyForExistingProducts === true &&
    decision.action === 'update' &&
    decision.target_product_id
  ) {
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

  let resolvedSku = decision.resolved_sku;
  const brandId = await ensureBrandId(input.accessToken, input.storeHash, input.product.brand_name);
  const categoryIds = await ensureCategoryIds(input.accessToken, input.storeHash, input.product.categories);
  const productMpn = resolveManagedProductMpn(input.product);
  const createSku = buildTemporaryManagedProductSku({
    vendorId: input.vendorId,
    product: input.product,
  });
  const desiredManagedProductSku = decision.target_product_id
    ? buildManagedProductSku(decision.target_product_id)
    : undefined;
  const catalogVariantSkuLookup =
    desiredManagedProductSku && input.product.variants
      ? buildManagedVariantSkuLookup({
          parentSku: desiredManagedProductSku,
          variants: input.product.variants,
        })
      : undefined;
  const catalogVariants = pricingProjection.variants.map(variant => {
    const normalizedVariant = (input.product.variants ?? []).find(candidate => candidate.sku === variant.sku);
    return {
      ...variant,
      sku:
        decision.target_product_id && catalogVariantSkuLookup
          ? getManagedVariantSku({
              variantSkuLookup: catalogVariantSkuLookup,
              variant: normalizedVariant ?? variant,
            })
          : variant.sku,
      mpn: resolveManagedVariantMpn(normalizedVariant ?? variant),
      min_purchase_quantity: normalizedVariant?.min_purchase_quantity,
      max_purchase_quantity: normalizedVariant?.max_purchase_quantity,
    };
  });

  const createPayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeCustomFields: true,
    includeVariants: false,
    isVisible: false,
    sku: createSku,
    mpn: productMpn,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
    productFallback: pricingProjection.product_fallback,
    variants: catalogVariants,
  });
  const updatePayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeCustomFields: false,
    includeVariants: false,
    sku: desiredManagedProductSku ?? resolvedSku,
    mpn: productMpn,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
    productFallback: pricingProjection.product_fallback,
    variants: catalogVariants,
  });

  const productRecord =
    decision.action === 'create' || !decision.target_product_id
      ? await (async (): Promise<BigCommerceCatalogProduct> => {
          let nextSku = createSku;

          for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
              const response = await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
                input.accessToken,
                `${buildApiBase(input.storeHash)}/catalog/products`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    ...createPayload,
                    sku: nextSku,
                  }),
                },
                'Failed to create BigCommerce product',
              );
              resolvedSku = nextSku;
              return response.data;
            } catch (error) {
              if (!isDuplicateSkuError(error) || attempt === 5) {
                throw error;
              }

              nextSku = buildSkuRetryCandidateSku({
                desiredSku: createSku,
                vendorId: input.vendorId,
                attempt,
              });
            }
          }

          throw new Error(`Failed to create BigCommerce product for ${input.product.sku}.`);
        })()
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

  resolvedSku = productRecord.sku;

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
      desiredManagedProductSku ?? resolvedSku,
      input.vendorId,
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
    await syncRelatedVendorProductIdsCustomField({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: productRecord.id,
      product: input.product,
    });
    await ensureConfigurationModifiers(input.accessToken, input.storeHash, productRecord.id, input.product);

    const contractProjection = projectBigCommerceProductContract(buildManagedContractProduct({
      product: input.product,
      resolvedSku,
    }), {
      price_list_id: priceListId,
      currency,
      markup_percent: markupPercent,
      markup_namespace: markupNamespace,
      markup_key: markupKey,
    });

    await syncProjectedProductContract({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: productRecord.id,
      productDesignerDefaults: contractProjection.product_designer_defaults,
      productInternalMetafields: contractProjection.product_internal_metafields,
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

    const hasOptionBearingVariants = (input.product.variants ?? []).some(variant => variant.option_values.length > 0);
    for (const target of priceListTargets) {
      const targetProjection =
        target === primaryPriceListTarget
          ? pricingProjection
          : projectProductPricing(input.product, {
              markup_percent: target.markup_percent,
              price_list_id: target.price_list_id,
              currency,
              family_preferences: target.family_preferences,
              require_family_match: target.require_family_match,
            });

      const priceListRecords = buildProjectedPriceListRecords({
        pricingProjection: targetProjection,
        variantIdsBySku,
        hasOptionBearingVariants,
        baseVariantId: productRecord.base_variant_id,
      });

      if (priceListRecords.length === 0) {
        continue;
      }

      await upsertPriceListRecords({
        accessToken: input.accessToken,
        storeHash: input.storeHash,
        price_list_id: target.price_list_id,
        records: priceListRecords,
      });
    }

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

  const existingProduct = await requestJson<BigCommerceCatalogProduct>(
    input.accessToken,
    `${buildApiV2Base(input.storeHash)}/products/${input.sourceProductId}`,
    { method: 'GET' },
    'Failed to load related products',
  );

  const parseRelatedProducts = (value: string | number[] | undefined): number[] => {
    if (Array.isArray(value)) {
      return value.filter((item): item is number => typeof item === 'number');
    }

    if (typeof value !== 'string') {
      return [];
    }

    return value
      .split(',')
      .map(item => Number(item.trim()))
      .filter(item => Number.isInteger(item) && item > 0);
  };

  const existing = new Set(parseRelatedProducts(existingProduct.related_products));
  const merged = Array.from(new Set([...Array.from(existing), ...input.targetProductIds]));

  if (merged.length === existing.size) {
    return;
  }

  await requestJson<BigCommerceCatalogProduct>(
    input.accessToken,
    `${buildApiV2Base(input.storeHash)}/products/${input.sourceProductId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        related_products: merged.join(','),
      }),
    },
    'Failed to update related products',
  );
}
