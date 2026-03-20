import type { ProductPricingProjection } from './pricingProjector';

export interface PricingReconciliationSummary {
  status: 'OK' | 'INCOMPLETE';
  projected_variant_count: number;
  resolved_variant_id_count: number;
  projected_price_list_record_count: number;
  missing_variant_skus: string[];
  markup_percent: number;
  price_list_id: number;
}

export function reconcileProjectedPricingTargets(input: {
  pricingProjection: ProductPricingProjection;
  variantIdsBySku: Map<string, number>;
}): PricingReconciliationSummary {
  const missing_variant_skus = input.pricingProjection.variants
    .map(variant => variant.sku)
    .filter(sku => !input.variantIdsBySku.has(sku));

  const projected_price_list_record_count = input.pricingProjection.variants.filter(variant =>
    input.variantIdsBySku.has(variant.sku),
  ).length;

  return {
    status: missing_variant_skus.length === 0 ? 'OK' : 'INCOMPLETE',
    projected_variant_count: input.pricingProjection.variants.length,
    resolved_variant_id_count: input.variantIdsBySku.size,
    projected_price_list_record_count,
    missing_variant_skus,
    markup_percent: input.pricingProjection.markup_percent,
    price_list_id: input.pricingProjection.price_list_id,
  };
}
