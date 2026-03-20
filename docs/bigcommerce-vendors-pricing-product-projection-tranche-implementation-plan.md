# MerchMonk Vendors Pricing And Product Projection Tranche Implementation Plan

## 1. Purpose

This document defines the next implementation tranche after the completed foundation work in [`docs/bigcommerce-vendors-foundation-tranche-implementation-plan.md`](./bigcommerce-vendors-foundation-tranche-implementation-plan.md).

It is the execution source of truth for what this tranche will and will not do while implementing the broader roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

## 2. Status

`Implemented`

## 3. In Scope

- implement the pricing boundary as a dedicated application layer before BigCommerce catalog writes
- resolve markup configuration by metafield namespace/key contract instead of fixed metafield IDs
- make BigCommerce B2B Price List `1` the authoritative blank-product pricing target
- make pricing projection variant-aware by default
- define and implement intentional fallback behavior for product-level `price`, `cost_price`, and bulk pricing data
- refactor BigCommerce product projection to align with the documented product contract
- project product-level designer defaults and variant-level overrides into BigCommerce machine-readable contract metadata
- treat size-driven decoration point or printable-area differences as the main expected override case
- add pricing reconciliation, drift detection, and pricing-specific observability
- preserve BigCommerce as the runtime product system of record

## 4. Out Of Scope

- public storefront or admin BFF routes for product/designer consumption
- `merchmonk-app` PDP, PLP, visual designer, or checkout implementation
- order execution workflows, polling, shipment handling, or notifications
- broad UI redesigns in the vendors app outside what is needed to support pricing configuration visibility
- turning MerchMonk DB into a product-serving read model
- replacing the queue/job/logging foundation added in the previous tranche

## 5. Repositories Touched

- `bigcommerce-vendors`
- `cdk-app` only if new environment wiring, IAM, or configuration outputs are required for pricing projection
- `merchmonk-app` is out of scope for implementation in this tranche unless a tiny compatibility/env update becomes unavoidable

## 6. Deliverables

- `PricingProjector` or equivalent pricing-boundary service
- markup-resolution service based on namespace/key metafield lookup
- variant-aware BigCommerce B2B price-list projection flow
- serialized bulk price-list write path with chunking and retry/backoff
- explicit product fallback pricing policy implemented in code
- BigCommerce contract projection updates for product-level defaults plus variant-level overrides
- size-aware override handling for decoration/location data where needed
- pricing reconciliation and drift-detection logic
- structured logging for pricing decisions, reconciliation outcomes, and BigCommerce pricing writes
- updated implementation and roadmap documentation as needed to reflect actual delivered behavior

## 7. Acceptance Criteria

- pricing policy is separated from the main catalog writer into a distinct boundary
- B2B Price List `1` becomes the intentional authoritative pricing output for blank merchandise
- selected blank variants receive correct price-list projections without requiring full product rewrites as the primary pricing mechanism
- product-level `price`, `cost_price`, and bulk pricing behavior are explicit, intentional, and documented in code
- markup configuration is resolved by stable namespace/key lookup rather than environment-specific IDs
- the projected BigCommerce product contract matches the documented product/variant inheritance strategy
- most shared design and pricing data is stored once at product level, with minimal variant overrides
- size-specific decoration overrides are supported without duplicating the full designer contract on every variant
- pricing drift and write failures are observable from logs and reconciliation results
- tests verify pricing projection behavior, contract projection behavior, and BigCommerce write orchestration behavior

## 8. Progress Checklist

- [x] Audit the current catalog writer, pricing logic, and existing BigCommerce price writes
- [x] Define the exact code-level pricing boundary inputs and outputs
- [x] Implement namespace/key-based markup lookup
- [x] Implement variant-aware pricing projection
- [x] Implement serialized batch price-list writes with retry/backoff
- [x] Formalize and implement product fallback pricing behavior
- [x] Refactor product contract projection to product defaults plus variant overrides
- [x] Add size-specific override handling for decoration/location differences
- [x] Add pricing reconciliation and drift detection
- [x] Add pricing-specific logging and diagnostics
- [x] Update docs to reflect the delivered pricing/product-projection behavior
- [x] Run app tests, lint, typecheck, and any required CDK verification

## 9. Risks And Dependencies

- the current catalog writer mixes product, modifier, and pricing responsibilities, so refactoring boundaries must avoid regressions in existing sync behavior
- BigCommerce price-list APIs have bulk-write constraints, so write orchestration must stay serialized and retry-safe
- existing product records may rely on historical pricing fields, custom fields, or modifier state that cannot be broken during the transition
- variant-level differences appear to be uncommon, but size-specific exceptions are important and must not be flattened away
- the repositories remain dirty, so unrelated user changes must not be reverted

## 10. Explicit Non-Goals

- do not build the product/designer BFF in this tranche
- do not implement the public ecommerce UI in this tranche
- do not introduce a second MerchMonk-owned product database for runtime reads
- do not expand into PromoStandards order execution in this tranche
- do not rewrite the completed async job and observability foundation except where small compatibility updates are required

## 11. Public APIs, Interfaces, And Environment Contracts

New or updated interfaces and services planned for this tranche:

- `PricingProjector`
- `MarkupConfigResolver`
- `PriceListProjector` or `PriceListWriter`
- `PriceListBatchCoordinator`
- `PricingReconciliationService`
- `ProductContractProjector`
- `ProductDesignerDefaults`
- `VariantDesignerOverride`

Likely existing code paths to change in this tranche:

- BigCommerce catalog projection and write orchestration
- vendor enrichment to pricing-boundary inputs
- BigCommerce metafield resolution and contract projection
- sync result logging for pricing outcomes

Environment or config contracts likely relevant in this tranche:

- BigCommerce price-list identifier for B2B blank-product pricing
- markup metafield namespace/key contract
- any rate-limit or batch-size tuning settings needed for serialized price-list writes

## 12. Test Checklist

- [x] unit tests for markup namespace/key resolution
- [x] unit tests for pricing-boundary calculations
- [x] unit tests for product fallback pricing policy
- [x] unit tests for product-default plus variant-override merge/projection behavior
- [x] integration tests for variant-aware price-list projection
- [x] integration tests for serialized/retried price-list writes
- [x] regression tests for existing catalog sync behavior that should remain unchanged
- [x] lint and TypeScript validation
- [x] any necessary CDK or environment-contract validation

## 13. Verification Notes

- `bigcommerce-vendors`
  - `npm test -- --runInBand`
  - `npm run lint`
  - `npx tsc --noEmit`
  - all passed after the pricing-boundary, price-list, and contract-projection changes
- `cdk-app`
  - `npx tsc --noEmit`
  - `npm run cdk -- synth --quiet`
  - both passed after wiring the explicit pricing/product-contract environment variables into `VendorsPlatformConstruct`

## 14. Delivered Scope Notes

- This tranche now resolves markup through a namespace/key-based store metafield lookup, projects variant-aware pricing into B2B Price List `1`, keeps intentional fallback product pricing fields, and writes product-level designer defaults plus minimal variant overrides into BigCommerce metafields.
- The current reconciliation layer is a sync-time target reconciliation summary plus detailed BigCommerce write logging. It detects missing variant targets and incomplete price-list projection during sync execution.
- A later enhancement can add post-write read-back comparison against live BigCommerce price-list records if deeper drift auditing is needed.

## 15. Implementation Notes

- BigCommerce remains the runtime system of record for product, pricing, and designer-facing contract data.
- MerchMonk DB remains limited to vendor configuration, mappings, jobs, logs, and execution telemetry.
- Most variants are expected to share the same designer and pricing contract.
- The main expected override case is size affecting decoration points or printable areas.
- The implementation should prefer storing shared contract data once at product level and only storing minimal overrides at variant level.
