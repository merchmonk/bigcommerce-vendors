# MerchMonk Vendors App Improvement Plan (No Execution Yet)

## 1. Context and understanding

Based on `docs/bigcommerce-vendors-app.md`, this app is not a generic marketplace app; it is a **single-tenant internal operations app** for MerchMonk that must:

- Manage supplier/vendor connectivity and API capabilities.
- Continuously synchronize supplier product catalog data (product, media, pricing, inventory, compliance) into BigCommerce.
- Support complex configuration-driven product customization data required by the visual designer.
- Handle post-checkout supplier interactions across PromoStandards order lifecycle endpoints (submit orders, status, shipment, invoice, remittance).
- Keep customer-visible order state timely via periodic background checks and notifications.

The biggest non-negotiable now is:

- **Required Update**: move pricing output to **BigCommerce B2B Price Lists** (Default `price_list_id = 1`) using markup from `product_markup` metafield (currently 30%).

And the key strategic improvement areas are:

- AWS architecture modernization for reliable continuous integrations.
- Better internal UI/UX for non-technical users.
- Clear data ownership strategy between BigCommerce and MerchMonk DB (including AI chatbot read needs).

## 2. Current-state snapshot (what exists now)

Current implementation already has strong foundations:

- DB-first endpoint mapping and vendor assignment model (Prisma).
- PromoStandards mapping seed path and custom API draft support (JSON/XML structure entry).
- ProductData discovery workflow (`getProductSellable`, `getProductDateModified`, `getProductCloseOut`, `getProduct`).
- Enrichment assembly stage with gating policy (pricing/inventory strict, media retryable).
- Vendor-isolated duplicate product policy and BigCommerce upsert flow.
- Deferred related-product linking support.
- Sync run tracking and operator sync UI panel.

Main gaps relative to your requirements:

1. Pricing still needs a formal B2B Price List write path as system of record.
2. Order lifecycle endpoints are not implemented end-to-end as operational workflows.
3. Infrastructure is still app-centric; background/scheduled integration orchestration needs hardening.
4. UI works but is still technical and form-heavy for non-technical operator workflows.
5. Data architecture for AI/search-scale access needs explicit denormalized read models.

## 3. Target architecture (recommended)

## 3.1 Logical domains

1. **Vendor Control Plane**  
Manage vendor profile, auth, endpoint mappings, test connection, sync policy.

2. **Catalog Sync Engine**  
Product ingestion, enrichment, normalization, BigCommerce write, retry/backfill.

3. **Pricing Engine**  
Supplier cost ingestion, markup policy, tier strategy, B2B Price List writer.

4. **Order Integration Engine**  
PO submission, status polling/webhooks, shipment tracking, invoice/remittance sync.

5. **Read Models / Analytics / AI Feed**  
Denormalized product + pricing + inventory + customization dataset for chatbot/recommendations.

## 3.2 AWS pattern

- API: Next.js server/API routes (short-lived admin requests).
- Async processing: SQS queues + worker Lambdas for ETL tasks.
- Orchestration: Step Functions for long-running sync jobs.
- Scheduling: EventBridge Scheduler for periodic endpoint checks.
- Persistence: PostgreSQL (Prisma) as integration source-of-truth.
- Secrets: AWS Secrets Manager (vendor credentials and tokens).
- Observability: CloudWatch dashboards + alarms + structured logs + correlation IDs.
- Failure handling: DLQs + replay tooling.

## 4. Required Update Plan: B2B Price Lists (Priority 0)

## 4.1 Pricing decisions

- Supplier-origin price remains integration input (`cost_price`).
- Selling price = `cost_price * (1 + markupPct/100)` where `markupPct` from `product_markup` metafield.
- Tiered/volume pricing stored in Price List records for `price_list_id = 1` (Default).
- Keep BigCommerce base product price as fallback/readability, but enforce price list as storefront effective price.

## 4.2 Implementation scope

1. Add `PriceListWriter` service.
2. Add pricing snapshot tables (versioned by vendor + product + effective timestamp).
3. Extend ETL runner to call price-list upsert after product upsert.
4. Add idempotency key: `vendor_id + bc_product_id + pricing_hash`.
5. Add reconciliation job to detect drift between DB snapshot and BigCommerce price list.

## 4.3 Acceptance criteria

- Every synced product has a matching Price List record in list `1`.
- Markup changes propagate without full product rewrite.
- Tiered pricing is reproducible and auditable per sync run.
- Failures do not block entire sync; failed products are retriable with precise error state.

## 5. Areas For Improvement Plan

## 5.1 Infrastructure modernization (Area #2)

### Objective
Support continuous, reliable, high-volume supplier and BigCommerce communication.

### Steps
1. Introduce queue-backed ETL command model (`sync_vendor`, `sync_product_batch`, `poll_order_status`, `sync_shipments`, etc.).
2. Add Step Functions orchestration for full vendor sync with checkpoints.
3. Move periodic endpoint checks to EventBridge schedules.
4. Add DLQ/retry policy per integration operation category (catalog vs order).
5. Add operational dashboard:
   - queue depth
   - run success rate
   - retry volume
   - endpoint latency/error by vendor.

### Outcome
Predictable throughput, no long-request timeouts, safe retries, and operational visibility.

## 5.2 Non-technical operator UX (Area #3)

### Objective
Internal users can safely manage vendors/sync/jobs without API knowledge.

### Steps
1. Adopt a lightweight admin UI system (e.g., Radix + simple tokenized theme, or a compact admin kit subset).
2. Replace freeform mapping authoring by default with guided templates:
   - PromoStandards endpoint presets.
   - Custom API wizard mode (protocol + sample payload + mapped fields).
3. Add vendor health panel:
   - last successful sync
   - failing endpoint(s)
   - auth status
   - retry queue count.
4. Add run logs with “copy error details” and one-click retry.
5. Add guardrails:
   - confirmation for destructive actions
   - inline validation
   - draft/save/publish mapping workflow.

### Outcome
Lower operator error rate and faster issue resolution.

## 5.3 Data architecture restructuring (Area #4)

### Objective
Define authoritative ownership across BigCommerce and MerchMonk DB while supporting AI/chatbot bulk access.

### Recommended ownership

- **BigCommerce authoritative for**:
  - storefront product identity
  - catalog visibility/status
  - checkout/cart-facing product entities.

- **MerchMonk DB authoritative for**:
  - vendor raw payload history
  - mapping configs/transforms
  - pricing/inventory snapshots
  - customization metadata (locations/methods/charges)
  - integration run/retry/deferred state
  - order integration state machine.

### New/expanded data models

1. `vendor_product_snapshot`
2. `vendor_inventory_snapshot`
3. `vendor_pricing_snapshot`
4. `vendor_media_snapshot`
5. `product_customization_model`
6. `integration_job` and `integration_job_event`
7. `order_integration_state`
8. `ai_product_projection` (denormalized retrieval model for chatbot).

### Outcome
Clear data boundaries, easier audits, and efficient AI retrieval over thousands of records.

## 6. Additional refactor recommendations (beyond the manually highlighted items)

1. Break large orchestration files into use-case services (`SyncPlanner`, `Assembler`, `Writer`, `LinkResolver`).
2. Replace heuristic parsing with schema-driven path extraction from endpoint transform configs.
3. Expand protocol adapters (REST/JSON first) for true non-Promo execution.
4. Add a unified validation layer for mapping drafts and runtime configs (Zod or equivalent).
5. Add contract tests for BigCommerce API writes (pricing, modifiers, categories, related products).
6. Add deterministic replay mode from stored raw vendor payload snapshots.

## 7. Phased delivery plan

## Phase 0: Decision lock + architecture prep (1 week)

- Finalize pricing policy details and tier conversion behavior.
- Lock AWS async pattern (SQS + Step Functions + EventBridge).
- Define data ownership matrix and schema additions.
- Deliverables:
  - ADRs (architecture decision records)
  - updated ERD
  - implementation backlog with acceptance criteria.

## Phase 1: Pricing + data model hardening (1-2 weeks)

- Implement Price List writer and reconciliation job.
- Add pricing snapshot + idempotency fields.
- Add integration tests around price list updates.
- Deliverables:
  - working `price_list_id=1` sync
  - pass/fail dashboards for price sync.

## Phase 2: Catalog sync reliability (2 weeks)

- Queue-backed sync execution and batch processing.
- Enhanced retry/DLQ workflows.
- Improved vendor health telemetry in UI.
- Deliverables:
  - stable high-volume sync
  - low manual intervention for recoverable failures.

## Phase 3: Order endpoint lifecycle (2-4 weeks)

- Implement PO send, order status polling, shipment updates, invoice/remittance handling.
- Add schedule policies and customer-notification integration hooks.
- Deliverables:
  - end-to-end supplier order lifecycle sync.

## Phase 4: UX refinement + AI projections (2 weeks)

- Introduce operator-friendly UI library and guided workflows.
- Build denormalized chatbot projection pipeline.
- Deliverables:
  - reduced operational friction
  - AI-ready bulk product retrieval model.

## 8. Quality gates per phase

- Unit tests on policy and mapping logic.
- Integration tests on Prisma repositories and BigCommerce API client.
- End-to-end sync smoke tests with fixture vendors.
- Load testing for batch sync and scheduled jobs.
- Rollback-safe migrations and replayable failed jobs.

## 9. Risks and mitigation

1. **Supplier payload variability**  
Mitigation: raw payload versioning + transform schema versioning + replay tests.

2. **BigCommerce API rate limits**  
Mitigation: adaptive throttling, queued writes, backoff strategy.

3. **Pricing correctness drift**  
Mitigation: reconciliation job + diff alerting + immutable pricing snapshots.

4. **Operator mistakes in mapping config**  
Mitigation: guided templates, staged publish, validation before activation.

## 10. Recommended immediate next actions (no code execution yet)

1. Approve this roadmap and sequencing.
2. Decide whether to prioritize Phase 1 only (pricing compliance) before infrastructure changes.
3. Approve data ownership matrix so schema expansion can be finalized.
4. Approve UI direction (lightweight component library choice).

---

This document is planning-only and intentionally does not execute any implementation changes yet.
