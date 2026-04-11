import { recordApiExchange } from '../apiTelemetry';

export interface BigCommerceCatalogResponse<T> {
  data: T;
}

export interface BigCommerceCatalogListResponse<T> extends BigCommerceCatalogResponse<T[]> {}

export function buildApiBase(storeHash: string): string {
  return `https://api.bigcommerce.com/stores/${storeHash}/v3`;
}

export function buildApiV2Base(storeHash: string): string {
  return `https://api.bigcommerce.com/stores/${storeHash}/v2`;
}

export function createHeaders(accessToken: string): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Auth-Token': accessToken,
  };
}

function toTelemetryAction(errorMessage: string): string {
  const trimmed = errorMessage.trim();
  if (!trimmed) {
    return 'BigCommerce API request';
  }

  return trimmed.replace(/^Failed to\s+/i, '');
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function requestJson<T>(
  accessToken: string,
  url: string,
  options: RequestInit,
  errorMessage: string,
): Promise<T> {
  const telemetryAction = toTelemetryAction(errorMessage);
  const headers = {
    ...createHeaders(accessToken),
    ...(options.headers ?? {}),
  };
  const controller = new AbortController();
  const timeoutMs = Number(process.env.BIGCOMMERCE_API_TIMEOUT_MS ?? 45000);
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      await recordApiExchange({
        category: 'bigcommerce-api',
        target: url,
        method: options.method ?? 'GET',
        action: telemetryAction,
        status: response.status,
        request: {
          headers,
          body: typeof options.body === 'string' ? options.body : undefined,
        },
        response: {
          body: errorBody,
        },
      });
      throw new Error(`${errorMessage} (${response.status}): ${errorBody}`);
    }

    if (response.status === 204) {
      await recordApiExchange({
        category: 'bigcommerce-api',
        target: url,
        method: options.method ?? 'GET',
        action: telemetryAction,
        status: response.status,
        request: {
          headers,
          body: typeof options.body === 'string' ? options.body : undefined,
        },
        response: {},
      });
      return {} as T;
    }

    const parsed = await parseJson<T>(response);
    await recordApiExchange({
      category: 'bigcommerce-api',
      target: url,
      method: options.method ?? 'GET',
      action: telemetryAction,
      status: response.status,
      request: {
        headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      },
      response: parsed as Record<string, unknown>,
    });
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(errorMessage)) {
      throw error;
    }

    await recordApiExchange({
      category: 'bigcommerce-api',
      target: url,
      method: options.method ?? 'GET',
      action: telemetryAction,
      request: {
        headers,
        body: typeof options.body === 'string' ? options.body : undefined,
      },
      error,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
