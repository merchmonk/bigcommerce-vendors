import type { MappingProtocol, SessionContextProps } from '../../types';
import { getVendorById } from '../vendors';
import { mergeRequestContext } from '../requestContext';
import {
  resolveBigCommercePricingContext,
} from './bigcommercePricingContext';
import {
  upsertBigCommerceProduct,
  upsertRelatedProducts,
} from './bigcommerceCatalog';
import { resolveEndpointAdapter } from './adapters/factory';
import { normalizeProductsFromEndpoint, type NormalizedProduct } from './productNormalizer';
import { buildProductAssembly } from './productEnrichment';
import { runProductDataWorkflow } from './productDataWorkflow';
import {
  clearProductEnrichmentRetry,
  completeSyncRun,
  createSyncRun,
  findVendorProductMapByVendorProductId,
  listEnabledVendorEndpointMappings,
  listPendingRelatedProductLinks,
  markSyncRunRunning,
  upsertPendingRelatedProductLink,
  upsertProductEnrichmentRetry,
  upsertVendorProductMap,
} from './repository';

export interface RunVendorSyncInput {
  vendorId: number;
  session: SessionContextProps;
  mappingId?: number;
  syncAll?: boolean;
}

export interface TestConnectionInput {
  vendorId: number;
}

export interface TestConnectionConfigInput {
  vendorApiUrl: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  apiProtocol?: MappingProtocol;
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

  try {
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

    const endpointResults: SyncRunResult['endpointResults'] = [];
    const baseProducts: NormalizedProduct[] = [];

    const selectedKeys = new Set(selectedMappings.map(item => mappingKey(item.mapping)));
    const productDataMappings = assignedMappings.filter(item => item.mapping.endpoint_name === 'ProductData');
    const hasSelectedProductData = selectedMappings.some(item => item.mapping.endpoint_name === 'ProductData');
    const includeProductDataAsPrereq = !hasSelectedProductData && selectedMappings.some(item => item.mapping.is_product_endpoint);
    const productDataToRun = hasSelectedProductData
      ? selectedMappings.filter(item => item.mapping.endpoint_name === 'ProductData')
      : includeProductDataAsPrereq
        ? productDataMappings
        : [];

    if (productDataToRun.length > 0) {
      const productDataResult = await runProductDataWorkflow({
        vendor,
        assignedMappings: productDataToRun,
      });
      productDataResult.endpointResults.forEach(result => endpointResults.push(result));
      baseProducts.push(...productDataResult.products);
    }

    for (const assigned of selectedMappings) {
      if (assigned.mapping.endpoint_name === 'ProductData') continue;

      const mapping = assigned.mapping;
      const runtimeConfig = (assigned.runtime_config ?? {}) as Record<string, unknown>;
      const endpointUrl = (runtimeConfig.endpoint_url as string | undefined) ?? vendor.vendor_api_url;
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

    const mergedBaseProducts = mergeProducts(baseProducts);
    const assembly = await buildProductAssembly({
      vendor,
      assignedMappings: enrichmentMappings,
      baseProducts: mergedBaseProducts,
    });
    assembly.endpointResults.forEach(result => endpointResults.push(result));

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

    let recordsWritten = 0;
    const pricingContext = await resolveBigCommercePricingContext({
      accessToken: input.session.accessToken,
      storeHash: input.session.storeHash,
      fallback_markup_percent: 30,
    });
    for (const product of assembly.products) {
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

      recordsWritten += 1;
    }

    await resolveDeferredRelatedProducts({
      accessToken: input.session.accessToken,
      storeHash: input.session.storeHash,
      vendorId: input.vendorId,
    });

    await completeSyncRun({
      sync_run_id: syncRun.sync_run_id,
      status: 'SUCCESS',
      records_read: mergedBaseProducts.length,
      records_written: recordsWritten,
      details: {
        endpointResults,
        productStatuses: assembly.statuses,
        mediaRetries: assembly.mediaRetries,
      },
    });

    return {
      syncRunId: syncRun.sync_run_id,
      recordsRead: mergedBaseProducts.length,
      recordsWritten,
      endpointResults,
    };
  } catch (error: any) {
    await completeSyncRun({
      sync_run_id: syncRun.sync_run_id,
      status: 'FAILED',
      error_message: error?.message ?? 'ETL sync failed',
      details: { stack: error?.stack },
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
    endpointUrl: input.vendorApiUrl,
    vendorAccountId: input.vendorAccountId,
    vendorSecret: input.vendorSecret,
    operationName: input.operationName,
    endpointVersion: input.endpointVersion,
    runtimeConfig: input.runtimeConfig,
  });
}
