import type {
  NormalizedMediaAsset,
  NormalizedMediaClassType,
  NormalizedProduct,
  NormalizedVariant,
} from '../etl/productNormalizer';

interface VendorManagedMediaMetadata {
  partId?: string;
  classTypes?: string[];
}

type VendorManagedMediaClassType = Array<{
  classTypeId?: string;
  classTypeName?: string;
}>;

function normalizeText(value: string | undefined | null): string {
  return value?.trim() ?? '';
}

function dedupeText(values: Array<string | undefined | null>): string[] | undefined {
  const deduped = Array.from(
    new Set(
      values
        .map(value => normalizeText(value))
        .filter(value => value.length > 0),
    ),
  );
  return deduped.length > 0 ? deduped : undefined;
}

function dedupeMediaAssets(assets: NormalizedMediaAsset[]): NormalizedMediaAsset[] {
  return assets.filter(
    (asset, index) =>
      assets.findIndex(candidate => {
        const candidateClassArray = JSON.stringify(candidate.class_type_array ?? []);
        const assetClassArray = JSON.stringify(asset.class_type_array ?? []);
        return (
          candidate.media_type === asset.media_type &&
          candidate.url === asset.url &&
          candidate.part_id === asset.part_id &&
          JSON.stringify(candidate.location_ids ?? []) === JSON.stringify(asset.location_ids ?? []) &&
          JSON.stringify(candidate.location_names ?? []) === JSON.stringify(asset.location_names ?? []) &&
          JSON.stringify(candidate.decoration_ids ?? []) === JSON.stringify(asset.decoration_ids ?? []) &&
          JSON.stringify(candidate.decoration_names ?? []) === JSON.stringify(asset.decoration_names ?? []) &&
          JSON.stringify(candidate.class_types ?? []) === JSON.stringify(asset.class_types ?? []) &&
          candidateClassArray === assetClassArray
        );
      }) === index,
  );
}

function buildMediaClassTypeArray(asset: NormalizedMediaAsset): VendorManagedMediaClassType | undefined {
  const directEntries = (asset.class_type_array ?? [])
    .map(entry => ({
      ...(normalizeText(entry.class_type_id) ? { classTypeId: normalizeText(entry.class_type_id) } : {}),
      ...(normalizeText(entry.class_type_name) ? { classTypeName: normalizeText(entry.class_type_name) } : {}),
    }))
    .filter(entry => Object.keys(entry).length > 0);

  if (directEntries.length > 0) {
    return directEntries;
  }

  const fallbackEntries = (asset.class_types ?? [])
    .map(value => normalizeText(value))
    .filter(value => value.length > 0)
    .map(classTypeName => ({ classTypeName }));

  return fallbackEntries.length > 0 ? fallbackEntries : undefined;
}

function normalizeClassTypeName(entry: Pick<NormalizedMediaClassType, 'class_type_name'>): string {
  return normalizeText(entry.class_type_name).toLowerCase();
}

export function hasPrimaryClassType(asset: NormalizedMediaAsset): boolean {
  return (asset.class_type_array ?? []).some(entry => normalizeClassTypeName(entry) === 'primary') ||
    (asset.class_types ?? []).some(classType => normalizeText(classType).toLowerCase() === 'primary');
}

function rankMediaAsset(asset: NormalizedMediaAsset): number {
  const classes = Array.from(
    new Set(
      [
        ...(asset.class_type_array ?? []).map(entry => entry.class_type_name ?? ''),
        ...(asset.class_types ?? []),
      ]
        .map(value => normalizeText(value).toLowerCase())
        .filter(value => value.length > 0),
    ),
  );

  if (classes.includes('primary')) return 500;
  if (classes.includes('product default image')) return 400;
  if (classes.includes('part default image')) return 350;
  if (classes.includes('blank') || classes.includes('hero')) return 300;
  if (classes.includes('finished') || classes.includes('decorated')) return 200;
  if (classes.includes('marketing') || classes.includes('lifestyle')) return 100;
  if (classes.includes('front')) return 50;
  return 0;
}

export function getSortedProductImageAssets(product: NormalizedProduct): NormalizedMediaAsset[] {
  return dedupeMediaAssets((product.media_assets ?? []).filter(asset => asset.media_type === 'Image')).sort(
    (left, right) => {
      const productLevelDelta = Number(!right.part_id) - Number(!left.part_id);
      if (productLevelDelta !== 0) return productLevelDelta;

      const scoreDelta = rankMediaAsset(right) - rankMediaAsset(left);
      if (scoreDelta !== 0) return scoreDelta;

      return left.url.localeCompare(right.url);
    },
  );
}

export function selectPrimaryProductImage(images: NormalizedMediaAsset[]): NormalizedMediaAsset | undefined {
  return (
    images.find(asset => !asset.part_id && hasPrimaryClassType(asset)) ??
    images.find(asset => hasPrimaryClassType(asset)) ??
    images.find(asset => !asset.part_id) ??
    images[0]
  );
}

export function getPrimaryProductImage(product: NormalizedProduct): NormalizedMediaAsset | undefined {
  return selectPrimaryProductImage(getSortedProductImageAssets(product));
}

export function selectVariantPrimaryImage(
  images: NormalizedMediaAsset[],
  variant: NormalizedVariant,
): NormalizedMediaAsset | undefined {
  const identityKeys = new Set(
    [variant.part_id, variant.sku, variant.source_sku].map(value => normalizeText(value)).filter(Boolean),
  );
  const matching = images.filter(asset => identityKeys.has(normalizeText(asset.part_id)));

  return matching.find(asset => hasPrimaryClassType(asset)) ?? matching[0] ?? selectPrimaryProductImage(images);
}

export function getVariantPrimaryImage(
  product: NormalizedProduct,
  variant: NormalizedVariant,
): NormalizedMediaAsset | undefined {
  return selectVariantPrimaryImage(getSortedProductImageAssets(product), variant);
}

export function buildVendorManagedMediaMarker(
  product: NormalizedProduct,
  asset: NormalizedMediaAsset,
): string {
  const classTypeArray = buildMediaClassTypeArray(asset);
  const classTypes = dedupeText([
    ...(classTypeArray ?? []).map(entry => entry.classTypeName),
    ...(asset.class_types ?? []),
  ]);

  const metadata: VendorManagedMediaMetadata = {
    ...(normalizeText(asset.part_id) ? { partId: normalizeText(asset.part_id) } : {}),
    ...(classTypes?.length ? { classTypes } : {}),
  };

  return JSON.stringify(metadata);
}

export function buildVendorManagedMediaDescription(
  product: NormalizedProduct,
  asset: NormalizedMediaAsset,
): string {
  return buildVendorManagedMediaMarker(product, asset);
}
