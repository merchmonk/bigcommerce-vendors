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

  test('dedupes duplicate price-list tiers projected from repeated vendor tiers', () => {
    const projection = projectProductPricing(
      {
        sku: 'BAG-BASE',
        source_sku: 'BAG-BASE',
        vendor_product_id: 'BAG-BASE',
        name: 'Example Bag',
        cost_price: 27.77,
        price: 27.77,
        variants: [
          {
            sku: 'BAG-BLK',
            source_sku: 'BAG-BLK',
            part_id: 'BAG-BLK',
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
        ],
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'BAG-BLK',
              default_part: true,
              price_tiers: [
                { min_quantity: 1, price: 27.77 },
                { min_quantity: 50, quantity_max: 99, price: 23.81 },
                { min_quantity: 50, quantity_max: 99, price: 23.81 },
                { min_quantity: 100, quantity_max: 299, price: 20.79 },
                { min_quantity: 100, quantity_max: 299, price: 20.79 },
                { min_quantity: 300, price: 19.98 },
                { min_quantity: 300, price: 19.98 },
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

    expect(projection.variants).toEqual([
      expect.objectContaining({
        sku: 'BAG-BLK',
        price_list_bulk_tiers: [
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'price',
            amount: 30.95,
          },
          {
            quantity_min: 100,
            quantity_max: 299,
            type: 'price',
            amount: 27.03,
          },
          {
            quantity_min: 300,
            type: 'price',
            amount: 25.97,
          },
        ],
      }),
    ]);
  });

  test('collapses conflicting same-range bulk rules to the best discount', () => {
    const projection = projectProductPricing(
      {
        sku: 'BOTTLE-BASE',
        source_sku: 'BOTTLE-BASE',
        vendor_product_id: 'BOTTLE-BASE',
        name: 'Example Bottle',
        cost_price: 58.67,
        price: 58.67,
        bulk_pricing_rules: [
          {
            quantity_min: 25,
            quantity_max: 49,
            type: 'price',
            amount: 50.32,
          },
          {
            quantity_min: 25,
            quantity_max: 49,
            type: 'price',
            amount: 49.02,
          },
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'price',
            amount: 40.55,
          },
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'price',
            amount: 39.5,
          },
          {
            quantity_min: 100,
            type: 'price',
            amount: 38.98,
          },
          {
            quantity_min: 100,
            type: 'price',
            amount: 37.98,
          },
        ],
        variants: [
          {
            sku: 'BOTTLE-BLK',
            source_sku: 'BOTTLE-BLK',
            part_id: 'BOTTLE-BLK',
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
        ],
      },
      {
        markup_percent: 30,
        price_list_id: 1,
        currency: 'USD',
      },
    );

    expect(projection.product_fallback.bulk_pricing_rules).toEqual([
      {
        quantity_min: 25,
        quantity_max: 49,
        type: 'percent',
        amount: 16.45,
      },
      {
        quantity_min: 50,
        quantity_max: 99,
        type: 'percent',
        amount: 32.67,
      },
      {
        quantity_min: 100,
        type: 'percent',
        amount: 35.27,
      },
    ]);
    expect(projection.variants).toEqual([
      expect.objectContaining({
        sku: 'BOTTLE-BLK',
        price_list_bulk_tiers: [
          {
            quantity_min: 25,
            quantity_max: 49,
            type: 'price',
            amount: 63.73,
          },
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'price',
            amount: 51.35,
          },
          {
            quantity_min: 100,
            type: 'price',
            amount: 49.37,
          },
        ],
      }),
    ]);
  });
});
