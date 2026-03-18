import {
  canonicalizeTaxonomyName,
  classifyDuplicateDecision,
  derivePercentBulkPricingRulesFromCost,
  deriveSellingPrice,
} from '@lib/etl/syncSemantics';

describe('syncSemantics', () => {
  test('classifies exact sku match from other vendor as duplicate create', () => {
    const decision = classifyDuplicateDecision({
      source_sku: 'SKU-100',
      source_name: 'Product 100',
      vendor_id: 12,
      candidates: [
        {
          id: 44,
          sku: 'SKU-100',
          name: 'Product 100',
          vendor_marker: '4',
        },
      ],
    });

    expect(decision.action).toBe('create');
    expect(decision.duplicate).toBe(true);
    expect(decision.resolved_sku).toBe('SKU-100__v12');
  });

  test('treats missing vendor marker as same-vendor update candidate', () => {
    const decision = classifyDuplicateDecision({
      source_sku: 'SKU-100',
      source_name: 'Product 100',
      vendor_id: 12,
      candidates: [
        {
          id: 44,
          sku: 'SKU-100',
          name: 'Product 100',
        },
      ],
    });

    expect(decision.action).toBe('update');
    expect(decision.duplicate).toBe(false);
    expect(decision.target_product_id).toBe(44);
  });

  test('derives markup-based selling price and percent bulk tiers from vendor cost', () => {
    const price = deriveSellingPrice(10, 30);
    const rules = derivePercentBulkPricingRulesFromCost({
      base_cost_price: 10,
      vendor_rules: [
        {
          quantity_min: 10,
          quantity_max: 24,
          type: 'price',
          amount: 9,
        },
        {
          quantity_min: 25,
          quantity_max: 49,
          type: 'price',
          amount: 8.5,
        },
      ],
    });

    expect(price).toBe(13);
    expect(rules).toEqual([
      {
        quantity_min: 10,
        quantity_max: 24,
        type: 'percent',
        amount: 10,
      },
      {
        quantity_min: 25,
        quantity_max: 49,
        type: 'percent',
        amount: 15,
      },
    ]);
  });

  test('canonicalizes brand/category keys across case/spacing/punctuation', () => {
    const keyA = canonicalizeTaxonomyName(' Acme Brand ');
    const keyB = canonicalizeTaxonomyName('ACME-brand');

    expect(keyA).toBe('acmebrand');
    expect(keyA).toBe(keyB);
  });
});
