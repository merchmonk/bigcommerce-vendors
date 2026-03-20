import { reconcileProjectedPricingTargets } from '@lib/etl/pricingReconciliation';

describe('reconcileProjectedPricingTargets', () => {
  test('flags projected variants that do not have BigCommerce variant ids', () => {
    const summary = reconcileProjectedPricingTargets({
      pricingProjection: {
        markup_percent: 30,
        currency: 'USD',
        price_list_id: 1,
        product_fallback: {
          cost_price: 10,
          price: 13,
        },
        variants: [
          {
            sku: 'SKU-1',
            option_values: [],
            cost_price: 10,
            price: 13,
          },
          {
            sku: 'SKU-2',
            option_values: [],
            cost_price: 12,
            price: 15.6,
          },
        ],
      },
      variantIdsBySku: new Map([['SKU-1', 101]]),
    });

    expect(summary).toEqual({
      status: 'INCOMPLETE',
      projected_variant_count: 2,
      resolved_variant_id_count: 1,
      projected_price_list_record_count: 1,
      missing_variant_skus: ['SKU-2'],
      markup_percent: 30,
      price_list_id: 1,
    });
  });
});
