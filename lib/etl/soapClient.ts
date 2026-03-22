import { XMLParser } from 'fast-xml-parser';
import { recordApiExchange } from '../apiTelemetry';

export interface SoapCallOptions {
  endpointUrl: string;
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
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
});
const wsdlMetadataCache = new Map<string, Promise<SoapOperationMetadata | null>>();

function normalizeEndpointSegment(endpointName: string): string {
  return endpointName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export function resolveSoapEndpointUrl(options: {
  endpointUrl: string;
  endpointName: string;
  endpointVersion: string;
}): string {
  const url = new URL(options.endpointUrl);
  const normalizedEndpoint = normalizeEndpointSegment(options.endpointName);
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  const segments = trimmedPath.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  const secondLastSegment = segments[segments.length - 2];

  if (lastSegment === options.endpointVersion && secondLastSegment === normalizedEndpoint) {
    return url.toString();
  }

  if (lastSegment === normalizedEndpoint) {
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

async function loadSoapOperationMetadata(options: {
  resolvedEndpointUrl: string;
  operationName: string;
}): Promise<SoapOperationMetadata | null> {
  const cacheKey = `${options.resolvedEndpointUrl}|${options.operationName}`;
  const cached = wsdlMetadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const response = await fetch(`${options.resolvedEndpointUrl}?wsdl`, {
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
  const namespaceAttribute = namespace === 'urn:PromoStandards'
    ? 'xmlns:urn="urn:PromoStandards"'
    : `xmlns:tns="${namespace}"`;
  const namespacePrefix = namespace === 'urn:PromoStandards' ? 'urn' : 'tns';
  const childElementPrefix = namespace === 'urn:PromoStandards' ? 'urn' : undefined;

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ${namespaceAttribute}>
  <soapenv:Header/>
  <soapenv:Body>
    <${namespacePrefix}:${bodyElementName}>
      ${serializeRequestFields(mergedFields, { elementPrefix: childElementPrefix })}
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
  const resolvedEndpointUrl = resolveSoapEndpointUrl(options);
  const operationMetadata = options.requestTemplate
    ? null
    : await loadSoapOperationMetadata({
        resolvedEndpointUrl,
        operationName: options.operationName,
      }).catch(() => null);
  const envelope = buildSoapEnvelope(options, operationMetadata);

  try {
    const response = await fetch(resolvedEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: options.soapAction ?? options.operationName,
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
      action: `${options.operationName}:${options.endpointVersion}`,
      status: response.status,
      request: {
        endpoint_version: options.endpointVersion,
        operation_name: options.operationName,
        soap_action: options.soapAction ?? options.operationName,
        request_fields: options.requestFields ?? {},
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
      action: `${options.operationName}:${options.endpointVersion}`,
      request: {
        endpoint_version: options.endpointVersion,
        operation_name: options.operationName,
        soap_action: options.soapAction ?? options.operationName,
        request_fields: options.requestFields ?? {},
        envelope,
      },
      error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
