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

interface CapabilityProbe {
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  metadata: Record<string, unknown>;
}

const PROMOSTANDARDS_ENDPOINT_ALIASES: Record<string, string[]> = {
  CompanyData: ['companydata', 'companydataservicebinding'],
  Inventory: ['inventory', 'inventoryservicebinding'],
  PricingAndConfiguration: [
    'pricingandconfiguration',
    'productpriceandconfiguration',
    'ppc',
    'pricingandconfigurationservicebinding',
  ],
  ProductData: ['productdata', 'productdataservicebinding'],
  ProductMedia: ['productmedia', 'mediacontent', 'mediacontentservicebinding'],
  purchaseOrder: ['purchaseorder', 'po', 'purchaseorderservicebinding'],
  OrderStatusService: ['orderstatusservice', 'orderstatus'],
  OrderShipmentNotification: ['ordershipmentnotification', 'shipmentnotification'],
  Invoice: ['invoice', 'invoiceservicebinding'],
  RemittanceAdvice: ['remittanceadvice', 'remittanceservicebinding'],
};

function normalizeProtocol(protocol: MappingProtocol | undefined): MappingProtocol {
  return protocol ?? 'SOAP';
}

function normalizeLookupText(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
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

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function walkNodes(value: unknown, callback: (node: Record<string, unknown>) => void): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => walkNodes(item, callback));
    return;
  }
  if (typeof value !== 'object') return;

  const node = value as Record<string, unknown>;
  callback(node);
  Object.values(node).forEach(child => walkNodes(child, callback));
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectStringValues(item));
  }

  const record = asRecord(value);
  if (!record) return [];
  return Object.values(record).flatMap(item => collectStringValues(item));
}

function extractVersionCandidates(strings: string[]): string[] {
  const versions: string[] = [];
  for (const value of strings) {
    const matches = value.match(/\b\d+\.\d+\.\d+\b/g);
    if (!matches) continue;
    versions.push(...matches);
  }

  return Array.from(new Set(versions));
}

function normalizeResolvedEndpointUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.search.toLowerCase() === '?wsdl') {
      url.search = '';
    }
    return url.toString();
  } catch {
    return value;
  }
}

function getEndpointAliasTokens(endpointName: string): string[] {
  const aliases = PROMOSTANDARDS_ENDPOINT_ALIASES[endpointName] ?? [];
  return Array.from(
    new Set(
      [endpointName, ...aliases]
        .map(normalizeLookupText)
        .filter(Boolean),
    ),
  );
}

function lookupKey(endpointName: string, endpointVersion: string): string {
  return `${endpointName}|${endpointVersion}`;
}

function resolveProbeFromServiceDetail(input: {
  probes: CapabilityProbe[];
  strings: string[];
}): CapabilityProbe | null {
  const normalizedStrings = input.strings.map(normalizeLookupText).filter(Boolean);
  if (normalizedStrings.length === 0) {
    return null;
  }

  const matchingByName = input.probes.filter(probe => {
    const aliasTokens = getEndpointAliasTokens(probe.endpoint_name);
    return normalizedStrings.some(value => aliasTokens.some(token => value.includes(token)));
  });

  if (matchingByName.length === 0) {
    return null;
  }

  const versionCandidates = extractVersionCandidates(input.strings);
  if (versionCandidates.length > 0) {
    const exactVersionMatch = matchingByName.find(probe => versionCandidates.includes(probe.endpoint_version));
    if (exactVersionMatch) {
      return exactVersionMatch;
    }
  }

  if (matchingByName.length === 1) {
    return matchingByName[0];
  }

  return null;
}

function extractResolvedEndpointUrls(input: {
  payload: Record<string, unknown> | null;
  probes: CapabilityProbe[];
}): Map<string, string> {
  const resolved = new Map<string, string>();
  if (!input.payload) return resolved;

  walkNodes(input.payload, node => {
    const strings = collectStringValues(node);
    const urls = strings
      .filter(value => /^https?:\/\//i.test(value))
      .map(normalizeResolvedEndpointUrl);
    if (urls.length === 0) {
      return;
    }

    const matchedProbe = resolveProbeFromServiceDetail({
      probes: input.probes,
      strings,
    });
    if (!matchedProbe) {
      return;
    }

    resolved.set(lookupKey(matchedProbe.endpoint_name, matchedProbe.endpoint_version), urls[0]);
  });

  return resolved;
}

function mergeResolvedEndpointUrls(target: Map<string, string>, source: Map<string, string>): void {
  source.forEach((value, key) => {
    if (!target.has(key)) {
      target.set(key, value);
    }
  });
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

export async function probePromostandardsEndpoint(input: {
  endpointUrl: string;
  endpointName: string;
  endpointVersion: string;
  operationName: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  protocol?: MappingProtocol;
  metadata?: Record<string, unknown>;
}): Promise<PromostandardsEndpointCapability> {
  const result = await runPromostandardsEndpointProbe(input);
  return result.capability;
}

async function runPromostandardsEndpointProbe(input: {
  endpointUrl: string;
  endpointName: string;
  endpointVersion: string;
  operationName: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  protocol?: MappingProtocol;
  metadata?: Record<string, unknown>;
}): Promise<{
  capability: PromostandardsEndpointCapability;
  parsedBody: Record<string, unknown> | null;
  rawPayload: string;
}> {
  const protocol = normalizeProtocol(input.protocol);
  const adapter = resolveEndpointAdapter(protocol);
  const metadata = input.metadata ?? {};
  const baseCapability = {
    endpoint_name: input.endpointName,
    endpoint_version: input.endpointVersion,
    operation_name: input.operationName,
    capability_scope:
      typeof metadata.capability_scope === 'string'
        ? (metadata.capability_scope as 'catalog' | 'order')
        : (input.endpointName === 'CompanyData' ? 'catalog' : 'catalog'),
    lifecycle_role:
      typeof metadata.lifecycle_role === 'string'
        ? metadata.lifecycle_role
        : undefined,
    optional_by_vendor:
      typeof metadata.optional_by_vendor === 'boolean'
        ? metadata.optional_by_vendor
        : undefined,
    recommended_poll_minutes:
      typeof metadata.recommended_poll_minutes === 'number'
        ? metadata.recommended_poll_minutes
        : null,
  };

  try {
    let wsdlInspection: {
      available: boolean;
      statusCode: number | null;
      message: string;
    } | null = null;

    if (protocol === 'SOAP') {
      wsdlInspection = await inspectSoapWsdl({
        endpointUrl: input.endpointUrl,
        endpointName: input.endpointName,
        endpointVersion: input.endpointVersion,
        operationName: input.operationName,
      });
    }

    const result = await adapter.invokeEndpoint({
      endpointUrl: input.endpointUrl,
      endpointName: input.endpointName,
      operationName: input.operationName,
      endpointVersion: input.endpointVersion,
      vendorAccountId: input.vendorAccountId ?? null,
      vendorSecret: input.vendorSecret ?? null,
      runtimeConfig: {},
    });

    const classified = classifyPromostandardsProbe({
      status: result.status,
      parsedBody: result.parsedBody,
      rawPayload: result.rawPayload,
    });

    return {
      capability: {
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
        resolved_endpoint_url: input.endpointUrl,
        custom_endpoint_url: null,
      },
      parsedBody: result.parsedBody,
      rawPayload: result.rawPayload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Endpoint probe failed';
    return {
      capability: {
        ...baseCapability,
        available: false,
        status_code: null,
        message,
        wsdl_available: null,
        credentials_valid: null,
        live_probe_message: null,
        resolved_endpoint_url: input.endpointUrl,
        custom_endpoint_url: null,
      },
      parsedBody: null,
      rawPayload: '',
    };
  }
}

function toCapabilityProbes(mappings: Awaited<ReturnType<typeof listEndpointMappings>>): CapabilityProbe[] {
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
  const endpoints: PromostandardsEndpointCapability[] = [];
  let credentialsValid: boolean | null = null;
  const resolvedEndpointUrls = new Map<string, string>();

  for (const probe of probes) {
    const endpointUrl =
      resolvedEndpointUrls.get(lookupKey(probe.endpoint_name, probe.endpoint_version)) ??
      input.vendor_api_url ??
      '';
    const probeResult = await runPromostandardsEndpointProbe({
      endpointUrl,
      endpointName: probe.endpoint_name,
      endpointVersion: probe.endpoint_version,
      operationName: probe.operation_name,
      vendorAccountId: input.vendor_account_id ?? null,
      vendorSecret: input.vendor_secret ?? null,
      protocol,
      metadata: probe.metadata,
    });
    const capability = probeResult.capability;

    if (probe.endpoint_name === 'CompanyData') {
      mergeResolvedEndpointUrls(
        resolvedEndpointUrls,
        extractResolvedEndpointUrls({
          payload: probeResult.parsedBody,
          probes,
        }),
      );
    }

    if (capability.credentials_valid === true) {
      credentialsValid = true;
    } else if (credentialsValid !== true && capability.credentials_valid === false) {
      credentialsValid = false;
    }

    endpoints.push({
      ...capability,
      resolved_endpoint_url: resolvedEndpointUrls.get(lookupKey(probe.endpoint_name, probe.endpoint_version)) ?? capability.resolved_endpoint_url ?? null,
    });
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
  const hasManualEndpointOverride = (endpoint: Pick<PromostandardsCapabilityMatrix['endpoints'][number], 'custom_endpoint_url'>) =>
    typeof endpoint.custom_endpoint_url === 'string' && endpoint.custom_endpoint_url.trim().length > 0;

  const selectedByOperation = new Map<
    string,
    {
      endpoint_name: string;
      endpoint_version: string;
      operation_name: string;
      custom_endpoint_url?: string | null;
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
        custom_endpoint_url: endpoint.custom_endpoint_url ?? null,
      });
      continue;
    }

    const nextHasManualOverride = hasManualEndpointOverride(endpoint);
    const existingHasManualOverride = hasManualEndpointOverride(existingSelection);
    if (
      (nextHasManualOverride && !existingHasManualOverride) ||
      (nextHasManualOverride === existingHasManualOverride &&
        compareEndpointVersions(endpoint.endpoint_version, existingSelection.endpoint_version) > 0)
    ) {
      selectedByOperation.set(selectionKey, {
        endpoint_name: endpoint.endpoint_name,
        endpoint_version: endpoint.endpoint_version,
        operation_name: endpoint.operation_name,
        custom_endpoint_url: endpoint.custom_endpoint_url ?? null,
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

  const mappings = await findMappingsByEndpointOperations(
    uniqueSelections.map(selection => ({
      endpoint_name: selection.endpoint_name,
      endpoint_version: selection.endpoint_version,
      operation_name: selection.operation_name,
    })),
  );
  return mappings.map(mapping => mapping.mapping_id);
}

export function isPromostandardsCapabilityMatrixCurrent(
  capabilities: PromostandardsCapabilityMatrix | undefined,
  input: DiscoveryInput,
): boolean {
  if (!capabilities) return false;
  return capabilities.fingerprint === buildPromostandardsConnectionFingerprint(input);
}
