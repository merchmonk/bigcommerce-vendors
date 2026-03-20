import crypto from 'node:crypto';
import type {
  MappingProtocol,
  PromostandardsCapabilityMatrix,
  PromostandardsEndpointCapability,
} from '../../types';
import { resolveEndpointAdapter } from '../etl/adapters/factory';
import {
  findMappingsByEndpointOperations,
  listEndpointMappings,
} from '../etl/repository';

interface DiscoveryInput {
  vendor_api_url?: string;
  vendor_account_id?: string | null;
  vendor_secret?: string | null;
  api_protocol?: MappingProtocol;
}

interface ProbeClassification {
  available: boolean;
  message: string;
}

function normalizeProtocol(protocol: MappingProtocol | undefined): MappingProtocol {
  return protocol ?? 'SOAP';
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

function classifyPromostandardsProbe(input: {
  status: number | null;
  parsedBody: Record<string, unknown> | null;
  rawPayload: string;
  errorMessage?: string;
}): ProbeClassification {
  const faultMessage = extractSoapFaultMessage(input.parsedBody, input.rawPayload);
  const message = input.errorMessage ?? faultMessage ?? 'No response body returned.';
  const normalized = message.toLowerCase();

  const unsupportedPatterns = [
    'did not recognize the value of http header soapaction',
    'server did not recognize the value of http header soapaction',
    'unknown operation',
    'not supported',
    'unsupported',
    'method not found',
    'dispatch method',
    'not found',
  ];
  const validationPatterns = [
    'required',
    'missing',
    'invalid',
    'must be provided',
    'cannot be empty',
    'validation',
    'partid',
    'productid',
    'lineitem',
    'quantity',
    'purchaseordernumber',
    'salesordernumber',
    'querytype',
    'invoice',
    'remittance',
  ];

  if (typeof input.status === 'number' && input.status >= 200 && input.status < 400) {
    return {
      available: true,
      message: faultMessage || 'Endpoint reachable.',
    };
  }

  if (unsupportedPatterns.some(pattern => normalized.includes(pattern))) {
    return {
      available: false,
      message,
    };
  }

  if (validationPatterns.some(pattern => normalized.includes(pattern))) {
    return {
      available: true,
      message,
    };
  }

  if (input.status === 401 || input.status === 403) {
    return {
      available: false,
      message,
    };
  }

  return {
    available: false,
    message,
  };
}

function toCapabilityProbes(mappings: Awaited<ReturnType<typeof listEndpointMappings>>): Array<{
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  metadata: Record<string, unknown>;
}> {
  return [...mappings].map(mapping => ({
    endpoint_name: mapping.endpoint_name,
    endpoint_version: mapping.endpoint_version,
    operation_name: mapping.operation_name,
    protocol: mapping.protocol,
    metadata: mapping.metadata ?? {},
  })).sort((left, right) => {
    if (left.endpoint_name !== right.endpoint_name) {
      return left.endpoint_name.localeCompare(right.endpoint_name);
    }

    if (left.endpoint_version !== right.endpoint_version) {
      return left.endpoint_version.localeCompare(right.endpoint_version);
    }

    return left.operation_name.localeCompare(right.operation_name);
  });
}

export function buildPromostandardsConnectionFingerprint(input: DiscoveryInput): string {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({
    vendor_api_url: input.vendor_api_url ?? '',
    vendor_account_id: input.vendor_account_id ?? '',
    vendor_secret: input.vendor_secret ?? '',
    api_protocol: normalizeProtocol(input.api_protocol),
  }));
  return hash.digest('hex');
}

export async function discoverPromostandardsCapabilities(
  input: DiscoveryInput,
): Promise<{
  ok: boolean;
  message: string;
  available_endpoint_count: number;
  fingerprint: string;
  tested_at: string;
  endpoints: PromostandardsEndpointCapability[];
}> {
  const protocol = normalizeProtocol(input.api_protocol);
  const mappings = await listEndpointMappings({
    standard_type: 'PROMOSTANDARDS',
    protocol,
  });
  const probes = toCapabilityProbes(mappings);
  const adapter = resolveEndpointAdapter(protocol);
  const endpoints: PromostandardsEndpointCapability[] = [];

  for (const probe of probes) {
    try {
      const result = await adapter.invokeEndpoint({
        endpointUrl: input.vendor_api_url ?? '',
        operationName: probe.operation_name,
        endpointVersion: probe.endpoint_version,
        vendorAccountId: input.vendor_account_id ?? null,
        vendorSecret: input.vendor_secret ?? null,
        runtimeConfig: {},
      });
      const classified = classifyPromostandardsProbe({
        status: result.status,
        parsedBody: result.parsedBody,
        rawPayload: result.rawPayload,
      });
      endpoints.push({
        endpoint_name: probe.endpoint_name,
        endpoint_version: probe.endpoint_version,
        operation_name: probe.operation_name,
        capability_scope:
          typeof probe.metadata.capability_scope === 'string'
            ? (probe.metadata.capability_scope as 'catalog' | 'order')
            : (probe.endpoint_name === 'CompanyData' ? 'catalog' : 'catalog'),
        lifecycle_role:
          typeof probe.metadata.lifecycle_role === 'string'
            ? probe.metadata.lifecycle_role
            : undefined,
        optional_by_vendor:
          typeof probe.metadata.optional_by_vendor === 'boolean'
            ? probe.metadata.optional_by_vendor
            : undefined,
        recommended_poll_minutes:
          typeof probe.metadata.recommended_poll_minutes === 'number'
            ? probe.metadata.recommended_poll_minutes
            : null,
        available: classified.available,
        status_code: result.status,
        message: classified.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Endpoint probe failed';
      endpoints.push({
        endpoint_name: probe.endpoint_name,
        endpoint_version: probe.endpoint_version,
        operation_name: probe.operation_name,
        capability_scope:
          typeof probe.metadata.capability_scope === 'string'
            ? (probe.metadata.capability_scope as 'catalog' | 'order')
            : (probe.endpoint_name === 'CompanyData' ? 'catalog' : 'catalog'),
        lifecycle_role:
          typeof probe.metadata.lifecycle_role === 'string'
            ? probe.metadata.lifecycle_role
            : undefined,
        optional_by_vendor:
          typeof probe.metadata.optional_by_vendor === 'boolean'
            ? probe.metadata.optional_by_vendor
            : undefined,
        recommended_poll_minutes:
          typeof probe.metadata.recommended_poll_minutes === 'number'
            ? probe.metadata.recommended_poll_minutes
            : null,
        available: false,
        status_code: null,
        message,
      });
    }
  }

  const availableEndpointCount = endpoints.filter(endpoint => endpoint.available).length;

  return {
    ok: availableEndpointCount > 0,
    message:
      availableEndpointCount > 0
        ? `Discovered ${availableEndpointCount} available PromoStandards endpoint${availableEndpointCount === 1 ? '' : 's'}.`
        : 'No supported PromoStandards endpoints were detected for this vendor.',
    available_endpoint_count: availableEndpointCount,
    fingerprint: buildPromostandardsConnectionFingerprint(input),
    tested_at: new Date().toISOString(),
    endpoints,
  };
}

export async function resolvePromostandardsCapabilityMappings(
  capabilities: Pick<PromostandardsCapabilityMatrix, 'endpoints'>,
): Promise<number[]> {
  const selections = capabilities.endpoints
    .filter(endpoint => endpoint.available)
    .map(endpoint => ({
      endpoint_name: endpoint.endpoint_name,
      endpoint_version: endpoint.endpoint_version,
      operation_name: endpoint.operation_name,
    }));

  const uniqueSelections = selections.filter((selection, index) => {
    return (
      selections.findIndex(item =>
        item.endpoint_name === selection.endpoint_name &&
        item.endpoint_version === selection.endpoint_version &&
        item.operation_name === selection.operation_name,
      ) === index
    );
  });

  if (uniqueSelections.length === 0) {
    return [];
  }

  const mappings = await findMappingsByEndpointOperations(uniqueSelections);
  return mappings.map(mapping => mapping.mapping_id);
}

export function isPromostandardsCapabilityMatrixCurrent(
  capabilities: PromostandardsCapabilityMatrix | undefined,
  input: DiscoveryInput,
): boolean {
  if (!capabilities) return false;
  return capabilities.fingerprint === buildPromostandardsConnectionFingerprint(input);
}
