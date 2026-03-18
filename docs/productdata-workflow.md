# ProductData 2.0.0 Mapping Workflow

## Why `getProduct` Alone Is Not Enough

`getProduct` requires a `productId` (and optional `partId`), so the ETL first needs an ID discovery step.

Implemented discovery flow:

1. `getProductSellable` discovers currently sellable `productId`/`partId` references.
2. `getProductDateModified` discovers changed `productId`/`partId` references since `changeTimeStamp`.
3. `getProductCloseOut` discovers closeout items for closeout flagging.
4. `getProduct` is then executed per discovered ID reference to pull full product detail.

## ProductData Operations in Seeded Endpoint Mappings

The seed now includes ProductData 2.0.0 operations as first-class mapping records:

- `getProductSellable`
- `getProductDateModified`
- `getProductCloseOut`
- `getProduct`

These are seeded in:

- `prisma/seeds/promostandards.ts`

## Runtime Config Supported for ProductData

Per vendor mapping (`vendor_endpoint_mappings.runtime_config`) supports:

- `endpoint_url` (override URL per operation mapping)
- `localization_country` / `localizationCountry` (default `US`)
- `localization_language` / `localizationLanguage` (default `en`)
- `is_sellable` / `isSellable` (for `getProductSellable`, default `true`)
- `change_timestamp` / `changeTimeStamp` (for `getProductDateModified`, default `1970-01-01T00:00:00Z`)
- `product_ids` / `productIds` (manual fallback list when discovery ops are not used)
- `request_fields` (raw SOAP body fields merged into request)

## BigCommerce Mapping Coverage for ProductData

From `GetProductResponse` + `SharedProductObjects`, the ETL now maps:

- Product core: SKU, name, description, base price
- Brand: resolves existing brand by name or creates new brand
- Category: resolves/creates category path(s), including `Category > SubCategory`
- Variants: mapped from `ProductPartArray.ProductPart` with option values
- Variant options: ensures option definitions and option values exist
- Bulk pricing rules: mapped from ProductPrice tiers and synced to BigCommerce rules
- Images: primary image URL mapped as product image
- Product map persistence: vendor product id + BigCommerce product id + SKU in `vendor_product_map`
- Closeout: `is_closeout=true` custom field set for product IDs found via `getProductCloseOut`

## Key Implementation Files

- `lib/etl/productDataWorkflow.ts`
- `lib/etl/productNormalizer.ts`
- `lib/etl/bigcommerceCatalog.ts`
- `lib/etl/runner.ts`
