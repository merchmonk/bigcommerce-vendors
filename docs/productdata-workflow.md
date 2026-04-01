# ProductData 2.0.0 Mapping Workflow

## Why `getProduct` Alone Is Not Enough

`getProduct` requires a `productId` (and optional `partId`), so the ETL first needs an ID discovery step.

Implemented discovery flow:

1. `getProductSellable` discovers currently sellable `productId`/`partId` references.
2. `getProductDateModified` discovers changed `productId`/`partId` references since `changeTimeStamp`.
3. `getProduct` is then executed per discovered ID reference to pull full product detail.

Current runtime behavior:

- First syncs use `getProductSellable`.
- Later syncs use `getProductDateModified` with the last successful sync timestamp.
- `getProductCloseOut` is not part of the active catalog sync path.
- Product discovery references are de-duped by `productId` before fetch.
- Large ProductData syncs are processed in resumable batches so the worker can continue a catalog across multiple jobs instead of timing out in a single Lambda run.

## ProductData Operations in Seeded Endpoint Mappings

The seed now includes ProductData 2.0.0 operations as first-class mapping records:

- `getProductSellable`
- `getProductDateModified`
- `getProduct`

These are seeded in:

- `prisma/seeds/promostandards.ts`

## Runtime Config Supported for ProductData

Per vendor mapping (`vendor_endpoint_mappings.runtime_config`) supports:

- Endpoint URLs are no longer stored in mapping runtime config. PromoStandards runtime reads the full endpoint URL from `vendor_endpoint_url.endpoint_url`.
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
- Images: vendor image URLs are uploaded into BigCommerce product images after product upsert
- Inventory: vendor inventory is normalized by part, mapped onto variants, and written to BigCommerce through the Inventory API (`/v3/inventory/adjustments/absolute`) at the end of each sync batch
- Product map persistence: vendor product id + BigCommerce product id + SKU in `vendor_product_map`
- Sync batching: catalog jobs can continue from a saved ProductData reference offset across multiple worker jobs

## Key Implementation Files

- `lib/etl/productDataWorkflow.ts`
- `lib/etl/productNormalizer.ts`
- `lib/etl/bigcommerceCatalog.ts`
- `lib/etl/runner.ts`
