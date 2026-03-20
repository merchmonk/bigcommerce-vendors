# BigCommerce Vendors Operator Diagnostics Tranche Implementation Plan

## Purpose

This document defines the execution scope for the operator diagnostics tranche of the broader roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It captures what this implementation step will and will not deliver before any diagnostics, trace, or drilldown code is changed.

## Status

Completed on March 19, 2026

## In Scope

- failed-item drilldown for vendor sync runs
- integration job timeline view for operators
- persisted operator-visible trace records for external API calls and internal failures
- operator snapshot inspection for archived request/response payloads
- dashboard and vendor-history links into diagnostics views
- sync history UX updates needed to make diagnostics reachable from existing operator pages

## Out Of Scope

- direct CloudWatch log querying in the operator UI
- new order integration flows
- pricing refactors
- reworking the core logging transport
- full observability dashboards in `cdk-app`

## Repositories Touched

- `bigcommerce-vendors`

## Delivered Implementation

- added `OperatorTrace` persistence with snapshot references and correlation-aware repository access
- extended API telemetry to persist operator-visible traces for vendor API calls, BigCommerce API calls, and internal failures
- added sync-run diagnostics service and API route
- expanded integration-job diagnostics to include related traces
- added a server-mediated snapshot viewer API for archived payload inspection
- added operator drilldown pages for:
  - sync runs
  - integration jobs
- linked dashboard history and vendor sync history to the new diagnostics pages

## Verification

- `npx prisma generate`
- `npm test -- --runInBand --watchman=false`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

## Key Product Decisions

### Diagnostics storage model

- Operator drilldown should not depend on live CloudWatch log queries for its primary data source.
- The application should persist lightweight operator trace summaries tied to:
  - `correlation_id`
  - `vendor_id`
  - `integration_job_id`
  - `sync_run_id`
- Archived snapshot payloads should continue to live outside PostgreSQL, with operators viewing them through stored snapshot references.

### Drilldown hierarchy

- Sync run drilldown is the primary failed-item view.
- Integration job drilldown is the primary async execution timeline view.
- Sync run drilldown should focus on:
  - failed endpoints
  - blocked products
  - enrichment gating reasons
  - media retry markers
  - related operator traces
- Integration job drilldown should focus on:
  - job lifecycle events
  - trace timeline
  - correlation context
  - latest failure details

### Snapshot viewing

- Operators should be able to inspect archived snapshots from the UI when a trace includes an S3 snapshot reference.
- Snapshot viewing should be read-only and server-mediated.
- This tranche only needs structured JSON inspection, not raw XML-specific visualization tooling.

## Deliverables

- persisted operator trace model and repository functions
- trace recording from API telemetry paths
- sync-run drilldown service and API route
- integration-job diagnostics service and API route expansion
- snapshot-read API route
- sync-run drilldown page
- integration-job drilldown page
- links from dashboard recent failures and vendor sync history into the new diagnostics pages

## Acceptance Criteria

- operators can open a sync run and see failed items, endpoint failures, and retry markers
- operators can open an integration job and see lifecycle events plus related traces
- external API calls and internal failures create operator trace summaries that are queryable without CloudWatch access
- snapshot-backed traces expose a safe server-side snapshot viewer
- dashboard failures link into job diagnostics
- vendor sync history links into sync-run diagnostics
- tests, lint, typecheck, and build all pass after the changes

## Progress Checklist

- [x] add operator trace persistence model and migration
- [x] record operator trace summaries from API telemetry
- [x] expose sync-run drilldown API
- [x] expose integration-job diagnostics API
- [x] expose snapshot view API
- [x] build sync-run diagnostics page
- [x] build integration-job diagnostics page
- [x] link dashboard failures and vendor sync history to diagnostics pages
- [x] add or update tests
- [x] run prisma generate, tests, lint, typecheck, and build
- [x] update this document to reflect delivered work

## Risks And Dependencies

- trace persistence adds write volume to the diagnostics path and should stay lightweight
- archived snapshots may not exist for every trace, so the UI must handle missing snapshot refs cleanly
- server-mediated snapshot reads depend on app runtime access to the archive bucket
- existing sync-run details are JSON-based and may require defensive parsing for old rows

## Explicit Non-Goals

- do not replace CloudWatch as the system log of record
- do not build a general-purpose log search UI in this tranche
- do not change the previously implemented job model, pricing model, or designer BFF behavior
