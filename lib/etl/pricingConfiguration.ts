import type {
  NormalizedBulkPricingRule,
  NormalizedProduct,
  PricingConfigurationCharge,
  PricingConfigurationChargeTier,
  PricingConfigurationDecoration,
  PricingConfigurationDecorationColor,
  PricingConfigurationFobPoint,
  PricingConfigurationLocation,
  PricingConfigurationPart,
  PricingConfigurationPartPriceTier,
  ProductPricingConfiguration,
} from './productNormalizer';

type AnyRecord = Record<string, unknown>;
type PricingRequestDefaults = {
  currency?: string;
  price_type?: string;
  configuration_type?: string;
};

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function walkNodes(value: unknown, callback: (node: AnyRecord) => void): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => walkNodes(item, callback));
    return;
  }
  if (typeof value !== 'object') return;

  const node = value as AnyRecord;
  callback(node);
  Object.values(node).forEach(child => walkNodes(child, callback));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function getFirstString(node: AnyRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function getFirstNumber(node: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toNumber(node[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function dedupeStrings(values: Array<string | undefined>): string[] | undefined {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output.length > 0 ? output : undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return undefined;
}

function readIdArrayValues(value: unknown, key: string): string[] | undefined {
  return dedupeStrings(
    asArray(value).map(item => {
      const record = asRecord(item);
      if (record) {
        return getFirstString(record, [key]);
      }
      return toStringValue(item);
    }),
  );
}

function findConfigurationNodes(payload: unknown): AnyRecord[] {
  const nodes: AnyRecord[] = [];
  walkNodes(payload, node => {
    const configNode = asRecord(node.Configuration);
    if (configNode) {
      nodes.push(configNode);
      return;
    }

    if ((node.PartArray || node.LocationArray) && node.productId) {
      nodes.push(node);
    }
  });
  return nodes;
}

function parsePartPriceTier(
  node: AnyRecord,
  defaults?: PricingRequestDefaults,
): PricingConfigurationPartPriceTier | null {
  const minQuantity = getFirstNumber(node, ['minQuantity']);
  const price = getFirstNumber(node, ['price']);
  if (minQuantity === undefined || price === undefined) return null;

  return {
    min_quantity: minQuantity,
    price,
    quantity_max: getFirstNumber(node, ['quantityMax']),
    price_uom: getFirstString(node, ['priceUom']),
    currency: defaults?.currency,
    price_type: defaults?.price_type,
    configuration_type: defaults?.configuration_type,
    discount_code: getFirstString(node, ['discountCode']),
    price_effective_date: getFirstString(node, ['priceEffectiveDate']),
    price_expiry_date: getFirstString(node, ['priceExpiryDate']),
  };
}

function parseChargeTier(node: AnyRecord): PricingConfigurationChargeTier | null {
  const xMinQty = getFirstNumber(node, ['xMinQty']);
  const price = getFirstNumber(node, ['price']);
  if (xMinQty === undefined || price === undefined) return null;

  return {
    x_min_qty: xMinQty,
    x_uom: getFirstString(node, ['xUom']),
    y_min_qty: getFirstNumber(node, ['yMinQty']),
    y_uom: getFirstString(node, ['yUom']),
    price,
    repeat_price: getFirstNumber(node, ['repeatPrice']),
    discount_code: getFirstString(node, ['discountCode']),
    repeat_discount_code: getFirstString(node, ['repeatDiscountCode']),
    price_effective_date: getFirstString(node, ['priceEffectiveDate']),
    price_expiry_date: getFirstString(node, ['priceExpiryDate']),
  };
}

function parseCharge(node: AnyRecord): PricingConfigurationCharge {
  const chargePriceArray = asRecord(node.ChargePriceArray);
  const chargePriceTiers = asArray(chargePriceArray?.ChargePrice)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(parseChargeTier)
    .filter((item): item is PricingConfigurationChargeTier => !!item)
    .sort((a, b) => a.x_min_qty - b.x_min_qty);

  return {
    charge_id: getFirstString(node, ['chargeId']),
    charge_name: getFirstString(node, ['chargeName']),
    charge_description: getFirstString(node, ['chargeDescription']),
    charge_type: getFirstString(node, ['chargeType']),
    charges_applies_ltm: toBoolean(node.chargeAppliesLTM ?? node.chargesAppliesLTM),
    charges_per_location: getFirstNumber(node, ['chargesPerLocation']),
    charges_per_color: getFirstNumber(node, ['chargesPerColor']),
    charge_price_tiers: chargePriceTiers,
  };
}

function parseDecoration(node: AnyRecord): PricingConfigurationDecoration {
  const chargeArray = asRecord(node.ChargeArray);
  const charges = asArray(chargeArray?.Charge)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(parseCharge);

  return {
    decoration_id: getFirstString(node, ['decorationId']),
    decoration_name: getFirstString(node, ['decorationName']),
    decoration_geometry: getFirstString(node, ['decorationGeometry']),
    decoration_height: getFirstNumber(node, ['decorationHeight']),
    decoration_width: getFirstNumber(node, ['decorationWidth']),
    decoration_diameter: getFirstNumber(node, ['decorationDiameter']),
    decoration_uom: getFirstString(node, ['decorationUom']),
    allow_sub_for_default_location: toBoolean(node.allowSubForDefaultLocation),
    allow_sub_for_default_method: toBoolean(node.allowSubForDefaultMethod),
    item_part_quantity_ltm: getFirstNumber(node, ['itemPartQuantityLTM']),
    decoration_units_included: getFirstNumber(node, ['decorationUnitsIncluded']),
    decoration_units_included_uom: getFirstString(node, ['decorationUnitsIncludedUom']),
    decoration_units_max: getFirstNumber(node, ['decorationUnitsMax']),
    default_decoration: toBoolean(node.defaultDecoration),
    lead_time_days: getFirstNumber(node, ['leadTime']),
    rush_lead_time_days: getFirstNumber(node, ['rushLeadTime']),
    charges,
  };
}

function parseLocation(node: AnyRecord): PricingConfigurationLocation {
  const decorationArray = asRecord(node.DecorationArray);
  const decorations = asArray(decorationArray?.Decoration)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(parseDecoration);

  return {
    location_id: getFirstString(node, ['locationId']),
    location_name: getFirstString(node, ['locationName']),
    decorations_included: getFirstNumber(node, ['decorationsIncluded']),
    default_location: toBoolean(node.defaultLocation),
    max_decoration: getFirstNumber(node, ['maxDecoration']),
    min_decoration: getFirstNumber(node, ['minDecoration']),
    location_rank: getFirstNumber(node, ['locationRank']),
    decorations,
  };
}

function parsePart(node: AnyRecord, defaults?: PricingRequestDefaults): PricingConfigurationPart | null {
  const partId = getFirstString(node, ['partId']);
  if (!partId) return null;

  const partPriceArray = asRecord(node.PartPriceArray);
  const priceTiers = asArray(partPriceArray?.PartPrice)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item => parsePartPriceTier(item, defaults))
    .filter((item): item is PricingConfigurationPartPriceTier => !!item)
    .sort((a, b) => a.min_quantity - b.min_quantity);

  const locationIdArray = asRecord(node.LocationIdArray);
  const locationIds = readIdArrayValues(locationIdArray?.LocationId, 'locationId');

  return {
    part_id: partId,
    part_description: getFirstString(node, ['partDescription']),
    part_group: getFirstString(node, ['partGroup']),
    next_part_group: getFirstString(node, ['nextPartGroup']),
    part_group_required: toBoolean(node.partGroupRequired),
    part_group_description: getFirstString(node, ['partGroupDescription']),
    ratio: getFirstNumber(node, ['ratio']),
    default_part: toBoolean(node.defaultPart),
    location_ids: locationIds,
    price_tiers: priceTiers,
  };
}

function parseConfigurationNode(
  node: AnyRecord,
  defaults?: PricingRequestDefaults,
): ProductPricingConfiguration {
  const partArray = asRecord(node.PartArray);
  const locationArray = asRecord(node.LocationArray);
  const fobArray = asRecord(node.FobArray);

  const parts = asArray(partArray?.Part)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(item =>
      parsePart(item, {
        currency: getFirstString(node, ['currency']) ?? defaults?.currency,
        price_type: getFirstString(node, ['priceType']) ?? defaults?.price_type,
        configuration_type: getFirstString(node, ['configurationType']) ?? defaults?.configuration_type,
      }),
    )
    .filter((item): item is PricingConfigurationPart => !!item);

  const locations = asArray(locationArray?.Location)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(parseLocation);

  const fobPoints = asArray(fobArray?.Fob)
    .map(item => asRecord(item))
    .filter((item): item is AnyRecord => !!item)
    .map(
      fob =>
        ({
          fob_id: getFirstString(fob, ['fobId']),
          city: getFirstString(fob, ['fobCity']),
          state: getFirstString(fob, ['fobState']),
          postal_code: getFirstString(fob, ['fobPostalCode']),
          country: getFirstString(fob, ['fobCountry']),
        }) satisfies PricingConfigurationFobPoint,
    );

  return {
    product_id: getFirstString(node, ['productId']),
    currency: getFirstString(node, ['currency']) ?? defaults?.currency,
    price_type: getFirstString(node, ['priceType']) ?? defaults?.price_type,
    configuration_type: getFirstString(node, ['configurationType']) ?? defaults?.configuration_type,
    fob_postal_code: getFirstString(node, ['fobPostalCode']),
    parts,
    locations,
    fob_points: fobPoints,
  };
}

function mergePartPriceTiers(
  current: PricingConfigurationPartPriceTier[],
  incoming: PricingConfigurationPartPriceTier[],
): PricingConfigurationPartPriceTier[] {
  const merged = [...current];
  for (const tier of incoming) {
    const existing = merged.find(
      item =>
        item.min_quantity === tier.min_quantity &&
        item.quantity_max === tier.quantity_max &&
        item.price === tier.price &&
        item.price_uom === tier.price_uom &&
        item.currency === tier.currency &&
        item.price_type === tier.price_type &&
        item.configuration_type === tier.configuration_type,
    );
    if (!existing) {
      merged.push(tier);
    }
  }
  return merged.sort((a, b) => a.min_quantity - b.min_quantity);
}

function mergeChargePriceTiers(
  current: PricingConfigurationChargeTier[],
  incoming: PricingConfigurationChargeTier[],
): PricingConfigurationChargeTier[] {
  const merged = [...current];
  for (const tier of incoming) {
    const existing = merged.find(
      item =>
        item.x_min_qty === tier.x_min_qty &&
        item.y_min_qty === tier.y_min_qty &&
        item.price === tier.price &&
        item.repeat_price === tier.repeat_price,
    );
    if (!existing) {
      merged.push(tier);
    }
  }
  return merged.sort((a, b) => a.x_min_qty - b.x_min_qty);
}

function mergeCharges(
  current: PricingConfigurationCharge[],
  incoming: PricingConfigurationCharge[],
): PricingConfigurationCharge[] {
  const byKey = new Map<string, PricingConfigurationCharge>();
  for (const charge of current) {
    const key = `${charge.charge_id ?? ''}|${charge.charge_name ?? ''}`;
    byKey.set(key, charge);
  }

  for (const charge of incoming) {
    const key = `${charge.charge_id ?? ''}|${charge.charge_name ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, charge);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...charge,
      charge_price_tiers: mergeChargePriceTiers(existing.charge_price_tiers, charge.charge_price_tiers),
    });
  }

  return Array.from(byKey.values());
}

function mergeDecorations(
  current: PricingConfigurationDecoration[],
  incoming: PricingConfigurationDecoration[],
): PricingConfigurationDecoration[] {
  const byKey = new Map<string, PricingConfigurationDecoration>();
  for (const decoration of current) {
    const key = `${decoration.decoration_id ?? ''}|${decoration.decoration_name ?? ''}`;
    byKey.set(key, decoration);
  }

  for (const decoration of incoming) {
    const key = `${decoration.decoration_id ?? ''}|${decoration.decoration_name ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, decoration);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...decoration,
      charges: mergeCharges(existing.charges, decoration.charges),
    });
  }

  return Array.from(byKey.values());
}

function mergeLocations(
  current: PricingConfigurationLocation[],
  incoming: PricingConfigurationLocation[],
): PricingConfigurationLocation[] {
  const byKey = new Map<string, PricingConfigurationLocation>();
  for (const location of current) {
    const key = `${location.location_id ?? ''}|${location.location_name ?? ''}`;
    byKey.set(key, location);
  }

  for (const location of incoming) {
    const key = `${location.location_id ?? ''}|${location.location_name ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, location);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...location,
      decorations: mergeDecorations(existing.decorations, location.decorations),
    });
  }

  return Array.from(byKey.values());
}

function mergeParts(
  current: PricingConfigurationPart[],
  incoming: PricingConfigurationPart[],
): PricingConfigurationPart[] {
  const byPartId = new Map<string, PricingConfigurationPart>();
  for (const part of current) {
    byPartId.set(part.part_id, part);
  }

  for (const part of incoming) {
    const existing = byPartId.get(part.part_id);
    if (!existing) {
      byPartId.set(part.part_id, part);
      continue;
    }

    byPartId.set(part.part_id, {
      ...existing,
      ...part,
      location_ids: dedupeStrings([...(existing.location_ids ?? []), ...(part.location_ids ?? [])]),
      price_tiers: mergePartPriceTiers(existing.price_tiers, part.price_tiers),
    });
  }

  return Array.from(byPartId.values());
}

function mergeFobPoints(
  current: PricingConfigurationFobPoint[],
  incoming: PricingConfigurationFobPoint[],
): PricingConfigurationFobPoint[] {
  const byKey = new Map<string, PricingConfigurationFobPoint>();
  for (const point of current) {
    const key = `${point.fob_id ?? ''}|${point.postal_code ?? ''}`;
    byKey.set(key, point);
  }
  for (const point of incoming) {
    const key = `${point.fob_id ?? ''}|${point.postal_code ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, point);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...point,
      supported_currencies: dedupeStrings([
        ...(existing.supported_currencies ?? []),
        ...(point.supported_currencies ?? []),
      ]),
      product_ids: dedupeStrings([
        ...(existing.product_ids ?? []),
        ...(point.product_ids ?? []),
      ]),
    });
  }
  return Array.from(byKey.values());
}

function mergeDecorationColors(
  current: PricingConfigurationDecorationColor[],
  incoming: PricingConfigurationDecorationColor[],
): PricingConfigurationDecorationColor[] {
  const byKey = new Map<string, PricingConfigurationDecorationColor>();
  for (const decorationColor of current) {
    const key = `${decorationColor.product_id ?? ''}|${decorationColor.location_id ?? ''}`;
    byKey.set(key, decorationColor);
  }

  for (const decorationColor of incoming) {
    const key = `${decorationColor.product_id ?? ''}|${decorationColor.location_id ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, decorationColor);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...decorationColor,
      colors: Array.from(
        new Map(
          [...existing.colors, ...decorationColor.colors].map(color => [
            `${color.color_id ?? ''}|${color.color_name ?? ''}`,
            color,
          ]),
        ).values(),
      ),
      decoration_methods: Array.from(
        new Map(
          [...existing.decoration_methods, ...decorationColor.decoration_methods].map(method => [
            `${method.decoration_id ?? ''}|${method.decoration_name ?? ''}`,
            method,
          ]),
        ).values(),
      ),
    });
  }

  return Array.from(byKey.values());
}

function extractAvailableLocations(payloads: unknown[]): Array<{ location_id?: string; location_name?: string }> | undefined {
  const locations: Array<{ location_id?: string; location_name?: string }> = [];
  for (const payload of payloads) {
    walkNodes(payload, node => {
      const locationArray = asRecord(node.AvailableLocationArray);
      if (!locationArray) return;
      const discovered = asArray(locationArray.AvailableLocation)
        .map(item => asRecord(item))
        .filter((item): item is AnyRecord => !!item)
        .map(item => ({
          location_id: getFirstString(item, ['locationId']),
          location_name: getFirstString(item, ['locationName']),
        }));
      locations.push(...discovered);
    });
  }

  const deduped = dedupeStrings(
    locations.map(location => `${location.location_id ?? ''}|${location.location_name ?? ''}`),
  );
  if (!deduped) return undefined;

  return deduped.map(key => {
    const [location_id, location_name] = key.split('|');
    return {
      location_id: location_id || undefined,
      location_name: location_name || undefined,
    };
  });
}

function extractAvailableCharges(
  payloads: unknown[],
): ProductPricingConfiguration['available_charges'] {
  const charges: NonNullable<ProductPricingConfiguration['available_charges']> = [];
  for (const payload of payloads) {
    walkNodes(payload, node => {
      const chargeArray = asRecord(node.AvailableChargeArray);
      if (!chargeArray) return;
      const discovered = asArray(chargeArray.AvailableCharge)
        .map(item => asRecord(item))
        .filter((item): item is AnyRecord => !!item)
        .map(item => ({
          charge_id: getFirstString(item, ['chargeId']),
          charge_name: getFirstString(item, ['chargeName']),
          charge_description: getFirstString(item, ['chargeDescription']),
          charge_type: getFirstString(item, ['chargeType']),
        }));
      charges.push(...discovered);
    });
  }

  const byKey = new Map<string, (typeof charges)[number]>();
  for (const charge of charges) {
    const key = `${charge.charge_id ?? ''}|${charge.charge_name ?? ''}`;
    if (!byKey.has(key)) {
      byKey.set(key, charge);
    }
  }
  const merged = Array.from(byKey.values());
  return merged.length > 0 ? merged : undefined;
}

function extractDecorationColors(
  payloads: unknown[],
): ProductPricingConfiguration['decoration_colors'] {
  const values: PricingConfigurationDecorationColor[] = [];
  for (const payload of payloads) {
    walkNodes(payload, node => {
      const decorationColors = asRecord(node.DecorationColors);
      const source = decorationColors ?? (node.ColorArray || node.DecorationMethodArray ? node : null);
      if (!source) return;

      const colorArray = asRecord(source.ColorArray);
      const decorationMethodArray = asRecord(source.DecorationMethodArray);
      values.push({
        product_id: getFirstString(source, ['productId']),
        location_id: getFirstString(source, ['locationId']),
        pms_match: toBoolean(source.pmsMatch),
        full_color: toBoolean(source.fullColor),
        colors: asArray(colorArray?.Color)
          .map(item => asRecord(item))
          .filter((item): item is AnyRecord => !!item)
          .map(item => ({
            color_id: getFirstString(item, ['colorId']),
            color_name: getFirstString(item, ['colorName']),
          })),
        decoration_methods: asArray(decorationMethodArray?.DecorationMethod)
          .map(item => asRecord(item))
          .filter((item): item is AnyRecord => !!item)
          .map(item => ({
            decoration_id: getFirstString(item, ['decorationId']),
            decoration_name: getFirstString(item, ['decorationName']),
          })),
      });
    });
  }

  const merged = mergeDecorationColors([], values);
  return merged.length > 0 ? merged : undefined;
}

function extractFobPoints(payloads: unknown[]): PricingConfigurationFobPoint[] {
  const points: PricingConfigurationFobPoint[] = [];
  for (const payload of payloads) {
    walkNodes(payload, node => {
      const fobPointArray = asRecord(node.FobPointArray);
      if (!fobPointArray) return;
      const discovered = asArray(fobPointArray.FobPoint)
        .map(item => asRecord(item))
        .filter((item): item is AnyRecord => !!item)
        .map(
          point =>
            ({
              fob_id: getFirstString(point, ['fobId']),
              city: getFirstString(point, ['fobCity']),
              state: getFirstString(point, ['fobState']),
              postal_code: getFirstString(point, ['fobPostalCode']),
              country: getFirstString(point, ['fobCountry']),
              supported_currencies: readIdArrayValues(asRecord(point.CurrencySupportedArray)?.CurrencySupported, 'currency'),
              product_ids: readIdArrayValues(asRecord(point.ProductArray)?.Product, 'productId'),
            }) satisfies PricingConfigurationFobPoint,
        );
      points.push(...discovered);
    });
  }

  return mergeFobPoints([], points);
}

export function buildProductPricingConfiguration(payloads: unknown[]): ProductPricingConfiguration | undefined {
  const payloadEntries = payloads.map(payload => {
    const record = asRecord(payload);
    const envelopePayload =
      record && Object.hasOwn(record, '__pricing_payload')
        ? record.__pricing_payload
        : payload;
    const requestContext = asRecord(record?.__pricing_request_context);
    return {
      payload: envelopePayload,
      defaults: {
        currency: getFirstString(requestContext ?? {}, ['currency']),
        price_type: getFirstString(requestContext ?? {}, ['priceType', 'price_type']),
        configuration_type: getFirstString(requestContext ?? {}, ['configurationType', 'configuration_type']),
      } satisfies PricingRequestDefaults,
    };
  });
  const configurationNodes = payloadEntries.flatMap(entry =>
    findConfigurationNodes(entry.payload).map(node => ({
      node,
      defaults: entry.defaults,
    })),
  );
  if (configurationNodes.length === 0 && payloadEntries.length === 0) {
    return undefined;
  }

  let merged: ProductPricingConfiguration | undefined;
  for (const entry of configurationNodes) {
    const parsed = parseConfigurationNode(entry.node, entry.defaults);
    if (!merged) {
      merged = parsed;
      continue;
    }

    merged = {
      product_id: merged.product_id ?? parsed.product_id,
      currency: merged.currency ?? parsed.currency,
      price_type: merged.price_type ?? parsed.price_type,
      configuration_type: merged.configuration_type ?? parsed.configuration_type,
      fob_postal_code: merged.fob_postal_code ?? parsed.fob_postal_code,
      parts: mergeParts(merged.parts, parsed.parts),
      locations: mergeLocations(merged.locations, parsed.locations),
      fob_points: mergeFobPoints(merged.fob_points, parsed.fob_points),
      available_locations: merged.available_locations,
      available_charges: merged.available_charges,
      decoration_colors: merged.decoration_colors,
    };
  }

  const rawPayloads = payloadEntries.map(entry => entry.payload);
  const availableLocations = extractAvailableLocations(rawPayloads);
  const availableCharges = extractAvailableCharges(rawPayloads);
  const decorationColors = extractDecorationColors(rawPayloads);
  const standaloneFobPoints = extractFobPoints(rawPayloads);

  if (!merged) {
    if (!availableLocations && !availableCharges && !decorationColors && standaloneFobPoints.length === 0) {
      return undefined;
    }

    merged = {
      parts: [],
      locations: [],
      fob_points: standaloneFobPoints,
    };
  } else {
    merged.fob_points = mergeFobPoints(merged.fob_points, standaloneFobPoints);
  }

  if (availableLocations) {
    merged.available_locations = availableLocations;
  }
  if (availableCharges) {
    merged.available_charges = availableCharges;
  }
  if (decorationColors) {
    merged.decoration_colors = decorationColors;
  }

  return merged;
}

function resolvePurchaseQuantityRange(
  priceTiers: PricingConfigurationPartPriceTier[],
): { min_purchase_quantity?: number; max_purchase_quantity?: number } {
  if (priceTiers.length === 0) {
    return {};
  }

  const maxValues = priceTiers
    .map(tier => tier.quantity_max)
    .filter((value): value is number => value !== undefined);

  return {
    min_purchase_quantity: priceTiers[0]?.min_quantity,
    ...(maxValues.length > 0 ? { max_purchase_quantity: Math.max(...maxValues) } : {}),
  };
}

function toBulkPricingRules(priceTiers: PricingConfigurationPartPriceTier[]): NormalizedBulkPricingRule[] | undefined {
  if (priceTiers.length <= 1) return undefined;

  const baseTier = priceTiers[0];
  const rules = priceTiers
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

export function applyPricingConfigurationToProduct(
  product: NormalizedProduct,
  configuration: ProductPricingConfiguration | undefined,
): NormalizedProduct {
  if (!configuration) {
    return product;
  }

  const partMap = new Map(configuration.parts.map(part => [part.part_id, part]));
  const variants = (product.variants ?? []).map(variant => {
    const part = partMap.get(variant.part_id ?? variant.sku);
    if (!part || part.price_tiers.length === 0) {
      return variant;
    }

    const baseTier = part.price_tiers[0];
    return {
      ...variant,
      cost_price: baseTier.price,
      price: baseTier.price,
      ...resolvePurchaseQuantityRange(part.price_tiers),
    };
  });

  const defaultPart =
    configuration.parts.find(part => part.default_part) ??
    (variants.length > 0
      ? configuration.parts.find(part => part.part_id === (variants[0]?.part_id ?? variants[0]?.sku))
      : configuration.parts[0]);

  const baseTier = defaultPart?.price_tiers[0];
  const bulkRules = defaultPart ? toBulkPricingRules(defaultPart.price_tiers) : undefined;

  return {
    ...product,
    price: baseTier?.price ?? product.price,
    cost_price: baseTier?.price ?? product.cost_price,
    ...(defaultPart ? resolvePurchaseQuantityRange(defaultPart.price_tiers) : {}),
    bulk_pricing_rules: bulkRules ?? product.bulk_pricing_rules,
    variants: variants.length > 0 ? variants : product.variants,
    pricing_configuration: configuration,
  };
}
