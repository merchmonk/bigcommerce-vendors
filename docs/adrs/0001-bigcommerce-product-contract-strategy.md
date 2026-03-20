# ADR 0001: BigCommerce Product Contract Strategy

- Status: Accepted
- Date: 2026-03-20

## Context

The MerchMonk storefront, designer workflow, operator tools, and downstream integrations need a stable way to interpret a BigCommerce product as a blank merchandise contract rather than a generic catalog item.

Earlier implementation work mixed display data, pricing, and customization semantics in ways that required downstream consumers to infer intent from sync behavior instead of reading a documented contract.

## Decision

MerchMonk will treat BigCommerce as the runtime product authority and define a stable BigCommerce-native product contract with these rules:

- product:
  - storefront merchandising shell and blank-product container
- variants:
  - fulfillable blank selections such as color, size, or part-backed SKU combinations
- B2B Price List `1`:
  - authoritative base sell price for blank merchandise
- modifiers:
  - design-time shopper choices that do not change the fulfilled blank SKU
- metafields:
  - machine-readable contract data for the designer and pricing layers
- custom fields:
  - lightweight human-readable or merchandising support metadata only

The public storefront read model is hybrid:

- PLP and initial PDP reads use BigCommerce Storefront GraphQL
- after blank selection, downstream apps call a MerchMonk BFF that resolves a selection-scoped payload from BigCommerce data only

## Consequences

- downstream apps do not read MerchMonk DB for runtime product structure
- the product contract must remain versioned and documented in:
  - [`../bigcommerce-product-contract-guide.md`](../bigcommerce-product-contract-guide.md)
  - [`../bigcommerce-product-integration-guide.md`](../bigcommerce-product-integration-guide.md)
- future catalog changes must preserve the distinction between variant selection and decoration selection
