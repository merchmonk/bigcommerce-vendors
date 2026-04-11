const mockGetStoreMarkupPercent = jest.fn();

jest.mock('@lib/db', () => ({
  getStoreMarkupPercent: (...args: unknown[]) => mockGetStoreMarkupPercent(...args),
}));

import {
  buildPriceListTargets,
  resolveBigCommercePricingContext,
  resolveConfiguredMarkupValue,
} from '@lib/etl/bigcommercePricingContext';

describe('resolveConfiguredMarkupValue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BIGCOMMERCE_MARKUP_METAFIELD_NAMESPACE;
    delete process.env.BIGCOMMERCE_MARKUP_METAFIELD_KEY;
    delete process.env.BIGCOMMERCE_B2B_PRICE_LIST_ID;
    delete process.env.BIGCOMMERCE_BLANKS_PRICE_LIST_ID;
    delete process.env.BIGCOMMERCE_PRICE_LIST_CURRENCY;
  });

  test('uses namespace/key contract instead of relying on a fixed metafield id', () => {
    const markup = resolveConfiguredMarkupValue(
      [
        {
          namespace: 'other',
          key: 'product_markup',
          value: '10',
        },
        {
          namespace: 'merchmonk',
          key: 'product_markup',
          value: '35',
        },
      ],
      {
        namespace: 'merchmonk',
        key: 'product_markup',
        fallback_markup_percent: 30,
      },
    );

    expect(markup).toBe(35);
  });

  test('falls back to default pricing context when store metafields route is unavailable', async () => {
    mockGetStoreMarkupPercent.mockResolvedValue(null);

    const context = await resolveBigCommercePricingContext({
      accessToken: 'token',
      storeHash: 'abc123',
      fallback_markup_percent: 30,
    });

    expect(context).toEqual({
      markup_percent: 30,
      price_list_id: 1,
      blanks_price_list_id: 2,
      currency: 'USD',
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    });
  });

  test('uses the persisted store markup percent when available', async () => {
    mockGetStoreMarkupPercent.mockResolvedValue(42);

    const context = await resolveBigCommercePricingContext({
      accessToken: 'token',
      storeHash: 'abc123',
      fallback_markup_percent: 30,
    });

    expect(context).toEqual({
      markup_percent: 42,
      price_list_id: 1,
      blanks_price_list_id: 2,
      currency: 'USD',
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    });
  });
});

describe('buildPriceListTargets', () => {
  test('routes storefront pricing to marked-up net decorated and blanks to raw net blank for PromoStandards pricing families', () => {
    expect(
      buildPriceListTargets({
        pricingContext: {
          markup_percent: 30,
          price_list_id: 1,
          blanks_price_list_id: 2,
          currency: 'USD',
          markup_namespace: 'merchmonk',
          markup_key: 'product_markup',
        },
      }),
    ).toEqual([
      {
        price_list_id: 1,
        markup_percent: 30,
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
      {
        price_list_id: 2,
        markup_percent: 0,
        family_preferences: [
          {
            price_type: 'Net',
            configuration_type: 'Blank',
          },
        ],
        require_family_match: true,
      },
    ]);
  });
});
