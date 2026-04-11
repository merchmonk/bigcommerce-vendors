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
  endpoint_mapping_id: number;
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

export interface ProductDataDiscoveryResult {
  endpointResults: ProductDataEndpointResult[];
  references: ProductReference[];
  getProductConfig: {
    mapping: EndpointMapping;
    runtimeConfig: Record<string, unknown>;
    endpointUrl: string;
    localizationCountry: string;
    localizationLanguage: string;
  } | null;
}

export interface ProductDataFetchResult {
  status: number;
  products: NormalizedProduct[];
  message?: string;
}

type AssignedMapping = VendorEndpointMapping & { mapping: EndpointMapping };

const DEFAULT_LOCALIZATION_COUNTRY = 'US';
const DEFAULT_LOCALIZATION_LANGUAGE = 'en';
const DEFAULT_MAX_DISCOVERY_REFERENCES = 20000;
const DEFAULT_MAX_GET_PRODUCT_REFERENCES = 10000;
const DEFAULT_GET_PRODUCT_CONCURRENCY = 8;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function extractSoapFaultMessage(parsedBody: Record<string, unknown> | null, rawPayload: string): string {
  const fault = parsedBody?.Fault;
  if (fault && typeof fault === 'object') {
    const faultRecord = fault as Record<string, unknown>;
    const faultString = faultRecord.faultstring;
    if (typeof faultString === 'string' && faultString.trim()) {
      return faultString.trim();
    }
  }

  const match = rawPayload.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  return '';
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

function readPositiveIntegerConfig(config: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
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

function getEndpointUrl(endpointUrl?: string | null): string {
  return endpointUrl?.trim() ?? '';
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

function appendReferences(
  target: ProductReference[],
  incoming: ProductReference[],
  maxReferences: number,
): { truncated: boolean } {
  if (maxReferences <= 0) {
    return { truncated: incoming.length > 0 };
  }

  for (const reference of incoming) {
    if (target.length >= maxReferences) {
      return { truncated: true };
    }
    target.push(reference);
  }

  return { truncated: false };
}

export async function discoverProductDataReferences(input: {
  vendor: Vendor;
  assignedMappings: AssignedMapping[];
  lastSuccessfulSyncAt?: string | null;
}): Promise<ProductDataDiscoveryResult> {
  const endpointResults: ProductDataEndpointResult[] = [];
  const mappings = input.assignedMappings.filter(item => item.mapping.endpoint_name === 'ProductData');
  if (mappings.length === 0) {
    return {
      endpointResults,
      references: [],
      getProductConfig: null,
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
        endpoint_mapping_id: item.endpoint_mapping_id,
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
      references: [],
      getProductConfig: null,
    };
  }

  const primaryGetProductMapping = getProductMappings[0];
  const primaryRuntimeConfig = asRecord(primaryGetProductMapping.runtime_config);
  const maxDiscoveryReferences = readPositiveIntegerConfig(
    primaryRuntimeConfig,
    ['maxDiscoveryReferences', 'max_discovery_references'],
    DEFAULT_MAX_DISCOVERY_REFERENCES,
  );

  const lookupRefs: ProductReference[] = [];
  const discoveryErrors: string[] = [];
  let discoveryTruncated = false;
  const discoveryOperationName = input.lastSuccessfulSyncAt ? 'getProductDateModified' : 'getProductSellable';

  async function runDiscoveryOperation(
    operationName: 'getProductSellable' | 'getProductDateModified',
  ): Promise<void> {
    const operationMappings = operationMap.get(operationName) ?? [];
    for (const assigned of operationMappings) {
      const mapping = assigned.mapping;
      const runtimeConfig = asRecord(assigned.runtime_config);
      const endpointUrl = getEndpointUrl(assigned.endpointUrl);
      if (!endpointUrl) {
        endpointResults.push({
          endpoint_mapping_id: mapping.endpoint_mapping_id,
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
        requestFields.changeTimeStamp = input.lastSuccessfulSyncAt;
      }

      try {
        const invokeResult = await adapter.invokeEndpoint({
          endpointUrl,
          endpointName: mapping.endpoint_name,
          operationName,
          endpointVersion: mapping.endpoint_version,
          vendorAccountId: input.vendor.vendor_account_id,
          vendorSecret: input.vendor.vendor_secret,
          runtimeConfig: mergeRequestFields(runtimeConfig, requestFields),
        });

        const responseMessage =
          invokeResult.status >= 400
            ? extractSoapFaultMessage(invokeResult.parsedBody, invokeResult.rawPayload)
            : undefined;
        if (invokeResult.status >= 400) {
          const summarizedMessage = responseMessage || `${operationName} returned HTTP ${invokeResult.status}.`;
          discoveryErrors.push(`${operationName}: ${summarizedMessage}`);
        }

        const refs = extractProductReferencesFromPayload(invokeResult.parsedBody ?? invokeResult.rawPayload);
        const appended = appendReferences(lookupRefs, refs, maxDiscoveryReferences);
        if (appended.truncated) {
          discoveryTruncated = true;
        }

        endpointResults.push({
          endpoint_mapping_id: mapping.endpoint_mapping_id,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          status: invokeResult.status,
          products_found: refs.length,
          message: responseMessage,
        });
      } catch (error: any) {
        discoveryErrors.push(`${operationName}: ${error?.message ?? 'Discovery operation failed'}`);
        endpointResults.push({
          endpoint_mapping_id: mapping.endpoint_mapping_id,
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

  await runDiscoveryOperation(discoveryOperationName);

  const runtimeReferences = parseProductReferencesFromRuntimeConfig(primaryRuntimeConfig);
  const appendedRuntime = appendReferences(lookupRefs, runtimeReferences, maxDiscoveryReferences);
  if (appendedRuntime.truncated) {
    discoveryTruncated = true;
  }

  const dedupedReferences = dedupeReferences(lookupRefs);
  const references = dedupedReferences.slice(0, maxDiscoveryReferences);
  if (dedupedReferences.length > maxDiscoveryReferences) {
    discoveryTruncated = true;
  }
  if (references.length === 0) {
    if (discoveryErrors.length > 0) {
      throw new Error(`ProductData discovery failed before any product IDs were found. ${discoveryErrors.join(' | ')}`);
    }

    endpointResults.push({
      endpoint_mapping_id: primaryGetProductMapping.endpoint_mapping_id,
      endpoint_name: primaryGetProductMapping.mapping.endpoint_name,
      endpoint_version: primaryGetProductMapping.mapping.endpoint_version,
      operation_name: primaryGetProductMapping.mapping.operation_name,
      status: 204,
      products_found: 0,
      message:
        `No ProductData product IDs discovered. Configure ${discoveryOperationName} or provide runtime product_ids.`,
    });

    return {
      endpointResults,
      references,
      getProductConfig: null,
    };
  }

  if (discoveryTruncated) {
    endpointResults.push({
      endpoint_mapping_id: primaryGetProductMapping.endpoint_mapping_id,
      endpoint_name: primaryGetProductMapping.mapping.endpoint_name,
      endpoint_version: primaryGetProductMapping.mapping.endpoint_version,
      operation_name: discoveryOperationName,
      status: 206,
      products_found: references.length,
      message: `Discovery truncated to ${maxDiscoveryReferences} references. Configure max_discovery_references to adjust this limit.`,
    });
  }

  const endpointUrl = getEndpointUrl(primaryGetProductMapping.endpointUrl);
  if (!endpointUrl) {
    endpointResults.push({
      endpoint_mapping_id: primaryGetProductMapping.mapping.endpoint_mapping_id,
      endpoint_name: primaryGetProductMapping.mapping.endpoint_name,
      endpoint_version: primaryGetProductMapping.mapping.endpoint_version,
      operation_name: primaryGetProductMapping.mapping.operation_name,
      status: 400,
      products_found: 0,
      message: 'Missing endpoint URL for getProduct operation.',
    });

    return {
      endpointResults,
      references,
      getProductConfig: null,
    };
  }

  const localization = getLocalization(primaryRuntimeConfig);
  return {
    endpointResults,
    references,
    getProductConfig: {
      mapping: primaryGetProductMapping.mapping,
      runtimeConfig: primaryRuntimeConfig,
      endpointUrl,
      localizationCountry: localization.localizationCountry,
      localizationLanguage: localization.localizationLanguage,
    },
  };
}

export async function fetchProductDataReference(input: {
  vendor: Vendor;
  discovery: ProductDataDiscoveryResult;
  reference: ProductReference;
}): Promise<ProductDataFetchResult> {
  if (!input.discovery.getProductConfig) {
    return {
      status: 400,
      products: [],
      message: 'ProductData discovery did not resolve a getProduct configuration.',
    };
  }

  const { mapping, runtimeConfig, endpointUrl, localizationCountry, localizationLanguage } = input.discovery.getProductConfig;
  const protocol = resolveProtocol(mapping.protocol, input.vendor.api_protocol);
  const adapter = resolveEndpointAdapter(protocol);

  const invokeResult = await adapter.invokeEndpoint({
    endpointUrl,
    endpointName: mapping.endpoint_name,
    operationName: 'getProduct',
    endpointVersion: mapping.endpoint_version,
    vendorAccountId: input.vendor.vendor_account_id,
    vendorSecret: input.vendor.vendor_secret,
    runtimeConfig: mergeRequestFields(runtimeConfig, {
      localizationCountry,
      localizationLanguage,
      productId: input.reference.productId,
      ...(input.reference.partId ? { partId: input.reference.partId } : {}),
    }),
  });

  const message =
    invokeResult.status >= 400
      ? extractSoapFaultMessage(invokeResult.parsedBody, invokeResult.rawPayload) ||
        `getProduct returned HTTP ${invokeResult.status}.`
      : undefined;

  if (invokeResult.status >= 400) {
    return {
      status: invokeResult.status,
      products: [],
      message,
    };
  }

  const normalized = normalizeProductsFromEndpoint(
    mapping.endpoint_name,
    mapping.endpoint_version,
    mapping.operation_name,
    invokeResult.parsedBody ?? invokeResult.rawPayload,
    (mapping.transform_schema ?? {}) as Record<string, unknown>,
  );

  return {
    status: invokeResult.status,
    products: normalized,
  };
}

export async function runProductDataWorkflow(input: {
  vendor: Vendor;
  assignedMappings: AssignedMapping[];
  lastSuccessfulSyncAt?: string | null;
}): Promise<ProductDataWorkflowResult> {
  const discovery = await discoverProductDataReferences(input);
  const endpointResults = [...discovery.endpointResults];
  const products: NormalizedProduct[] = [];

  if (!discovery.getProductConfig || discovery.references.length === 0) {
    return {
      endpointResults,
      products,
    };
  }

  let getProductErrorCount = 0;
  let getProductCallCount = 0;
  const workflowRuntimeConfig = asRecord(discovery.getProductConfig.runtimeConfig);
  const maxGetProductReferences = readPositiveIntegerConfig(
    workflowRuntimeConfig,
    ['maxGetProductReferences', 'max_get_product_references'],
    DEFAULT_MAX_GET_PRODUCT_REFERENCES,
  );
  const getProductConcurrency = readPositiveIntegerConfig(
    workflowRuntimeConfig,
    ['getProductConcurrency', 'get_product_concurrency'],
    DEFAULT_GET_PRODUCT_CONCURRENCY,
  );
  const referencesToProcess = discovery.references.slice(0, maxGetProductReferences);

  let index = 0;
  async function worker(): Promise<void> {
    while (index < referencesToProcess.length) {
      const currentIndex = index;
      index += 1;
      const reference = referencesToProcess[currentIndex];
      getProductCallCount += 1;

      try {
        const fetchResult = await fetchProductDataReference({
          vendor: input.vendor,
          discovery,
          reference,
        });

        if (fetchResult.status >= 400) {
          getProductErrorCount += 1;
          continue;
        }

        for (const product of fetchResult.products) {
          products.push(product);
        }
      } catch {
        getProductErrorCount += 1;
      }
    }
  }

  const workerCount = Math.min(getProductConcurrency, referencesToProcess.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const referencesWereTruncated = discovery.references.length > referencesToProcess.length;

  endpointResults.push({
    endpoint_mapping_id: discovery.getProductConfig.mapping.endpoint_mapping_id,
    endpoint_name: discovery.getProductConfig.mapping.endpoint_name,
    endpoint_version: discovery.getProductConfig.mapping.endpoint_version,
    operation_name: discovery.getProductConfig.mapping.operation_name,
    status: getProductErrorCount > 0 ? 207 : 200,
    products_found: products.length,
    message:
      getProductErrorCount > 0
        ? `getProduct completed with ${getProductErrorCount} failed calls out of ${getProductCallCount}.`
        : referencesWereTruncated
          ? `getProduct processed ${getProductCallCount} references (truncated from ${discovery.references.length}).`
          : `getProduct completed for ${getProductCallCount} product references.`,
  });

  return {
    endpointResults,
    products,
  };
}
