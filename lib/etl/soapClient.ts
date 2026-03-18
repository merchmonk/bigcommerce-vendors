import { XMLParser } from 'fast-xml-parser';

export interface SoapCallOptions {
  endpointUrl: string;
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
});

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function serializeSoapField(name: string, value: unknown): string {
  if (value === undefined || value === null) return '';

  if (Array.isArray(value)) {
    return value.map(item => serializeSoapField(name, item)).join('');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = Object.entries(record)
      .map(([nestedName, nestedValue]) => serializeSoapField(nestedName, nestedValue))
      .join('');
    return `<urn:${name}>${nested}</urn:${name}>`;
  }

  if (typeof value === 'boolean') {
    return `<urn:${name}>${value ? 'true' : 'false'}</urn:${name}>`;
  }

  return `<urn:${name}>${escapeXml(String(value))}</urn:${name}>`;
}

function serializeRequestFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return '';

  return Object.entries(fields)
    .map(([name, value]) => serializeSoapField(name, value))
    .join('');
}

function buildSoapEnvelope(options: SoapCallOptions): string {
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:PromoStandards">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:${options.operationName}>
      ${serializeRequestFields(mergedFields)}
    </urn:${options.operationName}>
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
  const envelope = buildSoapEnvelope(options);

  try {
    const response = await fetch(options.endpointUrl, {
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

    return {
      status: response.status,
      rawXml,
      parsedBody,
    };
  } finally {
    clearTimeout(timeout);
  }
}
