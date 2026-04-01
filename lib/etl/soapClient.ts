import { XMLParser } from 'fast-xml-parser';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { recordApiExchange } from '../apiTelemetry';

export interface SoapCallOptions {
  endpointUrl: string;
  endpointUrlIsFinal?: boolean;
  endpointName: string;
  operationName: string;
  endpointVersion: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  soapAction?: string;
  requestTemplate?: string;
  requestFields?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SoapCallResult {
  status: number;
  rawXml: string;
  parsedBody: Record<string, unknown> | null;
}

interface SoapOperationMetadata {
  requestElementName: string;
  targetNamespace: string;
  childElementNamespace?: string | null;
}

const BUILT_IN_SOAP_OPERATION_METADATA: Record<string, SoapOperationMetadata> = {
  'ProductData|1.0.0|getProduct': {
    requestElementName: 'GetProductRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/SharedObjects/',
  },
  'ProductData|1.0.0|getProductCloseOut': {
    requestElementName: 'GetProductCloseOutRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/SharedObjects/',
  },
  'ProductData|1.0.0|getProductDateModified': {
    requestElementName: 'GetProductDateModifiedRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/SharedObjects/',
  },
  'ProductData|1.0.0|getProductSellable': {
    requestElementName: 'GetProductSellableRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/1.0.0/SharedObjects/',
  },
  'ProductData|2.0.0|getProduct': {
    requestElementName: 'GetProductRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
  },
  'ProductData|2.0.0|getProductCloseOut': {
    requestElementName: 'GetProductCloseOutRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
  },
  'ProductData|2.0.0|getProductDateModified': {
    requestElementName: 'GetProductDateModifiedRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
  },
  'ProductData|2.0.0|getProductSellable': {
    requestElementName: 'GetProductSellableRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
  },
  'PricingAndConfiguration|1.0.0|getAvailableLocations': {
    requestElementName: 'GetAvailableLocationsRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
  },
  'PricingAndConfiguration|1.0.0|getDecorationColors': {
    requestElementName: 'GetDecorationColorsRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
  },
  'PricingAndConfiguration|1.0.0|getFobPoints': {
    requestElementName: 'GetFobPointsRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
  },
  'PricingAndConfiguration|1.0.0|getAvailableCharges': {
    requestElementName: 'GetAvailableChargesRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
  },
  'PricingAndConfiguration|1.0.0|getConfigurationAndPricing': {
    requestElementName: 'GetConfigurationAndPricingRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
  },
  'Inventory|2.0.0|getInventoryLevels': {
    requestElementName: 'GetInventoryLevelsRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/Inventory/2.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/Inventory/2.0.0/SharedObjects/',
  },
  'ProductMedia|1.0.0|getMediaContent': {
    requestElementName: 'GetMediaContentRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/SharedObjects/',
  },
  'ProductMedia|1.1.0|getMediaContent': {
    requestElementName: 'GetMediaContentRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/SharedObjects/',
  },
  'MediaContent|1.0.0|getMediaContent': {
    requestElementName: 'GetMediaContentRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/SharedObjects/',
  },
  'MediaContent|1.1.0|getMediaContent': {
    requestElementName: 'GetMediaContentRequest',
    targetNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/',
    childElementNamespace: 'http://www.promostandards.org/WSDL/MediaService/1.0.0/SharedObjects/',
  },
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
});
const wsdlMetadataCache = new Map<string, Promise<SoapOperationMetadata | null>>();
const promostandardsSchemaRoot = path.resolve(process.cwd(), 'promostandards');
const SOAP_ENDPOINT_SEGMENT_ALIASES: Record<string, string[]> = {
  PricingAndConfiguration: ['productpriceandconfiguration', 'ppc'],
};

function normalizeEndpointSegment(endpointName: string): string {
  return endpointName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function getEndpointSegmentCandidates(endpointName: string): string[] {
  const normalizedEndpoint = normalizeEndpointSegment(endpointName);
  return [...(SOAP_ENDPOINT_SEGMENT_ALIASES[endpointName] ?? []), normalizedEndpoint];
}

function getPreferredEndpointSegment(endpointName: string): string {
  return getEndpointSegmentCandidates(endpointName)[0] ?? normalizeEndpointSegment(endpointName);
}

function buildEndpointVersionTokens(endpointVersion: string): Set<string> {
  const normalizedVersion = endpointVersion.trim().toLowerCase();
  const majorVersion = normalizedVersion.split('.')[0] ?? '';
  const underscoreVersion = normalizedVersion.replace(/\./g, '_');
  const hyphenVersion = normalizedVersion.replace(/\./g, '-');

  return new Set([
    normalizedVersion,
    `v${normalizedVersion}`,
    underscoreVersion,
    `v${underscoreVersion}`,
    hyphenVersion,
    `v${hyphenVersion}`,
    majorVersion,
    `v${majorVersion}`,
  ].filter(Boolean));
}

function hasExplicitServiceEndpointPath(options: {
  segments: string[];
  endpointSegments: string[];
  endpointVersion: string;
}): boolean {
  const lowerSegments = options.segments.map(segment => segment.toLowerCase());
  const lastSegment = lowerSegments[lowerSegments.length - 1] ?? '';
  const hasEndpointReference = lowerSegments.some(
    segment =>
      options.endpointSegments.some(
        endpointSegment => segment === endpointSegment || segment.includes(endpointSegment),
      ),
  );
  const hasVersionToken = lowerSegments.some(segment => buildEndpointVersionTokens(options.endpointVersion).has(segment));
  const lastLooksLikeServiceTarget =
    lastSegment.includes('service') ||
    lastSegment.endsWith('.svc') ||
    lastSegment.endsWith('.asmx') ||
    lastSegment === 'soap';

  return hasEndpointReference && (hasVersionToken || lastLooksLikeServiceTarget);
}

export function resolveSoapOperationName(options: {
  endpointName: string;
  operationName: string;
}): string {
  if (
    options.endpointName === 'ProductCompliance' &&
    options.operationName.trim() === 'getComplianceData'
  ) {
    return 'getCompliance';
  }

  return options.operationName.trim();
}

export function resolveSoapEndpointUrl(options: {
  endpointUrl: string;
  endpointUrlIsFinal?: boolean;
  endpointName: string;
  endpointVersion: string;
}): string {
  if (options.endpointUrlIsFinal) {
    return options.endpointUrl;
  }

  const url = new URL(options.endpointUrl);
  const normalizedEndpoint = getPreferredEndpointSegment(options.endpointName);
  const endpointSegments = getEndpointSegmentCandidates(options.endpointName);
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  const segments = trimmedPath.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  const secondLastSegment = segments[segments.length - 2];

  if (segments.includes(options.endpointVersion) && segments.length > 0) {
    return url.toString();
  }

  if (hasExplicitServiceEndpointPath({
    segments,
    endpointSegments,
    endpointVersion: options.endpointVersion,
  })) {
    return url.toString();
  }

  if (
    lastSegment === options.endpointVersion &&
    endpointSegments.includes((secondLastSegment ?? '').toLowerCase())
  ) {
    return url.toString();
  }

  if (endpointSegments.includes((lastSegment ?? '').toLowerCase())) {
    url.pathname = `${trimmedPath}/${options.endpointVersion}`;
    return url.toString();
  }

  url.pathname = `${trimmedPath}/${normalizedEndpoint}/${options.endpointVersion}`.replace(/\/+/g, '/');
  return url.toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeLookupToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function getBuiltInSoapOperationMetadata(options: {
  endpointName: string;
  endpointVersion: string;
  operationName: string;
}): SoapOperationMetadata | null {
  const key = `${options.endpointName}|${options.endpointVersion}|${options.operationName}`;
  return BUILT_IN_SOAP_OPERATION_METADATA[key] ?? null;
}

async function findPromostandardsFile(options: {
  fileName: string;
  endpointName: string;
  endpointVersion: string;
}): Promise<string | null> {
  async function walk(dirPath: string): Promise<string[]> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const matches: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        matches.push(...(await walk(entryPath)));
        continue;
      }

      if (entry.isFile() && entry.name === options.fileName) {
        matches.push(entryPath);
      }
    }

    return matches;
  }

  const matches = await walk(promostandardsSchemaRoot);
  if (matches.length === 0) {
    return null;
  }

  const normalizedEndpoint = normalizeLookupToken(options.endpointName);
  const normalizedVersion = normalizeLookupToken(options.endpointVersion);

  const scoredMatches = matches
    .map(filePath => {
      const normalizedPath = normalizeLookupToken(filePath);
      const score =
        (normalizedPath.includes(normalizedEndpoint) ? 4 : 0) +
        (normalizedPath.includes(normalizedVersion) ? 2 : 0);

      return { filePath, score };
    })
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  return scoredMatches[0]?.filePath ?? null;
}

function serializeSoapField(name: string, value: unknown, elementPrefix?: string): string {
  const tagName = elementPrefix ? `${elementPrefix}:${name}` : name;

  if (value === undefined || value === null) return '';

  if (Array.isArray(value)) {
    return value.map(item => serializeSoapField(name, item, elementPrefix)).join('');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = Object.entries(record)
      .map(([nestedName, nestedValue]) => serializeSoapField(nestedName, nestedValue, elementPrefix))
      .join('');
    return `<${tagName}>${nested}</${tagName}>`;
  }

  if (typeof value === 'boolean') {
    return `<${tagName}>${value ? 'true' : 'false'}</${tagName}>`;
  }

  return `<${tagName}>${escapeXml(String(value))}</${tagName}>`;
}

function serializeRequestFields(
  fields: Record<string, unknown> | undefined,
  options?: { elementPrefix?: string },
): string {
  if (!fields) return '';

  return Object.entries(fields)
    .map(([name, value]) => serializeSoapField(name, value, options?.elementPrefix))
    .join('');
}

function parseSoapOperationMetadata(rawWsdl: string, operationName: string): SoapOperationMetadata | null {
  const targetNamespaceMatch = rawWsdl.match(/targetNamespace="([^"]+)"/);
  const targetNamespace = targetNamespaceMatch?.[1];
  if (!targetNamespace) {
    return null;
  }

  const operationExpression = new RegExp(
    `<wsdl:operation name="${operationName}">[\\s\\S]*?<wsdl:input message="tns:([^"]+)"`,
  );
  const operationMatch = rawWsdl.match(operationExpression);
  const messageName = operationMatch?.[1];
  if (!messageName) {
    return null;
  }

  const messageExpression = new RegExp(
    `<wsdl:message name="${messageName}">[\\s\\S]*?element="tns:([^"]+)"`,
  );
  const messageMatch = rawWsdl.match(messageExpression);
  const requestElementName = messageMatch?.[1];
  if (!requestElementName) {
    return null;
  }

  return {
    requestElementName,
    targetNamespace,
  };
}

async function loadLocalSoapOperationMetadata(options: {
  operationName: string;
  endpointName: string;
  endpointVersion: string;
}): Promise<SoapOperationMetadata | null> {
  const wsdlPath = await findPromostandardsFile({
    fileName: `${options.endpointName === 'ProductCompliance' ? 'productCompliance' : options.endpointName}Service.wsdl`,
    endpointName: options.endpointName,
    endpointVersion: options.endpointVersion,
  });
  if (!wsdlPath) {
    return null;
  }

  const rawWsdl = await fs.readFile(wsdlPath, 'utf8');
  return parseSoapOperationMetadata(rawWsdl, options.operationName);
}

async function loadChildElementNamespace(options: {
  endpointName: string;
  endpointVersion: string;
  requestElementName: string;
}): Promise<string | null> {
  const schemaPath = await findPromostandardsFile({
    fileName: `${options.requestElementName}.xsd`,
    endpointName: options.endpointName,
    endpointVersion: options.endpointVersion,
  });
  if (!schemaPath) {
    return null;
  }

  const rawSchema = await fs.readFile(schemaPath, 'utf8');
  const sharedNamespaceMatch = rawSchema.match(/<xsd:import namespace="([^"]+\/SharedObjects\/)"/i);
  const sharedNamespace = sharedNamespaceMatch?.[1];
  if (!sharedNamespace) {
    return null;
  }

  const prefixMatches = Array.from(
    rawSchema.matchAll(new RegExp(`xmlns:([A-Za-z0-9_]+)="${sharedNamespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')),
  );
  if (prefixMatches.length === 0) {
    return null;
  }

  const usesSharedNamespace = prefixMatches.some(match => {
    const prefix = match[1];
    return rawSchema.includes(`ref="${prefix}:`) || rawSchema.includes(`type="${prefix}:`);
  });

  return usesSharedNamespace ? sharedNamespace : null;
}

async function loadSoapOperationMetadata(options: {
  resolvedEndpointUrl: string;
  operationName: string;
  endpointName: string;
  endpointVersion: string;
}): Promise<SoapOperationMetadata | null> {
  const cacheKey = `${options.resolvedEndpointUrl}|${options.operationName}`;
  const cached = wsdlMetadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const wsdlUrl = `http://www.promostandards.org/WSDL/${options.endpointName}/${options.endpointVersion}/`;

  const pending = (async () => {
    const builtInMetadata = getBuiltInSoapOperationMetadata(options);
    if (builtInMetadata) {
      return builtInMetadata;
    }

    const localMetadata = await loadLocalSoapOperationMetadata(options).catch(() => null);
    const parsedMetadata =
      localMetadata ??
      (await (async () => {
    const response = await fetch(wsdlUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/xml, application/wsdl+xml, application/xml;q=0.9, */*;q=0.8',
      },
    });
    if (!response.ok) {
      return null;
    }

    const rawWsdl = await response.text();
    if (!rawWsdl.includes('<wsdl:definitions')) {
      return null;
    }

    return parseSoapOperationMetadata(rawWsdl, options.operationName);
      })().catch(() => null));

    if (!parsedMetadata) {
      return null;
    }

    const childElementNamespace = await loadChildElementNamespace({
      endpointName: options.endpointName,
      endpointVersion: options.endpointVersion,
      requestElementName: parsedMetadata.requestElementName,
    }).catch(() => null);

    return {
      ...parsedMetadata,
      childElementNamespace,
    };
  })();

  wsdlMetadataCache.set(cacheKey, pending);
  return pending;
}

export function buildSoapEnvelope(
  options: SoapCallOptions,
  metadata?: SoapOperationMetadata | null,
): string {
  if (options.requestTemplate) {
    const requestFieldsJson = JSON.stringify(options.requestFields ?? {});
    return options.requestTemplate
      .replaceAll('{{operationName}}', options.operationName)
      .replaceAll('{{endpointVersion}}', options.endpointVersion)
      .replaceAll('{{vendorAccountId}}', escapeXml(options.vendorAccountId ?? ''))
      .replaceAll('{{vendorSecret}}', escapeXml(options.vendorSecret ?? ''))
      .replaceAll('{{requestFieldsJson}}', requestFieldsJson);
  }

  const mergedFields: Record<string, unknown> = {
    wsVersion: options.endpointVersion,
    id: options.vendorAccountId ?? '',
    password: options.vendorSecret ?? '',
    ...(options.requestFields ?? {}),
  };
  const bodyElementName = metadata?.requestElementName ?? options.operationName;
  const namespace = metadata?.targetNamespace ?? 'urn:PromoStandards';
  const childNamespace = metadata?.childElementNamespace ?? null;
  const namespaceAttribute =
    namespace === 'urn:PromoStandards'
      ? 'xmlns:urn="urn:PromoStandards"'
      : [ `xmlns:tns="${namespace}"`, childNamespace ? `xmlns:sh="${childNamespace}"` : '' ]
          .filter(Boolean)
          .join(' ');
  const namespacePrefix = namespace === 'urn:PromoStandards' ? 'urn' : 'tns';
  const childElementPrefix = namespace === 'urn:PromoStandards' ? 'urn' : undefined;
  const variableElementPrefix = childNamespace ? 'sh' : childElementPrefix;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ${namespaceAttribute}>
  <soapenv:Header/>
  <soapenv:Body>
    <${namespacePrefix}:${bodyElementName}>
      ${serializeRequestFields(mergedFields, { elementPrefix: variableElementPrefix })}
    </${namespacePrefix}:${bodyElementName}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractSoapBody(parsed: Record<string, unknown>): Record<string, unknown> | null {
  const envelope =
    (parsed.Envelope as Record<string, unknown> | undefined) ??
    (parsed['soap:Envelope'] as Record<string, unknown> | undefined);
  if (!envelope) return null;

  const body =
    (envelope.Body as Record<string, unknown> | undefined) ??
    (envelope['soap:Body'] as Record<string, unknown> | undefined);
  if (!body) return null;

  return body;
}

export async function callSoapEndpoint(options: SoapCallOptions): Promise<SoapCallResult> {
  const normalizedOperationName = resolveSoapOperationName({
    endpointName: options.endpointName,
    operationName: options.operationName,
  });
  const normalizedOptions: SoapCallOptions = {
    ...options,
    operationName: normalizedOperationName,
    soapAction: options.soapAction ?? normalizedOperationName,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizedOptions.timeoutMs ?? 45000);
  const resolvedEndpointUrl = resolveSoapEndpointUrl(normalizedOptions);
  const operationMetadata = normalizedOptions.requestTemplate
    ? null
    : await loadSoapOperationMetadata({
        resolvedEndpointUrl,
        operationName: normalizedOperationName,
        endpointName: normalizedOptions.endpointName,
        endpointVersion: normalizedOptions.endpointVersion,
      }).catch(() => null);
  const envelope = buildSoapEnvelope(normalizedOptions, operationMetadata);

  try {
    const response = await fetch(resolvedEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: normalizedOptions.soapAction ?? normalizedOperationName,
      },
      body: envelope,
      signal: controller.signal,
    });

    const rawXml = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      const parsed = parser.parse(rawXml) as Record<string, unknown>;
      parsedBody = extractSoapBody(parsed);
    } catch {
      parsedBody = null;
    }

    await recordApiExchange({
      category: 'vendor-api',
      target: resolvedEndpointUrl,
      method: 'POST',
      action: `${normalizedOperationName}:${normalizedOptions.endpointVersion}`,
      status: response.status,
      request: {
        endpoint_version: normalizedOptions.endpointVersion,
        operation_name: normalizedOperationName,
        soap_action: normalizedOptions.soapAction ?? normalizedOperationName,
        request_fields: normalizedOptions.requestFields ?? {},
        envelope,
      },
      response: {
        raw_xml: rawXml,
        parsed_body: parsedBody ?? {},
      },
    });

    return {
      status: response.status,
      rawXml,
      parsedBody,
    };
  } catch (error) {
    await recordApiExchange({
      category: 'vendor-api',
      target: resolvedEndpointUrl,
      method: 'POST',
      action: `${normalizedOperationName}:${normalizedOptions.endpointVersion}`,
      request: {
        endpoint_version: normalizedOptions.endpointVersion,
        operation_name: normalizedOperationName,
        soap_action: normalizedOptions.soapAction ?? normalizedOperationName,
        request_fields: normalizedOptions.requestFields ?? {},
        envelope,
      },
      error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
