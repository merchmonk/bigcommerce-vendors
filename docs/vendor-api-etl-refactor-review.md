# Vendor API + ETL Refactor Review

## Scope of this review

This document reviews the integration refactor that moved vendor mapping and ETL behavior to a database-first model supporting:

- PromoStandards vendors.
- Non-Promo (custom) vendors with protocol and structure-defined mappings.
- Product ETL orchestration into BigCommerce.
- Prisma-backed persistence for mapping metadata and sync state.

It covers why each relevant file was created/changed, what architectural practice it supports, and where the design can be made more optimal.

## Architecture summary

The implementation moved from file-driven assumptions toward composable records:

- Endpoint definitions live in `endpoint_mappings`.
- Vendor assignment/runtime config lives in `vendor_endpoint_mappings`.
- ETL execution reads DB mapping records, resolves protocol adapter, and orchestrates ProductData + enrichment endpoints.
- Sync state, product map state, retry state, and deferred relationship state are persisted.

## File-by-file rationale

## Runtime + build configuration

### `next.config.ts`
- Why changed: align deployment with `cdk-nextjs` adapter mode instead of standalone packaging.
- Content rationale: enables `experimental.adapterPath`.
- Best practice applied: deployment config is explicit and framework-native, reducing custom build glue.
- Potential optimization: pin and document tested `next` + `cdk-nextjs` compatibility matrix to avoid future adapter drift.

### `package.json`
- Why changed: formalize Prisma and quality scripts in app runtime.
- Content rationale: adds `prisma:*`, `db:seed`, `db:migrate`, and keeps lint/test/build repeatable.
- Best practice applied: one-command reproducibility for schema generation, migration, and seed.
- Potential optimization: replace custom `db:migrate` wrapper with a pure Prisma flow (`migrate deploy && db:seed`) to reduce duplicate migration paths.

### `lib/prisma.ts`
- Why created: centralized Prisma singleton for Next.js server runtime.
- Content rationale: reuses client in dev to prevent connection explosion during hot reload.
- Best practice applied: standard Next.js + Prisma connection lifecycle pattern.
- Potential optimization: add optional query instrumentation hooks for ETL observability.

## Types + contracts

### `types/etl.ts`
- Why changed: expose stable app-level contracts for mapping, sync runs, retries, and deferred related links.
- Content rationale: added `PendingRelatedProductLink`, `ProductEnrichmentRetry`, enum unions for retry/link state.
- Best practice applied: explicit cross-layer contracts prevent hidden shape coupling.
- Potential optimization: split “API response contracts” from “domain contracts” to reduce type bloat in one file.

### `types/vendor.ts`
- Why changed: support generic vendor form/mapping draft payloads for Promo and custom APIs.
- Content rationale: keeps protocol + payload format + structure input per endpoint row.
- Best practice applied: consistent DTOs between UI and API reduces translation bugs.
- Potential optimization: add discriminated unions for JSON/XML draft validation at compile-time.

## Database models, migrations, and seeding

### `prisma/schema.prisma`
- Why changed: model API-agnostic mapping data and ETL lifecycle state in first-class tables.
- Content rationale:
  - Generic vendor integration metadata (`integration_family`, `api_protocol`, `connection_config`).
  - Mapping catalog (`endpoint_mappings`) + vendor assignment (`vendor_endpoint_mappings`).
  - Run telemetry (`etl_sync_runs`) + vendor product identity map (`vendor_product_map`).
  - Deferred related link table (`pending_related_product_links`).
  - Enrichment retry table (`product_enrichment_retries`).
- Best practice applied: normalized relational design with foreign keys, uniqueness constraints, and enum states.
- Potential optimization:
  - Add partial indexes for common filters (`status='PENDING'`).
  - Add an optimistic concurrency/version field on mutable tables used in retries.

### `prisma/migrations/20260317000000_init/migration.sql`
- Why created: baseline schema for vendors, mappings, sync runs, and product map.
- Best practice applied: explicit SQL migration under version control.
- Potential optimization: include comments in SQL for operational clarity during manual DB troubleshooting.

### `prisma/migrations/20260317120000_product_sync_semantics_v2/migration.sql`
- Why created: introduce persistence for deferred related links and enrichment retries.
- Content rationale: retryable ETL concerns moved out of volatile runtime memory.
- Best practice applied: additive migration compatible with empty DB bootstrap.
- Potential optimization: add check constraints for retry counts and status transition guards.

### `prisma/seeds/promostandards.ts`
- Why changed: provide deterministic DB-seeded PromoStandards mapping records.
- Content rationale: includes ProductData discovery/detail and PricingAndConfiguration operations used by ETL.
- Best practice applied: deterministic seed records replace filesystem scanning and enforce source-of-truth in DB.
- Potential optimization: externalize seed definitions to validated JSON schema so endpoint additions are declarative and reviewable.

### `prisma/seed.ts`
- Why changed: standard Prisma seed entrypoint to upsert mapping seed data.
- Best practice applied: idempotent upsert seed process.
- Potential optimization: factor shared seed upsert logic into one module reused by runtime seeding API and CLI seeding.

### `lib/etl/promostandardsSeed.ts`
- Why changed: runtime seed helper for API-triggered seed operations.
- Content rationale: lets app endpoints seed mappings without invoking CLI seed command.
- Best practice applied: keeps web flow independent from local shell tooling.
- Potential optimization: deduplicate with `prisma/seed.ts` through a single shared service function.

## Vendor + mapping APIs

### `pages/api/etl/mappings.ts`
- Why changed: generic mapping catalog CRUD/read endpoint.
- Content rationale: supports listing/upserting mappings and optional Promo seed trigger.
- Best practice applied: clear API boundary for mapping lifecycle.
- Potential optimization: split read and write routes, add stricter request validation (e.g., Zod) and auth scopes.

### `pages/api/vendors/index.ts`
- Why changed: vendor creation/list endpoint with mapping draft resolution and optional initial auto-sync.
- Content rationale:
  - Enforces connection test for Promo vendors.
  - Resolves inline mapping drafts to DB mapping IDs.
  - Applies vendor mapping assignments.
- Best practice applied: validates minimum mapping assignment to prevent unusable vendor records.
- Potential optimization: move orchestration into service layer to reduce API handler complexity.

### `pages/api/vendors/[vendorId].ts`
- Why changed: vendor read/update/delete with mapping hydration and mapping draft updates.
- Content rationale: returns vendor and assigned mapping details in one call for edit UX.
- Best practice applied: reduces UI round-trips and keeps mapping serialization consistent.
- Potential optimization: split resource route into focused handlers (`vendor`, `vendor-mappings`) for SRP.

### `pages/api/vendors/[vendorId]/mappings.ts`
- Why changed: dedicated mapping assignment endpoint for vendor.
- Content rationale: supports either explicit `mapping_ids` or inline draft upserts.
- Best practice applied: update paths stay explicit and reversible.
- Potential optimization: enforce transaction-scoped validation against orphaned mapping IDs.

### `pages/api/vendors/[vendorId]/sync.ts`
- Why changed: trigger and inspect ETL sync runs per vendor.
- Content rationale: supports full sync or specific mapping sync.
- Best practice applied: operational visibility via run history endpoint.
- Potential optimization: add async job queue handoff for long-running syncs.

### `pages/api/vendors/test-connection.ts`
- Why changed: protocol-aware connection test endpoint for add/edit vendor UX.
- Best practice applied: fail-fast validation before persisting vendor credentials.
- Potential optimization: add response timing and endpoint fingerprinting metadata for support/debug.

### `pages/api/vendors/promo-options.ts`
- Why kept/changed: compatibility endpoint for mapping option queries and seed initialization.
- Best practice applied: preserves backward compatibility for older UI flows.
- Potential optimization: deprecate once all clients use `/api/etl/mappings` to eliminate overlap.

## Vendor UI flow

### `components/vendorForm.tsx`
- Why changed: support API-agnostic endpoint mapping authoring inline in vendor form.
- Content rationale:
  - Integration family + protocol controls.
  - Per-endpoint draft rows (name/version/operation/protocol/payload/structure/runtime config).
  - Promo defaults can be seeded into rows.
  - Required test connection gate before saving Promo vendors.
- Best practice applied: pushes configuration correctness earlier into the UX.
- Potential optimization:
  - Move form state to a reducer/hook to reduce component complexity.
  - Add schema-based client validation to reduce server round-trip failures.

### `pages/vendors/new.tsx`
- Why changed: wires vendor form to creation + test-connection API.
- Best practice applied: API calls are centralized by route and context-aware.
- Potential optimization: standardize API client wrapper (error shape, retries, tracing headers).

### `pages/vendors/[id].tsx`
- Why changed: enables editing vendor + showing sync panel in one workspace.
- Best practice applied: consolidates operational controls with configuration editing.
- Potential optimization: defer sync panel load with dynamic import for faster edit-page TTI.

### `components/vendorSyncPanel.tsx`
- Why created: operational UI for per-endpoint/all sync triggers and run history.
- Best practice applied: explicit operator actions, recent run telemetry surfaced in-app.
- Potential optimization: add endpoint-level status counts and failed-item drilldown from `etl_sync_runs.details`.

### `pages/vendors/index.tsx`
- Why changed: reflects new vendor metadata (integration family/protocol/status) in list UX.
- Best practice applied: useful at-a-glance integration diagnostics.
- Potential optimization: replace prompt-based action menu with deterministic action controls.

## ETL core modules

### `lib/etl/adapters/types.ts`, `lib/etl/adapters/factory.ts`, `lib/etl/adapters/soapAdapter.ts`, `lib/etl/adapters/unsupportedAdapter.ts`
- Why changed/created: protocol abstraction boundary for endpoint invocation.
- Content rationale: SOAP implemented now; other protocols return explicit “not implemented yet”.
- Best practice applied: open/closed design via adapter interface; no protocol-specific branching in orchestration.
- Potential optimization: register adapters via map/DI container so new protocols are plug-in modules.

### `lib/etl/soapClient.ts`
- Why changed: stable SOAP envelope generation and response body parsing.
- Best practice applied: centralized transport + parser behavior avoids duplicated SOAP mechanics.
- Potential optimization: make request template rendering stricter (typed placeholders), add retry policy for transient transport failures.

### `lib/etl/mappingDrafts.ts`
- Why changed: transform vendor form drafts into durable mapping records + assignment entries.
- Content rationale: supports JSON/XML structure parsing and generic protocol defaults.
- Best practice applied: draft resolution isolated from API handlers.
- Potential optimization: move validation to dedicated schema validator and return structured field-level errors.

### `lib/etl/productNormalizer.ts`
- Why changed: expand normalized product contract for enrichment-aware sync.
- Content rationale adds:
  - `cost_price`, `search_keywords`, `related_vendor_product_ids`.
  - `shared_option_values`, `modifier_blueprint`, `enrichment_status`.
  - ProductData extraction for categories, brand, price tiers, keywords, related products, closeout marker.
- Best practice applied: single normalization surface for downstream ETL stages.
- Potential optimization: split endpoint-specific normalizers into dedicated modules (`productDataNormalizer`, `inventoryNormalizer`, etc.) to reduce file size and branching.

### `lib/etl/productDataWorkflow.ts`
- Why changed: ProductData discovery orchestration (`getProductSellable`, `getProductDateModified`, `getProductCloseOut`, then `getProduct`).
- Best practice applied: deterministic discovery-to-detail workflow with endpoint-level result telemetry.
- Potential optimization: support bounded concurrency for `getProduct` calls with rate limits.

### `lib/etl/productEnrichment.ts`
- Why created: enrichment assembly stage for Pricing, Inventory, and Media.
- Content rationale:
  - Strict gating for pricing/inventory failures.
  - Media as non-blocking with retry marker output.
  - Heuristic extraction of inventory, media URLs, pricing tiers, and modifier blueprint.
- Best practice applied: explicitly codified gating policy and per-product enrichment status.
- Potential optimization:
  - Replace heuristic parsing with mapping-driven field paths from `transform_schema`.
  - Separate parser logic by endpoint operation to improve determinism.

### `lib/etl/syncSemantics.ts`
- Why created: centralized pure rules for duplicate policy, canonical dedupe keys, markup and bulk pricing derivation.
- Best practice applied: pure functions are testable and keep policy logic out of transport code.
- Potential optimization: include policy versioning so behavior changes can be rolled out safely.

### `lib/etl/bigcommerceCatalog.ts`
- Why changed: BigCommerce write model upgraded for vendor-isolated semantics.
- Content rationale:
  - Exact SKU/name candidate lookup + vendor marker decisioning.
  - Duplicate SKU policy and collision-safe SKU resolution.
  - `cost_price` + markup-derived sell price.
  - Bulk pricing conversion to percent discounts.
  - Canonical brand/category dedupe.
  - Variant sync, shared-option-style modifier sync, config modifier sync.
  - Related-product upsert behavior.
- Best practice applied: idempotent upsert pattern and explicit catalog sub-operations.
- Potential optimization:
  - Split into smaller collaborators (`CatalogProductWriter`, `TaxonomyService`, `ModifierService`, `RelatedLinkService`).
  - Add API rate limiting/backoff and batch calls where available.

### `lib/etl/repository.ts`
- Why changed: centralized persistence for mappings, sync runs, product map, pending related links, enrichment retries.
- Best practice applied: repository boundary keeps Prisma-specific details out of orchestration logic.
- Potential optimization:
  - Move serializer boilerplate to shared mapper helpers.
  - Use transactions for multi-step state transitions that must stay atomic.

### `lib/etl/runner.ts`
- Why changed: orchestrates full sync lifecycle:
  - mapping selection,
  - ProductData baseline fetch,
  - enrichment assembly,
  - BigCommerce write,
  - retry marker writes,
  - deferred related-link resolution,
  - sync run completion telemetry.
- Best practice applied: explicit sync-run state machine and structured details payload.
- Potential optimization:
  - Decompose into use-case services (`SyncPlanner`, `ProductAssembler`, `ProductWriter`, `LinkResolver`).
  - Introduce queue-based async execution for large vendor catalogs.

### `lib/vendors.ts`
- Why changed: vendor CRUD now aligned to generic integration metadata and mapping assignment support.
- Best practice applied: avoids protocol-specific vendor schema coupling.
- Potential optimization: split persistence model from API-facing vendor projection.

## Tests and verification

### `test/lib/etl/productDataWorkflow.spec.ts`
- Why changed: verifies ProductData discovery-to-detail flow and request-field propagation.
- Best practice applied: behavior-focused unit test around the critical discovery pipeline.

### `test/lib/etl/productNormalizer.spec.ts`
- Why changed: regression checks for ProductData normalization and generic nested payload extraction.
- Best practice applied: protects normalization contract under mixed payload shapes.

### `test/lib/etl/syncSemantics.spec.ts`
- Why created: validates duplicate classification, canonicalization, and pricing rule transforms.
- Best practice applied: policy logic isolated and unit-tested as pure functions.

### `test/lib/etl/productEnrichment.spec.ts`
- Why created: verifies strict gating semantics and media non-blocking retry behavior.
- Best practice applied: tests capture explicit failure policy, not just happy paths.

### `test/lib/etl/runner.spec.ts`
- Why changed: validates orchestration path and deferred related-link resolution wiring.
- Best practice applied: high-level orchestration regression with controlled mocks.

## Best-practice alignment summary

What was done well:

- DB-first mapping architecture reduces runtime coupling to local files.
- Adapter boundary supports protocol extension without rewriting orchestration.
- Idempotent upsert strategy used throughout mappings/product map/sync state.
- Explicit sync telemetry (`etl_sync_runs.details`) improves operational debugging.
- Retry/deferred tables avoid losing enrichment/link work across process restarts.
- Test coverage now includes rule semantics, gating behavior, and orchestration flow.

## Where this could be more optimal

## File architecture opportunities

1. `lib/etl/bigcommerceCatalog.ts` and `lib/etl/runner.ts` are too large and multi-responsibility.
2. Seed logic is duplicated between Prisma seed and runtime seed helper.
3. Endpoint-specific parsing logic is still heuristic and concentrated in broad utility files.
4. API handlers include orchestration that should move into dedicated service/use-case modules.

## Code architecture opportunities

1. Introduce a mapping interpreter layer that consumes `transform_schema` field paths declaratively.
2. Replace sequential product processing with controlled concurrency + rate limiting.
3. Add stricter validation and typed errors for mapping drafts and runtime config.
4. Add transactional boundaries for related multi-write operations (product write + map + retry updates).
5. Add observability primitives (structured sync metrics, per-endpoint latency, retry counters).

## Suggested next refactor (priority order)

1. Extract `runner.ts` into use-case services with dependency-injected collaborators.
2. Split `bigcommerceCatalog.ts` by bounded contexts (taxonomy, modifiers, product upsert, related links).
3. Implement protocol adapters beyond SOAP (REST/JSON first) with parity tests.
4. Make `transform_schema` execution deterministic and endpoint-specific.
5. Add integration tests against a BigCommerce sandbox and a test PostgreSQL DB for repository flows.

## Final assessment

The current implementation is a substantial improvement in extensibility and operational safety over file-coupled mapping logic. It follows solid architectural direction for a growing ETL domain, but it is still in a “strong foundation + evolving execution layer” state. The highest ROI improvements now are decomposition of orchestration/writer modules and replacing heuristic payload parsing with strict mapping-driven transforms.
