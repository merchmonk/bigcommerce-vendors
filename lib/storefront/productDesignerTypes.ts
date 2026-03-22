export interface ContractPriceTier {
  minQuantity: number;
  quantityMax?: number;
  price: number;
}

export interface ContractVariantCatalogEntry {
  sku: string;
  partId?: string;
  color?: string;
  size?: string;
  optionValues?: Array<{
    optionDisplayName: string;
    label: string;
  }>;
  priceTiers?: ContractPriceTier[];
}

export interface ContractChargeTier {
  minQuantity: number;
  quantityUom?: string;
  minUnits?: number;
  unitsUom?: string;
  price: number;
  repeatPrice?: number;
  discountCode?: string;
  repeatDiscountCode?: string;
}

export interface ContractChargeRule {
  id?: string;
  name?: string;
  description?: string;
  type?: string;
  appliesLtm?: boolean;
  appliesPerLocation?: number;
  appliesPerColor?: number;
  tiers?: ContractChargeTier[];
}

export interface ContractDecorationMethod {
  id?: string;
  decorationId?: string;
  name?: string;
  printArea?: {
    geometry?: string;
    width?: number;
    height?: number;
    diameter?: number;
    uom?: string;
  };
  unitsIncluded?: number;
  unitsIncludedUom?: string;
  unitsMax?: number;
  isDefault?: boolean;
  allowSubForDefaultLocation?: boolean;
  allowSubForDefaultMethod?: boolean;
  itemPartQuantityLtm?: number;
  leadTimeDays?: number;
  rushLeadTimeDays?: number;
  sourceHints?: Record<string, unknown>;
  charges?: ContractChargeRule[];
}

export interface ContractDecorationLocation {
  id?: string;
  locationId?: string;
  name?: string;
  includedDecorations?: number;
  minDecorations?: number;
  maxDecorations?: number;
  isDefault?: boolean;
  rank?: number;
  methods?: ContractDecorationMethod[];
}

export interface ContractMediaAsset {
  url: string;
  alt?: string;
  description?: string;
  kind: 'product' | 'variant' | 'location' | 'method';
  partId?: string;
  locationIds?: string[];
  decorationIds?: string[];
  classTypes?: string[];
  color?: string;
  singlePart?: boolean;
  changeTimestamp?: string;
  width?: number;
  height?: number;
  dpi?: number;
  locationId?: string;
}

export interface ContractMediaGroups {
  gallery?: ContractMediaAsset[];
  variantAssets?: Record<string, ContractMediaAsset[]>;
  locationAssets?: Record<string, ContractMediaAsset[]>;
  methodAssets?: Record<string, ContractMediaAsset[]>;
}

export interface ProductDesignerDefaultsContract {
  contractVersion?: string;
  source?: {
    vendorProductId?: string;
    sourceSku?: string;
    partIds?: string[];
  };
  pricing?: {
    priceListId?: number;
    currency?: string;
    markupPercent?: number;
    markupSource?: {
      namespace?: string;
      key?: string;
    };
    priceType?: string;
    variantCatalog?: ContractVariantCatalogEntry[];
  };
  locations?: ContractDecorationLocation[];
  availableCharges?: Array<Record<string, unknown>>;
  availableLocations?: Array<Record<string, unknown>>;
  media?: ContractMediaGroups & {
    videos?: ContractMediaGroups;
  };
  fobPoints?: Array<{
    id?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
}

export interface VariantDesignerOverrideContract {
  contractVersion?: string;
  partId?: string;
  size?: string;
  color?: string;
  applicableLocationIds?: string[];
  physical?: Record<string, unknown>;
}

export interface ProductSummary {
  productId: number;
  name: string;
  sku: string;
  path?: string;
  brand?: string;
  description?: string;
  categories: string[];
  searchKeywords: string[];
  primaryImage?: {
    url: string;
    alt?: string;
  };
  source: {
    vendorId?: number;
    vendorProductId?: string;
    contractVersion?: string;
  };
}

export interface SelectedBlankVariant {
  variantId: number;
  sku: string;
  partId: string;
  options: {
    color?: string;
    size?: string;
    part?: string;
  };
  physical?: Record<string, unknown>;
  overrideKeysApplied: string[];
}

export interface BasePricing {
  currencyCode: string;
  quantity: number;
  priceListId?: number;
  unitBlankPrice: number;
  tierApplied?: {
    minQuantity: number;
    source: 'contract' | 'variant';
  };
  fobPoints?: ProductDesignerDefaultsContract['fobPoints'];
}

export interface InventorySnapshot {
  available: number | null;
  inventoryTracked: boolean;
  lastUpdatedAt?: string;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
}

export interface ResolvedDecorationMethod {
  id: string;
  name: string;
  isDefault?: boolean;
  unitsIncluded?: number;
  unitsMax?: number;
  printArea?: ContractDecorationMethod['printArea'];
  sourceHints?: ContractDecorationMethod['sourceHints'];
  charges: Array<{
    id: string;
    name: string;
    type: 'setup' | 'run' | 'order' | 'other';
    appliesPerLocation?: number;
    appliesPerColor?: number;
    tiers: Array<{
      minQuantity: number;
      minUnits?: number;
      price: number;
      repeatPrice?: number;
    }>;
  }>;
}

export interface ResolvedDecorationLocation {
  id: string;
  name: string;
  includedDecorations: number;
  minDecorations: number;
  maxDecorations: number;
  printableArea?: ContractDecorationMethod['printArea'];
  methods: ResolvedDecorationMethod[];
}

export interface ResolvedDesignerContract {
  contractVersion?: string;
  locations: ResolvedDecorationLocation[];
}

export interface PricingPreview {
  quantity: number;
  currencyCode: string;
  blankUnitPrice: number;
  decorationUnitPrice: number;
  oneTimeCharges: number;
  recurringCharges: number;
  estimatedUnitSellPrice: number;
  estimatedLineTotal: number;
}

export interface DesignerMedia {
  gallery: ContractMediaAsset[];
  variantAssets: Record<string, ContractMediaAsset[]>;
  locationAssets: Record<string, ContractMediaAsset[]>;
  methodAssets: Record<string, ContractMediaAsset[]>;
  videos: {
    gallery: ContractMediaAsset[];
    variantAssets: Record<string, ContractMediaAsset[]>;
    locationAssets: Record<string, ContractMediaAsset[]>;
    methodAssets: Record<string, ContractMediaAsset[]>;
  };
}

export interface RelatedProductSummary {
  productId: number;
  name: string;
  path?: string;
}

export interface ProductDesignerPayload {
  product: ProductSummary;
  selectedVariant: SelectedBlankVariant;
  basePricing: BasePricing;
  inventory: InventorySnapshot;
  designer: ResolvedDesignerContract;
  media: DesignerMedia;
  relatedProducts: RelatedProductSummary[];
  pricingPreview: PricingPreview;
}
