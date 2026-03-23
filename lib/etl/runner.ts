import type { MappingProtocol, SessionContextProps } from '../../types';
import logger from '../logger';
import { getVendorById } from '../vendors';
import { getRequestContext, mergeRequestContext } from '../requestContext';
import { submitCatalogSyncJob, type CatalogSyncJobRequest } from '../integrationJobs';
import {
  resolveBigCommercePricingContext,
} from './bigcommercePricingContext';
import {
  type BigCommerceInventorySyncTarget,
  syncBigCommerceInventoryBatch,
  upsertBigCommerceProduct,
  upsertRelatedProducts,
} from './bigcommerceCatalog';
import { resolveEndpointAdapter } from './adapters/factory';
import { resolveRuntimeEndpointUrl } from './endpointUrl';
import { normalizeProductsFromEndpoint, type NormalizedProduct } from './productNormalizer';
import { buildProductAssembly } from './productEnrichment';
import {
  discoverProductDataReferences,
  fetchProductDataReference,
} from './productDataWorkflow';
import {
  clearProductEnrichmentRetry,
  completeSyncRun,
  createSyncRun,
  getIntegrationJobById,
  findVendorProductMapByVendorProductId,
  listEnabledVendorEndpointMappings,
  listSyncRunsForVendor,
  listPendingRelatedProductLinks,
  markSyncRunRunning,
  reconcileStaleCatalogSyncRunsForVendor,
  updateSyncRunProgress,
  upsertPendingRelatedProductLink,
  upsertProductEnrichmentRetry,
  upsertVendorProductMap,
} from './repository';

export interface RunVendorSyncInput {
  vendorId: number;
  session: SessionContextProps;
  mappingId?: number;
  syncAll?: boolean;
  integrationJobId?: number;
  sourceAction?: string;
  correlationId?: string;
  continuation?: {
    start_reference_index?: number;
    max_references_per_run?: number;
    initial_last_successful_sync_at?: string | null;
  };
}

export interface TestConnectionInput {
  vendorId: number;
}

export interface TestConnectionConfigInput {
  vendorApiUrl: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  apiProtocol?: MappingProtocol;
  endpointName?: string;
  operationName?: string;
  endpointVersion?: string;
  runtimeConfig?: Record<string, unknown>;
}

export interface SyncRunResult {
  syncRunId: number;
  recordsRead: number;
  recordsWritten: number;
  endpointResults: Array<{
    mapping_id: number;
    endpoint_name: string;
    endpoint_version: string;
    operation_name: string;
    status: number;
    products_found: number;
    message?: string;
  }>;
  continuation?: {
    enqueued: boolean;
    nextStartReferenceIndex: number;
    totalReferences: number;
  };
}

const EARLY_SYNC_CANARY_PRODUCT_COUNT = 2;
const BLOCKED_PRODUCT_FAILURE_THRESHOLD_MIN_ATTEMPTS = 100;
const BLOCKED_PRODUCT_FAILURE_THRESHOLD_RATIO = 0.5;
const DEFAULT_MAX_PRODUCT_REFERENCES_PER_RUN = 50;
const INVENTORY_SYNC_FLUSH_TARGET_COUNT = 25;

interface ProductAssemblyStatusSummary {
  blockedCount: number;
  topGatingReasons: Array<{
    reason: string;
    count: number;
  }>;
}

interface ProductDataReference {
  productId: string;
  partId?: string | null;
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
        mergedCustomFields.findIndex(
          item => item.name === field.name && item.value === field.value,
        ) === index,
    );

    const mergedCategories = [...(existing.categories ?? []), ...(product.categories ?? [])];
    const uniqueCategories = mergedCategories.filter((value, index) => mergedCategories.indexOf(value) === index);

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
    const uniqueMediaAssets = mergedMediaAssets.filter(
      (asset, index) =>
        mergedMediaAssets.findIndex(
          item =>
          item.media_type === asset.media_type &&
          item.url === asset.url &&
          item.part_id === asset.part_id &&
          JSON.stringify(item.location_ids ?? []) === JSON.stringify(asset.location_ids ?? []) &&
          JSON.stringify(item.location_names ?? []) === JSON.stringify(asset.location_names ?? []) &&
          JSON.stringify(item.decoration_ids ?? []) === JSON.stringify(asset.decoration_ids ?? []) &&
          JSON.stringify(item.decoration_names ?? []) === JSON.stringify(asset.decoration_names ?? []),
        ) === index,
    );

    const mergedRelated = [...(existing.related_vendor_product_ids ?? []), ...(product.related_vendor_product_ids ?? [])];
    const uniqueRelated = mergedRelated.filter((value, index) => mergedRelated.indexOf(value) === index);

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
      enrichment_status: product.enrichment_status ?? existing.enrichment_status,
      weight: product.weight ?? existing.weight ?? 0,
    });
  }
  return Array.from(bySku.values());
}

function mergeVariantsBySku(variants: NonNullable<NormalizedProduct['variants']>): NonNullable<NormalizedProduct['variants']> {
  const bySku = new Map<string, NonNullable<NormalizedProduct['variants']>[number]>();
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

function resolveProtocol(mappingProtocol: string | null | undefined, vendorProtocol: string | null | undefined): MappingProtocol {
  if (mappingProtocol) return mappingProtocol as MappingProtocol;
  if (vendorProtocol) return vendorProtocol as MappingProtocol;
  return 'SOAP';
}

function mappingKey(mapping: { endpoint_name: string; endpoint_version: string; operation_name: string }): string {
  return `${mapping.endpoint_name}|${mapping.endpoint_version}|${mapping.operation_name}`;
}

function shouldRunMapping(input: {
  mappingId?: number;
  syncAll?: boolean;
  mapping: { mapping_id: number; is_product_endpoint: boolean };
}): boolean {
  if (input.mappingId) return input.mapping.mapping_id === input.mappingId;
  if (input.syncAll) return input.mapping.is_product_endpoint;
  return input.mapping.is_product_endpoint;
}

function summarizeBlockedProducts(
  statuses: Array<{
    blocked: boolean;
    gating_reasons: string[];
  }>,
): ProductAssemblyStatusSummary {
  const reasonCounts = new Map<string, number>();
  let blockedCount = 0;

  for (const status of statuses) {
    if (!status.blocked) continue;
    blockedCount += 1;

    for (const reason of status.gating_reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  return {
    blockedCount,
    topGatingReasons: Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  };
}

function formatGatingReasonSummary(summary: ProductAssemblyStatusSummary): string {
  if (summary.topGatingReasons.length === 0) {
    return 'No gating reasons were captured.';
  }

  return summary.topGatingReasons
    .map(item => `${item.reason} (${item.count})`)
    .join('; ');
}

function shouldFailSyncBecauseAllProductsWereBlocked(input: {
  recordsRead: number;
  recordsWritten: number;
  statuses: Array<{ blocked: boolean }>;
}): boolean {
  if (input.recordsRead === 0) return false;
  if (input.recordsWritten > 0) return false;
  return input.statuses.some(status => status.blocked);
}

function shouldFailSyncDuringCanaryWindow(input: {
  evaluatedProductCount: number;
  successfulProductCount: number;
}): boolean {
  return (
    input.evaluatedProductCount >= EARLY_SYNC_CANARY_PRODUCT_COUNT &&
    input.successfulProductCount === 0
  );
}

function shouldFailSyncBecauseBlockedRateTooHigh(input: {
  evaluatedProductCount: number;
  blockedProductCount: number;
}): boolean {
  if (input.evaluatedProductCount < BLOCKED_PRODUCT_FAILURE_THRESHOLD_MIN_ATTEMPTS) {
    return false;
  }

  return (
    input.blockedProductCount / input.evaluatedProductCount >=
    BLOCKED_PRODUCT_FAILURE_THRESHOLD_RATIO
  );
}

function getMaxProductReferencesPerRun(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }

  const configured = Number(process.env.CATALOG_SYNC_MAX_PRODUCT_REFERENCES_PER_RUN ?? '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_MAX_PRODUCT_REFERENCES_PER_RUN;
}

function normalizeContinuationStartIndex(startReferenceIndex?: number): number {
  if (typeof startReferenceIndex !== 'number' || !Number.isFinite(startReferenceIndex) || startReferenceIndex < 0) {
    return 0;
  }

  return Math.floor(startReferenceIndex);
}

function sortProductDataReferences(references: ProductDataReference[]): ProductDataReference[] {
  return [...references].sort((left, right) => {
    const productIdComparison = left.productId.localeCompare(right.productId);
    if (productIdComparison !== 0) {
      return productIdComparison;
    }

    return (left.partId ?? '').localeCompare(right.partId ?? '');
  });
}

function buildUniqueProductDataReferences(references: ProductDataReference[]): ProductDataReference[] {
  const uniqueReferences: ProductDataReference[] = [];
  const seenProductIds = new Set<string>();

  for (const reference of sortProductDataReferences(references)) {
    if (seenProductIds.has(reference.productId)) {
      continue;
    }

    seenProductIds.add(reference.productId);
    uniqueReferences.push(reference);
  }

  return uniqueReferences;
}

function isCatalogSyncSourceAction(sourceAction?: string): sourceAction is CatalogSyncJobRequest['sourceAction'] {
  return (
    sourceAction === 'manual_sync' ||
    sourceAction === 'manual_inventory_sync' ||
    sourceAction === 'vendor_create_auto_sync'
  );
}

function readPartialBigCommerceUpsertResult(error: unknown): {
  product: { id: number };
  duplicate: boolean;
  action: 'create' | 'update';
  resolvedSku: string;
  markupPercent: number;
  pricingReconciliation?: Record<string, unknown>;
  inventory_sync_target?: BigCommerceInventorySyncTarget;
} | null {
  if (!error || typeof error !== 'object' || !('partial_upsert_result' in error)) {
    return null;
  }

  const candidate = (error as { partial_upsert_result?: unknown }).partial_upsert_result;
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }

  const record = candidate as {
    product?: { id?: unknown };
    duplicate?: unknown;
    action?: unknown;
    resolvedSku?: unknown;
    markupPercent?: unknown;
    pricingReconciliation?: unknown;
    inventory_sync_target?: unknown;
  };

  if (
    typeof record.product?.id !== 'number' ||
    typeof record.duplicate !== 'boolean' ||
    (record.action !== 'create' && record.action !== 'update') ||
    typeof record.resolvedSku !== 'string' ||
    typeof record.markupPercent !== 'number'
  ) {
    return null;
  }

  return {
    product: { id: record.product.id },
    duplicate: record.duplicate,
    action: record.action,
    resolvedSku: record.resolvedSku,
    markupPercent: record.markupPercent,
    pricingReconciliation:
      record.pricingReconciliation && typeof record.pricingReconciliation === 'object'
        ? (record.pricingReconciliation as Record<string, unknown>)
        : undefined,
    inventory_sync_target:
      record.inventory_sync_target && typeof record.inventory_sync_target === 'object'
        ? (record.inventory_sync_target as BigCommerceInventorySyncTarget)
        : undefined,
  };
}

function buildSyncProgressDetails(input: {
  phase: 'DISCOVERY' | 'ENRICHMENT' | 'UPSERT' | 'FINALIZING' | 'CANCELLED';
  totalReferences?: number;
  processedReferences?: number;
  recordsRead: number;
  recordsWritten: number;
  blockedProductCount: number;
  currentProductId?: string | null;
  currentSku?: string | null;
  endpointResults?: SyncRunResult['endpointResults'];
  productStatuses?: Array<{
    sku: string;
    vendor_product_id?: string;
    blocked: boolean;
    gating_reasons: string[];
    enrichment_status: NonNullable<NormalizedProduct['enrichment_status']>;
  }>;
  mediaRetries?: Array<{
    sku: string;
    vendor_product_id: string;
    message: string;
  }>;
}): Record<string, unknown> {
  return {
    phase: input.phase,
    progress: {
      total_references: input.totalReferences ?? null,
      processed_references: input.processedReferences ?? 0,
      records_read: input.recordsRead,
      records_written: input.recordsWritten,
      blocked_product_count: input.blockedProductCount,
      current_product_id: input.currentProductId ?? null,
      current_sku: input.currentSku ?? null,
    },
    endpointResults: input.endpointResults ?? [],
    productStatuses: input.productStatuses ?? [],
    mediaRetries: input.mediaRetries ?? [],
  };
}

async function persistSyncProgress(input: {
  syncRunId: number;
  phase: 'DISCOVERY' | 'ENRICHMENT' | 'UPSERT' | 'FINALIZING' | 'CANCELLED';
  totalReferences?: number;
  processedReferences?: number;
  recordsRead: number;
  recordsWritten: number;
  blockedProductCount: number;
  currentProductId?: string | null;
  currentSku?: string | null;
  endpointResults?: SyncRunResult['endpointResults'];
  productStatuses?: Array<{
    sku: string;
    vendor_product_id?: string;
    blocked: boolean;
    gating_reasons: string[];
    enrichment_status: NonNullable<NormalizedProduct['enrichment_status']>;
  }>;
  mediaRetries?: Array<{
    sku: string;
    vendor_product_id: string;
    message: string;
  }>;
}): Promise<void> {
  await updateSyncRunProgress({
    sync_run_id: input.syncRunId,
    records_read: input.recordsRead,
    records_written: input.recordsWritten,
    details: buildSyncProgressDetails(input),
  });
}

function shouldPersistProgress(processedReferences: number): boolean {
  return processedReferences <= 5 || processedReferences % 25 === 0;
}

async function throwIfSyncCancelled(integrationJobId?: number): Promise<void> {
  if (!integrationJobId) {
    return;
  }

  const job = await getIntegrationJobById(integrationJobId);
  if (!job) {
    return;
  }

  if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
    const error = new Error(`Integration job ${integrationJobId} was cancelled by operator.`);
    error.name = 'IntegrationJobCancelledError';
    throw error;
  }
}

async function resolveDeferredRelatedProducts(input: {
  accessToken: string;
  storeHash: string;
  vendorId: number;
}): Promise<void> {
  const pending = await listPendingRelatedProductLinks(input.vendorId, 'PENDING');
  for (const item of pending) {
    const sourceMap = await findVendorProductMapByVendorProductId(input.vendorId, item.source_vendor_product_id);
    const targetMap = await findVendorProductMapByVendorProductId(input.vendorId, item.target_vendor_product_id);
    const sourceProductId = sourceMap?.bigcommerce_product_id;
    const targetProductId = targetMap?.bigcommerce_product_id;

    if (!sourceProductId || !targetProductId) {
      await upsertPendingRelatedProductLink({
        vendor_id: input.vendorId,
        source_vendor_product_id: item.source_vendor_product_id,
        target_vendor_product_id: item.target_vendor_product_id,
        status: 'PENDING',
        retry_count: item.retry_count + 1,
        last_error: 'Missing BigCommerce product IDs for related link resolution.',
      });
      continue;
    }

    try {
      await upsertRelatedProducts({
        accessToken: input.accessToken,
        storeHash: input.storeHash,
        sourceProductId,
        targetProductIds: [targetProductId],
      });
      await upsertPendingRelatedProductLink({
        vendor_id: input.vendorId,
        source_vendor_product_id: item.source_vendor_product_id,
        target_vendor_product_id: item.target_vendor_product_id,
        source_bigcommerce_product_id: sourceProductId,
        target_bigcommerce_product_id: targetProductId,
        status: 'RESOLVED',
        resolved_at: new Date(),
        last_error: null,
      });
    } catch (error: any) {
      await upsertPendingRelatedProductLink({
        vendor_id: input.vendorId,
        source_vendor_product_id: item.source_vendor_product_id,
        target_vendor_product_id: item.target_vendor_product_id,
        source_bigcommerce_product_id: sourceProductId,
        target_bigcommerce_product_id: targetProductId,
        status: 'FAILED',
        retry_count: item.retry_count + 1,
        last_error: error?.message ?? 'Failed to upsert related product link.',
      });
    }
  }
}

export async function runVendorSync(input: RunVendorSyncInput): Promise<SyncRunResult> {
  const vendor = await getVendorById(input.vendorId);
  if (!vendor) {
    throw new Error(`Vendor ${input.vendorId} not found`);
  }
  if (!vendor.vendor_api_url) {
    throw new Error(`Vendor ${input.vendorId} does not have vendor_api_url configured`);
  }

  const syncRun = await createSyncRun({
    vendor_id: input.vendorId,
    mapping_id: input.mappingId ?? null,
    sync_scope: input.syncAll ? 'ALL' : 'MAPPING',
    details: {},
  });
  mergeRequestContext({
    vendorId: input.vendorId,
    syncRunId: syncRun.sync_run_id,
  });
  await markSyncRunRunning(syncRun.sync_run_id);
  await reconcileStaleCatalogSyncRunsForVendor(input.vendorId);

  let endpointResults: SyncRunResult['endpointResults'] = [];
  let mergedBaseProducts: NormalizedProduct[] = [];
  let assemblyStatuses: Array<{
    sku: string;
    vendor_product_id?: string;
    blocked: boolean;
    gating_reasons: string[];
    enrichment_status: NonNullable<NormalizedProduct['enrichment_status']>;
  }> = [];
  let mediaRetries: Array<{
    sku: string;
    vendor_product_id: string;
    message: string;
  }> = [];
  let recordsRead = 0;
  let recordsWritten = 0;
  const pendingInventorySyncTargets: BigCommerceInventorySyncTarget[] = [];

  const flushPendingInventorySyncTargets = async (reason: string, force = false): Promise<void> => {
    if (pendingInventorySyncTargets.length === 0) {
      return;
    }

    if (!force && pendingInventorySyncTargets.length < INVENTORY_SYNC_FLUSH_TARGET_COUNT) {
      return;
    }

    const targets = pendingInventorySyncTargets.splice(0, pendingInventorySyncTargets.length);
    const productItemCount = targets.reduce(
      (count, target) => count + target.items.filter(item => 'product_id' in item).length,
      0,
    );
    const variantItemCount = targets.reduce(
      (count, target) => count + target.items.filter(item => 'variant_id' in item).length,
      0,
    );

    logger.info('vendor sync BigCommerce inventory batch started', {
      syncRunId: syncRun.sync_run_id,
      vendorId: input.vendorId,
      reason,
      targetCount: targets.length,
      productItemCount,
      variantItemCount,
    });

    await syncBigCommerceInventoryBatch({
      accessToken: input.session.accessToken,
      storeHash: input.session.storeHash,
      targets,
    });

    logger.info('vendor sync BigCommerce inventory batch completed', {
      syncRunId: syncRun.sync_run_id,
      vendorId: input.vendorId,
      reason,
      targetCount: targets.length,
      productItemCount,
      variantItemCount,
    });
  };

  try {
    const priorSyncRuns = await listSyncRunsForVendor(input.vendorId);
    const lastSuccessfulSync = priorSyncRuns.find(
      run => run.sync_run_id !== syncRun.sync_run_id && run.status === 'SUCCESS',
    );
    const lastSuccessfulSyncAt =
      input.continuation?.initial_last_successful_sync_at ??
      lastSuccessfulSync?.ended_at ??
      lastSuccessfulSync?.started_at ??
      null;

    const assignedMappings = await listEnabledVendorEndpointMappings(input.vendorId);
    const selectedMappings = assignedMappings.filter(item =>
      shouldRunMapping({
        mappingId: input.mappingId,
        syncAll: input.syncAll,
        mapping: {
          mapping_id: item.mapping_id,
          is_product_endpoint: item.mapping?.is_product_endpoint,
        },
      }),
    );

    if (selectedMappings.length === 0) {
      await completeSyncRun({
        sync_run_id: syncRun.sync_run_id,
        status: 'SUCCESS',
        records_read: 0,
        records_written: 0,
        details: { endpointResults: [], message: 'No eligible mappings assigned for this vendor' },
      });
      return {
        syncRunId: syncRun.sync_run_id,
        recordsRead: 0,
        recordsWritten: 0,
        endpointResults: [],
      };
    }

    endpointResults = [];
    const baseProducts: NormalizedProduct[] = [];
    const seenReadProductKeys = new Set<string>();
    const processedProductKeys = new Set<string>();
    const writtenProductKeys = new Set<string>();
    let blockedProductCount = 0;
    let canaryEvaluatedProductCount = 0;
    let canarySuccessfulProductCount = 0;
    let continuationResult: SyncRunResult['continuation'] | undefined;
    let pendingContinuationRequest: CatalogSyncJobRequest | null = null;

    const selectedKeys = new Set(selectedMappings.map(item => mappingKey(item.mapping)));
    const productDataMappings = assignedMappings.filter(item => item.mapping.endpoint_name === 'ProductData');
    const hasSelectedProductData = selectedMappings.some(item => item.mapping.endpoint_name === 'ProductData');
    const includeProductDataAsPrereq = !hasSelectedProductData && selectedMappings.some(item => item.mapping.is_product_endpoint);
    const productDataToRun = hasSelectedProductData
      ? selectedMappings.filter(item => item.mapping.endpoint_name === 'ProductData')
      : includeProductDataAsPrereq
        ? productDataMappings
        : [];

    logger.info('vendor sync mapping selection completed', {
      syncRunId: syncRun.sync_run_id,
      vendorId: input.vendorId,
      assignedMappingCount: assignedMappings.length,
      selectedMappingCount: selectedMappings.length,
      productDataMappingCount: productDataToRun.length,
    });

    const pricingContext = await resolveBigCommercePricingContext({
      accessToken: input.session.accessToken,
      storeHash: input.session.storeHash,
      fallback_markup_percent: 30,
    });

    if (productDataToRun.length > 0) {
      await throwIfSyncCancelled(input.integrationJobId);

      const discovery = await discoverProductDataReferences({
        vendor,
        assignedMappings: productDataToRun,
        lastSuccessfulSyncAt,
      });
      discovery.endpointResults.forEach(result => endpointResults.push(result));

      logger.info('vendor sync product discovery completed', {
        syncRunId: syncRun.sync_run_id,
        vendorId: input.vendorId,
        discoveredProductCount: discovery.references.length,
        discoveryEndpointCount: discovery.endpointResults.length,
      });

      const uniqueReferences = buildUniqueProductDataReferences(discovery.references);
      const totalReferences = uniqueReferences.length;
      const startReferenceIndex = normalizeContinuationStartIndex(input.continuation?.start_reference_index);
      const batchingEnabled = isCatalogSyncSourceAction(input.sourceAction);
      const maxReferencesPerRun = batchingEnabled
        ? getMaxProductReferencesPerRun(input.continuation?.max_references_per_run)
        : totalReferences || getMaxProductReferencesPerRun(input.continuation?.max_references_per_run);
      const remainingReferences = uniqueReferences.slice(startReferenceIndex);
      const batchReferences = remainingReferences.slice(0, maxReferencesPerRun);
      const nextStartReferenceIndex = startReferenceIndex + batchReferences.length;
      const hasMoreReferences = batchingEnabled && nextStartReferenceIndex < totalReferences;

      await persistSyncProgress({
        syncRunId: syncRun.sync_run_id,
        phase: 'DISCOVERY',
        totalReferences,
        processedReferences: 0,
        recordsRead,
        recordsWritten,
        blockedProductCount,
        endpointResults,
        productStatuses: assemblyStatuses,
        mediaRetries,
      });

      if (discovery.getProductConfig && discovery.references.length > 0) {
        logger.info('vendor sync BigCommerce upsert phase started', {
          syncRunId: syncRun.sync_run_id,
          vendorId: input.vendorId,
          productCount: batchReferences.length,
          markupPercent: pricingContext.markup_percent,
          priceListId: pricingContext.price_list_id,
        });
      }

      let getProductCallCount = 0;
      for (const reference of batchReferences) {
        await throwIfSyncCancelled(input.integrationJobId);
        getProductCallCount += 1;

        const fetchResult = await fetchProductDataReference({
          vendor,
          discovery,
          reference,
        });

        if (fetchResult.status >= 400) {
          endpointResults.push({
            mapping_id: discovery.getProductConfig?.mapping.mapping_id ?? 0,
            endpoint_name: discovery.getProductConfig?.mapping.endpoint_name ?? 'ProductData',
            endpoint_version: discovery.getProductConfig?.mapping.endpoint_version ?? '',
            operation_name: 'getProduct',
            status: fetchResult.status,
            products_found: 0,
            message: fetchResult.message,
          });
          throw new Error(fetchResult.message ?? `getProduct failed for ${reference.productId}.`);
        }

        const mergedFetchedProducts = mergeProducts(fetchResult.products);
        for (const product of mergedFetchedProducts) {
          const readKey = product.vendor_product_id ?? product.sku;
          if (!seenReadProductKeys.has(readKey)) {
            seenReadProductKeys.add(readKey);
            recordsRead += 1;
          }
        }

        const unprocessedFetchedProducts = mergedFetchedProducts.filter(product => {
          const productKey = product.vendor_product_id ?? product.sku;
          if (processedProductKeys.has(productKey)) {
            return false;
          }

          processedProductKeys.add(productKey);
          return true;
        });

        if (mergedFetchedProducts.length > 0 && unprocessedFetchedProducts.length === 0) {
          logger.info('vendor sync skipped duplicate product reference', {
            syncRunId: syncRun.sync_run_id,
            vendorId: input.vendorId,
            productId: reference.productId,
            partId: reference.partId ?? null,
          });
          continue;
        }

        const assembly = await buildProductAssembly({
          vendor,
          assignedMappings: assignedMappings.filter(item => {
            if (item.mapping.endpoint_name === 'ProductData') return false;
            if (!['Inventory', 'PricingAndConfiguration', 'ProductMedia'].includes(item.mapping.endpoint_name)) return false;
            if (input.mappingId && selectedKeys.size > 0) {
              return selectedKeys.has(mappingKey(item.mapping));
            }
            return true;
          }),
          baseProducts: unprocessedFetchedProducts,
        });

        assembly.endpointResults.forEach(result => endpointResults.push(result));
        assemblyStatuses.push(...assembly.statuses);
        mediaRetries.push(...assembly.mediaRetries);
        blockedProductCount += assembly.statuses.filter(status => status.blocked).length;
        canaryEvaluatedProductCount += assembly.statuses.length;
        canarySuccessfulProductCount += assembly.products.length;

        for (const retry of assembly.mediaRetries) {
          await upsertProductEnrichmentRetry({
            vendor_id: input.vendorId,
            vendor_product_id: retry.vendor_product_id,
            source: 'MEDIA',
            status: 'PENDING',
            last_error: retry.message,
            metadata: { sku: retry.sku },
          });
        }

        if (shouldFailSyncDuringCanaryWindow({
          evaluatedProductCount: canaryEvaluatedProductCount,
          successfulProductCount: canarySuccessfulProductCount,
        })) {
          const blockedSummary = summarizeBlockedProducts(assemblyStatuses);
          throw new Error(
            `Vendor sync halted during early product validation: 0 of first ${canaryEvaluatedProductCount} products passed enrichment. ${formatGatingReasonSummary(blockedSummary)}`,
          );
        }

        if (shouldFailSyncBecauseBlockedRateTooHigh({
          evaluatedProductCount: assemblyStatuses.length,
          blockedProductCount,
        })) {
          const blockedSummary = summarizeBlockedProducts(assemblyStatuses);
          throw new Error(
            `Vendor sync halted after ${assemblyStatuses.length} attempted products because ${blockedProductCount} products (${Math.round((blockedProductCount / assemblyStatuses.length) * 100)}%) failed enrichment, exceeding the ${Math.round(BLOCKED_PRODUCT_FAILURE_THRESHOLD_RATIO * 100)}% threshold. ${formatGatingReasonSummary(blockedSummary)}`,
          );
        }

        if (mergedFetchedProducts.length > 0 && assembly.products.length === 0) {
          const blockedSummary = summarizeBlockedProducts(assembly.statuses);
          logger.warn('vendor sync skipped blocked product before BigCommerce write', {
            syncRunId: syncRun.sync_run_id,
            vendorId: input.vendorId,
            productId: reference.productId,
            blockedProductCount: blockedSummary.blockedCount,
            topGatingReasons: blockedSummary.topGatingReasons,
          });
          continue;
        }

        for (const product of assembly.products) {
          await throwIfSyncCancelled(input.integrationJobId);

          let upsertResult;
          try {
            upsertResult = await upsertBigCommerceProduct({
              accessToken: input.session.accessToken,
              storeHash: input.session.storeHash,
              vendorId: input.vendorId,
              product,
              defaultMarkupPercent: 30,
              pricingContext,
            });
          } catch (error) {
            const partialUpsert = readPartialBigCommerceUpsertResult(error);
            if (partialUpsert) {
              await upsertVendorProductMap({
                vendor_id: input.vendorId,
                mapping_id: input.mappingId ?? null,
                vendor_product_id: product.vendor_product_id ?? product.sku,
                bigcommerce_product_id: partialUpsert.product.id,
                sku: partialUpsert.resolvedSku,
                product_name: product.name,
                metadata: {
                  source: 'etl-sync',
                  duplicate: partialUpsert.duplicate,
                  action: partialUpsert.action,
                  markup_percent: partialUpsert.markupPercent,
                  pricing_reconciliation: partialUpsert.pricingReconciliation ?? null,
                  enrichment: product.enrichment_status ?? {},
                  partial_failure: true,
                  partial_error: error instanceof Error ? error.message : 'Partial BigCommerce upsert failed.',
                },
              });

              if (!writtenProductKeys.has(partialUpsert.resolvedSku)) {
                writtenProductKeys.add(partialUpsert.resolvedSku);
                recordsWritten += 1;
              }

              if (partialUpsert.inventory_sync_target) {
                pendingInventorySyncTargets.push(partialUpsert.inventory_sync_target);
              }
            }

            throw error;
          }

          await upsertVendorProductMap({
            vendor_id: input.vendorId,
            mapping_id: input.mappingId ?? null,
            vendor_product_id: product.vendor_product_id ?? product.sku,
            bigcommerce_product_id: upsertResult.product.id,
            sku: upsertResult.resolvedSku,
            product_name: product.name,
            metadata: {
              source: 'etl-sync',
              duplicate: upsertResult.duplicate,
              action: upsertResult.action,
              markup_percent: upsertResult.markupPercent,
              pricing_reconciliation: upsertResult.pricingReconciliation,
              enrichment: product.enrichment_status ?? {},
            },
          });

          if (product.vendor_product_id) {
            await clearProductEnrichmentRetry({
              vendor_id: input.vendorId,
              vendor_product_id: product.vendor_product_id,
              source: 'MEDIA',
            });
          }

          const related = product.related_vendor_product_ids ?? [];
          for (const targetVendorProductId of related) {
            if (!product.vendor_product_id) continue;
            await upsertPendingRelatedProductLink({
              vendor_id: input.vendorId,
              source_vendor_product_id: product.vendor_product_id,
              target_vendor_product_id: targetVendorProductId,
              source_bigcommerce_product_id: upsertResult.product.id,
              status: 'PENDING',
              metadata: {
                source_sku: upsertResult.resolvedSku,
              },
            });
          }

          if (!writtenProductKeys.has(upsertResult.resolvedSku)) {
            writtenProductKeys.add(upsertResult.resolvedSku);
            recordsWritten += 1;
          }

          if (upsertResult.inventory_sync_target) {
            pendingInventorySyncTargets.push(upsertResult.inventory_sync_target);
            await flushPendingInventorySyncTargets('productdata_batch_progress');
          }

          logger.info('vendor sync BigCommerce product upsert completed', {
            syncRunId: syncRun.sync_run_id,
            vendorId: input.vendorId,
            sku: upsertResult.resolvedSku,
            vendorProductId: product.vendor_product_id ?? null,
            bigcommerceProductId: upsertResult.product.id,
            action: upsertResult.action,
            recordsWritten,
          });
        }

        if (shouldPersistProgress(getProductCallCount)) {
          await persistSyncProgress({
            syncRunId: syncRun.sync_run_id,
            phase: 'UPSERT',
            totalReferences,
            processedReferences: startReferenceIndex + getProductCallCount,
            recordsRead,
            recordsWritten,
            blockedProductCount,
            currentProductId: reference.productId,
            currentSku: mergedFetchedProducts[0]?.sku ?? null,
            endpointResults,
            productStatuses: assemblyStatuses,
            mediaRetries,
          });
        }
      }

      endpointResults.push({
        mapping_id: discovery.getProductConfig.mapping.mapping_id,
        endpoint_name: discovery.getProductConfig.mapping.endpoint_name,
        endpoint_version: discovery.getProductConfig.mapping.endpoint_version,
        operation_name: discovery.getProductConfig.mapping.operation_name,
        status: 200,
        products_found: recordsRead,
        message: hasMoreReferences
          ? `getProduct completed for ${batchReferences.length} of ${totalReferences} product references in this batch.`
          : `getProduct completed for ${totalReferences} product references.`,
      });

      if (hasMoreReferences && isCatalogSyncSourceAction(input.sourceAction)) {
        continuationResult = {
          enqueued: false,
          nextStartReferenceIndex,
          totalReferences,
        };

        const correlationId = input.correlationId ?? getRequestContext()?.correlationId;
        if (!correlationId) {
          throw new Error('Catalog sync continuation requires a correlation ID.');
        }

        pendingContinuationRequest = {
          vendorId: input.vendorId,
          mappingId: input.mappingId,
          syncAll: input.syncAll,
          sourceAction: input.sourceAction,
          correlationId,
          requestPayload: {
            continuation: {
              start_reference_index: nextStartReferenceIndex,
              max_references_per_run: maxReferencesPerRun,
              initial_last_successful_sync_at: lastSuccessfulSyncAt,
            },
          },
        };
      }
    }

    for (const assigned of selectedMappings) {
      if (assigned.mapping.endpoint_name === 'ProductData') continue;

      const mapping = assigned.mapping;
      const runtimeConfig = (assigned.runtime_config ?? {}) as Record<string, unknown>;
      const endpointUrl = resolveRuntimeEndpointUrl({
        vendorApiUrl: vendor.vendor_api_url,
        runtimeConfig,
      });
      const operationName = mapping.operation_name || (runtimeConfig.operation_name as string | undefined) || '';
      if (!endpointUrl || !operationName) {
        endpointResults.push({
          mapping_id: mapping.mapping_id,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          status: 400,
          products_found: 0,
          message: 'Missing endpoint URL or operation name',
        });
        continue;
      }

      if (['Inventory', 'PricingAndConfiguration', 'ProductMedia'].includes(mapping.endpoint_name)) {
        continue;
      }

      const protocol = resolveProtocol(mapping.protocol, vendor.api_protocol);
      const adapter = resolveEndpointAdapter(protocol);
      const result = await adapter.invokeEndpoint({
        endpointUrl,
        endpointName: mapping.endpoint_name,
        operationName,
        endpointVersion: mapping.endpoint_version,
        vendorAccountId: vendor.vendor_account_id,
        vendorSecret: vendor.vendor_secret,
        runtimeConfig,
      });

      const products = normalizeProductsFromEndpoint(
        mapping.endpoint_name,
        mapping.endpoint_version,
        operationName,
        result.parsedBody ?? result.rawPayload,
        (mapping.transform_schema ?? {}) as Record<string, unknown>,
      );
      baseProducts.push(...products);
      endpointResults.push({
        mapping_id: mapping.mapping_id,
        endpoint_name: mapping.endpoint_name,
        endpoint_version: mapping.endpoint_version,
        operation_name: operationName,
        status: result.status,
        products_found: products.length,
      });
    }

    const enrichmentMappings = assignedMappings.filter(item => {
      if (item.mapping.endpoint_name === 'ProductData') return false;
      if (!['Inventory', 'PricingAndConfiguration', 'ProductMedia'].includes(item.mapping.endpoint_name)) return false;
      if (input.mappingId && selectedKeys.size > 0) {
        return selectedKeys.has(mappingKey(item.mapping));
      }
      return true;
    });

    mergedBaseProducts = mergeProducts(baseProducts);
    logger.info('vendor sync base product merge completed', {
      syncRunId: syncRun.sync_run_id,
      vendorId: input.vendorId,
      rawProductCount: baseProducts.length,
      mergedProductCount: mergedBaseProducts.length,
    });

    if (mergedBaseProducts.length > 0) {
      const assembly = await buildProductAssembly({
        vendor,
        assignedMappings: enrichmentMappings,
        baseProducts: mergedBaseProducts,
      });
      assembly.endpointResults.forEach(result => endpointResults.push(result));
      assemblyStatuses.push(...assembly.statuses);
      mediaRetries.push(...assembly.mediaRetries);
      blockedProductCount += assembly.statuses.filter(status => status.blocked).length;
      canaryEvaluatedProductCount += assembly.statuses.length;
      canarySuccessfulProductCount += assembly.products.length;

      const blockedSummary = summarizeBlockedProducts(assembly.statuses);
      logger.info('vendor sync product assembly completed', {
        syncRunId: syncRun.sync_run_id,
        vendorId: input.vendorId,
        baseProductCount: mergedBaseProducts.length,
        assembledProductCount: assembly.products.length,
        blockedProductCount: blockedSummary.blockedCount,
        mediaRetryCount: assembly.mediaRetries.length,
        topGatingReasons: blockedSummary.topGatingReasons,
      });

      if (shouldFailSyncDuringCanaryWindow({
        evaluatedProductCount: canaryEvaluatedProductCount,
        successfulProductCount: canarySuccessfulProductCount,
      })) {
        const aggregateBlockedSummary = summarizeBlockedProducts(assemblyStatuses);
        throw new Error(
          `Vendor sync halted during early product validation: 0 of first ${canaryEvaluatedProductCount} products passed enrichment. ${formatGatingReasonSummary(aggregateBlockedSummary)}`,
        );
      }

      if (shouldFailSyncBecauseBlockedRateTooHigh({
        evaluatedProductCount: assemblyStatuses.length,
        blockedProductCount,
      })) {
        const aggregateBlockedSummary = summarizeBlockedProducts(assemblyStatuses);
        throw new Error(
          `Vendor sync halted after ${assemblyStatuses.length} attempted products because ${blockedProductCount} products (${Math.round((blockedProductCount / assemblyStatuses.length) * 100)}%) failed enrichment, exceeding the ${Math.round(BLOCKED_PRODUCT_FAILURE_THRESHOLD_RATIO * 100)}% threshold. ${formatGatingReasonSummary(aggregateBlockedSummary)}`,
        );
      }

      if (mergedBaseProducts.length > 0 && assembly.products.length === 0) {
        logger.warn('vendor sync skipped blocked products before BigCommerce write', {
          syncRunId: syncRun.sync_run_id,
          vendorId: input.vendorId,
          blockedProductCount: blockedSummary.blockedCount,
          topGatingReasons: blockedSummary.topGatingReasons,
        });
      }

      for (const retry of assembly.mediaRetries) {
        await upsertProductEnrichmentRetry({
          vendor_id: input.vendorId,
          vendor_product_id: retry.vendor_product_id,
          source: 'MEDIA',
          status: 'PENDING',
          last_error: retry.message,
          metadata: { sku: retry.sku },
        });
      }

      logger.info('vendor sync BigCommerce upsert phase started', {
        syncRunId: syncRun.sync_run_id,
        vendorId: input.vendorId,
        productCount: assembly.products.length,
        markupPercent: pricingContext.markup_percent,
        priceListId: pricingContext.price_list_id,
      });

      for (const product of assembly.products) {
        await throwIfSyncCancelled(input.integrationJobId);

        const upsertResult = await upsertBigCommerceProduct({
          accessToken: input.session.accessToken,
          storeHash: input.session.storeHash,
          vendorId: input.vendorId,
          product,
          defaultMarkupPercent: 30,
          pricingContext,
        });

        await upsertVendorProductMap({
          vendor_id: input.vendorId,
          mapping_id: input.mappingId ?? null,
          vendor_product_id: product.vendor_product_id ?? product.sku,
          bigcommerce_product_id: upsertResult.product.id,
          sku: upsertResult.resolvedSku,
          product_name: product.name,
          metadata: {
            source: 'etl-sync',
            duplicate: upsertResult.duplicate,
            action: upsertResult.action,
            markup_percent: upsertResult.markupPercent,
            pricing_reconciliation: upsertResult.pricingReconciliation,
            enrichment: product.enrichment_status ?? {},
          },
        });

        if (product.vendor_product_id) {
          await clearProductEnrichmentRetry({
            vendor_id: input.vendorId,
            vendor_product_id: product.vendor_product_id,
            source: 'MEDIA',
          });
        }

        const related = product.related_vendor_product_ids ?? [];
        for (const targetVendorProductId of related) {
          if (!product.vendor_product_id) continue;
          await upsertPendingRelatedProductLink({
            vendor_id: input.vendorId,
            source_vendor_product_id: product.vendor_product_id,
            target_vendor_product_id: targetVendorProductId,
            source_bigcommerce_product_id: upsertResult.product.id,
            status: 'PENDING',
            metadata: {
              source_sku: upsertResult.resolvedSku,
            },
          });
        }

        if (!seenReadProductKeys.has(product.vendor_product_id ?? product.sku)) {
          seenReadProductKeys.add(product.vendor_product_id ?? product.sku);
          recordsRead += 1;
        }
        if (!writtenProductKeys.has(upsertResult.resolvedSku)) {
          writtenProductKeys.add(upsertResult.resolvedSku);
          recordsWritten += 1;
        }

        if (upsertResult.inventory_sync_target) {
          pendingInventorySyncTargets.push(upsertResult.inventory_sync_target);
          await flushPendingInventorySyncTargets('endpoint_batch_progress');
        }

        logger.info('vendor sync BigCommerce product upsert completed', {
          syncRunId: syncRun.sync_run_id,
          vendorId: input.vendorId,
          sku: upsertResult.resolvedSku,
          vendorProductId: product.vendor_product_id ?? null,
          bigcommerceProductId: upsertResult.product.id,
          action: upsertResult.action,
          recordsWritten,
        });
      }
    }

    await flushPendingInventorySyncTargets('finalize', true);

    await persistSyncProgress({
      syncRunId: syncRun.sync_run_id,
      phase: 'FINALIZING',
      recordsRead,
      recordsWritten,
      blockedProductCount,
      endpointResults,
      productStatuses: assemblyStatuses,
      mediaRetries,
    });

    await resolveDeferredRelatedProducts({
      accessToken: input.session.accessToken,
      storeHash: input.session.storeHash,
      vendorId: input.vendorId,
    });

    if (shouldFailSyncBecauseAllProductsWereBlocked({
      recordsRead,
      recordsWritten,
      statuses: assemblyStatuses,
    })) {
      const blockedSummary = summarizeBlockedProducts(assemblyStatuses);
      throw new Error(
        `Vendor sync halted before BigCommerce write: 0 of ${recordsRead} products passed enrichment. ${formatGatingReasonSummary(blockedSummary)}`,
      );
    }

    if (pendingContinuationRequest) {
      await submitCatalogSyncJob(pendingContinuationRequest);
      continuationResult = continuationResult
        ? {
            ...continuationResult,
            enqueued: true,
          }
        : continuationResult;
    }

    await completeSyncRun({
      sync_run_id: syncRun.sync_run_id,
      status: 'SUCCESS',
      records_read: recordsRead,
      records_written: recordsWritten,
      details: {
        endpointResults,
        productStatuses: assemblyStatuses,
        mediaRetries,
        continuation: continuationResult
          ? {
              enqueued: continuationResult.enqueued,
              next_start_reference_index: continuationResult.nextStartReferenceIndex,
              total_references: continuationResult.totalReferences,
            }
          : null,
      },
    });

    return {
      syncRunId: syncRun.sync_run_id,
      recordsRead,
      recordsWritten,
      endpointResults,
      continuation: continuationResult,
    };
  } catch (error: any) {
    if (pendingInventorySyncTargets.length > 0) {
      try {
        await flushPendingInventorySyncTargets('failure', true);
      } catch (inventoryError) {
        logger.error('vendor sync inventory flush failed after sync error', {
          syncRunId: syncRun.sync_run_id,
          vendorId: input.vendorId,
          pendingTargetCount: pendingInventorySyncTargets.length,
          error: {
            message: inventoryError instanceof Error ? inventoryError.message : 'Inventory flush failed',
          },
        });
      }
    }

    if (error?.name === 'IntegrationJobCancelledError') {
      await persistSyncProgress({
        syncRunId: syncRun.sync_run_id,
        phase: 'CANCELLED',
        recordsRead,
        recordsWritten,
        blockedProductCount: assemblyStatuses.filter(status => status.blocked).length,
        endpointResults,
        productStatuses: assemblyStatuses,
        mediaRetries,
      });
    }

    logger.error('vendor sync failed', {
      syncRunId: syncRun.sync_run_id,
      vendorId: input.vendorId,
      recordsRead,
      recordsWritten,
      endpointResultCount: endpointResults.length,
      blockedProductCount: assemblyStatuses.filter(status => status.blocked).length,
      mediaRetryCount: mediaRetries.length,
      error: {
        message: error?.message ?? 'ETL sync failed',
      },
    });

    await completeSyncRun({
      sync_run_id: syncRun.sync_run_id,
      status: error?.name === 'IntegrationJobCancelledError' ? 'CANCELLED' : 'FAILED',
      error_message: error?.message ?? 'ETL sync failed',
      details: {
        endpointResults,
        productStatuses: assemblyStatuses,
        mediaRetries,
        recordsWritten,
        stack: error?.stack,
      },
    });
    throw error;
  }
}

export async function testVendorConnection(input: TestConnectionInput): Promise<{ ok: boolean; message: string }> {
  const vendor = await getVendorById(input.vendorId);
  if (!vendor) {
    throw new Error(`Vendor ${input.vendorId} not found`);
  }
  if (!vendor.vendor_api_url) {
    throw new Error('Vendor API URL is required');
  }

  return testVendorConnectionConfig({
    vendorApiUrl: vendor.vendor_api_url,
    vendorAccountId: vendor.vendor_account_id,
    vendorSecret: vendor.vendor_secret,
    apiProtocol: (vendor.api_protocol ?? 'SOAP') as MappingProtocol,
  });
}

export async function testVendorConnectionConfig(
  input: TestConnectionConfigInput,
): Promise<{ ok: boolean; message: string }> {
  const protocol = input.apiProtocol ?? 'SOAP';
  const adapter = resolveEndpointAdapter(protocol);
  return adapter.testConnection({
    endpointUrl: resolveRuntimeEndpointUrl({
      vendorApiUrl: input.vendorApiUrl,
      runtimeConfig: input.runtimeConfig,
    }),
    endpointName: input.endpointName ?? 'CompanyData',
    vendorAccountId: input.vendorAccountId,
    vendorSecret: input.vendorSecret,
    operationName: input.operationName,
    endpointVersion: input.endpointVersion,
    runtimeConfig: input.runtimeConfig,
  });
}
