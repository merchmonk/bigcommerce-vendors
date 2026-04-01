import type {
  NormalizedBulkPricingRule,
  NormalizedProduct,
  NormalizedVariant,
  PricingConfigurationPart,
} from './productNormalizer';
import {
  collapseBulkPricingRulesByRange,
  derivePercentBulkPricingRulesFromCost,
  deriveSellingPrice,
} from './syncSemantics';

export interface PriceListBulkPricingTier {
  quantity_min: number;
  quantity_max?: number;
  type: 'price';
  amount: number;
}

export interface VariantPricingProjection {
  sku: string;
  part_id?: string;
  option_values: NormalizedVariant['option_values'];
  cost_price: number;
  price: number;
  bulk_pricing_rules?: NormalizedBulkPricingRule[];
  price_list_bulk_tiers?: PriceListBulkPricingTier[];
}

export interface ProductPricingProjection {
  markup_percent: number;
  currency: string;
  price_list_id: number;
  product_fallback: {
    cost_price?: number;
    price?: number;
    bulk_pricing_rules?: NormalizedBulkPricingRule[];
  };
  variants: VariantPricingProjection[];
}

export interface PricingProjectionContext {
  markup_percent: number;
  price_list_id: number;
  currency: string;
}

function buildSyntheticVariant(product: NormalizedProduct): NormalizedVariant {
  return {
    sku: product.sku,
    source_sku: product.source_sku,
    part_id: product.source_sku ?? product.sku,
    price: product.price,
    cost_price: product.cost_price ?? product.price,
    option_values: [],
  };
}

function toSellPriceFromVendorRule(
  vendorRule: NormalizedBulkPricingRule,
  input: {
    base_cost_price: number;
    base_sell_price: number;
    markup_percent: number;
  },
): number | undefined {
  if (vendorRule.type === 'price') {
    return deriveSellingPrice(vendorRule.amount, input.markup_percent);
  }

  if (vendorRule.type === 'percent') {
    const discountedCost = input.base_cost_price * (1 - vendorRule.amount / 100);
    return Number(discountedCost.toFixed(2)) <= 0
      ? undefined
      : Number((input.base_sell_price * (1 - vendorRule.amount / 100)).toFixed(2));
  }

  return undefined;
}

function toPriceListBulkTiers(
  vendorRules: NormalizedBulkPricingRule[] | undefined,
  input: {
    base_cost_price: number;
    base_sell_price: number;
    markup_percent: number;
  },
): PriceListBulkPricingTier[] | undefined {
  if (!vendorRules || vendorRules.length === 0) return undefined;

  const tiers = vendorRules
    .map(rule => {
      const price = toSellPriceFromVendorRule(rule, input);
      if (price === undefined) return null;
      const tier: PriceListBulkPricingTier = {
        quantity_min: rule.quantity_min,
        quantity_max: rule.quantity_max,
        type: 'price',
        amount: price,
      };
      return tier;
    })
    .filter((tier): tier is PriceListBulkPricingTier => !!tier);

  const dedupedTiers = tiers.filter(
    (tier, index) =>
      tiers.findIndex(
        candidate =>
          candidate.quantity_min === tier.quantity_min &&
          candidate.quantity_max === tier.quantity_max &&
          candidate.type === tier.type &&
          candidate.amount === tier.amount,
      ) === index,
  );

  const collapsedTiers = collapsePriceListBulkTiersByRange(dedupedTiers);
  return collapsedTiers.length > 0 ? collapsedTiers : undefined;
}

function collapsePriceListBulkTiersByRange(
  tiers: PriceListBulkPricingTier[],
): PriceListBulkPricingTier[] {
  const selected = new Map<string, PriceListBulkPricingTier>();

  for (const tier of tiers) {
    const key = [
      tier.quantity_min,
      typeof tier.quantity_max === 'number' ? tier.quantity_max : 'open',
      tier.type,
    ].join(':');
    const existing = selected.get(key);

    if (!existing || tier.amount < existing.amount) {
      selected.set(key, tier);
    }
  }

  return Array.from(selected.values()).sort((left, right) => {
    if (left.quantity_min !== right.quantity_min) {
      return left.quantity_min - right.quantity_min;
    }

    const leftMax = typeof left.quantity_max === 'number' ? left.quantity_max : Number.MAX_SAFE_INTEGER;
    const rightMax = typeof right.quantity_max === 'number' ? right.quantity_max : Number.MAX_SAFE_INTEGER;
    return leftMax - rightMax;
  });
}

function toVendorBulkRulesFromPart(part: PricingConfigurationPart | undefined): NormalizedBulkPricingRule[] | undefined {
  if (!part || part.price_tiers.length <= 1) return undefined;

  const baseTier = part.price_tiers[0];
  const rules = part.price_tiers
    .filter(tier => tier.min_quantity > baseTier.min_quantity)
    .map(
      tier =>
        ({
          quantity_min: tier.min_quantity,
          quantity_max: tier.quantity_max,
          type: 'price',
          amount: tier.price,
        }) satisfies NormalizedBulkPricingRule,
    );

  return rules.length > 0 ? rules : undefined;
}

function resolvePartProjection(
  product: NormalizedProduct,
  variant: NormalizedVariant,
): {
  vendor_cost_price: number;
  vendor_bulk_rules?: NormalizedBulkPricingRule[];
} {
  const partMap = new Map(
    (product.pricing_configuration?.parts ?? []).map(part => [part.part_id, part]),
  );
  const part = partMap.get(variant.part_id ?? variant.sku);
  const baseTier = part?.price_tiers[0];

  const vendor_cost_price =
    baseTier?.price ??
    variant.cost_price ??
    variant.price ??
    product.cost_price ??
    product.price ??
    0;

  return {
    vendor_cost_price,
    vendor_bulk_rules: collapseBulkPricingRulesByRange(
      toVendorBulkRulesFromPart(part) ?? product.bulk_pricing_rules ?? [],
    ),
  };
}

export function projectProductPricing(
  product: NormalizedProduct,
  context: PricingProjectionContext,
): ProductPricingProjection {
  const variants = (product.variants && product.variants.length > 0
    ? product.variants
    : [buildSyntheticVariant(product)]);

  const projectedVariants = variants.map(variant => {
    const { vendor_cost_price, vendor_bulk_rules } = resolvePartProjection(product, variant);
    const sellPrice =
      deriveSellingPrice(vendor_cost_price, context.markup_percent) ??
      variant.price ??
      product.price ??
      0;

    return {
      sku: variant.sku,
      part_id: variant.part_id,
      option_values: variant.option_values,
      cost_price: vendor_cost_price,
      price: sellPrice,
      bulk_pricing_rules: vendor_bulk_rules,
      price_list_bulk_tiers: toPriceListBulkTiers(vendor_bulk_rules, {
        base_cost_price: vendor_cost_price,
        base_sell_price: sellPrice,
        markup_percent: context.markup_percent,
      }),
    } satisfies VariantPricingProjection;
  });

  const defaultVariant = projectedVariants[0];
  const fallbackBulkPricingRules =
    defaultVariant && defaultVariant.bulk_pricing_rules
      ? derivePercentBulkPricingRulesFromCost({
          base_cost_price: defaultVariant.cost_price,
          vendor_rules: defaultVariant.bulk_pricing_rules,
        })
      : undefined;

  return {
    markup_percent: context.markup_percent,
    currency: context.currency,
    price_list_id: context.price_list_id,
    product_fallback: {
      cost_price: defaultVariant?.cost_price ?? product.cost_price ?? product.price,
      price: defaultVariant?.price ?? product.price,
      bulk_pricing_rules: fallbackBulkPricingRules,
    },
    variants: projectedVariants,
  };
}
