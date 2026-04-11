import { getStoreMarkupPercent } from '../db';

export interface BigCommercePricingContext {
  markup_percent: number;
  price_list_id: number;
  blanks_price_list_id: number;
  currency: string;
  markup_namespace: string;
  markup_key: string;
}

export interface BigCommercePriceListTarget {
  price_list_id: number;
  markup_percent: number;
  family_preferences?: Array<{
    price_type?: string;
    configuration_type?: string;
  }>;
  require_family_match?: boolean;
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
  metafields: Array<Pick<{ namespace?: string; key?: string; value?: string }, 'namespace' | 'key' | 'value'>>,
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
  const blanks_price_list_id = parseFiniteNumber(process.env.BIGCOMMERCE_BLANKS_PRICE_LIST_ID, 2);
  const currency = readEnv('BIGCOMMERCE_PRICE_LIST_CURRENCY', 'USD');
  const fallback_markup_percent = input.fallback_markup_percent ?? 30;
  const configuredMarkupPercent = await getStoreMarkupPercent(input.storeHash);
  const markup_percent = configuredMarkupPercent ?? fallback_markup_percent;

  return {
    markup_percent,
    price_list_id,
    blanks_price_list_id,
    currency,
    markup_namespace,
    markup_key,
  };
}

export function buildPriceListTargets(input: {
  pricingContext: BigCommercePricingContext;
}): BigCommercePriceListTarget[] {
  const targets: BigCommercePriceListTarget[] = [
    {
      price_list_id: input.pricingContext.price_list_id,
      markup_percent: input.pricingContext.markup_percent,
      family_preferences: [
        {
          price_type: 'Net',
          configuration_type: 'Decorated',
        },
        {
          price_type: 'Net',
        },
      ],
    },
  ];

  if (input.pricingContext.blanks_price_list_id !== input.pricingContext.price_list_id) {
    targets.push({
      price_list_id: input.pricingContext.blanks_price_list_id,
      markup_percent: 0,
      family_preferences: [
        {
          price_type: 'Net',
          configuration_type: 'Blank',
        },
      ],
      require_family_match: true,
    });
  }

  return targets;
}
