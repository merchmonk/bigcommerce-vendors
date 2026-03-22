import { projectBigCommerceProductContract } from '@lib/etl/productContractProjector';

describe('projectBigCommerceProductContract', () => {
  test('projects shared product defaults with a size-driven variant override', () => {
    const contract = projectBigCommerceProductContract(
      {
        sku: 'TEE-BASE',
        source_sku: 'TEE-BASE',
        vendor_product_id: 'PC54',
        name: 'Port Authority Tee',
        variants: [
          {
            sku: 'PC54-BLK-M',
            source_sku: 'PC54-BLK-M',
            part_id: 'PC54-BLK-M',
            color: 'Black',
            size: 'M',
            option_values: [
              { option_display_name: 'Color', label: 'Black' },
              { option_display_name: 'Size', label: 'M' },
            ],
          },
          {
            sku: 'PC54-BLK-XL',
            source_sku: 'PC54-BLK-XL',
            part_id: 'PC54-BLK-XL',
            color: 'Black',
            size: 'XL',
            physical: {
              shape: 'rectangular',
              dimension: {
                width: 24,
                height: 32,
                uom: 'IN',
              },
            },
            option_values: [
              { option_display_name: 'Color', label: 'Black' },
              { option_display_name: 'Size', label: 'XL' },
            ],
          },
        ],
        media_assets: [
          {
            url: 'https://cdn.example.com/products/pc54/hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
            class_types: ['Primary'],
          },
          {
            url: 'https://cdn.example.com/products/pc54/black-xl.jpg',
            media_type: 'Image',
            description: 'Black XL',
            part_id: 'PC54-BLK-XL',
            class_types: ['Primary'],
          },
          {
            url: 'https://cdn.example.com/products/pc54/full-front.jpg',
            media_type: 'Image',
            description: 'Front print placement',
            location_ids: ['FULL_FRONT'],
            decoration_ids: ['SCREEN_PRINT'],
          },
          {
            url: 'https://www.youtube.com/watch?v=abc123xyz89',
            media_type: 'Video',
            description: 'Promo video',
            part_id: 'PC54-BLK-XL',
          },
        ],
        location_decoration_data: {
          LocationDecoration: [
            {
              locationName: 'Full Front',
              decorationName: 'Screen Print',
              maxImprintColors: 4,
              locationDecorationComboDefault: true,
              priceIncludes: true,
            },
          ],
        },
        pricing_configuration: {
          price_type: 'List',
          locations: [
            {
              location_id: 'FULL_FRONT',
              location_name: 'Full Front',
              decorations_included: 1,
              min_decoration: 1,
              max_decoration: 4,
              decorations: [
                {
                  decoration_id: 'SCREEN_PRINT',
                  decoration_name: 'Screen Print',
                  decoration_geometry: 'rectangular',
                  decoration_width: 12,
                  decoration_height: 14,
                  decoration_uom: 'IN',
                  charges: [
                    {
                      charge_id: 'RUN',
                      charge_name: 'Run Charge',
                      charge_type: 'run',
                      charge_price_tiers: [
                        {
                          x_min_qty: 48,
                          price: 1.35,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              location_id: 'FULL_BACK',
              location_name: 'Full Back',
              decorations_included: 1,
              min_decoration: 1,
              max_decoration: 4,
              decorations: [],
            },
          ],
          parts: [
            {
              part_id: 'PC54-BLK-M',
              location_ids: ['FULL_FRONT', 'FULL_BACK'],
              price_tiers: [{ min_quantity: 1, price: 10 }],
            },
            {
              part_id: 'PC54-BLK-XL',
              location_ids: ['FULL_FRONT'],
              price_tiers: [{ min_quantity: 1, price: 12 }],
            },
          ],
          available_charges: [
            {
              charge_id: 'RUN',
              charge_name: 'Run Charge',
              charge_description: 'Per color run charge',
              charge_type: 'run',
            },
          ],
          fob_points: [
            {
              fob_id: 'GA-ATL',
              city: 'Atlanta',
              state: 'GA',
              postal_code: '30318',
              country: 'US',
            },
          ],
        },
      },
      {
        price_list_id: 1,
        currency: 'USD',
        markup_percent: 30,
        markup_namespace: 'merchmonk',
        markup_key: 'product_markup',
      },
    );

    expect(contract.product_designer_defaults).toEqual(
      expect.objectContaining({
        contractVersion: '2026-03-22.1',
        source: expect.objectContaining({
          vendorProductId: 'PC54',
        }),
        pricing: expect.objectContaining({
          priceListId: 1,
          currency: 'USD',
          markupPercent: 30,
          markupSource: {
            namespace: 'merchmonk',
            key: 'product_markup',
          },
          variantCatalog: [
            expect.objectContaining({
              sku: 'PC54-BLK-M',
              partId: 'PC54-BLK-M',
              color: 'Black',
              size: 'M',
              priceTiers: [
                { minQuantity: 1, price: 13 },
              ],
            }),
            expect.objectContaining({
              sku: 'PC54-BLK-XL',
              partId: 'PC54-BLK-XL',
              color: 'Black',
              size: 'XL',
              priceTiers: [
                { minQuantity: 1, price: 15.6 },
              ],
            }),
          ],
        }),
        availableCharges: [
          {
            charge_id: 'RUN',
            charge_name: 'Run Charge',
            charge_description: 'Per color run charge',
            charge_type: 'run',
          },
        ],
        media: {
          videos: {
            variantAssets: {
              'PC54-BLK-XL': [
                {
                  url: 'https://www.youtube.com/watch?v=abc123xyz89',
                  alt: 'Promo video',
                  description: 'Promo video',
                  kind: 'variant',
                  partId: 'PC54-BLK-XL',
                },
              ],
            },
          },
        },
      }),
    );
    expect((contract.product_designer_defaults.locations as Array<Record<string, unknown>>)[0]).toEqual(
      expect.objectContaining({
        id: 'full_front',
        methods: [
          expect.objectContaining({
            id: 'screen_print',
            printArea: {
              geometry: 'rectangular',
              width: 12,
              height: 14,
              uom: 'IN',
            },
            sourceHints: {
              maxImprintColors: 4,
              locationDecorationComboDefault: true,
              priceIncludes: true,
            },
          }),
        ],
      }),
    );
    expect(contract.variant_designer_overrides).toEqual([
      {
        sku: 'PC54-BLK-XL',
        value: expect.objectContaining({
          partId: 'PC54-BLK-XL',
          size: 'XL',
          applicableLocationIds: ['FULL_FRONT'],
          physical: {
            shape: 'rectangular',
            dimension: {
              width: 24,
              height: 32,
              uom: 'IN',
            },
          },
        }),
      },
    ]);
  });
});
