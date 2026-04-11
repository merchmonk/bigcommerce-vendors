# MerchMonk BigCommerce Product Integration Guide

## 1. Purpose And Audience

This document explains how a public ecommerce application should consume a MerchMonk product from BigCommerce in order to:

- render product listing and product detail pages
- initialize the visual designer
- calculate quantity-aware design-step pricing
- preserve the vendor-sourced product structure without calling MerchMonk DB for runtime product data

This guide is written for:

- the headless storefront / ecommerce UI developer
- the developer building the public product detail page
- the developer building the visual designer and add-to-cart flow

This is a **runtime integration guide**. It is not the setup or authoring guide for how the Vendors app writes products into BigCommerce. That companion document remains [`docs/bigcommerce-product-contract-guide.md`](./bigcommerce-product-contract-guide.md).

## 2. Core Runtime Model

The runtime product read model is intentionally hybrid.

### 2.1 Initial catalog and PDP load

Use **BigCommerce Storefront GraphQL** for:

- product cards
- search and category pages
- initial product detail page content
- visible option selection UI
- base customer-context pricing shown before designer initialization

### 2.2 Designer initialization

Once the shopper selects a concrete blank variant such as a color or color-plus-size combination, the UI should call a **MerchMonk BFF** that returns a resolved designer payload for that selected blank.

Recommended endpoint:

`GET /api/storefront/products/{productId}/designer?variantId={variantId}&quantity={quantity}`

### 2.3 Why the BFF exists

BigCommerce remains the runtime product authority, but the BFF still has an important role:

- it composes product fields, variant data, modifiers, images, metafields, related products, and pricing context into one UI-friendly payload
- it resolves product-level designer defaults plus any selected-variant overrides
- it returns only the data relevant to the chosen blank instead of forcing the UI to understand low-level contract storage details

### 2.4 Database boundary

MerchMonk DB is **not** part of the runtime product read path for the public site.

Use MerchMonk DB for:

- vendor records
- endpoint mappings
- job state
- logs and observability metadata

Do **not** use it as a runtime product store for:

- PDP rendering
- designer initialization
- pricing preview
- inventory display

## 3. Design Principle: Shared Product Defaults With Variant Overrides

Most PromoStandards parts map to BigCommerce variants that share the same designer structure.

The common case is:

- the same decoration locations exist across the product
- the same decoration methods exist across the product
- the same charge rules exist across the product
- most pricing logic is shared across the product

The main expected exception is **size**.

Size can change:

- decoration points
- printable area dimensions
- max imprint area
- any location geometry or location-specific designer constraints

Because of that, the target contract should use:

- `productDesignerDefaults`
  - product-level shared designer contract data
- `variantDesignerOverrides`
  - only the fields that differ for a specific variant

The BFF should resolve the final payload like this:

1. Load product-level defaults.
2. Load the selected variant.
3. Apply variant override fragments, if any.
4. Return a selection-scoped resolved payload to the UI.

This prevents duplicating the full design contract across every variant when only a small subset differs.

## 4. PromoStandards Source Model

The BigCommerce product contract exists so the public site can consume data that originally came from PromoStandards without calling PromoStandards directly.

### 4.1 Source operations that matter to the UI

| PromoStandards source | Why it matters |
| --- | --- |
| `ProductData.getProduct` | Blank product identity, descriptions, categories, related products, images, keywords, product parts, size, and base location-decoration hints |
| `PricingAndConfiguration.getAvailableLocations` | Canonical list of selectable decoration locations |
| `PricingAndConfiguration.getAvailableCharges` | Charge catalog and charge identity |
| `PricingAndConfiguration.getConfigurationAndPricing` | Part pricing tiers, location rules, decoration methods, min/max/included decoration counts, charge matrices, and FOB data |
| `PricingAndConfiguration.getDecorationColors` | Optional color-specific decoration constraints or capabilities |
| `PricingAndConfiguration.getFobPoints` | Shipping origin / FOB information if surfaced in pricing or fulfillment UX |
| `Inventory.getInventoryLevels` | Inventory at the part / variant level |
| `ProductMedia.getMediaContent` | Product, part, location, and decoration-associated images or other media |

### 4.2 Supplier concepts the UI eventually needs

The public storefront and designer do not need the raw SOAP payloads, but they do need the concepts those payloads contain:

- product identity
- part identity
- blank option selections such as color and size
- base blank price tiers
- quantity-aware pricing
- decoration locations
- decoration methods per location
- min, max, and included decoration counts
- charge types such as setup, run, and order charges
- charge matrices by quantity and decoration units
- inventory by part
- media by product, part, location, and decoration
- related products

### 4.3 Important source details from `ProductData.getProduct`

These product data points are especially important to preserve in the BigCommerce contract:

- `productId`
- `productName`
- `description`
- `ProductKeywordArray`
- `productBrand`
- `ProductCategoryArray`
- `RelatedProductArray`
- `primaryImageUrl`
- `ProductPriceGroupArray`
- `LocationDecorationArray`
- `ProductPartArray.ProductPart`
- `ApparelSize`
- `ColorArray`
- `Dimension`
- `leadTime`
- `isCloseout`
- `imprintSize`
- `defaultSetupCharge`
- `defaultRunCharge`
- `FobPointArray`

### 4.4 Important source details from `PricingAndConfiguration`

These pricing and configuration data points are what make the designer work:

- `Part.PartPriceArray`
- `Location.locationId`
- `Location.locationName`
- `Location.decorationsIncluded`
- `Location.minDecoration`
- `Location.maxDecoration`
- `Decoration.decorationId`
- `Decoration.decorationName`
- `Decoration.decorationGeometry`
- `Decoration.decorationHeight`
- `Decoration.decorationWidth`
- `Decoration.decorationDiameter`
- `Decoration.decorationUom`
- `Decoration.decorationUnitsIncluded`
- `Decoration.decorationUnitsMax`
- `Charge.chargeId`
- `Charge.chargeName`
- `Charge.chargeType`
- `Charge.chargesPerLocation`
- `Charge.chargesPerColor`
- `ChargePrice.xMinQty`
- `ChargePrice.yMinQty`
- `ChargePrice.price`
- `ChargePrice.repeatPrice`

## 5. BigCommerce Storage Model

This section defines how the full product object is represented across BigCommerce resources.

### 5.1 Product shell

The BigCommerce **product** is the main merchandising shell and public product identity.

Use it for:

- product ID
- name
- description
- brand
- categories
- primary merchandising images
- search keywords
- related products
- lightweight custom fields
- product-level machine-readable contract metadata in metafields

### 5.2 Variant options and variants

Use **variant options** and **variants** for real blank selections that change the fulfillable item.

Typical examples:

- color
- size
- part

If the selection changes the actual blank SKU, inventory position, or price context, it belongs in the variant model.

### 5.3 Product modifiers

Use **product modifiers** for shopper design selections that do not change the blank SKU.

Typical examples:

- decoration location
- decoration method
- decoration count
- rush or finish options if they affect price but not the blank SKU

Modifiers support the storefront selection experience, but they are **not** the only pricing contract surface. Complex logic should still be stored in structured metafield data.

### 5.4 Shared options and shared modifiers

Use **shared variant options** and **shared modifiers** only for reusable vocabulary.

Good uses:

- standard option names such as `Color` and `Size`
- standard modifier names such as `Decoration Location`
- stable admin vocabulary across the catalog

Do not use shared values as the only source of truth for:

- per-product location availability
- per-product method availability
- per-product charge rules
- size-specific location point changes

### 5.5 Product metafields

Use **product metafields** for machine-readable shared contract data.

This is where `productDesignerDefaults` should live.

That data should include:

- contract version
- PromoStandards source identifiers
- product-wide locations
- product-wide methods
- product-wide charge definitions
- product-wide quantity rules
- media classification references
- pricing behavior metadata needed by the BFF

### 5.6 Variant metafields

Use **variant metafields** only for minimal override fragments.

This is where `variantDesignerOverrides` should live when needed.

Typical override use cases:

- size-specific printable areas
- size-specific location points
- variant-specific geometry changes
- rare variant-specific pricing or design constraints

### 5.7 Custom fields

Use **custom fields** only for simple, human-readable support metadata.

Examples:

- vendor markers
- merchandising hints
- lightweight admin-facing values

Do not use custom fields as the primary design-rule storage surface.

### 5.8 Images and media

Use BigCommerce **product images** and variant-linked imagery for standard storefront image display.

Use metafield contract data to preserve additional machine-readable media relationships, such as:

- which media applies to a location
- which media applies to a decoration method
- which media applies to a part or variant

### 5.9 Price lists

Use **BigCommerce B2B Price Lists** as the authoritative storefront pricing layer.

Price lists should represent:

- shopper-facing sell price for the active merchandising family
- quantity-aware pricing tiers for that family
- vendor-specific auxiliary blank-only layers when the storefront sell price and blank base price must both be retained

They should not be treated as the storage layer for all design-step surcharges.

Current PromoStandards routing is:

- price list `1`: marked-up `Net Decorated`, falling back to another `Net` family if decorated net pricing is unavailable
- price list `2`: raw `Net Blank`

### 5.10 Related products

Use **related products** for:

- related blanks
- companion products
- alternate vendor or family relationships

## 6. Full Product Object Outline

The full runtime product object is spread across associated BigCommerce objects.

| BigCommerce object | Runtime role |
| --- | --- |
| Product | Main product identity and merchandising shell |
| Variant options | Shopper-selectable blank dimensions like color and size |
| Variants | Actual fulfillable blank selections and inventory/pricing context |
| Product modifiers | Designer selections that do not change the blank SKU |
| Shared options / shared modifiers | Reusable vocabulary only |
| Product custom fields | Lightweight support metadata |
| Product metafields | Shared designer defaults and source mapping contract |
| Variant metafields | Minimal override fragments for variant-specific differences |
| Product images | Standard storefront image presentation |
| Related products | Cross-sell / alternate blank relationships |
| Price list records | Base sell price for the selected blank variant |

## 7. Mapping Matrix

This table shows how important supplier data should move through the system.

| PromoStandards source | BigCommerce storage | BFF response field | Contract level |
| --- | --- | --- | --- |
| `Product.productId` | product metafield | `product.source.vendorProductId` | product default |
| `Product.productName` | product `name` | `product.name` | product default |
| `Product.description` | product `description` | `product.description` | product default |
| `Product.productBrand` | brand | `product.brand` | product default |
| `Product.ProductCategoryArray` | categories | `product.categories` | product default |
| `Product.ProductKeywordArray` | product `search_keywords` | `product.searchKeywords` | product default |
| `Product.RelatedProductArray` | related products + product metafield IDs | `relatedProducts` | product default |
| `Product.primaryImageUrl` | product image | `product.primaryImage` | product default |
| `Product.LocationDecorationArray` | product metafield contract data | `designer.locations[*].sourceHints` | product default |
| `Product.ProductPartArray.ProductPart.partId` | variant metafield or variant source mapping | `selectedVariant.partId` | variant identity |
| `Product.ProductPartArray.ProductPart.ColorArray` | variant option values | `selectedVariant.options.color` | variant identity |
| `Product.ProductPartArray.ProductPart.ApparelSize` | variant option values | `selectedVariant.options.size` | variant identity |
| `Product.ProductPartArray.ProductPart.Dimension` | variant metafield if needed | `selectedVariant.physical` | variant override |
| `Product.ProductPartArray.ProductPart.leadTime` | variant metafield or product default | `selectedVariant.leadTimeDays` | variant override |
| `Product.ProductPartArray.ProductPart.isCloseout` | custom field or metafield | `product.flags.isCloseout` | product default |
| `Product.FobPointArray` | product metafield | `basePricing.fobPoints` | product default |
| `Configuration.Part.PartPriceArray` | price list projection + pricing contract metafield | `basePricing.tiers` | variant identity |
| `Configuration.Location` | product metafield defaults | `designer.locations` | product default |
| `Configuration.Location.minDecoration` | product metafield defaults | `designer.locations[*].minDecorations` | product default |
| `Configuration.Location.maxDecoration` | product metafield defaults | `designer.locations[*].maxDecorations` | product default |
| `Configuration.Location.decorationsIncluded` | product metafield defaults | `designer.locations[*].includedDecorations` | product default |
| `Configuration.Decoration` | product metafield defaults | `designer.locations[*].methods` | product default |
| `Configuration.Decoration.decorationGeometry` | product metafield defaults | `designer.locations[*].methods[*].geometry` | product default |
| `Configuration.Decoration.decorationHeight/Width/Diameter` | product defaults or variant override | `designer.locations[*].methods[*].printArea` | product default or variant override |
| `Configuration.Charge` | product metafield defaults | `designer.locations[*].methods[*].charges` | product default |
| `Configuration.ChargePrice` | product metafield defaults | `designer.locations[*].methods[*].charges[*].tiers` | product default |
| `Inventory.PartInventory.quantityAvailable` | variant inventory | `inventory.available` | variant identity |
| `Inventory.PartInventory.lastModified` | variant metafield or contract timestamp | `inventory.lastUpdatedAt` | variant identity |
| `MediaContent.url` | product images or media contract data | `media.gallery` | product default |
| `MediaContent.partId` | variant-linked media mapping | `media.variantAssets` | variant override |
| `MediaContent.LocationArray` | product metafield media mapping | `media.locationAssets` | product default |
| `MediaContent.DecorationArray` | product metafield media mapping | `media.methodAssets` | product default |

## 8. Runtime Query Flow

### 8.1 Query 1: Initial product detail load

Use Storefront GraphQL to render the basic product detail page.

Example:

```graphql
query ProductDetailPage($entityId: Int!) {
  site {
    product(entityId: $entityId) {
      entityId
      name
      sku
      path
      description
      brand {
        name
      }
      defaultImage {
        urlOriginal
        altText
      }
      images(first: 20) {
        edges {
          node {
            urlOriginal
            altText
          }
        }
      }
      prices {
        price {
          value
          currencyCode
        }
      }
      productOptions(first: 20) {
        edges {
          node {
            entityId
            displayName
            isRequired
            ... on MultipleChoiceOption {
              values(first: 50) {
                edges {
                  node {
                    entityId
                    label
                  }
                }
              }
            }
          }
        }
      }
      variants(first: 100) {
        edges {
          node {
            entityId
            sku
            defaultImage {
              urlOriginal
            }
          }
        }
      }
    }
  }
}
```

Use this query for:

- title
- description
- image gallery
- visible blank option selectors
- initial displayed price

Do not make the UI infer full designer behavior from this query alone.

### 8.2 Query 2: Designer payload load

After the shopper selects a concrete blank variant, call the BFF.

Example:

```http
GET /api/storefront/products/1457/designer?variantId=8842&quantity=96
```

This is the payload the designer should actually consume.

### 8.3 Internal BFF composition sources

The BFF should compose from BigCommerce data sources such as:

- product shell
- variant records
- product modifiers
- product images
- related products
- product metafields
- variant metafields
- customer pricing context / price list output for the selected variant

The exact internal API call mix can evolve, but the external BFF response contract should remain stable.

## 9. BFF Contract

Recommended endpoint:

`GET /api/storefront/products/{productId}/designer?variantId={variantId}&quantity={quantity}`

Recommended response type:

`ProductDesignerPayload`

### 9.1 Top-level response shape

```ts
type ProductDesignerPayload = {
  product: ProductSummary;
  selectedVariant: SelectedBlankVariant;
  basePricing: BasePricing;
  inventory: InventorySnapshot;
  designer: ResolvedDesignerContract;
  media: DesignerMedia;
  relatedProducts: RelatedProductSummary[];
  pricingPreview: PricingPreview;
};
```

### 9.2 Core nested types

```ts
type SelectedBlankVariant = {
  variantId: number;
  sku: string;
  partId: string;
  options: {
    color?: string;
    size?: string;
    part?: string;
  };
  overrideKeysApplied: string[];
};

type BasePricing = {
  currencyCode: string;
  quantity: number;
  priceListId: number;
  unitBlankPrice: number;
  tierApplied?: {
    minQuantity: number;
    source: "price_list";
  };
  fobPoints?: Array<{
    id: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;
  }>;
};

type InventorySnapshot = {
  available: number | null;
  inventoryTracked: boolean;
  lastUpdatedAt?: string;
  status: "in_stock" | "low_stock" | "out_of_stock" | "made_to_order";
};

type ProductDesignerDefaults = {
  contractVersion: string;
  locationDefaults: ResolvedDecorationLocation[];
  mediaDefaults: DesignerMedia;
};

type VariantDesignerOverride = {
  variantId: number;
  overrideKeys: string[];
};

type ResolvedDecorationLocation = {
  id: string;
  name: string;
  includedDecorations: number;
  minDecorations: number;
  maxDecorations: number;
  printableArea?: {
    geometry: "rectangular" | "circle" | "other";
    width?: number;
    height?: number;
    diameter?: number;
    uom?: string;
  };
  methods: ResolvedDecorationMethod[];
};

type ResolvedDecorationMethod = {
  id: string;
  name: string;
  isDefault?: boolean;
  unitsIncluded?: number;
  unitsMax?: number;
  charges: ChargeRule[];
};

type ChargeRule = {
  id: string;
  name: string;
  type: "setup" | "run" | "order";
  appliesPerLocation?: number;
  appliesPerColor?: number;
  tiers: Array<{
    minQuantity: number;
    minUnits?: number;
    price: number;
    repeatPrice?: number;
  }>;
};

type PricingPreview = {
  quantity: number;
  currencyCode: string;
  blankUnitPrice: number;
  decorationUnitPrice: number;
  oneTimeCharges: number;
  recurringCharges: number;
  estimatedUnitSellPrice: number;
  estimatedLineTotal: number;
};

type DesignerMedia = {
  gallery: Array<{
    url: string;
    alt?: string;
    kind: "product" | "variant" | "location" | "method";
  }>;
};
```

### 9.3 Merge behavior

The UI should not perform contract inheritance logic.

The BFF should:

1. start with `productDesignerDefaults`
2. locate the selected variant's override fragment
3. apply only the override fields that exist
4. return the final resolved payload as `designer`

## 10. Full JSON Example

The example below shows a resolved designer payload for a selected size variant where the `Full Front` printable area differs from the default product-level value.

```json
{
  "product": {
    "productId": 1457,
    "name": "Port Authority Core Cotton Tee",
    "sku": "PORT-CORE-TEE",
    "path": "/port-authority-core-cotton-tee",
    "brand": "Port Authority",
    "description": "Blank cotton tee available in multiple colors and sizes for screen print and embroidery.",
    "categories": ["Apparel", "T-Shirts"],
    "searchKeywords": ["tee", "cotton", "screen print", "embroidery"],
    "primaryImage": {
      "url": "https://cdn.example.com/products/1457/main.jpg",
      "alt": "Port Authority Core Cotton Tee"
    },
    "source": {
      "vendorId": 22,
      "vendorProductId": "PC54",
      "contractVersion": "2026-03-18.1"
    }
  },
  "selectedVariant": {
    "variantId": 8842,
    "sku": "PC54-BLK-XL",
    "partId": "PC54-BLK-XL",
    "options": {
      "color": "Black",
      "size": "XL"
    },
    "overrideKeysApplied": [
      "locations.full_front.printableArea",
      "locations.full_back.printableArea"
    ]
  },
  "basePricing": {
    "currencyCode": "USD",
    "quantity": 96,
    "priceListId": 1,
    "unitBlankPrice": 8.45,
    "tierApplied": {
      "minQuantity": 72,
      "source": "price_list"
    },
    "fobPoints": [
      {
        "id": "GA-ATL",
        "city": "Atlanta",
        "state": "GA",
        "postalCode": "30318",
        "country": "US"
      }
    ]
  },
  "inventory": {
    "available": 640,
    "inventoryTracked": true,
    "lastUpdatedAt": "2026-03-18T13:10:22Z",
    "status": "in_stock"
  },
  "designer": {
    "contractVersion": "2026-03-18.1",
    "locations": [
      {
        "id": "full_front",
        "name": "Full Front",
        "includedDecorations": 1,
        "minDecorations": 1,
        "maxDecorations": 4,
        "printableArea": {
          "geometry": "rectangular",
          "width": 12,
          "height": 14,
          "uom": "IN"
        },
        "methods": [
          {
            "id": "screen_print",
            "name": "Screen Print",
            "isDefault": true,
            "unitsIncluded": 1,
            "unitsMax": 4,
            "charges": [
              {
                "id": "setup_screen_print",
                "name": "Screen Print Setup",
                "type": "setup",
                "appliesPerLocation": 1,
                "tiers": [
                  {
                    "minQuantity": 1,
                    "minUnits": 1,
                    "price": 45.0,
                    "repeatPrice": 25.0
                  }
                ]
              },
              {
                "id": "run_screen_print",
                "name": "Screen Print Run Charge",
                "type": "run",
                "appliesPerColor": 1,
                "tiers": [
                  {
                    "minQuantity": 48,
                    "minUnits": 1,
                    "price": 1.35,
                    "repeatPrice": 1.15
                  },
                  {
                    "minQuantity": 96,
                    "minUnits": 1,
                    "price": 1.1,
                    "repeatPrice": 0.95
                  }
                ]
              }
            ]
          },
          {
            "id": "embroidery",
            "name": "Embroidery",
            "unitsIncluded": 1,
            "unitsMax": 1,
            "charges": [
              {
                "id": "setup_embroidery",
                "name": "Embroidery Setup",
                "type": "setup",
                "tiers": [
                  {
                    "minQuantity": 1,
                    "minUnits": 1,
                    "price": 55.0,
                    "repeatPrice": 35.0
                  }
                ]
              },
              {
                "id": "run_embroidery",
                "name": "Embroidery Run Charge",
                "type": "run",
                "tiers": [
                  {
                    "minQuantity": 48,
                    "minUnits": 1,
                    "price": 2.25,
                    "repeatPrice": 2.0
                  },
                  {
                    "minQuantity": 96,
                    "minUnits": 1,
                    "price": 2.0,
                    "repeatPrice": 1.8
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "id": "full_back",
        "name": "Full Back",
        "includedDecorations": 1,
        "minDecorations": 1,
        "maxDecorations": 4,
        "printableArea": {
          "geometry": "rectangular",
          "width": 12,
          "height": 14,
          "uom": "IN"
        },
        "methods": [
          {
            "id": "screen_print",
            "name": "Screen Print",
            "charges": [
              {
                "id": "run_screen_print_back",
                "name": "Back Screen Print Run Charge",
                "type": "run",
                "tiers": [
                  {
                    "minQuantity": 48,
                    "minUnits": 1,
                    "price": 1.35,
                    "repeatPrice": 1.15
                  },
                  {
                    "minQuantity": 96,
                    "minUnits": 1,
                    "price": 1.1,
                    "repeatPrice": 0.95
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "media": {
    "gallery": [
      {
        "url": "https://cdn.example.com/products/1457/main.jpg",
        "alt": "Front view",
        "kind": "product"
      },
      {
        "url": "https://cdn.example.com/products/1457/black-xl.jpg",
        "alt": "Black XL blank",
        "kind": "variant"
      },
      {
        "url": "https://cdn.example.com/products/1457/full-front-template.png",
        "alt": "Full front printable area",
        "kind": "location"
      }
    ]
  },
  "relatedProducts": [
    {
      "productId": 1460,
      "name": "Port Authority Long Sleeve Tee",
      "path": "/port-authority-long-sleeve-tee"
    }
  ],
  "pricingPreview": {
    "quantity": 96,
    "currencyCode": "USD",
    "blankUnitPrice": 8.45,
    "decorationUnitPrice": 1.1,
    "oneTimeCharges": 45.0,
    "recurringCharges": 105.6,
    "estimatedUnitSellPrice": 10.02,
    "estimatedLineTotal": 961.8
  }
}
```

## 11. UI Implementation Guidance

### 11.1 Product listing page

Use Storefront GraphQL only.

Render:

- product title
- thumbnail
- base price display
- brand
- path

### 11.2 Initial product detail page

Use Storefront GraphQL only until the shopper selects a concrete blank variant.

Render:

- merchandising content
- blank option selectors
- gallery
- base price

### 11.3 Variant selection event

Once the user chooses the blank variant:

- capture `productId`
- capture `variantId`
- capture intended `quantity`
- request the designer payload from the BFF

### 11.4 Designer initialization

Use the `designer.locations` array as the resolved selection-scoped source of truth.

The UI should not:

- infer printable areas from option labels
- rebuild charge matrices from loose modifier labels
- guess location behavior from image names

### 11.5 Pricing updates

When quantity or design selections change:

- keep the selected blank variant fixed unless the shopper changes it
- recompute preview pricing from the BFF contract data
- if pricing logic is intentionally server-owned, call a re-price BFF endpoint instead of reimplementing pricing rules on the client

### 11.6 Add-to-cart payload

The add-to-cart flow should preserve:

- `productId`
- `variantId`
- selected location IDs
- selected method IDs
- selected decoration counts
- uploaded artwork references
- resolved pricing snapshot used at add-to-cart time

### 11.7 Stable IDs the UI should use

Use machine-readable IDs, not display labels, for:

- `variantId`
- `partId`
- `location.id`
- `method.id`
- `charge.id`

Labels are for display only.

## 12. Shared Options And Shared Modifiers Guidance

Shared options and shared modifiers are helpful, but they are not the primary designer contract.

Use them for:

- stable names
- reusable labels
- consistent catalog vocabulary

Do not depend on them alone for:

- location availability logic
- method availability logic
- charge math
- size-specific location point changes

The real machine-readable contract should remain in product and variant metafields, with the BFF exposing a simpler resolved shape to the UI.

## 13. Implementation Checklist For The UI Team

- Load PLP and basic PDP data from Storefront GraphQL.
- Do not call MerchMonk DB for product runtime reads.
- After variant selection, request the selection-scoped designer payload from the BFF.
- Treat BigCommerce as the runtime product authority.
- Treat B2B price lists as the base blank price authority.
- Treat product-level contract data as the default designer contract.
- Treat variant-level contract data as minimal override fragments only.
- Assume size is the most likely variant-specific override case for location points and printable areas.
- Use IDs, not labels, when storing selections.

## 14. Summary

The correct mental model for the public site is:

- GraphQL loads the merchandising shell.
- BigCommerce variants identify the selected blank.
- Price lists define base blank sell price.
- Product metafields define shared designer defaults.
- Variant metafields define minimal override fragments.
- The BFF merges those pieces and returns one resolved payload to the UI.

That gives the storefront everything it needs to load a complete product detail page and visual designer while keeping BigCommerce as the single runtime product authority.
