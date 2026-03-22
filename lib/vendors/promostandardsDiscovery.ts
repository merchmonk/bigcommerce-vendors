import crypto from 'node:crypto';
import type {
  MappingProtocol,
  PromostandardsCapabilityMatrix,
  PromostandardsEndpointCapability,
} from '../../types';
import { resolveSoapEndpointUrl } from '../etl/soapClient';
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
  credentialsValid: boolean | null;
}

function normalizeProtocol(protocol: MappingProtocol | undefined): MappingProtocol {
  return protocol ?? 'SOAP';
}

function compareEndpointVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(part => Number.parseInt(part, 10));
  const rightParts = right.split('.').map(part => Number.parseInt(part, 10));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index]! : 0;
    const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index]! : 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }

  return 0;
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
    'procedure',
  ];
  const validationPatterns = [
    'required',
    'missing',
    'invalid',
    'must be provided',
    'cannot be empty',
    'validation',
    'not found',
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
      credentialsValid: true,
    };
  }

  if (unsupportedPatterns.some(pattern => normalized.includes(pattern))) {
    return {
      available: false,
      message,
      credentialsValid: null,
    };
  }

  if (validationPatterns.some(pattern => normalized.includes(pattern))) {
    return {
      available: true,
      message,
      credentialsValid: true,
    };
  }

  if (input.status === 401 || input.status === 403) {
    return {
      available: false,
      message,
      credentialsValid: false,
    };
  }

  const authenticationPatterns = [
    'invalid credentials',
    'authentication',
    'not authorized',
    'unauthorized',
    'access denied',
    'invalid login',
    'login failed',
    'invalid password',
  ];
  if (authenticationPatterns.some(pattern => normalized.includes(pattern))) {
    return {
      available: false,
      message,
      credentialsValid: false,
    };
  }

  return {
    available: false,
    message,
    credentialsValid: null,
  };
}

function parseWsdlOperations(rawXml: string): Set<string> {
  const operations = new Set<string>();
  const expression = /wsdl:operation name="([^"]+)"/g;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(rawXml)) !== null) {
    if (match[1]) {
      operations.add(match[1]);
    }
  }
  return operations;
}

async function inspectSoapWsdl(input: {
  endpointUrl: string;
  endpointName: string;
  endpointVersion: string;
  operationName: string;
}): Promise<{
  available: boolean;
  statusCode: number | null;
  message: string;
} | null> {
  const wsdlUrl = `${resolveSoapEndpointUrl({
    endpointUrl: input.endpointUrl,
    endpointName: input.endpointName,
    endpointVersion: input.endpointVersion,
  })}?wsdl`;

  try {
    const response = await fetch(wsdlUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/xml, application/wsdl+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    const rawXml = await response.text();
    if (!response.ok || !rawXml.includes('<wsdl:definitions')) {
      return null;
    }

    const operations = parseWsdlOperations(rawXml);
    return {
      available: operations.has(input.operationName),
      statusCode: response.status,
      message: operations.has(input.operationName)
        ? 'Operation listed in endpoint WSDL.'
        : 'Operation not listed in endpoint WSDL.',
    };
  } catch {
    return null;
  }
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
  credentials_valid: boolean | null;
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
  let credentialsValid: boolean | null = null;

  for (const probe of probes) {
    try {
      const baseCapability = {
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
      };

      let wsdlInspection: {
        available: boolean;
        statusCode: number | null;
        message: string;
      } | null = null;

      if (protocol === 'SOAP') {
        wsdlInspection = await inspectSoapWsdl({
          endpointUrl: input.vendor_api_url ?? '',
          endpointName: probe.endpoint_name,
          endpointVersion: probe.endpoint_version,
          operationName: probe.operation_name,
        });
      }

      const result = await adapter.invokeEndpoint({
        endpointUrl: input.vendor_api_url ?? '',
        endpointName: probe.endpoint_name,
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
      if (classified.credentialsValid === true) {
        credentialsValid = true;
      } else if (credentialsValid !== true && classified.credentialsValid === false) {
        credentialsValid = false;
      }
      endpoints.push({
        ...baseCapability,
        available: wsdlInspection?.available ?? classified.available,
        status_code: result.status,
        message: wsdlInspection
          ? wsdlInspection.available
            ? 'Operation listed in endpoint WSDL.'
            : 'Operation not listed in endpoint WSDL.'
          : classified.available
            ? 'Endpoint reachable.'
            : 'Endpoint probe did not confirm availability.',
        wsdl_available: wsdlInspection?.available ?? null,
        credentials_valid: classified.credentialsValid,
        live_probe_message: classified.message,
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
        wsdl_available: null,
        credentials_valid: null,
        live_probe_message: null,
      });
    }
  }

  const availableEndpointCount = endpoints.filter(endpoint => endpoint.available).length;
  const ok = availableEndpointCount > 0 && credentialsValid !== false;

  return {
    ok,
    message:
      availableEndpointCount > 0
        ? credentialsValid === true
          ? `Discovered ${availableEndpointCount} PromoStandards operation${availableEndpointCount === 1 ? '' : 's'} in WSDL and confirmed the credentials with a live probe.`
          : credentialsValid === false
            ? `Discovered ${availableEndpointCount} PromoStandards operation${availableEndpointCount === 1 ? '' : 's'} in WSDL, but the live probe rejected the credentials.`
            : `Discovered ${availableEndpointCount} PromoStandards operation${availableEndpointCount === 1 ? '' : 's'} in WSDL. Live probes reached the service but still need endpoint-specific request fields.`
        : 'No supported PromoStandards endpoints were detected for this vendor.',
    available_endpoint_count: availableEndpointCount,
    credentials_valid: credentialsValid,
    fingerprint: buildPromostandardsConnectionFingerprint(input),
    tested_at: new Date().toISOString(),
    endpoints,
  };
}

export async function resolvePromostandardsCapabilityMappings(
  capabilities: Pick<PromostandardsCapabilityMatrix, 'endpoints'>,
): Promise<number[]> {
  const selectedByOperation = new Map<
    string,
    {
      endpoint_name: string;
      endpoint_version: string;
      operation_name: string;
    }
  >();

  for (const endpoint of capabilities.endpoints) {
    if (!endpoint.available) {
      continue;
    }

    const selectionKey = `${endpoint.endpoint_name}|${endpoint.operation_name}`;
    const existingSelection = selectedByOperation.get(selectionKey);
    if (!existingSelection) {
      selectedByOperation.set(selectionKey, {
        endpoint_name: endpoint.endpoint_name,
        endpoint_version: endpoint.endpoint_version,
        operation_name: endpoint.operation_name,
      });
      continue;
    }

    if (compareEndpointVersions(endpoint.endpoint_version, existingSelection.endpoint_version) > 0) {
      selectedByOperation.set(selectionKey, {
        endpoint_name: endpoint.endpoint_name,
        endpoint_version: endpoint.endpoint_version,
        operation_name: endpoint.operation_name,
      });
    }
  }

  const uniqueSelections = Array.from(selectedByOperation.values()).sort((left, right) => {
    if (left.endpoint_name !== right.endpoint_name) {
      return left.endpoint_name.localeCompare(right.endpoint_name);
    }

    if (left.operation_name !== right.operation_name) {
      return left.operation_name.localeCompare(right.operation_name);
    }

    return compareEndpointVersions(left.endpoint_version, right.endpoint_version);
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
