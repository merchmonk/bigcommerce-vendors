import type { EndpointMapping, MappingProtocol, VendorEndpointMapping } from '../../types';
import type { Vendor } from '../vendors';
import { resolveEndpointAdapter } from './adapters/factory';
import {
  extractProductReferencesFromPayload,
  normalizeProductsFromEndpoint,
  type NormalizedProduct,
  type ProductReference,
} from './productNormalizer';

export interface ProductDataEndpointResult {
  mapping_id: number;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  status: number;
  products_found: number;
  message?: string;
}

export interface ProductDataWorkflowResult {
  endpointResults: ProductDataEndpointResult[];
  products: NormalizedProduct[];
}

type AssignedMapping = VendorEndpointMapping & { mapping: EndpointMapping };

const DEFAULT_LOCALIZATION_COUNTRY = 'US';
const DEFAULT_LOCALIZATION_LANGUAGE = 'en';
const DEFAULT_DELTA_TIMESTAMP = '1970-01-01T00:00:00Z';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readStringConfig(config: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function readBooleanConfig(config: Record<string, unknown>, keys: string[], fallback: boolean): boolean {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
  }
  return fallback;
}

function resolveProtocol(mappingProtocol: string | null | undefined, vendorProtocol: string | null | undefined): MappingProtocol {
  if (mappingProtocol) return mappingProtocol as MappingProtocol;
  if (vendorProtocol) return vendorProtocol as MappingProtocol;
  return 'SOAP';
}

function dedupeReferences(references: ProductReference[]): ProductReference[] {
  const unique: ProductReference[] = [];
  const seen = new Set<string>();
  for (const ref of references) {
    if (!ref.productId) continue;
    const key = `${ref.productId}|${ref.partId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function parseProductReferencesFromRuntimeConfig(runtimeConfig: Record<string, unknown>): ProductReference[] {
  const productIdsValue = runtimeConfig.product_ids ?? runtimeConfig.productIds;
  if (!Array.isArray(productIdsValue)) return [];

  const parsed: ProductReference[] = [];
  for (const item of productIdsValue) {
    if (typeof item === 'string') {
      const value = item.trim();
      if (value) {
        parsed.push({ productId: value });
      }
      continue;
    }

    const record = asRecord(item);
    const productId = readStringConfig(record, ['productId', 'product_id']);
    if (!productId) continue;
    const partId = readStringConfig(record, ['partId', 'part_id']) || undefined;
    parsed.push({ productId, partId });
  }

  return dedupeReferences(parsed);
}

function mergeRequestFields(
  runtimeConfig: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const existing = asRecord(runtimeConfig.request_fields);
  return {
    ...runtimeConfig,
    request_fields: {
      ...existing,
      ...fields,
    },
  };
}

function getEndpointUrl(vendor: Vendor, runtimeConfig: Record<string, unknown>): string {
  const runtimeEndpointUrl = readStringConfig(runtimeConfig, ['endpoint_url', 'endpointUrl']);
  if (runtimeEndpointUrl) return runtimeEndpointUrl;
  return vendor.vendor_api_url ?? '';
}

function getLocalization(runtimeConfig: Record<string, unknown>): {
  localizationCountry: string;
  localizationLanguage: string;
} {
  return {
    localizationCountry: readStringConfig(
      runtimeConfig,
      ['localizationCountry', 'localization_country'],
      DEFAULT_LOCALIZATION_COUNTRY,
    ),
    localizationLanguage: readStringConfig(
      runtimeConfig,
      ['localizationLanguage', 'localization_language'],
      DEFAULT_LOCALIZATION_LANGUAGE,
    ),
  };
}

function markCloseoutProducts(
  products: NormalizedProduct[],
  closeoutProductIds: Set<string>,
): NormalizedProduct[] {
  if (closeoutProductIds.size === 0) return products;

  return products.map(product => {
    const vendorProductId = product.vendor_product_id ?? product.sku;
    if (!closeoutProductIds.has(vendorProductId)) return product;

    const existingCustomFields = product.custom_fields ?? [];
    const withoutCloseout = existingCustomFields.filter(field => field.name !== 'is_closeout');
    return {
      ...product,
      custom_fields: [...withoutCloseout, { name: 'is_closeout', value: 'true' }],
    };
  });
}

export async function runProductDataWorkflow(input: {
  vendor: Vendor;
  assignedMappings: AssignedMapping[];
}): Promise<ProductDataWorkflowResult> {
  const endpointResults: ProductDataEndpointResult[] = [];
  const products: NormalizedProduct[] = [];

  const mappings = input.assignedMappings.filter(item => item.mapping.endpoint_name === 'ProductData');
  if (mappings.length === 0) {
    return {
      endpointResults,
      products,
    };
  }

  const operationMap = new Map<string, AssignedMapping[]>();
  for (const mapping of mappings) {
    const operation = (mapping.mapping.operation_name ?? '').trim();
    if (!operation) continue;
    const existing = operationMap.get(operation) ?? [];
    existing.push(mapping);
    operationMap.set(operation, existing);
  }

  const getProductMappings = operationMap.get('getProduct') ?? [];
  if (getProductMappings.length === 0) {
    for (const item of mappings) {
      endpointResults.push({
        mapping_id: item.mapping_id,
        endpoint_name: item.mapping.endpoint_name,
        endpoint_version: item.mapping.endpoint_version,
        operation_name: item.mapping.operation_name,
        status: 400,
        products_found: 0,
        message: 'ProductData workflow requires a getProduct mapping.',
      });
    }

    return {
      endpointResults,
      products,
    };
  }

  const lookupRefs: ProductReference[] = [];
  const closeoutProductIds = new Set<string>();

  async function runDiscoveryOperation(
    operationName: 'getProductSellable' | 'getProductDateModified' | 'getProductCloseOut',
  ): Promise<void> {
    const operationMappings = operationMap.get(operationName) ?? [];
    for (const assigned of operationMappings) {
      const mapping = assigned.mapping;
      const runtimeConfig = asRecord(assigned.runtime_config);
      const endpointUrl = getEndpointUrl(input.vendor, runtimeConfig);
      if (!endpointUrl) {
        endpointResults.push({
          mapping_id: mapping.mapping_id,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          status: 400,
          products_found: 0,
          message: 'Missing endpoint URL for ProductData operation.',
        });
        continue;
      }

      const protocol = resolveProtocol(mapping.protocol, input.vendor.api_protocol);
      const adapter = resolveEndpointAdapter(protocol);
      const localization = getLocalization(runtimeConfig);

      const requestFields: Record<string, unknown> = {};
      if (operationName === 'getProductSellable') {
        requestFields.localizationCountry = localization.localizationCountry;
        requestFields.localizationLanguage = localization.localizationLanguage;
        requestFields.isSellable = readBooleanConfig(runtimeConfig, ['isSellable', 'is_sellable'], true);
      }
      if (operationName === 'getProductDateModified') {
        requestFields.changeTimeStamp = readStringConfig(
          runtimeConfig,
          ['changeTimeStamp', 'change_timestamp'],
          DEFAULT_DELTA_TIMESTAMP,
        );
      }

      try {
        const invokeResult = await adapter.invokeEndpoint({
          endpointUrl,
          operationName,
          endpointVersion: mapping.endpoint_version,
          vendorAccountId: input.vendor.vendor_account_id,
          vendorSecret: input.vendor.vendor_secret,
          runtimeConfig: mergeRequestFields(runtimeConfig, requestFields),
        });

        const refs = extractProductReferencesFromPayload(invokeResult.parsedBody ?? invokeResult.rawPayload);
        lookupRefs.push(...refs);
        if (operationName === 'getProductCloseOut') {
          refs.forEach(ref => closeoutProductIds.add(ref.productId));
        }

        endpointResults.push({
          mapping_id: mapping.mapping_id,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          status: invokeResult.status,
          products_found: refs.length,
        });
      } catch (error: any) {
        endpointResults.push({
          mapping_id: mapping.mapping_id,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          status: 500,
          products_found: 0,
          message: error?.message ?? 'Discovery operation failed',
        });
      }
    }
  }

  await runDiscoveryOperation('getProductSellable');
  await runDiscoveryOperation('getProductDateModified');
  await runDiscoveryOperation('getProductCloseOut');

  const primaryGetProductMapping = getProductMappings[0];
  const primaryRuntimeConfig = asRecord(primaryGetProductMapping.runtime_config);
  lookupRefs.push(...parseProductReferencesFromRuntimeConfig(primaryRuntimeConfig));

  const uniqueRefs = dedupeReferences(lookupRefs);
  if (uniqueRefs.length === 0) {
    endpointResults.push({
      mapping_id: primaryGetProductMapping.mapping_id,
      endpoint_name: primaryGetProductMapping.mapping.endpoint_name,
      endpoint_version: primaryGetProductMapping.mapping.endpoint_version,
      operation_name: primaryGetProductMapping.mapping.operation_name,
      status: 204,
      products_found: 0,
      message:
        'No ProductData product IDs discovered. Configure getProductSellable/getProductDateModified or provide runtime product_ids.',
    });

    return {
      endpointResults,
      products,
    };
  }

  const getProductMapping = primaryGetProductMapping.mapping;
  const endpointUrl = getEndpointUrl(input.vendor, primaryRuntimeConfig);
  if (!endpointUrl) {
    endpointResults.push({
      mapping_id: getProductMapping.mapping_id,
      endpoint_name: getProductMapping.endpoint_name,
      endpoint_version: getProductMapping.endpoint_version,
      operation_name: getProductMapping.operation_name,
      status: 400,
      products_found: 0,
      message: 'Missing endpoint URL for getProduct operation.',
    });

    return {
      endpointResults,
      products,
    };
  }

  const protocol = resolveProtocol(getProductMapping.protocol, input.vendor.api_protocol);
  const adapter = resolveEndpointAdapter(protocol);
  const localization = getLocalization(primaryRuntimeConfig);

  let getProductErrorCount = 0;
  let getProductCallCount = 0;

  for (const ref of uniqueRefs) {
    getProductCallCount += 1;

    try {
      const invokeResult = await adapter.invokeEndpoint({
        endpointUrl,
        operationName: 'getProduct',
        endpointVersion: getProductMapping.endpoint_version,
        vendorAccountId: input.vendor.vendor_account_id,
        vendorSecret: input.vendor.vendor_secret,
        runtimeConfig: mergeRequestFields(primaryRuntimeConfig, {
          localizationCountry: localization.localizationCountry,
          localizationLanguage: localization.localizationLanguage,
          productId: ref.productId,
          ...(ref.partId ? { partId: ref.partId } : {}),
        }),
      });

      if (invokeResult.status >= 400) {
        getProductErrorCount += 1;
        continue;
      }

      const normalized = normalizeProductsFromEndpoint(
        getProductMapping.endpoint_name,
        getProductMapping.endpoint_version,
        getProductMapping.operation_name,
        invokeResult.parsedBody ?? invokeResult.rawPayload,
        (getProductMapping.transform_schema ?? {}) as Record<string, unknown>,
      );
      products.push(...normalized);
    } catch {
      getProductErrorCount += 1;
    }
  }

  const normalizedProducts = markCloseoutProducts(products, closeoutProductIds);
  endpointResults.push({
    mapping_id: getProductMapping.mapping_id,
    endpoint_name: getProductMapping.endpoint_name,
    endpoint_version: getProductMapping.endpoint_version,
    operation_name: getProductMapping.operation_name,
    status: getProductErrorCount > 0 ? 207 : 200,
    products_found: normalizedProducts.length,
    message:
      getProductErrorCount > 0
        ? `getProduct completed with ${getProductErrorCount} failed calls out of ${getProductCallCount}.`
        : `getProduct completed for ${getProductCallCount} product references.`,
  });

  return {
    endpointResults,
    products: normalizedProducts,
  };
}
