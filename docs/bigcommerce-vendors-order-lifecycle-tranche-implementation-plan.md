# BigCommerce Vendors Order Lifecycle Tranche Implementation Plan

## Purpose

This document defines the execution scope for the first Phase 6 order lifecycle implementation wave from [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It exists to lock what this tranche will and will not do before order-domain code, jobs, or infrastructure are changed.

## Status

Completed

## In Scope

- PromoStandards order capability seeding and discovery for supported order-related operations
- a documented PromoStandards order capability matrix
- persisted vendor order integration state for supplier-facing purchase orders
- async order job kinds for:
  - PO submission
  - order status polling
  - shipment polling
  - invoice polling
  - remittance advice submission
- operator APIs for creating, listing, viewing, retrying, and manually polling order integrations
- operator UI for order integration state and drilldown
- scheduler infrastructure for recurring order polling
- EventBridge publication and structured logging around order lifecycle actions

## Out Of Scope

- automatic BigCommerce checkout or webhook wiring into the new order APIs
- customer-facing order tracking UI in `merchmonk-app`
- decorator workflow orchestration
- automatic transformation from a raw BigCommerce order/cart payload into a final PromoStandards `sendPO` request
- deep normalized invoice/remittance line-item warehousing beyond the state and metadata needed for operator workflows

## Repositories Touched

- `bigcommerce-vendors`
- `cdk-app`

## Key Product Decisions

### Order state boundary

- The system should track supplier-facing order lifecycle state per vendor order integration, not only per BigCommerce order.
- A single customer order may eventually fan out to multiple supplier orders; this tranche should therefore model a vendor-scoped order integration record.
- Runtime product/catalog storage remains BigCommerce-native. Order operational state lives in MerchMonk DB.

### Request-shape boundary

- This tranche will accept a prepared PromoStandards-ready order payload for `sendPO` rather than attempting a full automatic BigCommerce-to-PromoStandards mapping.
- The new order API should therefore be suitable for a future checkout-side caller that already knows the vendor split and request payload structure.

### Polling model

- Recurring order polling should build on the existing integration job + SQS worker foundation.
- EventBridge schedules should trigger a scheduler Lambda that finds due order integrations and enqueues order poll jobs, rather than directly invoking supplier endpoints.

### Diagnostics and observability

- Order actions must emit the same level of structured logs, operator traces, snapshot references, and platform events as catalog syncs.
- Operators should be able to see order state, last error, next poll times, and related job/trace context without direct CloudWatch queries.

## Deliverables

- order capability matrix document in [`docs/promostandards-order-capability-matrix.md`](./promostandards-order-capability-matrix.md)
- PromoStandards seed expansion for order endpoints and order metadata
- order integration Prisma model(s) and repository functions
- order integration services and generic PromoStandards order execution helpers
- expanded integration job worker support for order job kinds
- scheduler Lambda and EventBridge rules for recurring order polling
- order integration API routes
- operator order list and detail views with retry/manual poll actions

## Acceptance Criteria

- vendors can be tested for PromoStandards order endpoint support without manual endpoint entry
- the app can persist a vendor-scoped order integration record and submit it asynchronously
- order status, shipment, and invoice polling can be queued and executed through the worker model
- operators can inspect order integration state, last errors, and retry or poll actions from the UI
- periodic order polling infrastructure exists in `cdk-app`
- tests, lint, typecheck, build, and CDK synth pass after the changes

## Progress Checklist

- [x] create the saved order lifecycle tranche doc
- [x] add the PromoStandards order capability matrix doc
- [x] extend PromoStandards seeds and discovery for order operations
- [x] add order integration Prisma model(s) and migration
- [x] add order repositories and service-layer helpers
- [x] extend integration job kinds and worker dispatch for orders
- [x] add order integration APIs
- [x] add operator order UI pages
- [x] add scheduler Lambda and EventBridge polling rules in `cdk-app`
- [x] add or update tests
- [x] run app and CDK verification
- [x] update this document to reflect delivered work

## Delivered In This Tranche

- Added `OrderIntegrationState` persistence, order job kinds, request-context propagation, operator traces, and repository helpers.
- Expanded PromoStandards seeding and capability discovery to cover order submission, status, shipment, invoice, and remittance endpoints at operation granularity.
- Implemented order capability resolution, execution, coordination, and scheduling services under `lib/orders/`.
- Extended the existing integration job dispatcher and worker so order jobs share the same queue, retry, lock, event, and observability model as catalog syncs.
- Added operator APIs for:
  - listing order integrations
  - creating order integrations
  - fetching order integration detail
  - manual submit / retry / status poll / shipment poll / invoice poll / remittance submission
- Added operator pages for:
  - `/orders`
  - `/orders/new`
  - `/orders/[orderIntegrationStateId]`
- Added shared navigation to the orders surface from the main embedded-app header.
- Added an order poll scheduler Lambda plus EventBridge rules in `cdk-app` for:
  - 15-minute status polling
  - 30-minute shipment polling
  - 6-hour invoice polling

## Notes

- This tranche intentionally accepts a prepared PromoStandards-ready submission payload for `sendPO`.
- Automatic BigCommerce order-to-PromoStandards request mapping remains future work.
- Remittance support is implemented as a manual operator action in this tranche.
- Order polling uses the discovered vendor capability set and degrades cleanly when optional shipment, invoice, or remittance endpoints are absent.

## Verification

- `bigcommerce-vendors`
  - `npx prisma generate`
  - `npm test -- --runInBand --watchman=false`
  - `npm run lint`
  - `npx tsc --noEmit`
  - `npm run build`
- `cdk-app`
  - `npx tsc --noEmit`
  - `npm run cdk -- synth --quiet`

## Remaining Follow-On Work

- automatic checkout/webhook wiring from BigCommerce or `merchmonk-app` into the new order integration APIs
- richer upstream order payload transformation and vendor split logic
- decorator workflow orchestration
- downstream customer/admin notification fanout
- deeper finance warehousing beyond the operator-focused state and payload history stored here

## Risks And Dependencies

- suppliers may support only a subset of order endpoints, so the lifecycle must degrade by vendor capability
- order payload mapping is intentionally upstreamed in this tranche, so caller contracts must be explicit
- response payloads vary by PromoStandards version and vendor behavior, so order parsing must stay defensive
- recurring polling can produce duplicate work if idempotency and due-time handling are not enforced carefully

## Explicit Non-Goals

- do not replace the existing catalog sync worker model
- do not introduce a second queueing system for orders
- do not block this tranche on the final checkout-side integration
- do not build the customer notification fanout layer yet
