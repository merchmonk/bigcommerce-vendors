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
  companyDataEndpointUrl?: string | null;
  endpoints?: Array<{
    endpointName: string;
    endpointVersion?: string | null;
    endpointUrl?: string | null;
  }>;
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
    'unable to process',
    'InternalServiceFault',
    'internal error',
    'a:InternalServiceFault',
    'request was malformed',
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
  if (validationPatterns.some(pattern => normalized.includes(pattern)) || validationPatterns.some(pattern => input.rawPayload?.includes(pattern))) {
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
    if (url.search.toLowerCase().includes('wsdl')) {
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
  endpointUrlIsFinal?: boolean;
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
    endpointUrlIsFinal: input.endpointUrlIsFinal,
    endpointName: input.endpointName,
    endpointVersion: input.endpointVersion,
  })}`;

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
  endpointUrlIsFinal?: boolean;
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
  endpointUrlIsFinal?: boolean;
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
    endpointName: input.endpointName,
    endpointVersion: input.endpointVersion,
    endpointUrl: input.endpointUrl,
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
        endpointUrlIsFinal: input.endpointUrlIsFinal,
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
      runtimeConfig: input.endpointUrlIsFinal ? { endpoint_url: input.endpointUrl } : {},
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
        versionDetectionStatus: 'detected_from_wsdl' as const,
        requiresManualVersionSelection: false,
        availableVersions: [],
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
        versionDetectionStatus: 'failed' as const,
        requiresManualVersionSelection: false,
        availableVersions: [],
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
    company_data_endpoint_url: input.companyDataEndpointUrl ?? '',
    endpoints: (input.endpoints ?? []).map(endpoint => ({
      endpointName: endpoint.endpointName,
      endpointVersion: endpoint.endpointVersion ?? '',
      endpointUrl: endpoint.endpointUrl ?? '',
    })),
  }));
  return hash.digest('hex');
}

export async function discoverPromostandardsCapabilities(
  input: DiscoveryInput,
): Promise<{
  ok: boolean;
  message: string;
  availableEndpointCount: number;
  credentialsValid: boolean | null;
  fingerprint: string;
  testedAt: string;
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
    const resolvedEndpointUrl = resolvedEndpointUrls.get(lookupKey(probe.endpoint_name, probe.endpoint_version));
    const endpointUrl =
      probe.endpoint_name === 'CompanyData'
        ? input.companyDataEndpointUrl ?? input.vendor_api_url ?? ''
        : resolvedEndpointUrl ?? input.vendor_api_url ?? '';
    const probeResult = await runPromostandardsEndpointProbe({
      endpointUrl,
      endpointUrlIsFinal:
        Boolean(resolvedEndpointUrl) ||
        (probe.endpoint_name === 'CompanyData' && Boolean(input.companyDataEndpointUrl)),
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
      endpointUrl: resolvedEndpointUrls.get(lookupKey(probe.endpoint_name, probe.endpoint_version)) ?? capability.endpointUrl,
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
    availableEndpointCount,
    credentialsValid,
    fingerprint: buildPromostandardsConnectionFingerprint(input),
    testedAt: new Date().toISOString(),
    endpoints,
  };
}

export async function resolvePromostandardsCapabilityMappings(
  capabilities: Pick<PromostandardsCapabilityMatrix, 'endpoints'>,
): Promise<number[]> {
  const selections = capabilities.endpoints
    .filter(endpoint => endpoint.available && !!endpoint.endpointVersion)
    .map(endpoint => ({
      endpointName: endpoint.endpointName,
      endpointVersion: endpoint.endpointVersion!,
    }))
    .filter(
      (endpoint, index, values) =>
        values.findIndex(
          value =>
            value.endpointName === endpoint.endpointName &&
            value.endpointVersion === endpoint.endpointVersion,
        ) === index,
    );

  if (selections.length === 0) {
    return [];
  }

  const mappingIdSet = new Set<number>();
  for (const selection of selections) {
    const mappings = await listEndpointMappings({
      standard_type: 'PROMOSTANDARDS',
      endpoint_name: selection.endpointName,
      endpoint_version: selection.endpointVersion,
    });
    mappings.forEach(mapping => mappingIdSet.add(mapping.endpoint_mapping_id));
  }

  return Array.from(mappingIdSet).sort((left, right) => left - right);
}

export function isPromostandardsCapabilityMatrixCurrent(
  capabilities: PromostandardsCapabilityMatrix | undefined,
  input: DiscoveryInput,
): boolean {
  if (!capabilities) return false;
  return capabilities.fingerprint === buildPromostandardsConnectionFingerprint(input);
}

interface PromostandardsEndpointDefinition {
  endpointName: string;
  versions: string[];
  representativeOperationByVersion: Record<string, string>;
}

function normalizeEndpointRows(
  endpoints: PromostandardsEndpointCapability[],
): PromostandardsEndpointCapability[] {
  return endpoints.sort((left, right) => left.endpointName.localeCompare(right.endpointName));
}

export async function listPromostandardsEndpointDefinitions(
  protocol: MappingProtocol = 'SOAP',
): Promise<PromostandardsEndpointDefinition[]> {
  const mappings = await listEndpointMappings({
    standard_type: 'PROMOSTANDARDS',
    protocol,
  });
  const grouped = new Map<string, { versions: string[]; representativeOperationByVersion: Record<string, string> }>();

  for (const mapping of mappings) {
    const existing = grouped.get(mapping.endpoint_name) ?? {
      versions: [],
      representativeOperationByVersion: {},
    };
    if (!existing.versions.includes(mapping.endpoint_version)) {
      existing.versions.push(mapping.endpoint_version);
      existing.versions.sort(compareEndpointVersions);
    }
    if (!existing.representativeOperationByVersion[mapping.endpoint_version]) {
      existing.representativeOperationByVersion[mapping.endpoint_version] = mapping.operation_name;
    }
    grouped.set(mapping.endpoint_name, existing);
  }

  return Array.from(grouped.entries())
    .map(([endpointName, value]) => ({
      endpointName,
      versions: value.versions.sort(compareEndpointVersions),
      representativeOperationByVersion: value.representativeOperationByVersion,
    }))
    .sort((left, right) => left.endpointName.localeCompare(right.endpointName));
}

export function detectPromostandardsEndpointVersionFromUrl(
  endpointUrl: string,
  supportedVersions: string[],
): string | null {
  const normalizedUrl = endpointUrl.toLowerCase();
  const matches = supportedVersions.filter(version => normalizedUrl.includes(version.toLowerCase()));
  if (matches.length === 0) {
    const versionTokens = Array.from(
      normalizedUrl.matchAll(/(?:^|[^a-z0-9])v(\d+(?:[._-]\d+){0,2})(?:[^a-z0-9]|$)/g),
      match => match[1]?.replace(/[._-]/g, '.') ?? '',
    ).filter(Boolean);

    for (const token of versionTokens) {
      const exactTokenMatch = supportedVersions.filter(version => version === token);
      if (exactTokenMatch.length > 0) {
        return exactTokenMatch.sort(compareEndpointVersions).at(-1) ?? null;
      }

      const prefixTokenMatch = supportedVersions.filter(version => version.startsWith(`${token}.`));
      if (prefixTokenMatch.length === 1) {
        return prefixTokenMatch[0] ?? null;
      }

      const tokenMajor = token.split('.')[0] ?? '';
      if (!token.includes('.') && tokenMajor) {
        const majorMatches = supportedVersions.filter(version => version.split('.')[0] === tokenMajor);
        if (majorMatches.length === 1) {
          return majorMatches[0] ?? null;
        }
      }
    }

    return null;
  }

  return matches.sort(compareEndpointVersions).at(-1) ?? null;
}

async function detectPromostandardsEndpointVersionFromWsdl(
  endpointUrl: string,
  supportedVersions: string[],
): Promise<string | null> {
  try {
    const response = await fetch(`${endpointUrl}?wsdl`, {
      method: 'GET',
      headers: {
        Accept: 'text/xml, application/wsdl+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!response.ok) {
      return null;
    }

    const rawXml = await response.text();
    const matches = extractVersionCandidates([rawXml]).filter(version => supportedVersions.includes(version));
    if (matches.length === 0) {
      return null;
    }

    return matches.sort(compareEndpointVersions).at(-1) ?? null;
  } catch {
    return null;
  }
}

export async function testPromostandardsEndpointUrls(input: {
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  protocol?: MappingProtocol;
  endpoints: Array<{
    endpointName: string;
    endpointUrl?: string | null;
    endpointVersion?: string | null;
  }>;
}): Promise<{
  ok: boolean;
  message: string;
  availableEndpointCount: number;
  credentialsValid: boolean | null;
  endpoints: PromostandardsEndpointCapability[];
  endpointMappingIds: number[];
}> {
  const protocol = normalizeProtocol(input.protocol);
  const definitions = await listPromostandardsEndpointDefinitions(protocol);
  const endpointRows: PromostandardsEndpointCapability[] = [];
  let credentialsValid: boolean | null = null;

  for (const inputEndpoint of input.endpoints) {
    const definition = definitions.find(item => item.endpointName === inputEndpoint.endpointName);
    const availableVersions = definition?.versions ?? [];
    const endpointUrl = inputEndpoint.endpointUrl?.trim() ?? '';

    if (!endpointUrl || !definition) {
      endpointRows.push({
        endpointName: inputEndpoint.endpointName,
        endpointVersion: inputEndpoint.endpointVersion ?? null,
        endpointUrl,
        available: false,
        status_code: null,
        message: endpointUrl ? 'Unsupported PromoStandards endpoint.' : 'Endpoint URL is required.',
        wsdl_available: null,
        credentials_valid: null,
        live_probe_message: null,
        versionDetectionStatus: 'failed',
        requiresManualVersionSelection: Boolean(endpointUrl),
        availableVersions,
      });
      continue;
    }

    const detectedVersionFromUrl = detectPromostandardsEndpointVersionFromUrl(endpointUrl, availableVersions);
    // const detectedVersionFromWsdl = detectedVersionFromUrl ? null : await detectPromostandardsEndpointVersionFromWsdl(endpointUrl, availableVersions);
    const endpointVersion =
      inputEndpoint.endpointVersion ??
      detectedVersionFromUrl ??
      //detectedVersionFromWsdl ??
      null;

    if (!endpointVersion) {
      endpointRows.push({
        endpointName: inputEndpoint.endpointName,
        endpointVersion: null,
        endpointUrl,
        available: false,
        status_code: null,
        message: 'Version detection failed. Select a version and test again.',
        wsdl_available: null,
        credentials_valid: null,
        live_probe_message: null,
        versionDetectionStatus: 'failed',
        requiresManualVersionSelection: true,
        availableVersions,
      });
      continue;
    }

    const representativeOperation = definition.representativeOperationByVersion[endpointVersion];
    const probeResult = await probePromostandardsEndpoint({
      endpointUrl,
      endpointUrlIsFinal: true,
      endpointName: inputEndpoint.endpointName,
      endpointVersion,
      operationName: representativeOperation,
      vendorAccountId: input.vendorAccountId ?? null,
      vendorSecret: input.vendorSecret ?? null,
      protocol,
    });

    if (probeResult.credentials_valid === true) {
      credentialsValid = true;
    } else if (credentialsValid !== true && probeResult.credentials_valid === false) {
      credentialsValid = false;
    }

    endpointRows.push({
      ...probeResult,
      endpointVersion,
      endpointUrl,
      versionDetectionStatus: inputEndpoint.endpointVersion
        ? 'manual'
        : detectedVersionFromUrl
          ? 'detected_from_url'
          : 'detected_from_wsdl',
      requiresManualVersionSelection: false,
      availableVersions,
    });
  }

  const endpoints = normalizeEndpointRows(endpointRows);
  const availableEndpointCount = endpoints.filter(endpoint => endpoint.available).length;
  const endpointMappingIds = await resolvePromostandardsCapabilityMappings({
    endpoints,
  });

  return {
    ok: availableEndpointCount > 0 && credentialsValid !== false,
    message:
      availableEndpointCount > 0
        ? `Confirmed ${availableEndpointCount} PromoStandards endpoint${availableEndpointCount === 1 ? '' : 's'}.`
        : 'No supported PromoStandards endpoints were confirmed.',
    availableEndpointCount,
    credentialsValid,
    endpoints,
    endpointMappingIds,
  };
}

export async function discoverPromostandardsEndpointsFromCompanyData(input: {
  companyDataEndpointUrl: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  protocol?: MappingProtocol;
}): Promise<{
  ok: boolean;
  message: string;
  availableEndpointCount: number;
  credentialsValid: boolean | null;
  fingerprint: string;
  testedAt: string;
  endpoints: PromostandardsEndpointCapability[];
  endpointMappingIds: number[];
}> {
  const discovery = await discoverPromostandardsCapabilities({
    companyDataEndpointUrl: input.companyDataEndpointUrl,
    vendor_account_id: input.vendorAccountId ?? null,
    vendor_secret: input.vendorSecret ?? null,
    api_protocol: input.protocol,
  });

  const groupedByEndpoint = new Map<string, PromostandardsEndpointCapability>();
  for (const endpoint of discovery.endpoints.filter(item => item.available)) {
    const existing = groupedByEndpoint.get(endpoint.endpointName);
    if (!existing) {
      groupedByEndpoint.set(endpoint.endpointName, endpoint);
      continue;
    }

    if (
      endpoint.endpointVersion &&
      existing.endpointVersion &&
      compareEndpointVersions(endpoint.endpointVersion, existing.endpointVersion) > 0
    ) {
      groupedByEndpoint.set(endpoint.endpointName, endpoint);
    }
  }

  groupedByEndpoint.set('CompanyData', {
    endpointName: 'CompanyData',
    endpointVersion: '1.0.0',
    endpointUrl: input.companyDataEndpointUrl,
    available: true,
    status_code: 200,
    message: 'CompanyData endpoint confirmed.',
    wsdl_available: true,
    credentials_valid: discovery.credentialsValid ?? null,
    live_probe_message: null,
    versionDetectionStatus: 'manual',
    requiresManualVersionSelection: false,
    availableVersions: ['1.0.0'],
  });

  const endpoints = normalizeEndpointRows(Array.from(groupedByEndpoint.values()));
  const endpointMappingIds = await resolvePromostandardsCapabilityMappings({
    endpoints,
  });

  return {
    ok: endpoints.some(endpoint => endpoint.available),
    message: discovery.message,
    availableEndpointCount: endpoints.filter(endpoint => endpoint.available).length,
    credentialsValid: discovery.credentialsValid,
    fingerprint: discovery.fingerprint,
    testedAt: discovery.testedAt,
    endpoints,
    endpointMappingIds,
  };
}
