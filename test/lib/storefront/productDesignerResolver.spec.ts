import {
  buildPricingPreview,
  flattenOverrideKeys,
  resolveBasePricing,
  resolveContractVariantCatalogEntry,
  resolveDesignerContract,
} from '@lib/storefront/productDesignerResolver';

describe('productDesignerResolver', () => {
  const productDesignerDefaults = {
    contractVersion: '2026-03-18.1',
    pricing: {
      priceListId: 1,
      currency: 'USD',
      variantCatalog: [
        {
          sku: 'PC54-BLK-M',
          partId: 'PC54-BLK-M',
          color: 'Black',
          size: 'M',
          priceTiers: [
            { minQuantity: 1, price: 9.1 },
            { minQuantity: 72, price: 8.45 },
          ],
        },
        {
          sku: 'PC54-BLK-XL',
          partId: 'PC54-BLK-XL',
          color: 'Black',
          size: 'XL',
          priceTiers: [
            { minQuantity: 1, price: 10.1 },
            { minQuantity: 72, price: 9.45 },
          ],
        },
      ],
    },
    fobPoints: [
      {
        id: 'GA-ATL',
        city: 'Atlanta',
        state: 'GA',
        postalCode: '30318',
        country: 'US',
      },
    ],
    locations: [
      {
        id: 'full_front',
        locationId: 'FULL_FRONT',
        name: 'Full Front',
        includedDecorations: 1,
        minDecorations: 1,
        maxDecorations: 4,
        isDefault: true,
        methods: [
          {
            id: 'screen_print',
            name: 'Screen Print',
            isDefault: true,
            unitsIncluded: 1,
            unitsMax: 4,
            charges: [
              {
                id: 'setup',
                name: 'Setup',
                type: 'setup',
                tiers: [
                  { minQuantity: 1, minUnits: 1, price: 45 },
                ],
              },
              {
                id: 'run',
                name: 'Run',
                type: 'run',
                appliesPerColor: 1,
                tiers: [
                  { minQuantity: 48, minUnits: 1, price: 1.35 },
                  { minQuantity: 96, minUnits: 1, price: 1.1 },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'full_back',
        locationId: 'FULL_BACK',
        name: 'Full Back',
        includedDecorations: 1,
        minDecorations: 1,
        maxDecorations: 4,
        methods: [
          {
            id: 'screen_print',
            name: 'Screen Print',
            charges: [],
          },
        ],
      },
    ],
  };

  test('resolves variant catalog entry for the selected sku', () => {
    const variantCatalog = resolveContractVariantCatalogEntry(productDesignerDefaults, {
      sku: 'PC54-BLK-XL',
    });

    expect(variantCatalog).toEqual(
      expect.objectContaining({
        sku: 'PC54-BLK-XL',
        partId: 'PC54-BLK-XL',
        size: 'XL',
      }),
    );
  });

  test('filters resolved locations using applicable location overrides', () => {
    const resolved = resolveDesignerContract(productDesignerDefaults, {
      applicableLocationIds: ['FULL_FRONT'],
      physical: {
        shape: 'rectangular',
      },
    });

    expect(resolved.locations).toHaveLength(1);
    expect(resolved.locations[0]).toEqual(
      expect.objectContaining({
        id: 'full_front',
        name: 'Full Front',
      }),
    );
  });

  test('selects the correct quantity tier for base pricing', () => {
    const variantCatalog = resolveContractVariantCatalogEntry(productDesignerDefaults, {
      sku: 'PC54-BLK-M',
    });

    const basePricing = resolveBasePricing({
      quantity: 96,
      variantCatalog,
      productDesignerDefaults,
      fallbackUnitBlankPrice: 9.1,
    });

    expect(basePricing).toEqual(
      expect.objectContaining({
        priceListId: 1,
        currencyCode: 'USD',
        quantity: 96,
        unitBlankPrice: 8.45,
        tierApplied: {
          minQuantity: 72,
          source: 'contract',
        },
        fobPoints: [
          expect.objectContaining({
            id: 'GA-ATL',
          }),
        ],
      }),
    );
  });

  test('builds a default pricing preview from the resolved designer contract', () => {
    const pricingPreview = buildPricingPreview({
      quantity: 96,
      currencyCode: 'USD',
      blankUnitPrice: 8.45,
      designer: resolveDesignerContract(productDesignerDefaults, {
        applicableLocationIds: ['FULL_FRONT'],
      }),
    });

    expect(pricingPreview).toEqual({
      quantity: 96,
      currencyCode: 'USD',
      blankUnitPrice: 8.45,
      decorationUnitPrice: 1.1,
      oneTimeCharges: 45,
      recurringCharges: 105.6,
      estimatedUnitSellPrice: 10.02,
      estimatedLineTotal: 961.8,
    });
  });

  test('flattens override keys for diagnostics while skipping identity fields', () => {
    expect(
      flattenOverrideKeys({
        contractVersion: '2026-03-18.1',
        partId: 'PC54-BLK-XL',
        size: 'XL',
        applicableLocationIds: ['FULL_FRONT'],
        physical: {
          dimension: {
            width: 24,
            height: 32,
          },
        },
      }),
    ).toEqual(['applicableLocationIds', 'physical.dimension.height', 'physical.dimension.width']);
  });
});
