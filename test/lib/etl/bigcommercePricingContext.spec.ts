import { resolveConfiguredMarkupValue } from '@lib/etl/bigcommercePricingContext';

describe('resolveConfiguredMarkupValue', () => {
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
});
