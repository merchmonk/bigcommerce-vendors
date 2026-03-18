import type { NormalizedBulkPricingRule } from './productNormalizer';

export interface ProductCandidate {
  id: number;
  sku: string;
  name: string;
  vendor_marker?: string | null;
}

export interface DuplicateDecision {
  action: 'create' | 'update';
  duplicate: boolean;
  resolved_sku: string;
  target_product_id?: number;
  reason: string;
}

export function canonicalizeTaxonomyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function buildDuplicateSku(sourceSku: string, vendorId: number): string {
  return `${sourceSku}__v${vendorId}`;
}

function readVendorMarker(candidate: ProductCandidate | undefined): string | undefined {
  if (!candidate?.vendor_marker) return undefined;
  const value = String(candidate.vendor_marker).trim();
  return value || undefined;
}

export function classifyDuplicateDecision(input: {
  source_sku: string;
  source_name: string;
  vendor_id: number;
  candidates: ProductCandidate[];
}): DuplicateDecision {
  const exactSkuMatch = input.candidates.find(candidate => candidate.sku === input.source_sku);
  const exactNameMatch = input.candidates.find(candidate => candidate.name === input.source_name);
  const candidate = exactSkuMatch ?? exactNameMatch;

  if (!candidate) {
    return {
      action: 'create',
      duplicate: false,
      resolved_sku: input.source_sku,
      reason: 'No existing exact SKU or exact name match.',
    };
  }

  const marker = readVendorMarker(candidate);
  if (marker && marker !== String(input.vendor_id)) {
    return {
      action: 'create',
      duplicate: true,
      resolved_sku: buildDuplicateSku(input.source_sku, input.vendor_id),
      reason: `Matched product belongs to vendor ${marker}.`,
    };
  }

  return {
    action: 'update',
    duplicate: false,
    resolved_sku: input.source_sku,
    target_product_id: candidate.id,
    reason: marker ? `Matched same vendor marker ${marker}.` : 'Matched product has no vendor marker.',
  };
}

export function parseMarkupPercent(value: unknown, fallback = 30): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

export function deriveSellingPrice(costPrice: number | undefined, markupPercent: number): number | undefined {
  if (costPrice === undefined || !Number.isFinite(costPrice)) {
    return undefined;
  }
  return Number((costPrice * (1 + markupPercent / 100)).toFixed(2));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function derivePercentBulkPricingRulesFromCost(input: {
  base_cost_price?: number;
  vendor_rules?: NormalizedBulkPricingRule[];
}): NormalizedBulkPricingRule[] | undefined {
  if (input.base_cost_price === undefined || !Number.isFinite(input.base_cost_price)) {
    return undefined;
  }
  const rules = input.vendor_rules ?? [];
  if (rules.length === 0) return undefined;

  const normalized: NormalizedBulkPricingRule[] = [];
  for (const rule of rules) {
    if (rule.type === 'percent') {
      normalized.push({
        quantity_min: rule.quantity_min,
        quantity_max: rule.quantity_max,
        type: 'percent',
        amount: round2(rule.amount),
      });
      continue;
    }

    if (!Number.isFinite(rule.amount) || rule.amount >= input.base_cost_price) {
      continue;
    }

    const discountPercent = ((input.base_cost_price - rule.amount) / input.base_cost_price) * 100;
    if (!Number.isFinite(discountPercent) || discountPercent <= 0) {
      continue;
    }

    normalized.push({
      quantity_min: rule.quantity_min,
      quantity_max: rule.quantity_max,
      type: 'percent',
      amount: round2(discountPercent),
    });
  }
  normalized.sort((a, b) => a.quantity_min - b.quantity_min);

  return normalized.length > 0 ? normalized : undefined;
}
