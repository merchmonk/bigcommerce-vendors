import type { IncomingHttpHeaders } from 'node:http';
import { requestJson } from '../etl/bigcommerceApi';
import logger from '../logger';

interface BigCommerceWebhookRecord {
  id: number;
  scope: string;
  destination: string;
  is_active: boolean;
  headers?: Record<string, string> | null;
}

const ORDER_WEBHOOK_SCOPES = ['store/order/created', 'store/order/updated'] as const;

function readHeader(headers: IncomingHttpHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function resolveAppBaseUrl(headers?: IncomingHttpHeaders): string | undefined {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const authCallback = process.env.AUTH_CALLBACK?.trim();
  if (authCallback) {
    return authCallback.replace(/\/api\/auth\/?$/, '').replace(/\/+$/, '');
  }

  const host = readHeader(headers, 'x-forwarded-host') ?? readHeader(headers, 'host');
  if (!host) return undefined;

  const protocol = readHeader(headers, 'x-forwarded-proto') ?? 'https';
  return `${protocol}://${host}`.replace(/\/+$/, '');
}

function getWebhookHeaders(): Record<string, string> | undefined {
  const sharedToken = process.env.PRODUCT_PLATFORM_SHARED_TOKEN?.trim();
  if (!sharedToken) {
    return undefined;
  }

  return {
    'x-product-platform-token': sharedToken,
  };
}

export async function ensureBigCommerceOrderWebhooks(input: {
  accessToken: string;
  storeHash: string;
  headers?: IncomingHttpHeaders;
}): Promise<{ destination?: string; ensured_scopes: string[] }> {
  const destinationBaseUrl = resolveAppBaseUrl(input.headers);
  const webhookHeaders = getWebhookHeaders();

  if (!destinationBaseUrl || !webhookHeaders) {
    logger.warn('skipping BigCommerce order webhook ensure because webhook configuration is incomplete', {
      hasDestinationBaseUrl: !!destinationBaseUrl,
      hasWebhookHeaders: !!webhookHeaders,
    });
    return {
      ensured_scopes: [],
      ...(destinationBaseUrl ? { destination: `${destinationBaseUrl}/api/webhooks/bigcommerce/orders` } : {}),
    };
  }

  const destination = `${destinationBaseUrl}/api/webhooks/bigcommerce/orders`;
  const existing = await requestJson<{ data: BigCommerceWebhookRecord[] }>(
    input.accessToken,
    `https://api.bigcommerce.com/stores/${input.storeHash}/v3/hooks`,
    { method: 'GET' },
    'Failed to list BigCommerce webhooks',
  );

  const ensuredScopes: string[] = [];

  for (const scope of ORDER_WEBHOOK_SCOPES) {
    const matching = (existing.data ?? []).find(
      hook => hook.scope === scope && hook.destination === destination && hook.is_active,
    );
    if (matching) {
      ensuredScopes.push(scope);
      continue;
    }

    await requestJson<{ data: BigCommerceWebhookRecord }>(
      input.accessToken,
      `https://api.bigcommerce.com/stores/${input.storeHash}/v3/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          scope,
          destination,
          is_active: true,
          headers: webhookHeaders,
        }),
      },
      'Failed to create BigCommerce webhook',
    );

    ensuredScopes.push(scope);
  }

  logger.info('ensured BigCommerce order webhooks', {
    storeHash: input.storeHash,
    destination,
    ensuredScopes,
  });

  return {
    destination,
    ensured_scopes: ensuredScopes,
  };
}
