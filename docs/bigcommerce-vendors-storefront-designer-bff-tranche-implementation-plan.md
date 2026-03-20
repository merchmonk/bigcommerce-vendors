# MerchMonk Vendors Storefront Designer BFF Tranche Implementation Plan

## Purpose

This document defines the execution scope for the storefront/designer BFF tranche of the broader roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It exists to make clear what will and will not be implemented in this tranche before code and infrastructure changes are made.

## Status

Implemented

## In Scope

- selection-scoped storefront/designer BFF endpoint in `bigcommerce-vendors`
- BigCommerce runtime read/composition services needed to resolve the documented `ProductDesignerPayload`
- resolution of product-level designer defaults plus selected-variant overrides from BigCommerce metafields
- runtime retrieval of product, variant, modifier, related-product, image, and pricing context from BigCommerce
- quantity-aware pricing preview for the selected blank and decoration contract
- typed response contract and tests for the BFF
- `merchmonk-app` environment/client glue needed to discover and call the BFF cleanly
- any `cdk-app` environment wiring needed to expose the product-platform BFF base URL to consuming apps

## Out Of Scope

- vendor sync execution changes
- pricing projection changes to the sync pipeline
- BigCommerce catalog authoring/refactor work already covered by earlier tranches
- customer cart persistence of design payloads
- add-to-cart checkout integration
- visual designer UI implementation itself
- order lifecycle workflows
- operator UX/dashboard work

## Repositories Touched

- `bigcommerce-vendors`
- `cdk-app`
- `merchmonk-app` for minimal compatibility/client wiring only

## Deliverables

- `GET /api/storefront/products/{productId}/designer?variantId={variantId}&quantity={quantity}`
- service layer to read BigCommerce product contract data and resolve a selection-scoped payload
- stable `ProductDesignerPayload` response model aligned with [`docs/bigcommerce-product-integration-guide.md`](./bigcommerce-product-integration-guide.md)
- quantity-aware pricing preview composed from base blank pricing plus designer charge rules
- tests covering contract resolution, override application, and endpoint behavior
- `merchmonk-app` helper/client layer for future PDP/designer consumption
- any required cross-stack/app environment propagation for the product-platform API base URL

## Acceptance Criteria

- a caller can request one endpoint and receive the full resolved designer payload for a selected blank variant
- the BFF composes from BigCommerce runtime data and does not read MerchMonk DB for product structure
- product-level defaults and variant-level overrides are merged server-side rather than in the UI
- the payload includes product summary, selected variant, base pricing, inventory, designer contract, media, related products, and pricing preview
- quantity changes affect the returned pricing preview
- `merchmonk-app` has a clean environment/config path to call the BFF
- tests and validation cover the new behavior

## Progress Checklist

- [x] Save-first tranche document created
- [x] Improvement roadmap linked to this tranche doc
- [x] BFF contract types implemented
- [x] BigCommerce product read service implemented
- [x] Designer contract resolution implemented
- [x] Selection-scoped endpoint implemented
- [x] Quantity-aware pricing preview implemented
- [x] Endpoint tests added
- [x] `merchmonk-app` client/env glue added
- [x] `cdk-app` wiring updated if needed
- [x] Validation completed
- [x] Tranche doc updated to reflect delivered scope

## Implemented Notes

- Added the vendors-platform BFF endpoint at `GET /api/storefront/products/{productId}/designer?variantId={variantId}&quantity={quantity}`.
- Added BigCommerce runtime composition services that load product shell, variants, modifiers, related products, categories, brand, and contract metafields directly from BigCommerce.
- Implemented server-side merge of `product_designer_defaults` plus `variant_designer_override`.
- Extended the projected product contract to include variant catalog pricing metadata needed for quantity-aware BFF pricing.
- Added quantity-aware pricing preview resolution based on selected blank pricing tiers and default decoration charges.
- Added server-to-server auth for product-platform requests using a shared token injected through `cdk-app`.
- Added a minimal proxy route and typed product-platform helper in `merchmonk-app`.
- Corrected the example pricing-preview math in [`docs/bigcommerce-product-integration-guide.md`](./bigcommerce-product-integration-guide.md) to match the implemented pricing formula.

## Verification

The following checks passed after implementation:

- `bigcommerce-vendors`: `npm test`
- `bigcommerce-vendors`: `npm run lint`
- `bigcommerce-vendors`: `npx tsc --noEmit`
- `merchmonk-app`: `npm run lint`
- `merchmonk-app`: `npx tsc --noEmit`
- `cdk-app`: `npx tsc --noEmit`
- `cdk-app`: `npm run cdk -- synth --quiet`

## Risks And Dependencies

- the BFF depends on BigCommerce runtime data being shaped consistently by the earlier product-contract and pricing tranches
- BigCommerce runtime APIs may require multiple calls to assemble a stable payload, so composition must stay disciplined
- `merchmonk-app` should only receive minimal glue in this tranche to avoid accidental UI-scope expansion
- the worktree may contain unrelated changes and those should not be reverted

## Explicit Non-Goals

- do not implement the public PDP or designer UI in this tranche
- do not move runtime product reads into MerchMonk DB
- do not change the established BigCommerce product contract semantics unless a defect blocks the BFF
- do not introduce order execution or cart persistence in this tranche
