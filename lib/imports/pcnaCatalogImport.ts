import type {
  NormalizedMediaAsset,
  NormalizedProduct,
  NormalizedVariant,
  ProductDataLocationDecorationSnapshot,
  ProductDataSnapshot,
  PricingConfigurationPartPriceTier,
  PricingConfigurationDecoration,
  PricingConfigurationLocation,
  PricingConfigurationPart,
} from '../etl/productNormalizer';

export interface PcnaProductDataRow {
  Division: string;
  Brand: string;
  PCNA_Style_Number: string;
  PCNA_SKU_Number: string;
  CategoryWeb: string;
  SubCategoryWeb: string;
  ItemName: string;
  SeriesName: string;
  Description: string;
  MARKET_COLORS: string;
  Product_Dimensions: string;
  Product_Size: string;
  Product_Weight: string;
  MaterialsDescription: string;
  EffectiveDate: string;
  PackagingDetails: string;
  MemorySize: string;
  Hazmat: string;
  Caution: string;
  CautionComments: string;
  ColorHexCode?: string;
  CanonicalUrl?: string;
  UnitOfMeasure?: string;
}

export interface PcnaPricingRow {
  SKU: string;
  Style: string;
  quantityMin: string;
  price: string;
  discountCode: string;
  CurrencyID: string;
  PriceType: string;
  PriceDescription: string;
}

export interface PcnaMediaRow {
  Style: string;
  Sku: string;
  Url: string;
  Description: string;
  MediaType: string;
  ClassTypeName: string;
  ClassTypeId: string;
}

export interface PcnaDecorationRow {
  SKU: string;
  Style: string;
  DecorationId: string;
  DecorationName: string;
  Priority: string;
  MaxLength: string;
  MaxHeight: string;
  LocationName: string;
  LocationId: string;
}

export interface PcnaCatalogImportInput {
  vendorId: number;
  vendorName?: string;
  markupPercent: number;
  productDataRows: PcnaProductDataRow[];
  pricingRows: PcnaPricingRow[];
  mediaRows?: PcnaMediaRow[];
  mediaRowsByStyle?: Map<string, PcnaMediaRow[]>;
  decorationRows: PcnaDecorationRow[];
  productDataSnapshotsByStyle?: Map<string, ProductDataSnapshot>;
}

export interface PcnaCatalogImportReport {
  total_products: number;
  simple_products: number;
  variant_products: number;
  total_variants: number;
  products_with_media: number;
  products_with_decorations: number;
  missing_pricing_rows: number;
}

export interface PcnaCatalogImportResult {
  products: NormalizedProduct[];
  report: PcnaCatalogImportReport;
}

interface ParsedDimensions {
  height?: number;
  width?: number;
  depth?: number;
}

type PriceTier = PricingConfigurationPartPriceTier;

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function normalizeLower(value: string | undefined | null): string {
  return normalizeText(value).toLowerCase();
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const trimmed = normalizeText(value);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(trimmed);
  }

  return deduped;
}

function parseNumber(value: string | undefined | null): number | undefined {
  const trimmed = normalizeText(value);
  if (!trimmed) return undefined;

  const normalized = trimmed.replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseWeightInPounds(value: string | undefined | null): number | undefined {
  const trimmed = normalizeText(value);
  if (!trimmed) return undefined;

  const match = trimmed.match(/([\d.]+)\s*([A-Za-z]+)/);
  if (!match) {
    return parseNumber(trimmed);
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;

  const unit = match[2].toUpperCase();
  if (unit === 'LB' || unit === 'LBS') {
    return amount;
  }
  if (unit === 'OZ') {
    return Number((amount / 16).toFixed(4));
  }
  return amount;
}

function parseDimensions(value: string | undefined | null): ParsedDimensions {
  const trimmed = normalizeText(value);
  if (!trimmed) return {};

  const match = trimmed.match(/([\d.]+)\s*H\s*x\s*([\d.]+)\s*W\s*x\s*([\d.]+)\s*L/i);
  if (!match) return {};

  const height = Number(match[1]);
  const width = Number(match[2]);
  const depth = Number(match[3]);
  return {
    ...(Number.isFinite(height) ? { height } : {}),
    ...(Number.isFinite(width) ? { width } : {}),
    ...(Number.isFinite(depth) ? { depth } : {}),
  };
}

function parseColorLabel(value: string | undefined | null): string | undefined {
  const trimmed = normalizeText(value);
  if (!trimmed) return undefined;

  const withoutSuffix = trimmed.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return withoutSuffix || trimmed;
}

function parseColorHex(value: string | undefined | null): string | undefined {
  const normalized = normalizeText(value).replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(normalized) ? normalized.toLowerCase() : undefined;
}

function parseBoolean(value: string | undefined | null): boolean | undefined {
  const normalized = normalizeLower(value);
  if (!normalized) return undefined;
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', '0'].includes(normalized)) return false;
  return undefined;
}

function toTitleCase(value: string | undefined): string | undefined {
  const trimmed = normalizeText(value);
  if (!trimmed) return undefined;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

function parsePricingFamily(row: PcnaPricingRow): {
  currency?: string;
  price_type?: string;
  configuration_type?: string;
} {
  const currency = normalizeText(row.CurrencyID) || undefined;
  const familySource = normalizeText(row.PriceDescription) || normalizeText(row.PriceType);
  if (!familySource) {
    return { currency };
  }

  const normalized = familySource.replace(/_\d+$/, '');
  const rawTokens = normalized.split(/[-/]/).map(token => normalizeText(token)).filter(Boolean);
  const tokens =
    rawTokens.length > 0 && currency && normalizeLower(rawTokens[0]) === normalizeLower(currency)
      ? rawTokens.slice(1)
      : rawTokens;

  if (tokens.length === 0) {
    return { currency };
  }

  const [priceType, ...configurationTokens] = tokens;
  return {
    ...(currency ? { currency } : {}),
    ...(toTitleCase(priceType) ? { price_type: toTitleCase(priceType) } : {}),
    ...(configurationTokens.length > 0
      ? { configuration_type: configurationTokens.map(token => toTitleCase(token) ?? token).join(' ') }
      : {}),
  };
}

function buildCategoryPath(category: string, subcategory: string): string[] | undefined {
  const categoryValue = normalizeText(category);
  const subcategoryValue = normalizeText(subcategory);

  if (!categoryValue && !subcategoryValue) return undefined;
  if (!categoryValue) return [subcategoryValue];
  if (!subcategoryValue || normalizeLower(categoryValue) === normalizeLower(subcategoryValue)) {
    return [categoryValue];
  }
  return [`${categoryValue} > ${subcategoryValue}`];
}

function buildSearchKeywords(row: PcnaProductDataRow): string | undefined {
  const keywords = dedupeStrings([
    row.Division,
    row.Brand,
    row.CategoryWeb,
    row.SubCategoryWeb,
    row.MaterialsDescription,
  ]);

  return keywords.length > 0 ? keywords.join(', ') : undefined;
}

function sortPriceTiers(tiers: PriceTier[]): PriceTier[] {
  return [...tiers].sort((left, right) => {
    if (left.min_quantity !== right.min_quantity) {
      return left.min_quantity - right.min_quantity;
    }

    return [
      normalizeLower(left.currency),
      normalizeLower(left.price_type),
      normalizeLower(left.configuration_type),
    ]
      .join('|')
      .localeCompare(
        [
          normalizeLower(right.currency),
          normalizeLower(right.price_type),
          normalizeLower(right.configuration_type),
        ].join('|'),
      );
  });
}

function toPriceTiers(rows: PcnaPricingRow[]): PriceTier[] {
  const tiers = rows
    .map(row => {
      const minQuantity = parseNumber(row.quantityMin);
      const price = parseNumber(row.price);
      if (minQuantity === undefined || price === undefined) {
        return null;
      }
      const family = parsePricingFamily(row);
      return {
        min_quantity: minQuantity,
        price,
        ...(family.currency ? { currency: family.currency } : {}),
        ...(family.price_type ? { price_type: family.price_type } : {}),
        ...(family.configuration_type ? { configuration_type: family.configuration_type } : {}),
        ...(normalizeText(row.discountCode) ? { discount_code: normalizeText(row.discountCode) } : {}),
      } satisfies PriceTier;
    })
    .filter((tier): tier is PriceTier => !!tier);

  const uniqueTiers = tiers.filter(
    (tier, index) =>
      tiers.findIndex(
        candidate =>
          candidate.min_quantity === tier.min_quantity &&
          candidate.price === tier.price &&
          normalizeLower(candidate.currency) === normalizeLower(tier.currency) &&
          normalizeLower(candidate.price_type) === normalizeLower(tier.price_type) &&
          normalizeLower(candidate.configuration_type) === normalizeLower(tier.configuration_type) &&
          normalizeLower(candidate.discount_code) === normalizeLower(tier.discount_code),
      ) === index,
  );

  const groups = new Map<string, PriceTier[]>();
  for (const tier of uniqueTiers) {
    const key = [
      normalizeLower(tier.currency),
      normalizeLower(tier.price_type),
      normalizeLower(tier.configuration_type),
    ].join('|');
    const entries = groups.get(key) ?? [];
    entries.push(tier);
    groups.set(key, entries);
  }

  return sortPriceTiers(
    Array.from(groups.values()).flatMap(group => {
      const sorted = [...group].sort((left, right) => left.min_quantity - right.min_quantity);
      return sorted.map((tier, index) => {
        const nextTier = sorted[index + 1];
        return {
          ...tier,
          ...(nextTier ? { quantity_max: nextTier.min_quantity - 1 } : {}),
        };
      });
    }),
  );
}

function buildVariantOptionKey(optionValues: NormalizedVariant['option_values']): string {
  return optionValues
    .map(optionValue => `${normalizeLower(optionValue.option_display_name)}:${normalizeLower(optionValue.label)}`)
    .sort()
    .join('|');
}

function ensureUniqueVariantOptionCombinations(variants: NormalizedVariant[]): NormalizedVariant[] {
  const counts = new Map<string, number>();
  for (const variant of variants) {
    const key = buildVariantOptionKey(variant.option_values);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return variants.map(variant => {
    const key = buildVariantOptionKey(variant.option_values);
    if ((counts.get(key) ?? 0) <= 1) {
      return variant;
    }

    const hasPartOption = variant.option_values.some(
      optionValue => normalizeLower(optionValue.option_display_name) === 'part',
    );
    if (hasPartOption) {
      return variant;
    }

    return {
      ...variant,
      option_values: [
        ...variant.option_values,
        {
          option_display_name: 'Part',
          label: variant.part_id ?? variant.sku,
        },
      ],
    };
  });
}

function classifyMediaType(row: PcnaMediaRow): NormalizedMediaAsset['media_type'] {
  const mediaType = normalizeLower(row.MediaType);
  const url = normalizeLower(row.Url);

  if (mediaType.includes('video') || url.includes('youtube.com') || url.includes('youtu.be')) {
    return 'Video';
  }

  return 'Image';
}

function splitCsvList(value: string | undefined | null): string[] | undefined {
  const entries = value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return entries && entries.length > 0 ? entries : undefined;
}

function buildMediaSortScore(asset: NormalizedMediaAsset): number {
  const classTypes = new Set((asset.class_types ?? []).map(entry => normalizeLower(entry)));
  let score = 0;

  if (classTypes.has('product default image')) score += 100;
  if (classTypes.has('part default image')) score += 50;
  if (classTypes.has('front')) score += 10;
  if (classTypes.has('hires') || classTypes.has('extralarge')) score += 5;

  return score;
}

function buildMediaAssets(
  styleNumber: string,
  knownVariantSkus: Set<string>,
  mediaRows: PcnaMediaRow[],
): NormalizedMediaAsset[] | undefined {
  const assets = mediaRows
    .filter(row => {
      const styleKey = normalizeText(row.Sku) || normalizeText(row.Style);
      return styleKey === styleNumber;
    })
    .map(row => {
      const partId = knownVariantSkus.has(normalizeText(row.Style))
        ? normalizeText(row.Style)
        : knownVariantSkus.has(normalizeText(row.Sku))
          ? normalizeText(row.Sku)
          : undefined;

      return {
        url: normalizeText(row.Url),
        media_type: classifyMediaType(row),
        product_id: styleNumber,
        ...(partId ? { part_id: partId } : {}),
        ...(normalizeText(row.Description) ? { description: normalizeText(row.Description) } : {}),
        ...(splitCsvList(row.ClassTypeName) ? { class_types: splitCsvList(row.ClassTypeName) } : {}),
        ...(splitCsvList(row.ClassTypeName) || splitCsvList(row.ClassTypeId)
          ? {
              class_type_array: Array.from({
                length: Math.max(
                  splitCsvList(row.ClassTypeName)?.length ?? 0,
                  splitCsvList(row.ClassTypeId)?.length ?? 0,
                ),
              })
                .map((_, index) => ({
                  ...(splitCsvList(row.ClassTypeId)?.[index]
                    ? { class_type_id: splitCsvList(row.ClassTypeId)?.[index] }
                    : {}),
                  ...(splitCsvList(row.ClassTypeName)?.[index]
                    ? { class_type_name: splitCsvList(row.ClassTypeName)?.[index] }
                    : {}),
                }))
                .filter(entry => Object.keys(entry).length > 0),
            }
          : {}),
      } satisfies NormalizedMediaAsset;
    })
    .filter(asset => !!asset.url);

  const deduped = assets.filter(
    (asset, index) =>
      assets.findIndex(
        candidate => candidate.url === asset.url && candidate.part_id === asset.part_id,
      ) === index,
  );

  const sorted = deduped.sort((left, right) => {
    const scoreDifference = buildMediaSortScore(right) - buildMediaSortScore(left);
    if (scoreDifference !== 0) {
      return scoreDifference;
    }
    return left.url.localeCompare(right.url);
  });

  return sorted.length > 0 ? sorted : undefined;
}

function buildPricingConfigurationParts(
  styleRows: PcnaProductDataRow[],
  pricingRowsBySku: Map<string, PcnaPricingRow[]>,
  locationIds: string[],
): PricingConfigurationPart[] | undefined {
  const parts = styleRows
    .map(row => {
      const sku = normalizeText(row.PCNA_SKU_Number);
      const priceTiers = toPriceTiers(pricingRowsBySku.get(sku) ?? []);
      if (!sku || priceTiers.length === 0) {
        return null;
      }

      const part: PricingConfigurationPart = {
        part_id: sku,
        price_tiers: priceTiers,
      };
      const partDescription = normalizeText(row.ItemName);
      if (partDescription) {
        part.part_description = partDescription;
      }
      if (locationIds.length > 0) {
        part.location_ids = locationIds;
      }

      return part;
    })
    .filter((part): part is PricingConfigurationPart => !!part);

  return parts.length > 0 ? parts : undefined;
}

function buildDecorationModels(
  decorationRows: PcnaDecorationRow[],
): {
  pricingLocations?: PricingConfigurationLocation[];
  modifierBlueprint?: NonNullable<NormalizedProduct['modifier_blueprint']>;
  locationDecorationData?: Record<string, unknown>;
  productDataLocationDecorations?: ProductDataLocationDecorationSnapshot[];
} {
  if (decorationRows.length === 0) {
    return {};
  }

  const locations = new Map<
    string,
    {
      location_id?: string;
      location_name: string;
      decorations: Map<string, PricingConfigurationDecoration>;
      methods: Set<string>;
      is_default: boolean;
      rank: number;
    }
  >();
  const locationDecorationHints: Array<Record<string, unknown>> = [];
  const productDataLocationDecorations: ProductDataLocationDecorationSnapshot[] = [];

  for (let index = 0; index < decorationRows.length; index += 1) {
    const row = decorationRows[index]!;
    const locationName = normalizeText(row.LocationName);
    if (!locationName) continue;
    const priority = parseBoolean(row.Priority) ?? false;
    const maxLength = parseNumber(row.MaxLength);
    const maxHeight = parseNumber(row.MaxHeight);

    const locationKey = `${normalizeText(row.LocationId)}|${locationName.toLowerCase()}`;
    const current =
      locations.get(locationKey) ??
      {
        location_id: normalizeText(row.LocationId) || undefined,
        location_name: locationName,
        decorations: new Map<string, PricingConfigurationDecoration>(),
        methods: new Set<string>(),
        is_default: false,
        rank: index + 1,
      };
    current.is_default = current.is_default || priority;

    const decorationId = normalizeText(row.DecorationId);
    const decorationName = normalizeText(row.DecorationName);
    const decorationKey = `${decorationId}|${decorationName.toLowerCase()}`;

    if (decorationName) {
      current.methods.add(decorationName);
    }

    if (!current.decorations.has(decorationKey) && decorationName) {
      current.decorations.set(decorationKey, {
        ...(decorationId ? { decoration_id: decorationId } : {}),
        decoration_name: decorationName,
        ...(maxLength !== undefined ? { decoration_width: maxLength } : {}),
        ...(maxHeight !== undefined ? { decoration_height: maxHeight } : {}),
        ...(maxLength !== undefined || maxHeight !== undefined
          ? { decoration_geometry: 'rectangular', decoration_uom: 'IN' }
          : {}),
        ...(priority ? { default_decoration: true } : {}),
        charges: [],
      });
    } else if (decorationName) {
      const existing = current.decorations.get(decorationKey);
      if (existing) {
        if (maxLength !== undefined) {
          existing.decoration_width = maxLength;
        }
        if (maxHeight !== undefined) {
          existing.decoration_height = maxHeight;
        }
        if (maxLength !== undefined || maxHeight !== undefined) {
          existing.decoration_geometry = 'rectangular';
          existing.decoration_uom = 'IN';
        }
        if (priority) {
          existing.default_decoration = true;
        }
      }
    }

    locationDecorationHints.push({
      ...(normalizeText(row.LocationId) ? { locationId: normalizeText(row.LocationId) } : {}),
      locationName,
      ...(decorationId ? { decorationId } : {}),
      decorationName,
      ...(priority ? { locationDecorationComboDefault: true } : {}),
    });
    productDataLocationDecorations.push({
      location_name: locationName,
      ...(decorationName ? { decoration_name: decorationName } : {}),
      ...(priority ? { location_decoration_combo_default: true } : {}),
    });
    locations.set(locationKey, current);
  }

  const pricingLocations = Array.from(locations.values())
    .map(location => ({
      ...(location.location_id ? { location_id: location.location_id } : {}),
      location_name: location.location_name,
      ...(location.is_default ? { default_location: true } : {}),
      location_rank: location.rank,
      decorations: Array.from(location.decorations.values()).sort((left, right) =>
        normalizeText(left.decoration_name).localeCompare(normalizeText(right.decoration_name)),
      ),
    }))
    .sort((left, right) => (left.location_rank ?? 0) - (right.location_rank ?? 0));

  const modifierBlueprint = {
    locations: Array.from(locations.values())
      .map(location => ({
        location: location.location_name,
        methods: Array.from(location.methods)
          .sort((left, right) => left.localeCompare(right))
          .map(method => ({ method })),
      }))
      .sort((left, right) => left.location.localeCompare(right.location)),
    charges: [],
  } satisfies NonNullable<NormalizedProduct['modifier_blueprint']>;

  return {
    ...(pricingLocations.length > 0 ? { pricingLocations } : {}),
    ...(modifierBlueprint.locations.length > 0 ? { modifierBlueprint } : {}),
    ...(locationDecorationHints.length > 0
      ? {
          locationDecorationData: {
            LocationDecoration: locationDecorationHints,
          },
        }
      : {}),
    ...(productDataLocationDecorations.length > 0
      ? {
          productDataLocationDecorations: productDataLocationDecorations.filter(
            (entry, index, entries) =>
              entries.findIndex(
                candidate =>
                  normalizeLower(candidate.location_name) === normalizeLower(entry.location_name) &&
                  normalizeLower(candidate.decoration_name) === normalizeLower(entry.decoration_name),
              ) === index,
          ),
        }
      : {}),
  };
}

function buildCustomFields(styleNumber: string, sampleRow: PcnaProductDataRow): Array<{ name: string; value: string }> {
  const fields: Array<{ name: string; value: string }> = [
    { name: 'vendor_endpoint', value: 'CSVImport' },
    { name: 'vendor_version', value: 'pcna' },
    { name: 'vendor_operation', value: 'pcna_initial_import' },
    { name: 'vendor_product_id', value: styleNumber },
  ];

  const lineName = normalizeText(sampleRow.SeriesName);
  if (lineName) {
    fields.push({ name: 'line_name', value: lineName });
  }

  return fields;
}

function selectPrimaryRow(rows: PcnaProductDataRow[]): PcnaProductDataRow {
  return [...rows].sort((left, right) => {
    const leftPriceWeight = parseNumber(left.Product_Size) ? 1 : 0;
    const rightPriceWeight = parseNumber(right.Product_Size) ? 1 : 0;
    return rightPriceWeight - leftPriceWeight;
  })[0];
}

function buildProductFromStyle(input: {
  styleNumber: string;
  styleRows: PcnaProductDataRow[];
  pricingRowsBySku: Map<string, PcnaPricingRow[]>;
  mediaRows: PcnaMediaRow[];
  decorationRows: PcnaDecorationRow[];
  productDataSnapshot?: ProductDataSnapshot;
}): { product: NormalizedProduct; missingPricing: number } {
  const sampleRow = selectPrimaryRow(input.styleRows);
  const uniqueSizes = dedupeStrings(input.styleRows.map(row => row.Product_Size));
  const uniqueCategories = dedupeStrings(
    input.styleRows.flatMap(row => buildCategoryPath(row.CategoryWeb, row.SubCategoryWeb) ?? []),
  );

  let missingPricing = 0;
  const candidateVariants: NormalizedVariant[] = [];
  const baseSku = normalizeText(input.styleRows[0]?.PCNA_SKU_Number) || input.styleNumber;

  for (const row of input.styleRows) {
    const sku = normalizeText(row.PCNA_SKU_Number);
    if (!sku) continue;

    const optionValues: NormalizedVariant['option_values'] = [];
    const color = parseColorLabel(row.MARKET_COLORS);
    const size = normalizeText(row.Product_Size) || undefined;

    if (color) {
      optionValues.push({ option_display_name: 'Color', label: color });
    }
    if (size) {
      optionValues.push({ option_display_name: 'Size', label: size });
    }
    if (optionValues.length === 0 && input.styleRows.length > 1) {
      optionValues.push({ option_display_name: 'Part', label: sku });
    }

    const priceTiers = toPriceTiers(input.pricingRowsBySku.get(sku) ?? []);
    if (priceTiers.length === 0) {
      missingPricing += 1;
    }
    const colorHex = parseColorHex(row.ColorHexCode);

    if (input.styleRows.length > 1 || optionValues.length > 0) {
      candidateVariants.push({
        sku,
        source_sku: sku,
        part_id: sku,
        ...(priceTiers[0] ? { price: priceTiers[0].price, cost_price: priceTiers[0].price } : {}),
        ...(parseWeightInPounds(row.Product_Weight) !== undefined
          ? { weight: parseWeightInPounds(row.Product_Weight) }
          : {}),
        ...(color ? { color } : {}),
        ...(colorHex ? { color_hex: colorHex } : {}),
        ...(size ? { size } : {}),
        option_values: optionValues,
      });
    }
  }

  const variants = ensureUniqueVariantOptionCombinations(candidateVariants);
  const knownVariantSkus = new Set(
    (variants.length > 0 ? variants : input.styleRows.map(row => ({
      sku: normalizeText(row.PCNA_SKU_Number),
    } as NormalizedVariant))).map(item => item.sku),
  );
  const mediaAssets = buildMediaAssets(input.styleNumber, knownVariantSkus, input.mediaRows);
  const primaryImage = mediaAssets?.find(asset => asset.media_type === 'Image');
  const {
    pricingLocations,
    modifierBlueprint,
    locationDecorationData,
    productDataLocationDecorations,
  } = buildDecorationModels(input.decorationRows);
  const pricingConfigurationParts = buildPricingConfigurationParts(
    input.styleRows,
    input.pricingRowsBySku,
    dedupeStrings((pricingLocations ?? []).map(location => location.location_id)),
  );
  const pricingCurrencies = dedupeStrings(
    (pricingConfigurationParts ?? []).flatMap(part => part.price_tiers.map(tier => tier.currency)),
  );

  const basePrices = [
    ...variants.flatMap(variant => [variant.cost_price, variant.price]),
    ...(pricingConfigurationParts ?? [])
      .flatMap(part => part.price_tiers[0]?.price)
      .filter((value): value is number => value !== undefined),
  ].filter((value): value is number => value !== undefined);
  const basePrice = basePrices.length > 0 ? Math.min(...basePrices) : undefined;

  const dimensions = parseDimensions(sampleRow.Product_Dimensions);
  const productSku = variants.length > 0 ? input.styleNumber : baseSku;
  const productData = input.productDataSnapshot
    ? {
        ...input.productDataSnapshot,
        ...(primaryImage?.url && !input.productDataSnapshot.primary_image_url
          ? { primary_image_url: primaryImage.url }
          : {}),
        ...(productDataLocationDecorations && productDataLocationDecorations.length > 0
          ? { location_decorations: productDataLocationDecorations }
          : {}),
      }
    : undefined;

  const product: NormalizedProduct = {
    sku: productSku,
    source_sku: productSku,
    vendor_product_id: input.styleNumber,
    name: normalizeText(sampleRow.ItemName) || normalizeText(sampleRow.SeriesName) || input.styleNumber,
    ...(normalizeText(sampleRow.Description) ? { description: normalizeText(sampleRow.Description) } : {}),
    ...(basePrice !== undefined ? { price: basePrice, cost_price: basePrice } : {}),
    ...(parseWeightInPounds(sampleRow.Product_Weight) !== undefined
      ? { weight: parseWeightInPounds(sampleRow.Product_Weight) }
      : {}),
    ...(normalizeText(sampleRow.Brand) ? { brand_name: normalizeText(sampleRow.Brand) } : {}),
    ...(uniqueCategories.length > 0 ? { categories: uniqueCategories } : {}),
    ...(variants.length > 0 ? { variants } : {}),
    ...(primaryImage ? { images: [{ image_url: primaryImage.url, is_thumbnail: true }] } : {}),
    ...(mediaAssets ? { media_assets: mediaAssets } : {}),
    custom_fields: buildCustomFields(input.styleNumber, sampleRow),
    ...(buildSearchKeywords(sampleRow) ? { search_keywords: buildSearchKeywords(sampleRow) } : {}),
    ...(uniqueSizes.length === 1 ? { shared_option_values: { size: uniqueSizes[0] } } : {}),
    ...((pricingConfigurationParts && pricingConfigurationParts.length > 0) || pricingLocations
      ? {
          pricing_configuration: {
            parts: pricingConfigurationParts ?? [],
            locations: pricingLocations ?? [],
            fob_points: [],
            ...(pricingCurrencies.length === 1 ? { currency: pricingCurrencies[0] } : {}),
            ...(pricingLocations && pricingLocations.length > 0
              ? {
                  available_locations: pricingLocations.map(location => ({
                    ...(location.location_id ? { location_id: location.location_id } : {}),
                    ...(location.location_name ? { location_name: location.location_name } : {}),
                  })),
                }
              : {}),
          },
        }
      : {}),
    ...(modifierBlueprint ? { modifier_blueprint: modifierBlueprint } : {}),
    ...(productData ? { product_data: productData } : {}),
    ...(Object.keys(dimensions).length > 0
      ? {
          location_decoration_data: {
            dimensions,
            ...(locationDecorationData ? locationDecorationData : {}),
          },
        }
      : locationDecorationData
        ? {
            location_decoration_data: locationDecorationData,
          }
        : {}),
  };

  return {
    product,
    missingPricing,
  };
}

export function buildPcnaCatalogImport(input: PcnaCatalogImportInput): PcnaCatalogImportResult {
  const styleRows = new Map<string, PcnaProductDataRow[]>();
  for (const row of input.productDataRows) {
    const styleNumber = normalizeText(row.PCNA_Style_Number);
    if (!styleNumber) continue;
    const entries = styleRows.get(styleNumber) ?? [];
    entries.push(row);
    styleRows.set(styleNumber, entries);
  }

  const pricingRowsBySku = new Map<string, PcnaPricingRow[]>();
  for (const row of input.pricingRows) {
    const sku = normalizeText(row.SKU);
    if (!sku) continue;
    const entries = pricingRowsBySku.get(sku) ?? [];
    entries.push(row);
    pricingRowsBySku.set(sku, entries);
  }

  const mediaRowsByStyle = new Map<string, PcnaMediaRow[]>();
  for (const row of input.mediaRows ?? []) {
    const styleNumber = normalizeText(row.Sku) || normalizeText(row.Style);
    if (!styleNumber) continue;
    const entries = mediaRowsByStyle.get(styleNumber) ?? [];
    entries.push(row);
    mediaRowsByStyle.set(styleNumber, entries);
  }

  const decorationRowsByStyle = new Map<string, PcnaDecorationRow[]>();
  for (const row of input.decorationRows) {
    const styleNumber = normalizeText(row.Style);
    if (!styleNumber) continue;
    const entries = decorationRowsByStyle.get(styleNumber) ?? [];
    entries.push(row);
    decorationRowsByStyle.set(styleNumber, entries);
  }

  let simpleProducts = 0;
  let variantProducts = 0;
  let totalVariants = 0;
  let productsWithMedia = 0;
  let productsWithDecorations = 0;
  let missingPricingRows = 0;

  const products = Array.from(styleRows.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([styleNumber, rows]) => {
      const built = buildProductFromStyle({
        styleNumber,
        styleRows: rows,
        pricingRowsBySku,
        mediaRows: input.mediaRowsByStyle?.get(styleNumber) ?? mediaRowsByStyle.get(styleNumber) ?? [],
        decorationRows: decorationRowsByStyle.get(styleNumber) ?? [],
        productDataSnapshot: input.productDataSnapshotsByStyle?.get(styleNumber),
      });

      if (built.product.variants && built.product.variants.length > 0) {
        variantProducts += 1;
        totalVariants += built.product.variants.length;
      } else {
        simpleProducts += 1;
      }
      if ((built.product.media_assets?.length ?? 0) > 0) {
        productsWithMedia += 1;
      }
      if ((built.product.modifier_blueprint?.locations.length ?? 0) > 0) {
        productsWithDecorations += 1;
      }
      missingPricingRows += built.missingPricing;

      return built.product;
    });

  return {
    products,
    report: {
      total_products: products.length,
      simple_products: simpleProducts,
      variant_products: variantProducts,
      total_variants: totalVariants,
      products_with_media: productsWithMedia,
      products_with_decorations: productsWithDecorations,
      missing_pricing_rows: missingPricingRows,
    },
  };
}

export function parseCsvText(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let currentField = '';
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentField += '"';
        index += 1;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (!insideQuotes && character === ',') {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if (!insideQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentField = '';
      currentRow = [];
      continue;
    }

    currentField += character;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length === 0) {
    return [];
  }

  const [header, ...dataRows] = rows;
  return dataRows
    .filter(row => row.some(value => normalizeText(value).length > 0))
    .map(row =>
      Object.fromEntries(
        header.map((column, index) => [column, row[index] ?? '']),
      ),
    );
}
