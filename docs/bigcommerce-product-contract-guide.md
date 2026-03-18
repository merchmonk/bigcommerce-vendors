# MerchMonk BigCommerce Product Contract Guide

## 1. Purpose

This document defines how a blank merchandise product should be represented in BigCommerce for MerchMonk.

It is intended to guide:

- the Vendors app that creates and syncs products into BigCommerce
- the next application that will call the BigCommerce API to power the visual designer
- any future service that needs to calculate blank product price, decoration price, or design-step pricing

The goal is to make the BigCommerce object model explicit, stable, and machine-readable so downstream systems do not need to reverse-engineer the Vendors app implementation.

## 2. Core Principles

### 2.1 BigCommerce is the product system of record

For live commerce behavior, BigCommerce is authoritative for:

- the blank product shell
- variants and fulfillable blank SKUs
- storefront-visible pricing outputs
- images, categories, brand, and merchandising data
- designer-facing contract metadata stored in BigCommerce

### 2.2 MerchMonk DB is not a second product store

MerchMonk DB should not be used as a duplicate operational product catalog for:

- base product records
- normalized product snapshots
- inventory snapshots
- media snapshots
- design-time product lookups

### 2.3 Downstream apps must read a contract, not infer behavior from labels

The next app should not rely on:

- human-readable custom field names alone
- modifier labels alone
- ad hoc parsing of product descriptions or category names

Instead, it should read a documented contract made up of:

- standard BigCommerce product and variant fields
- B2B price list outputs
- product modifiers
- product and variant metafields

## 3. BigCommerce Resource Roles

## 3.1 Product

The BigCommerce product is the blank merchandise shell and storefront merchandising entity.

It should hold:

- product identity
- name and description
- brand and categories
- primary images
- search keywords
- lightweight custom fields
- machine-readable product-level contract metadata in metafields

It should not by itself be the full design-time pricing model.

## 3.2 Variant options and variants

Variants represent fulfillable blank SKU combinations.

Use variants for selections that change the actual fulfilled blank item, such as:

- color
- size
- part/style when the supplier exposes multiple fulfillable blank parts

If selecting a value changes the underlying blank SKU or inventory position, it belongs in the variant model.

## 3.3 B2B Price Lists

B2B Price List `1` is the intended effective storefront pricing authority for base blank merchandise pricing.

Use it for:

- base sell price for the blank item
- quantity-tier behavior for the blank item

Do not use it as the storage location for decoration surcharges that depend on design-step choices.

## 3.4 Modifiers

Modifiers represent design-time or configuration-time selections that do not change the fulfilled blank SKU.

Use modifiers for:

- decoration location
- decoration method
- decoration count
- other decoration or finishing choices that affect price but do not change the blank SKU

If selecting a value changes only decoration behavior or surcharge behavior, it belongs in the modifier model.

## 3.5 Metafields

Metafields are the preferred location for machine-readable design and pricing contract data.

Use product or variant metafields for:

- contract versioning
- structured design metadata
- structured pricing metadata
- vendor-source identifiers needed by downstream systems
- machine-readable rules that another app should read directly

Metafields should be the main cross-application contract surface for non-trivial structured data.

## 3.6 Custom fields

Custom fields should be limited to lightweight human-readable or merchandising-support metadata.

They are acceptable for:

- simple admin-support markers
- easy storefront-visible values where needed
- lightweight debugging hints

They should not be the primary place for complex design contract or pricing logic.

## 3.7 Related products

Related products can be used for:

- alternative blank options
- companion products
- vendor-specific sibling relationships

They are not the primary mechanism for design logic or price calculation.

## 4. Shared Options And Shared Modifiers

Shared option definitions are useful, but only in the right places.

### 4.1 When shared definitions are appropriate

Use shared variant options or shared modifiers when:

- the label is standardized across many products
- the value set is genuinely reusable
- the downstream app benefits from a predictable catalog-wide control vocabulary

Examples:

- `Color`
- `Size`
- `Decoration Location` only if the values are truly standardized

### 4.2 When shared definitions are not enough

Do not rely exclusively on shared modifier values when:

- allowed locations differ by product
- allowed methods differ by product
- price adjustments differ by product
- decoration count rules differ by product

In those cases, shared labels may still be useful, but the actual contract data must remain product-specific in BigCommerce metafields and, where needed, product-specific modifier values.

### 4.3 MerchMonk recommendation

The MerchMonk contract should use a hybrid model:

- standardized control names wherever practical
- product-specific machine-readable rules in metafields
- variants for fulfillable blank selections
- modifiers for decoration selections

This prevents downstream apps from depending on brittle storewide assumptions.

## 5. Current Vendors App Projection

This section documents what the current codebase writes today.

## 5.1 Current product-level fields written by the Vendors app

The current sync path writes the following core product fields into BigCommerce:

- `name`
- `type = physical`
- `sku`
- `description`
- `cost_price`
- `price`
- `inventory_tracking = product`
- `inventory_level`
- `search_keywords`
- `brand_id`
- `categories`
- `images`
- `bulk_pricing_rules`

## 5.2 Current custom fields written by the Vendors app

The current implementation writes or may write these custom fields:

- `vendor_endpoint`
- `vendor_version`
- `vendor_operation`
- `vendor_product_id`
- `line_name`
- `is_closeout`
- `vendor_id`
- `duplicate`
- `size`
- `product_cost_markup`

These fields are currently useful, but they are not enough to serve as the full downstream contract.

## 5.3 Current variant behavior

The current implementation derives variants from supplier part-level data and currently uses option names such as:

- `Color`
- `Size`
- `Part`

The variant model is the correct place for blank merchandise selections that affect the underlying fulfillable item.

## 5.4 Current modifier behavior

The current implementation currently creates product-level modifiers with names including:

- `vendor_id`
- `duplicate`
- `product_cost_markup`
- `size`
- `Decoration Location`
- `Decoration Method`
- `Decoration Count`

The decoration modifiers are currently derived from pricing/enrichment payloads and represent the beginning of the design-step pricing contract, but the contract is implicit in code rather than documented as a stable object model.

## 5.5 Current related-product behavior

The current implementation also maintains related-product links when supplier payloads expose related product IDs.

## 6. Target Stable Contract

The next app should be built against the target contract below, not just the current implementation details.

## 6.1 Base product contract

Each blank product should expose a stable base shell in BigCommerce with:

- product ID
- name
- description
- brand
- categories
- merchandising images
- base/default SKU
- search keywords
- related products when relevant

The product itself represents the blank merchandise parent, not the full decoration-state selection.

## 6.2 Variant contract

Variants should represent only fulfillable blank combinations.

Rules:

- if a selection changes the actual purchased blank SKU, it must be a variant dimension
- if a selection only changes decoration behavior or price, it must not be modeled as a variant dimension

Recommended standard variant axes:

- `Color`
- `Size`
- `Part` or `Style` only when supplier data requires it

Each variant should expose:

- variant ID
- variant SKU
- base blank pricing context
- inventory
- optional variant-specific metafields if needed by the designer

## 6.3 Base blank pricing contract

Base blank pricing should come from:

- selected variant if variant pricing differs
- BigCommerce B2B Price List `1` as the effective storefront pricing authority

Rules:

- the next app should treat price list output as the base sell price for the blank item
- product-level `price` is a fallback or projection aid, not the primary pricing authority
- quantity tiers for the blank item should come from the price list strategy rather than ad hoc modifier logic

## 6.4 Decoration modifier contract

Decoration modifiers should represent customer design selections that add or adjust price without changing the blank SKU.

Required standard modifier concepts:

- `Decoration Location`
- `Decoration Method`
- `Decoration Count`

Optional future modifier concepts:

- `Rush`
- `Packaging`
- `Special Finish`

Rules:

- modifier names should be stable across the catalog
- modifier labels shown to users can vary in presentation if needed, but the contract meaning must remain stable
- modifier price adjusters can support simple storefront-compatible pricing behavior
- the machine-readable source of truth for complex pricing logic should still live in metafields

## 6.5 Product metafield contract

The target contract should introduce product metafields as the main machine-readable integration surface.

Recommended namespaces and keys:

- `merchmonk.contract/version`
  - contract version for downstream parsing
- `merchmonk.vendor/source`
  - vendor identity and source product references
- `merchmonk.design/config`
  - location, method, and decoration-rule model
- `merchmonk.pricing/config`
  - machine-readable design-step pricing inputs and surcharge rules

If payload size requires it, split the JSON across multiple logically named metafields rather than overloading one giant field.

## 6.6 Variant metafield contract

Use variant metafields only when a rule is variant-specific and should not be duplicated at the product level.

Examples:

- variant-specific printable area data
- variant-specific image positioning metadata
- variant-specific pricing behavior that is not already represented through the price list contract

## 6.7 Custom field contract

Custom fields should be treated as secondary metadata, not the main design contract.

Allowed custom-field roles:

- vendor traceability
- operational hints
- simple storefront-readable attributes

Avoid placing complex nested design or pricing rules in custom fields.

## 7. Recommended Machine-Readable Design Contract

The next app needs a predictable JSON contract. The recommended shape below is conceptual and can be refined during implementation, but the main structure should remain stable.

```json
{
  "version": 1,
  "blankProductType": "decoratable_blank",
  "vendor": {
    "vendorId": 22,
    "vendorProductId": "P-12345"
  },
  "design": {
    "locations": [
      {
        "code": "front",
        "label": "Front",
        "minDecorations": 1,
        "maxDecorations": 4,
        "includedDecorations": 1,
        "methods": [
          {
            "code": "embroidery",
            "label": "Embroidery"
          },
          {
            "code": "screen_print",
            "label": "Screen Print"
          }
        ]
      }
    ]
  },
  "pricing": {
    "basePriceSource": "price_list_1",
    "markupSource": "product_markup_metafield",
    "decorationCharges": [
      {
        "location": "front",
        "method": "embroidery",
        "amount": 5.0,
        "type": "relative"
      },
      {
        "count": 2,
        "amount": 2.5,
        "type": "relative"
      }
    ]
  }
}
```

This contract is intentionally separate from human-facing labels and should be versioned.

## 8. Design-Step Pricing Flow For The Next App

The next app should calculate design-step price in this order:

1. Fetch the product, variants, modifiers, and relevant metafields from BigCommerce.
2. Determine the selected blank variant.
3. Read the base blank price from the BigCommerce pricing context for that variant.
4. Read the design contract from product metafields.
5. Validate allowed decoration locations, methods, and count limits.
6. Apply decoration surcharges based on the pricing contract.
7. Build the displayed design-step total as:

`base blank price + decoration surcharges + any future supported service charges`

8. Persist the customer’s selections back into the cart/order flow using the chosen BigCommerce-compatible mechanism.

## 9. What Belongs Where

Use this rule set when deciding where a piece of data should live.

### 9.1 Use a variant when

- the choice changes the fulfillable blank SKU
- the choice changes inventory
- the choice represents a real supplier part distinction

### 9.2 Use a modifier when

- the choice affects decoration behavior
- the choice affects price but not the blank SKU
- the choice is part of the designer workflow

### 9.3 Use a metafield when

- the data is structured
- the next app must parse it directly
- the data should not be inferred from display labels
- the rules vary by product

### 9.4 Use a custom field when

- the value is lightweight
- the value is mainly for admin or merchandising support
- the value does not require nested or structured parsing

## 10. Current-To-Target Migration Direction

The current app already maps the right kinds of information, but the contract needs to be formalized.

Migration direction:

- keep current product/variant/category/brand/image projection patterns
- keep current decoration-related modifier concepts
- move the machine-readable design/pricing contract into product metafields
- reduce reliance on custom fields for structured business logic
- keep variant modeling strictly for fulfillable blank selections
- formalize whether any shared option/modifier definitions are reusable across product families

## 11. Minimum Downstream App Checklist

Before the next app is built against this contract, confirm that each target product has:

- a valid base product shell
- variants for all fulfillable blank choices
- price list coverage for base blank pricing
- stable decoration modifiers
- product metafields containing the machine-readable contract
- a contract version value
- a documented mapping of what the app should read first and what it should treat as fallback only

## 12. Implementation Notes

- The current Vendors app should eventually project this contract into BigCommerce as part of sync.
- The improvement roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md) should be treated as the implementation sequence.
- This guide should be updated whenever the BigCommerce contract changes.

