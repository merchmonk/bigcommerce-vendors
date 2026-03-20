# BigCommerce Vendors Checkout Order Orchestration Tranche Implementation Plan

## Purpose

This document defines the execution scope for the Phase 7 checkout and order-orchestration implementation wave that follows the completed Phase 6 order lifecycle foundation in [`docs/bigcommerce-vendors-order-lifecycle-tranche-implementation-plan.md`](./bigcommerce-vendors-order-lifecycle-tranche-implementation-plan.md).

It exists to lock what this tranche will and will not do before checkout-side intake, BigCommerce webhook ingestion, or supplier-payload automation are changed.

## Status

Completed

## In Scope

- save-first execution planning for automated order intake
- BigCommerce order runtime readers for:
  - order detail
  - order products
  - order shipping addresses
- vendor split resolution from BigCommerce order line items using synced MerchMonk product/vendor metadata
- automatic creation of vendor-scoped order integrations from a BigCommerce order
- PromoStandards `sendPO` payload building from BigCommerce order data plus optional enriched design/configuration input
- authenticated product-platform order intake API for server-to-server calls
- BigCommerce order webhook ingestion for automatic order-intake triggering
- same-origin `merchmonk-app` proxy/helper for future checkout-side submission
- EventBridge publication for intake and orchestration lifecycle events
- webhook registration/ensure flow during app install/load
- tests covering intake resolution, payload building, idempotency, and webhook/platform API behavior

## Out Of Scope

- end-customer checkout UI in `merchmonk-app`
- payment capture or payment-provider integration
- full decorator workflow execution
- customer-facing order tracking UI
- finalized customer/admin notification delivery channels such as email or SMS
- deep invoice/remittance warehousing beyond the existing Phase 6 order state

## Repositories Touched

- `bigcommerce-vendors`
- `merchmonk-app`
- `cdk-app` verification only; no code changes were required in this tranche because the shared product-platform env contract already existed

## Key Product Decisions

### Intake boundary

- Automated intake should create vendor-scoped `OrderIntegrationState` records from a BigCommerce order rather than adding a second order domain model.
- Intake should reuse the existing Phase 6 order worker and submission flow instead of creating a separate order queueing system.

### Vendor split strategy

- Vendor ownership should be resolved from synced product metadata first, using:
  - `VendorProductMap.bigcommerce_product_id`
  - BigCommerce product-level vendor contract data such as `vendor_id` custom fields
- Intake should fail clearly for unsupported or unmapped products instead of silently assigning them to the wrong vendor.

### Payload builder strategy

- The automated PromoStandards builder should produce a stable baseline `submission_payload.request_fields.PO` structure from BigCommerce order data.
- Product-level blank data and design metadata already projected into BigCommerce should be the source for part, location, and charge references when available.
- The intake API should also accept optional enriched line-item overrides so future checkout/designer work can pass final decoration and artwork details without refactoring the supplier orchestration layer.

### Webhook strategy

- BigCommerce webhook payloads are intentionally lightweight, so webhook handling should hydrate the full order from the BigCommerce Orders API before vendor split or payload building.
- Webhook callbacks should be protected with explicit shared headers configured on the webhook subscription.

### Notification hooks

- This tranche should publish structured platform events for intake success/failure and vendor split outcomes.
- Those events are the notification fanout boundary for follow-on customer/admin delivery work, but this tranche does not implement direct email/SMS delivery.

## Deliverables

- saved Phase 7 tranche execution doc
- roadmap pointer from [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md)
- BigCommerce order runtime reader helpers
- order-intake orchestration service
- vendor-split resolver
- PromoStandards PO payload builder
- server-to-server order intake API in `bigcommerce-vendors`
- BigCommerce webhook endpoint in `bigcommerce-vendors`
- same-origin order intake proxy/helper in `merchmonk-app`
- webhook registration/ensure helper
- EventBridge intake/orchestration events
- tests and verification updates

## Acceptance Criteria

- a BigCommerce order can be hydrated automatically from an order ID
- order line items are grouped into vendor-scoped order integrations deterministically
- vendor-scoped order integrations are created idempotently for repeat webhook or checkout submissions
- a baseline PromoStandards `sendPO` payload is generated automatically from BigCommerce order data
- the intake API can accept optional override data for future design/artwork enrichment
- BigCommerce order-created webhooks can trigger intake without operator intervention
- `merchmonk-app` can call the vendors platform through a same-origin proxy for future checkout-side order intake
- intake and orchestration events are traceable through logs and EventBridge
- tests, lint, typecheck, and synth pass after the changes

## Progress Checklist

- [x] create the saved checkout/order-orchestration tranche doc
- [x] add the roadmap pointer to this tranche
- [x] add failing tests for intake resolution and payload building
- [x] add BigCommerce order runtime readers
- [x] add vendor split resolution and payload builder services
- [x] add automated order-intake orchestration
- [x] add server-to-server order intake API
- [x] add BigCommerce webhook endpoint and registration helper
- [x] add `merchmonk-app` order intake proxy/helper
- [x] add EventBridge intake lifecycle events
- [x] add or update tests
- [x] run verification and update this document to reflect delivered work

## Delivered In This Tranche

- Added BigCommerce order runtime readers for order detail, order products, shipping addresses, and fallback catalog product context.
- Added deterministic vendor split resolution from:
  - `VendorProductMap.bigcommerce_product_id`
  - product-level `vendor_id` custom fields as a fallback
- Added a baseline PromoStandards PO payload builder that:
  - creates `request_fields.PO`
  - produces shipment, contact, line, and part structures
  - accepts optional PO and line-item override fragments for future design/artwork enrichment
- Added automated order-intake orchestration that:
  - hydrates a BigCommerce order
  - creates vendor-scoped supplier order integrations idempotently
  - reuses existing Phase 6 async submission jobs
  - emits intake lifecycle platform events
- Added a trusted server-to-server intake endpoint at `/api/storefront/orders/intake`.
- Added a BigCommerce webhook endpoint at `/api/webhooks/bigcommerce/orders`.
- Added webhook registration/ensure behavior during auth and load flows when an access token is available.
- Added a same-origin `merchmonk-app` proxy route and typed helper for future checkout-side order submission.
- Added unit coverage for:
  - vendor split resolution
  - PromoStandards PO payload building
  - order-intake orchestration and deduplication

## Notes

- The automated payload builder intentionally generates a strong baseline supplier PO shape and leaves room for future checkout/designer override fragments instead of requiring a full decorator workflow in this tranche.
- Repeated webhook or platform submissions deduplicate per vendor via existing `OrderIntegrationState` records keyed by `external_order_id`.
- BigCommerce webhook registration uses the existing shared product-platform token as an explicit header on the webhook subscription.
- No `cdk-app` code changes were required in this tranche; the previously established shared env and platform wiring were sufficient.

## Verification

- `bigcommerce-vendors`
  - `npm test -- --runInBand --watchman=false`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- `merchmonk-app`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- `cdk-app`
  - `npx tsc --noEmit`
  - `npm run cdk -- synth --quiet`

## Remaining Follow-On Work

- connect the public checkout flow to the new same-origin order intake proxy with final decoration/artwork overrides
- expand decorator workflow orchestration beyond supplier order submission
- build end-customer/admin notification delivery on top of the new intake and order lifecycle platform events
- enrich the baseline supplier payload builder with deeper freight, tax, and finance warehousing logic as those workflows solidify

## Risks And Dependencies

- BigCommerce order webhooks can be retried and duplicated, so idempotency must be strict
- some supplier payload fields depend on final checkout/designer data that may not yet be fully represented in a public checkout flow
- line-item vendor resolution depends on synced BigCommerce product identity staying consistent
- webhook registration must stay aligned with deployed public URLs and shared-secret configuration

## Explicit Non-Goals

- do not replace the existing Phase 6 order worker model
- do not introduce a separate order database outside the current MerchMonk DB
- do not block automated intake on full decorator workflow execution
- do not implement end-customer notification delivery channels in this tranche
