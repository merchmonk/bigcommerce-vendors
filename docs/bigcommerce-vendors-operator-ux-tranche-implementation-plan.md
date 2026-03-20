# BigCommerce Vendors Operator UX Tranche Implementation Plan

## Purpose

This document is the execution plan for the operator UX tranche of the broader roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It defines what this implementation step will and will not do before any UX or API mutations are made.

## Status

Completed

## In Scope

- operator-facing sync, health, and history dashboard
- vendors table redesign with sortable operational columns
- safer row actions for sync, edit, and deactivate
- simplified vendor onboarding and edit flow
- PromoStandards capability discovery during connection test
- automatic persistence of discovered PromoStandards endpoint versions into the vendor record
- automatic assignment of PromoStandards endpoint mappings based on discovered capabilities
- server-side vendor summary APIs for health, counts, and status
- deactivation guard that blocks deactivation when the vendor still has active synced products
- edit warning UX for active vendors

## Out Of Scope

- price list or pricing-boundary refactors
- storefront designer BFF changes
- order workflow execution
- schema-driven custom API mapping builder
- visual redesign of the entire app shell beyond the operator workflow pages in this tranche

## Repositories Touched

- `bigcommerce-vendors`

## Delivered Scope

- added `vendor_type` as first-class vendor metadata
- kept custom API metadata in `connection_config` and exposed it through the simplified form
- replaced the PromoStandards manual mapping UX with discovery-driven capability testing
- added operator summary services for vendor table rows and the dashboard
- added a new dashboard page at `/dashboard`
- rebuilt the vendors page as a sortable operator table with safe actions
- simplified the add/edit vendor form for PromoStandards and custom API onboarding
- added an active-product deactivation guard in the vendor update API

## Implementation Notes

- the custom API service type dropdown ships with these guided v1 options:
  - `REST API`
  - `SOAP API`
  - `JSON Feed`
  - `XML Feed`
  - `CSV Feed`
- PromoStandards discovery groups seeded endpoint mappings by endpoint name and version, then probes one representative operation per group.
- SOAP faults that indicate missing request data, such as missing `partId`, are treated as evidence that the endpoint/version is reachable.
- SOAP faults that indicate unsupported operations or unsupported actions are treated as unavailable endpoint/version combinations.
- the vendors table and dashboard both use persisted async job and sync-run records for status/health, not client-side heuristics.
- the initial `active products` rule remains conservative and is still based on a non-null `bigcommerce_product_id` in `vendor_product_map`.

## Key Product Decisions

### PromoStandards onboarding

- The operator should not manually configure endpoint mappings for PromoStandards vendors.
- The connection test should probe seeded PromoStandards endpoint/version combinations, determine availability, and store the discovered capability matrix on the vendor record.
- Saving a PromoStandards vendor should auto-assign endpoint mappings from the discovered endpoint/version set.
- The save button should remain disabled for PromoStandards vendors until a discovery run succeeds with at least one available endpoint.

### Custom API onboarding

- The v1 custom API flow should stay lightweight.
- Operators will choose an API service type from a guided dropdown and provide format data in a textarea.
- This tranche will not re-introduce the old manual endpoint-mapping authoring workflow into the primary vendor form.

### Vendor status and health

- Vendor operational status should be derived from persisted async job and sync-run records.
- The primary statuses for the table are:
  - `SYNCING`
  - `SYNCED`
  - `SYNC_FAILED`
  - `DEACTIVATED`
- Health should be derived from completed sync history and presented as a percentage of successful completed syncs.

### Product counts and deactivation guard

- `Total products synced` is the count of vendor product map rows for the vendor.
- `Total products active` is the count of vendor product map rows with a non-null `bigcommerce_product_id`.
- Deactivation should be blocked when `total active products > 0`.
- This is the tranche-one implementation of the rule; it is intentionally conservative.

## Deliverables

- vendor summary query/service with:
  - operational status
  - health percentage
  - total synced product count
  - total active product count
  - latest sync date
  - added date
- dashboard summary query/service with:
  - overall status counts
  - recent sync history
  - recent failures
- new dashboard page
- redesigned vendors list page
- simplified add/edit vendor form
- PromoStandards discovery service and API response contract
- create/update vendor API changes to support discovery-driven PromoStandards setup
- deactivation guard in the vendor update API
- roadmap link back to this tranche document

## Acceptance Criteria

- the add/edit PromoStandards form no longer exposes manual endpoint mapping controls
- PromoStandards test connection returns endpoint/version availability and stores that discovery in the vendor record
- PromoStandards vendor save succeeds only after a passing discovery with at least one available endpoint
- vendor create and edit flows persist vendor type and custom API metadata cleanly
- the vendors page displays sortable columns for the operator fields defined in the roadmap
- the vendors page supports safe row actions for sync now, edit warning, and deactivate
- the dashboard page surfaces sync/health/history information from persisted data
- deactivation fails with a clear message when the vendor still has active synced products
- tests, lint, and typecheck pass for the changed app code

## Progress Checklist

- [x] add vendor metadata support for vendor type and guided custom API fields
- [x] add PromoStandards capability discovery service
- [x] update test-connection API to return discovery results
- [x] update vendor create flow for discovery-driven PromoStandards setup
- [x] update vendor edit flow for discovery-driven PromoStandards setup
- [x] add vendor summary and dashboard summary services
- [x] add deactivation guard based on active synced products
- [x] build dashboard page
- [x] rebuild vendors list page
- [x] simplify add/edit vendor form
- [x] add or update tests for discovery, summaries, and UX behavior
- [x] run lint, typecheck, and test suite
- [x] update this document to reflect delivered work

## Verification

- `npx prisma generate`
- `npm test -- --runInBand --watchman=false`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

## Risks And Dependencies

- the app has an existing operator workflow built around manual endpoint mappings, so this tranche changes both UI and API contracts together
- PromoStandards capability detection is only as good as the seeded endpoint catalog and SOAP probe heuristics
- some vendors may return SOAP faults for missing product-specific parameters even when an endpoint exists, so the discovery classifier must distinguish validation faults from unsupported endpoint/version faults
- the current data model does not persist a richer BigCommerce active/inactive product state, so the initial active-product guard uses mapped BigCommerce product presence as the conservative rule
- the worktree may contain unrelated local changes that should not be reverted

## Explicit Non-Goals

- do not refactor pricing projection
- do not build order orchestration or order dashboards in this tranche
- do not build the future custom API schema builder in this tranche
- do not move runtime product reads into MerchMonk DB
