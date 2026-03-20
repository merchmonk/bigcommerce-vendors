import {
  BigCommerceCatalogListResponse,
  buildApiBase,
  requestJson,
} from './bigcommerceApi';

interface BigCommerceStoreMetafield {
  id: number;
  namespace?: string;
  key?: string;
  value?: string;
}

export interface BigCommercePricingContext {
  markup_percent: number;
  price_list_id: number;
  currency: string;
  markup_namespace: string;
  markup_key: string;
}

function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function parseFiniteNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveConfiguredMarkupValue(
  metafields: Array<Pick<BigCommerceStoreMetafield, 'namespace' | 'key' | 'value'>>,
  input?: {
    namespace?: string;
    key?: string;
    fallback_markup_percent?: number;
  },
): number {
  const namespace = input?.namespace ?? 'merchmonk';
  const key = input?.key ?? 'product_markup';
  const fallback = input?.fallback_markup_percent ?? 30;

  const metafield = metafields.find(
    item => item.namespace === namespace && item.key === key,
  );
  return parseFiniteNumber(metafield?.value, fallback);
}

export async function resolveBigCommercePricingContext(input: {
  accessToken: string;
  storeHash: string;
  fallback_markup_percent?: number;
}): Promise<BigCommercePricingContext> {
  const markup_namespace = readEnv('BIGCOMMERCE_MARKUP_METAFIELD_NAMESPACE', 'merchmonk');
  const markup_key = readEnv('BIGCOMMERCE_MARKUP_METAFIELD_KEY', 'product_markup');
  const price_list_id = parseFiniteNumber(process.env.BIGCOMMERCE_B2B_PRICE_LIST_ID, 1);
  const currency = readEnv('BIGCOMMERCE_PRICE_LIST_CURRENCY', 'USD');
  const fallback_markup_percent = input.fallback_markup_percent ?? 30;

  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceStoreMetafield>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/settings/store/metafields?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce store metafields',
  );

  const markup_percent = resolveConfiguredMarkupValue(response.data ?? [], {
    namespace: markup_namespace,
    key: markup_key,
    fallback_markup_percent,
  });

  return {
    markup_percent,
    price_list_id,
    currency,
    markup_namespace,
    markup_key,
  };
}
