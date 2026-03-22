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
      references: [],
      getProductConfig: null,
    };
  }

  const lookupRefs: ProductReference[] = [];
  const discoveryErrors: string[] = [];
  const discoveryOperationName = input.lastSuccessfulSyncAt ? 'getProductDateModified' : 'getProductSellable';

  async function runDiscoveryOperation(
    operationName: 'getProductSellable' | 'getProductDateModified',
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
        lookupRefs.push(...refs);

        endpointResults.push({
          mapping_id: mapping.mapping_id,
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

  await runDiscoveryOperation(discoveryOperationName);

  const primaryGetProductMapping = getProductMappings[0];
  const primaryRuntimeConfig = asRecord(primaryGetProductMapping.runtime_config);
  lookupRefs.push(...parseProductReferencesFromRuntimeConfig(primaryRuntimeConfig));

  const references = dedupeReferences(lookupRefs);
  if (references.length === 0) {
    if (discoveryErrors.length > 0) {
      throw new Error(`ProductData discovery failed before any product IDs were found. ${discoveryErrors.join(' | ')}`);
    }

    endpointResults.push({
      mapping_id: primaryGetProductMapping.mapping_id,
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

  const endpointUrl = getEndpointUrl(input.vendor, primaryRuntimeConfig);
  if (!endpointUrl) {
    endpointResults.push({
      mapping_id: primaryGetProductMapping.mapping.mapping_id,
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

  for (const reference of discovery.references) {
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

      products.push(...fetchResult.products);
    } catch {
      getProductErrorCount += 1;
    }
  }

  endpointResults.push({
    mapping_id: discovery.getProductConfig.mapping.mapping_id,
    endpoint_name: discovery.getProductConfig.mapping.endpoint_name,
    endpoint_version: discovery.getProductConfig.mapping.endpoint_version,
    operation_name: discovery.getProductConfig.mapping.operation_name,
    status: getProductErrorCount > 0 ? 207 : 200,
    products_found: products.length,
    message:
      getProductErrorCount > 0
        ? `getProduct completed with ${getProductErrorCount} failed calls out of ${getProductCallCount}.`
        : `getProduct completed for ${getProductCallCount} product references.`,
  });

  return {
    endpointResults,
    products,
  };
}
