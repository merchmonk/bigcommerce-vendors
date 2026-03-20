# MerchMonk Vendors Foundation Tranche Implementation Plan

## 1. Purpose

This document defines the first implementation tranche for the broader roadmap in [`docs/bigcommerce-vendors-improvement-plan.md`](./bigcommerce-vendors-improvement-plan.md).

It is the execution source of truth for what this tranche will and will not do.

## 2. Status

`Implemented`

## 3. In Scope

- app-side async job model
- async API cutover for vendor creation and manual sync
- standalone worker Lambda for sync execution
- structured logging with correlation IDs
- request/response snapshot archival outside PostgreSQL
- EventBridge publication of sync lifecycle events
- shared product-platform infrastructure wiring
- `AdminAppStack` targeting `../merchmonk-app`
- Aurora stack cleanup back to a production-first, reversible shape

## 4. Out Of Scope

- pricing boundary rewrite
- BigCommerce B2B price-list projection work
- product-detail or designer BFF routes
- order workflow execution
- order polling and order notification workflows
- product contract refactoring beyond what is needed for logging and async execution

## 5. Repositories Touched

- `bigcommerce-vendors`
- `cdk-app`
- `merchmonk-app` only for minimal compatibility or environment glue if needed

## 6. Deliverables

- tranche-scoped async job persistence model
- queue-backed sync submission for vendor creation and manual sync
- standalone sync worker Lambda entrypoint
- structured logger with request/job correlation support
- snapshot archive writer for external calls and failure paths
- EventBridge sync lifecycle publication
- shared EventBridge bus and snapshot archive bucket in `cdk-app`
- SQS queue, DLQ, worker Lambda, and IAM for `VendorsAppStack`
- shared env wiring for `AdminAppStack`
- Aurora stack refactor to make production Aurora the primary path again
- test coverage and synthesis coverage for the above

## 7. Acceptance Criteria

- this document remains aligned with the implemented tranche
- vendor creation and manual sync submit jobs instead of running inline
- overlapping vendor syncs are prevented
- request-time PromoStandards seeding is removed from request handlers
- structured logs include correlation context
- retained snapshots are stored outside PostgreSQL and can be found from logs or job context
- shared EventBridge and snapshot infrastructure exist in CDK
- `AdminAppStack` is aligned to `../merchmonk-app`
- Aurora stack is cleaned up into a production-first, reversible design
- tests and synthesis checks cover the new app and infra behavior

## 8. Progress Checklist

- [x] Create async job persistence model
- [x] Remove request-time PromoStandards seeding
- [x] Add queue-backed sync submission
- [x] Add integration job status API
- [x] Add standalone worker entrypoint
- [x] Add vendor-level advisory locking
- [x] Add structured logger with correlation IDs
- [x] Add snapshot archival
- [x] Add EventBridge publication
- [x] Add shared product-platform stack or construct in `cdk-app`
- [x] Add queue, DLQ, worker, and IAM to `VendorsAppStack`
- [x] Add shared env wiring to `AdminAppStack`
- [x] Refactor Aurora stack deployment mode shape
- [x] Add app tests
- [x] Add CDK synthesis checks for `NetworkStack`, `CommercePlatformStack`, `AuroraStack`, and `VendorsAppStack`
- [x] Clear the unrelated `merchmonk-app` build error blocking all-stacks synth with `AdminAppStack`

## 9. Risks And Dependencies

- the `bigcommerce-vendors` repository has a dirty worktree, so unrelated changes must not be reverted
- sibling repository changes in `cdk-app` may be in progress and must be preserved
- Aurora stack cleanup changes infrastructure shape and needs careful synthesis validation
- snapshot retention and log transport changes introduce AWS service dependencies that must match runtime IAM and env wiring

## 10. Explicit Non-Goals

- do not change pricing semantics in this tranche
- do not implement price-list projection in this tranche
- do not implement the product-detail/designer BFF in this tranche
- do not implement PromoStandards order execution in this tranche
- do not turn MerchMonk DB into a product-serving data store in this tranche

## 11. Public APIs, Interfaces, And Environment Contracts

New interfaces and services planned for this tranche:

- `IntegrationJob`
- `IntegrationJobEvent`
- `IntegrationJobKind`
- `IntegrationJobStatus`
- `SyncJobDispatcher`
- `IntegrationJobWorker`
- `StructuredLogger`
- `SnapshotArchiveWriter`
- `PlatformEventPublisher`

Public API changes planned for this tranche:

- `POST /api/vendors`
- `POST /api/vendors/[vendorId]/sync`
- `GET /api/integration-jobs/[jobId]`

Shared environment contracts planned for this tranche:

- `PRODUCT_PLATFORM_API_BASE_URL`
- `COMMERCE_PLATFORM_EVENT_BUS_NAME`
- `COMMERCE_PLATFORM_EVENT_BUS_ARN`
- `SNAPSHOT_ARCHIVE_BUCKET`

## 12. Test Checklist

- [x] Prisma migration and client generation
- [x] request-time seed removal
- [x] async submission behavior
- [x] duplicate active job reuse
- [x] worker success and failure handling
- [x] advisory lock behavior
- [x] structured log context propagation
- [x] snapshot archival policy enforcement
- [x] EventBridge publication
- [x] CDK synth for shared infra with `-c skipAdminApp=true`
- [x] `AdminAppStack` target/path correctness in CDK TypeScript
- [x] Aurora primary-path and fallback-path typing and synth validation
- [x] Full all-stacks synth including `AdminAppStack`

## 13. Verification Notes

- `bigcommerce-vendors`
  - `npm test`
  - `npm run lint`
  - `npx tsc --noEmit`
  - all passed after the async job, worker, and observability changes
- `cdk-app`
  - `npx tsc --noEmit`
  - passed
  - `npm run cdk -- synth --quiet -c skipAdminApp=true`
  - passed for `NetworkStack`, `CommercePlatformStack`, `AuroraStack`, and `VendorsAppStack`
- `cdk-app`
  - `npm run cdk -- synth --quiet`
  - passed for `NetworkStack`, `CommercePlatformStack`, `AuroraStack`, `VendorsAppStack`, and `AdminAppStack`
