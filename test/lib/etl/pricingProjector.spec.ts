import { projectProductPricing } from '@lib/etl/pricingProjector';

describe('projectProductPricing', () => {
  test('projects variant-aware sell pricing and price-list tiers from part pricing', () => {
    const projection = projectProductPricing(
      {
        sku: 'TEE-BASE',
        source_sku: 'TEE-BASE',
        vendor_product_id: 'TEE-BASE',
        name: 'Example Tee',
        cost_price: 10,
        price: 10,
        variants: [
          {
            sku: 'TEE-BLK-M',
            source_sku: 'TEE-BLK-M',
            part_id: 'TEE-BLK-M',
            size: 'M',
            option_values: [
              { option_display_name: 'Color', label: 'Black' },
              { option_display_name: 'Size', label: 'M' },
            ],
          },
          {
            sku: 'TEE-BLK-XL',
            source_sku: 'TEE-BLK-XL',
            part_id: 'TEE-BLK-XL',
            size: 'XL',
            option_values: [
              { option_display_name: 'Color', label: 'Black' },
              { option_display_name: 'Size', label: 'XL' },
            ],
          },
        ],
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'TEE-BLK-M',
              default_part: true,
              price_tiers: [
                { min_quantity: 1, price: 10 },
                { min_quantity: 48, price: 9.5 },
              ],
            },
            {
              part_id: 'TEE-BLK-XL',
              price_tiers: [
                { min_quantity: 1, price: 12 },
                { min_quantity: 48, price: 11.5 },
              ],
            },
          ],
          locations: [],
          fob_points: [],
        },
      },
      {
        markup_percent: 30,
        price_list_id: 1,
        currency: 'USD',
      },
    );

    expect(projection.product_fallback).toEqual({
      cost_price: 10,
      price: 13,
      bulk_pricing_rules: [
        {
          quantity_min: 48,
          type: 'percent',
          amount: 5,
        },
      ],
    });
    expect(projection.variants).toEqual([
      expect.objectContaining({
        sku: 'TEE-BLK-M',
        cost_price: 10,
        price: 13,
        price_list_bulk_tiers: [
          {
            quantity_min: 48,
            type: 'price',
            amount: 12.35,
          },
        ],
      }),
      expect.objectContaining({
        sku: 'TEE-BLK-XL',
        cost_price: 12,
        price: 15.6,
        price_list_bulk_tiers: [
          {
            quantity_min: 48,
            type: 'price',
            amount: 14.95,
          },
        ],
      }),
    ]);
  });
});
