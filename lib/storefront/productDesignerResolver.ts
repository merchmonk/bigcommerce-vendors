import type {
  BasePricing,
  ContractChargeRule,
  ContractChargeTier,
  ContractDecorationLocation,
  ContractDecorationMethod,
  ContractVariantCatalogEntry,
  PricingPreview,
  ProductDesignerDefaultsContract,
  ResolvedDecorationLocation,
  ResolvedDecorationMethod,
  ResolvedDesignerContract,
  VariantDesignerOverrideContract,
} from './productDesignerTypes';

type AnyRecord = Record<string, unknown>;

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeChargeType(type: string | undefined): 'setup' | 'run' | 'order' | 'other' {
  const normalized = type?.trim().toLowerCase();
  if (normalized === 'setup' || normalized === 'run' || normalized === 'order') {
    return normalized;
  }
  return 'other';
}

function resolveLocationIdentity(location: ContractDecorationLocation): string | undefined {
  return asString(location.locationId) ?? asString(location.id);
}

function resolveMethodPrintArea(method: ContractDecorationMethod): ContractDecorationMethod['printArea'] | undefined {
  if (!method.printArea) return undefined;

  const { geometry, width, height, diameter, uom } = method.printArea;
  if (
    geometry === undefined &&
    width === undefined &&
    height === undefined &&
    diameter === undefined &&
    uom === undefined
  ) {
    return undefined;
  }

  return method.printArea;
}

function resolveChargeTier(
  tiers: ContractChargeTier[] | undefined,
  quantity: number,
  decorationUnits: number,
): ContractChargeTier | undefined {
  if (!tiers || tiers.length === 0) return undefined;

  return [...tiers]
    .sort((left, right) => left.minQuantity - right.minQuantity)
    .filter(tier => {
      if (tier.minQuantity > quantity) return false;
      if (tier.minUnits !== undefined && tier.minUnits > decorationUnits) return false;
      return true;
    })
    .pop();
}

function resolveChargeMultiplier(charge: ContractChargeRule): number {
  const perLocation = charge.appliesPerLocation ?? 1;
  const perColor = charge.appliesPerColor ?? 1;
  return perLocation * perColor;
}

function cloneLocation(location: ContractDecorationLocation): ContractDecorationLocation {
  return {
    ...location,
    methods: (location.methods ?? []).map(method => ({
      ...method,
      charges: (method.charges ?? []).map(charge => ({
        ...charge,
        tiers: (charge.tiers ?? []).map(tier => ({ ...tier })),
      })),
    })),
  };
}

function toResolvedMethod(method: ContractDecorationMethod): ResolvedDecorationMethod | null {
  const id = asString(method.id) ?? asString(method.decorationId);
  const name = asString(method.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    ...(method.isDefault !== undefined ? { isDefault: method.isDefault } : {}),
    ...(method.unitsIncluded !== undefined ? { unitsIncluded: method.unitsIncluded } : {}),
    ...(method.unitsMax !== undefined ? { unitsMax: method.unitsMax } : {}),
    ...(resolveMethodPrintArea(method) ? { printArea: resolveMethodPrintArea(method) } : {}),
    ...(method.sourceHints ? { sourceHints: method.sourceHints } : {}),
    charges: (method.charges ?? [])
      .map(charge => {
        const chargeId = asString(charge.id);
        const chargeName = asString(charge.name);
        if (!chargeId || !chargeName) return null;

        return {
          id: chargeId,
          name: chargeName,
          type: normalizeChargeType(charge.type),
          ...(charge.appliesPerLocation !== undefined ? { appliesPerLocation: charge.appliesPerLocation } : {}),
          ...(charge.appliesPerColor !== undefined ? { appliesPerColor: charge.appliesPerColor } : {}),
          tiers: (charge.tiers ?? [])
            .filter(tier => Number.isFinite(tier.minQuantity) && Number.isFinite(tier.price))
            .map(tier => ({
              minQuantity: tier.minQuantity,
              ...(tier.minUnits !== undefined ? { minUnits: tier.minUnits } : {}),
              price: tier.price,
              ...(tier.repeatPrice !== undefined ? { repeatPrice: tier.repeatPrice } : {}),
            })),
        };
      })
      .filter((charge): charge is NonNullable<typeof charge> => !!charge),
  };
}

export function flattenOverrideKeys(
  override: VariantDesignerOverrideContract | Record<string, unknown> | null | undefined,
): string[] {
  if (!override) return [];

  const output = new Set<string>();
  const skipKeys = new Set(['contractVersion', 'partId', 'size', 'color']);

  function walk(value: unknown, prefix: string): void {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      if (prefix) output.add(prefix);
      return;
    }

    const record = value as AnyRecord;
    const entries = Object.entries(record).filter(([key]) => !skipKeys.has(key));
    if (entries.length === 0 && prefix) {
      output.add(prefix);
      return;
    }

    for (const [key, child] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      walk(child, nextPrefix);
    }
  }

  walk(override, '');
  return Array.from(output).sort();
}

export function resolveContractVariantCatalogEntry(
  productDesignerDefaults: ProductDesignerDefaultsContract,
  selectedVariant: {
    sku: string;
  },
): ContractVariantCatalogEntry | undefined {
  const variantCatalog = productDesignerDefaults.pricing?.variantCatalog ?? [];
  return variantCatalog.find(entry => entry.sku === selectedVariant.sku);
}

export function resolveBasePricing(input: {
  quantity: number;
  variantCatalog?: ContractVariantCatalogEntry;
  productDesignerDefaults: ProductDesignerDefaultsContract;
  fallbackUnitBlankPrice: number;
}): BasePricing {
  const sortedTiers = [...(input.variantCatalog?.priceTiers ?? [])].sort(
    (left, right) => left.minQuantity - right.minQuantity,
  );
  const appliedTier = sortedTiers.filter(tier => tier.minQuantity <= input.quantity).pop();
  const unitBlankPrice = appliedTier?.price ?? input.fallbackUnitBlankPrice;

  return {
    currencyCode: input.productDesignerDefaults.pricing?.currency ?? 'USD',
    quantity: input.quantity,
    ...(input.productDesignerDefaults.pricing?.priceListId !== undefined
      ? { priceListId: input.productDesignerDefaults.pricing.priceListId }
      : {}),
    unitBlankPrice,
    ...(appliedTier
      ? {
          tierApplied: {
            minQuantity: appliedTier.minQuantity,
            source: 'contract' as const,
          },
        }
      : {}),
    ...(input.productDesignerDefaults.fobPoints ? { fobPoints: input.productDesignerDefaults.fobPoints } : {}),
  };
}

export function resolveDesignerContract(
  productDesignerDefaults: ProductDesignerDefaultsContract,
  variantOverride?: VariantDesignerOverrideContract,
): ResolvedDesignerContract {
  const applicableLocationIds = new Set(variantOverride?.applicableLocationIds ?? []);
  const locations = (productDesignerDefaults.locations ?? [])
    .map(cloneLocation)
    .filter(location => {
      if (applicableLocationIds.size === 0) return true;
      const locationIdentity = resolveLocationIdentity(location);
      return !!locationIdentity && applicableLocationIds.has(locationIdentity);
    })
    .map(location => {
      const resolvedMethods = (location.methods ?? [])
        .map(method => {
          const resolved = toResolvedMethod(method);
          if (!resolved) return null;
          return resolved;
        })
        .filter((method): method is ResolvedDecorationMethod => !!method);

      const firstMethodWithPrintArea = resolvedMethods.find(method => method.printArea);

      return {
        id: asString(location.id) ?? asString(location.locationId) ?? 'location',
        name: asString(location.name) ?? asString(location.locationId) ?? 'Location',
        includedDecorations: location.includedDecorations ?? 0,
        minDecorations: location.minDecorations ?? 0,
        maxDecorations: location.maxDecorations ?? 0,
        ...(firstMethodWithPrintArea?.printArea ? { printableArea: firstMethodWithPrintArea.printArea } : {}),
        methods: resolvedMethods,
      } satisfies ResolvedDecorationLocation;
    })
    .filter(location => location.methods.length > 0 || location.name.length > 0);

  return {
    contractVersion: variantOverride?.contractVersion ?? productDesignerDefaults.contractVersion,
    locations,
  };
}

export function buildPricingPreview(input: {
  quantity: number;
  currencyCode: string;
  blankUnitPrice: number;
  designer: ResolvedDesignerContract;
}): PricingPreview {
  const defaultLocation =
    input.designer.locations.find(location =>
      location.methods.some(method => method.isDefault),
    ) ?? input.designer.locations[0];
  const defaultMethod =
    defaultLocation?.methods.find(method => method.isDefault) ?? defaultLocation?.methods[0];

  let decorationUnitPrice = 0;
  let oneTimeCharges = 0;

  if (defaultLocation && defaultMethod) {
    const decorationUnits = Math.max(
      defaultLocation.minDecorations,
      defaultLocation.includedDecorations,
      1,
    );

    for (const charge of defaultMethod.charges) {
      const tier = resolveChargeTier(charge.tiers, input.quantity, decorationUnits);
      if (!tier) continue;
      const multiplier = resolveChargeMultiplier(charge);
      const effectivePrice = (tier.repeatPrice ?? tier.price) * multiplier;

      if (charge.type === 'setup' || charge.type === 'order') {
        oneTimeCharges += effectivePrice;
        continue;
      }

      if (charge.type === 'run') {
        decorationUnitPrice += effectivePrice;
      }
    }
  }

  const recurringCharges = round2(decorationUnitPrice * input.quantity);
  const estimatedLineTotal = round2((input.blankUnitPrice * input.quantity) + recurringCharges + oneTimeCharges);

  return {
    quantity: input.quantity,
    currencyCode: input.currencyCode,
    blankUnitPrice: round2(input.blankUnitPrice),
    decorationUnitPrice: round2(decorationUnitPrice),
    oneTimeCharges: round2(oneTimeCharges),
    recurringCharges,
    estimatedUnitSellPrice: round2(estimatedLineTotal / input.quantity),
    estimatedLineTotal,
  };
}
