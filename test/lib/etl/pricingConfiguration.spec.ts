import {
  applyPricingConfigurationToProduct,
  buildProductPricingConfiguration,
} from '@lib/etl/pricingConfiguration';

describe('buildProductPricingConfiguration', () => {
  test('captures the full PricingAndConfiguration response model that we persist to BigCommerce', () => {
    const configuration = buildProductPricingConfiguration([
      {
        GetAvailableLocationsResponse: {
          AvailableLocationArray: {
            AvailableLocation: [
              { locationId: 'FRONT', locationName: 'Front' },
              { locationId: 'BACK', locationName: 'Back' },
            ],
          },
        },
      },
      {
        GetDecorationColorsResponse: {
          DecorationColors: {
            productId: '101854',
            locationId: 'FRONT',
            pmsMatch: 'true',
            fullColor: 'false',
            ColorArray: {
              Color: [
                { colorId: 'BLK', colorName: 'Black' },
                { colorId: 'WHT', colorName: 'White' },
              ],
            },
            DecorationMethodArray: {
              DecorationMethod: [
                { decorationId: 'SCREEN', decorationName: 'Screen Print' },
              ],
            },
          },
        },
      },
      {
        GetFobPointsResponse: {
          FobPointArray: {
            FobPoint: [
              {
                fobId: '1',
                fobPostalCode: '30318',
                fobCity: 'Atlanta',
                fobState: 'GA',
                fobCountry: 'US',
                CurrencySupportedArray: {
                  CurrencySupported: [{ currency: 'USD' }, { currency: 'CAD' }],
                },
                ProductArray: {
                  Product: [{ productId: '101854' }],
                },
              },
            ],
          },
        },
      },
      {
        GetAvailableChargesResponse: {
          AvailableChargeArray: {
            AvailableCharge: [
              {
                chargeId: 'SETUP',
                chargeName: 'Setup',
                chargeDescription: 'One time setup',
                chargeType: 'setup',
              },
            ],
          },
        },
      },
      {
        GetConfigurationAndPricingResponse: {
          Configuration: {
            productId: '101854',
            currency: 'USD',
            priceType: 'List',
            fobPostalCode: '30318',
            PartArray: {
              Part: [
                {
                  partId: '101854-001',
                  partDescription: 'Black',
                  defaultPart: 'true',
                  LocationIdArray: {
                    LocationId: ['FRONT', { locationId: 'BACK' }],
                  },
                  PartPriceArray: {
                    PartPrice: [
                      {
                        minQuantity: 12,
                        quantityMax: 47,
                        price: 10,
                        priceUom: 'EA',
                        discountCode: 'A',
                        priceEffectiveDate: '2026-01-01',
                        priceExpiryDate: '2026-12-31',
                      },
                    ],
                  },
                },
              ],
            },
            LocationArray: {
              Location: [
                {
                  locationId: 'FRONT',
                  locationName: 'Front',
                  decorationsIncluded: 1,
                  defaultLocation: 'true',
                  DecorationArray: {
                    Decoration: [
                      {
                        decorationId: 'SCREEN',
                        decorationName: 'Screen Print',
                        decorationWidth: 3,
                        decorationHeight: 2,
                        chargeAppliesLTM: 'true',
                        ChargeArray: {
                          Charge: [
                            {
                              chargeId: 'RUN',
                              chargeName: 'Run Charge',
                              chargeType: 'run',
                              chargeAppliesLTM: 'true',
                              ChargePriceArray: {
                                ChargePrice: [
                                  {
                                    xMinQty: 12,
                                    xUom: 'EA',
                                    yMinQty: 1,
                                    yUom: 'COLOR',
                                    price: 1.25,
                                    repeatPrice: 0.75,
                                    discountCode: 'A',
                                    repeatDiscountCode: 'R',
                                    priceEffectiveDate: '2026-01-01',
                                    priceExpiryDate: '2026-12-31',
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
            FobArray: {
              Fob: [
                {
                  fobId: '1',
                  fobPostalCode: '30318',
                  fobCity: 'Atlanta',
                  fobState: 'GA',
                  fobCountry: 'US',
                },
              ],
            },
          },
        },
      },
    ]);

    expect(configuration).toEqual(
      expect.objectContaining({
        product_id: '101854',
        currency: 'USD',
        price_type: 'List',
        fob_postal_code: '30318',
        available_locations: [
          { location_id: 'FRONT', location_name: 'Front' },
          { location_id: 'BACK', location_name: 'Back' },
        ],
        decoration_colors: [
          expect.objectContaining({
            product_id: '101854',
            location_id: 'FRONT',
            pms_match: true,
            full_color: false,
            colors: [
              { color_id: 'BLK', color_name: 'Black' },
              { color_id: 'WHT', color_name: 'White' },
            ],
            decoration_methods: [
              { decoration_id: 'SCREEN', decoration_name: 'Screen Print' },
            ],
          }),
        ],
        available_charges: [
          {
            charge_id: 'SETUP',
            charge_name: 'Setup',
            charge_description: 'One time setup',
            charge_type: 'setup',
          },
        ],
        fob_points: [
          expect.objectContaining({
            fob_id: '1',
            postal_code: '30318',
            supported_currencies: ['USD', 'CAD'],
            product_ids: ['101854'],
          }),
        ],
        parts: [
          expect.objectContaining({
            part_id: '101854-001',
            location_ids: ['FRONT', 'BACK'],
            price_tiers: [
              expect.objectContaining({
                min_quantity: 12,
                quantity_max: 47,
                price: 10,
                price_uom: 'EA',
                discount_code: 'A',
                price_effective_date: '2026-01-01',
                price_expiry_date: '2026-12-31',
              }),
            ],
          }),
        ],
        locations: [
          expect.objectContaining({
            location_id: 'FRONT',
            decorations: [
              expect.objectContaining({
                decoration_id: 'SCREEN',
                charges: [
                  expect.objectContaining({
                    charge_id: 'RUN',
                    charges_applies_ltm: true,
                    charge_price_tiers: [
                      expect.objectContaining({
                        x_min_qty: 12,
                        x_uom: 'EA',
                        y_min_qty: 1,
                        y_uom: 'COLOR',
                        price: 1.25,
                        repeat_price: 0.75,
                        discount_code: 'A',
                        repeat_discount_code: 'R',
                        price_effective_date: '2026-01-01',
                        price_expiry_date: '2026-12-31',
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
  });

  test('preserves price family metadata from the request context envelope on each price tier', () => {
    const configuration = buildProductPricingConfiguration([
      {
        __pricing_payload: {
          GetConfigurationAndPricingResponse: {
            Configuration: {
              productId: '101854',
              PartArray: {
                Part: [
                  {
                    partId: '101854-001',
                    defaultPart: 'true',
                    PartPriceArray: {
                      PartPrice: [
                        {
                          minQuantity: 24,
                          price: 18.5,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
        __pricing_request_context: {
          currency: 'USD',
          priceType: 'Net',
          configurationType: 'Decorated',
        },
      },
      {
        __pricing_payload: {
          GetConfigurationAndPricingResponse: {
            Configuration: {
              productId: '101854',
              PartArray: {
                Part: [
                  {
                    partId: '101854-001',
                    defaultPart: 'true',
                    PartPriceArray: {
                      PartPrice: [
                        {
                          minQuantity: 1,
                          price: 12.5,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
        __pricing_request_context: {
          currency: 'USD',
          priceType: 'Net',
          configurationType: 'Blank',
        },
      },
    ]);

    expect(configuration?.configuration_type).toBe('Decorated');
    expect(configuration?.parts[0]?.price_tiers).toEqual([
      expect.objectContaining({
        min_quantity: 1,
        price: 12.5,
        currency: 'USD',
        price_type: 'Net',
        configuration_type: 'Blank',
      }),
      expect.objectContaining({
        min_quantity: 24,
        price: 18.5,
        currency: 'USD',
        price_type: 'Net',
        configuration_type: 'Decorated',
      }),
    ]);
  });
});

describe('applyPricingConfigurationToProduct', () => {
  test('maps purchase quantity constraints to the product and variants', () => {
    const product = applyPricingConfigurationToProduct(
      {
        sku: 'BASE',
        name: 'Base product',
        variants: [
          {
            sku: 'BASE-BLK',
            part_id: 'BASE-BLK',
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
        ],
      },
      {
        product_id: 'BASE',
        parts: [
          {
            part_id: 'BASE-BLK',
            default_part: true,
            price_tiers: [
              { min_quantity: 24, quantity_max: 95, price: 12.5 },
            ],
          },
        ],
        locations: [],
        fob_points: [],
      },
    );

    expect(product.min_purchase_quantity).toBe(24);
    expect(product.max_purchase_quantity).toBe(95);
    expect(product.variants?.[0]).toEqual(
      expect.objectContaining({
        min_purchase_quantity: 24,
        max_purchase_quantity: 95,
      }),
    );
  });
});
