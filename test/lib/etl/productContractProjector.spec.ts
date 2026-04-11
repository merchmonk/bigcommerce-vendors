import { projectBigCommerceProductContract } from '@lib/etl/productContractProjector';

describe('projectBigCommerceProductContract', () => {
  test('projects shared product defaults with a size-driven variant override', () => {
    const contract = projectBigCommerceProductContract(
      {
        sku: 'TEE-BASE',
        source_sku: 'TEE-BASE',
        vendor_product_id: 'PC54',
        name: 'Port Authority Tee',
        min_purchase_quantity: 12,
        max_purchase_quantity: 95,
        variants: [
          {
            sku: 'PC54-BLK-M',
            source_sku: 'PC54-BLK-M',
            part_id: 'PC54-BLK-M',
            color: 'Black',
            size: 'M',
            min_purchase_quantity: 12,
            max_purchase_quantity: 95,
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
            min_purchase_quantity: 12,
            max_purchase_quantity: 95,
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
        /*  {
            url: 'https://www.youtube.com/watch?v=abc123xyz89',
            media_type: 'Video',
            description: 'Promo video',
            part_id: 'PC54-BLK-XL',
          },*/
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
        product_data: {
          product_id: 'PC54',
          product_name: 'Port Authority Tee',
          line_name: 'Core Apparel',
          primary_image_url: 'https://cdn.example.com/products/pc54/hero.jpg',
          marketing_points: [
            {
              point_type: 'Highlights',
              point_copy: 'Soft cotton feel',
            },
          ],
          categories: [
            {
              category: 'Apparel',
              sub_category: 'T-Shirts',
            },
          ],
          related_products: [
            {
              relation_type: 'CompanionSell',
              product_id: 'PC55',
            },
          ],
          product_price_groups: [
            {
              group_name: 'List',
              currency: 'USD',
              prices: [
                {
                  quantity_min: 12,
                  quantity_max: 95,
                  price: 10,
                },
              ],
            },
          ],
          location_decorations: [
            {
              location_name: 'Full Front',
              max_imprint_colors: 4,
              decoration_name: 'Screen Print',
            },
          ],
          fob_points: [
            {
              fob_id: 'GA-ATL',
              fob_postal_code: '30318',
            },
          ],
          parts: [
            {
              part_id: 'PC54-BLK-M',
              country_of_origin: 'US',
              primary_material: 'Cotton',
            },
          ],
        },
        pricing_configuration: {
          product_id: 'PC54',
          currency: 'USD',
          fob_postal_code: '30318',
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
              part_description: 'Black M',
              location_ids: ['FULL_FRONT', 'FULL_BACK'],
              price_tiers: [
                {
                  min_quantity: 12,
                  quantity_max: 95,
                  price: 10,
                  price_uom: 'EA',
                  discount_code: 'A',
                },
              ],
            },
            {
              part_id: 'PC54-BLK-XL',
              part_description: 'Black XL',
              location_ids: ['FULL_FRONT'],
              price_tiers: [
                {
                  min_quantity: 12,
                  quantity_max: 95,
                  price: 12,
                  price_uom: 'EA',
                  discount_code: 'A',
                },
              ],
            },
          ],
          available_locations: [
            { location_id: 'FULL_FRONT', location_name: 'Full Front' },
            { location_id: 'FULL_BACK', location_name: 'Full Back' },
          ],
          decoration_colors: [
            {
              product_id: 'PC54',
              location_id: 'FULL_FRONT',
              pms_match: true,
              full_color: false,
              colors: [
                { color_id: 'BLK', color_name: 'Black' },
              ],
              decoration_methods: [
                { decoration_id: 'SCREEN_PRINT', decoration_name: 'Screen Print' },
              ],
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
              supported_currencies: ['USD'],
              product_ids: ['PC54'],
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
          minPurchaseQuantity: 12,
          maxPurchaseQuantity: 95,
          variantCatalog: [
            expect.objectContaining({
              sku: 'PC54-BLK-M',
              partId: 'PC54-BLK-M',
              color: 'Black',
              size: 'M',
              minPurchaseQuantity: 12,
              maxPurchaseQuantity: 95,
              priceTiers: [
                { minQuantity: 12, quantityMax: 95, price: 14.29, priceUom: 'EA', discountCode: 'A' },
              ],
            }),
            expect.objectContaining({
              sku: 'PC54-BLK-XL',
              partId: 'PC54-BLK-XL',
              color: 'Black',
              size: 'XL',
              minPurchaseQuantity: 12,
              maxPurchaseQuantity: 95,
              priceTiers: [
                { minQuantity: 12, quantityMax: 95, price: 17.14, priceUom: 'EA', discountCode: 'A' },
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
        media: expect.objectContaining({
          gallery: [
            expect.objectContaining({
              url: 'https://cdn.example.com/products/pc54/hero.jpg',
              classTypes: ['Primary'],
            }),
          ],
          variantAssets: expect.objectContaining({
            'PC54-BLK-XL': [
              expect.objectContaining({
                url: 'https://cdn.example.com/products/pc54/black-xl.jpg',
                partId: 'PC54-BLK-XL',
              }),
            ],
          }),
          locationAssets: expect.objectContaining({
            FULL_FRONT: [
              expect.objectContaining({
                url: 'https://cdn.example.com/products/pc54/full-front.jpg',
                locationIds: ['FULL_FRONT'],
              }),
            ],
          }),
          methodAssets: expect.objectContaining({
            SCREEN_PRINT: [
              expect.objectContaining({
                url: 'https://cdn.example.com/products/pc54/full-front.jpg',
                decorationIds: ['SCREEN_PRINT'],
                locationId: 'FULL_FRONT',
              }),
            ],
          }),
        }),
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
          minPurchaseQuantity: 12,
          maxPurchaseQuantity: 95,
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
    expect(contract.product_designer_defaults).not.toHaveProperty('availableLocations');
    expect(contract.product_internal_metafields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'pricing_configuration_configuration',
          value: expect.objectContaining({
            productId: 'PC54',
            currency: 'USD',
            priceType: 'List',
            fobPostalCode: '30318',
            minPurchaseQuantity: 12,
            maxPurchaseQuantity: 95,
            parts: expect.arrayContaining([
              expect.objectContaining({
                partId: 'PC54-BLK-M',
                partDescription: 'Black M',
                priceTiers: expect.arrayContaining([
                  expect.objectContaining({
                    minQuantity: 12,
                    quantityMax: 95,
                    price: 10,
                    priceUom: 'EA',
                    discountCode: 'A',
                  }),
                ]),
              }),
            ]),
            variants: expect.arrayContaining([
              expect.objectContaining({
                sku: 'PC54-BLK-M',
                minPurchaseQuantity: 12,
                maxPurchaseQuantity: 95,
              }),
            ]),
          }),
        }),
        expect.objectContaining({
          key: 'product_data_product',
          value: expect.objectContaining({
            productData: expect.objectContaining({
              product_id: 'PC54',
              product_name: 'Port Authority Tee',
              line_name: 'Core Apparel',
            }),
          }),
        }),
        expect.objectContaining({
          key: 'product_data_marketing_points',
          value: expect.objectContaining({
            marketingPoints: [
              expect.objectContaining({
                point_type: 'Highlights',
                point_copy: 'Soft cotton feel',
              }),
            ],
          }),
        }),
        expect.objectContaining({
          key: 'product_data_parts',
          value: expect.objectContaining({
            parts: [
              expect.objectContaining({
                part_id: 'PC54-BLK-M',
                country_of_origin: 'US',
                primary_material: 'Cotton',
              }),
            ],
          }),
        }),
        expect.objectContaining({
          key: 'pricing_configuration_available_locations',
          value: expect.objectContaining({
            availableLocations: [
              { locationId: 'FULL_FRONT', locationName: 'Full Front' },
              { locationId: 'FULL_BACK', locationName: 'Full Back' },
            ],
          }),
        }),
        expect.objectContaining({
          key: 'pricing_configuration_decoration_colors',
          value: expect.objectContaining({
            decorationColors: [
              expect.objectContaining({
                productId: 'PC54',
                locationId: 'FULL_FRONT',
                pmsMatch: true,
              }),
            ],
          }),
        }),
        expect.objectContaining({
          key: 'pricing_configuration_fob_points',
          value: expect.objectContaining({
            fobPoints: [
              expect.objectContaining({
                fobId: 'GA-ATL',
                supportedCurrencies: ['USD'],
                productIds: ['PC54'],
              }),
            ],
          }),
        }),
      ]),
    );
  });
});
