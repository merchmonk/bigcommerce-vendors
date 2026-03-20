# MerchMonk Vendors App Improvement Plan

## 1. Purpose

This document replaces the previous improvement plan with a roadmap that reflects the application as it exists today and the product direction described in [`docs/bigcommerce-vendors-app.md`](./bigcommerce-vendors-app.md).

The goal is to improve the MerchMonk Vendors app as a single-tenant internal BigCommerce embedded application for:

- vendor onboarding and connectivity management
- supplier catalog synchronization into BigCommerce
- a stable BigCommerce product contract for blank merchandise, decoration data, and pricing behavior
- pricing and customization data projection for storefront and design-step use
- future order lifecycle integration with PromoStandards endpoints
- internal operator workflows
- strong operational logging, observability, and downstream AI export support

This is not a marketplace-ready multi-tenant app. It is an internal operations platform for one BigCommerce store and related MerchMonk systems.

## 2. Current Baseline

### 2.1 Product baseline

From the product requirements, this app is being built to:

- let internal users add and manage merchandise vendors
- validate vendor connection details before activation
- import vendor product data into BigCommerce
- maintain pricing, inventory, media, and customization-relevant product metadata in BigCommerce
- support future order submission, order status, shipment, invoice, and remittance flows
- provide the product data foundation for the MerchMonk storefront, designer/cart workflow, internal operations, and downstream AI indexing

### 2.2 Current application baseline

The current codebase already has meaningful architecture in place:

- Next.js pages and API routes for the embedded admin experience
- Prisma/PostgreSQL persistence for vendor records, endpoint mappings, sync runs, retry markers, and vendor product identity mapping
- database-first endpoint mapping architecture for PromoStandards and future custom APIs
- ProductData discovery flow (`getProductSellable`, `getProductDateModified`, `getProductCloseOut`, `getProduct`)
- enrichment assembly for pricing, inventory, and media
- BigCommerce catalog projection for products, variants, modifiers, categories, brands, and related products
- sync telemetry and operator-triggered sync controls

### 2.3 Current deployment baseline

The deployed architecture is AWS/CDK-based, not Heroku/MySQL/Firebase-based.

The current source of truth for deployment is the sibling [`cdk-app`](../../cdk-app) project, especially:

- `bin/cdk-app.ts`
- `lib/cdk-app-stack.ts`
- `lib/cdk-aurora-stack.ts`
- `lib/cdk-vpc-stack.ts`

That stack currently indicates:

- `cdk-nextjs` deployment for the app
- AWS Lambda + CloudFront + WAF delivery
- VPC-backed PostgreSQL infrastructure
- AWS Secrets Manager for DB credentials
- CloudWatch alarms and AWS-native operational configuration

Because of this, stale references in this repository to Heroku/ClearDB/Firebase/MySQL should be treated as outdated and scheduled for reconciliation.

## 3. Strengths And Gaps

### 3.1 Current strengths

- database-first mapping and vendor assignment model
- deterministic PromoStandards seed path
- product discovery and enrichment workflow already separated into dedicated ETL modules
- current BigCommerce projection already covers products, variants, categories, brands, images, bulk pricing rules, related products, and decoration-aware modifiers
- persisted retry state for media and related-product deferrals
- passing automated tests and clean lint baseline
- enough current structure to evolve into a stronger control plane and execution plane without rewriting everything

### 3.2 Current gaps

1. The most important gap is the lack of a formally documented BigCommerce product contract for blank merchandise, decoration choices, and design-step pricing behavior.
2. The runtime read model for PLP, PDP, and designer flows is not yet documented clearly enough for a downstream ecommerce UI team.
3. Pricing authority is mixed into the current BigCommerce catalog writer instead of being treated as a dedicated pricing boundary.
4. Sync execution is still synchronous and request-driven in API handlers.
5. Operator UX is still technical and form-heavy.
6. Logging and CloudWatch integration are too lightweight for the operational importance of this app.
7. Order lifecycle integration is not implemented yet.
8. Repository documentation and deployment assumptions are not fully aligned with the real AWS/CDK runtime.

## 4. Architectural Seams

The roadmap should be organized around five explicit architectural seams.

### 4.1 Control Plane

The control plane is responsible for:

- vendor profile management
- credential and endpoint configuration
- mapping authoring and validation
- connection testing
- sync requests
- job visibility and operator diagnostics

This is the internal admin-facing management layer.

### 4.2 Execution Plane

The execution plane is responsible for:

- async job submission and processing
- endpoint invocation
- retry and dead-letter handling
- BigCommerce projection orchestration
- scheduled jobs
- operational logging for all internal and external calls

This is where syncs and future order workflows should actually run.

### 4.3 BigCommerce Product Contract

This seam is responsible for the documented BigCommerce-native object model that downstream systems will rely on, including:

- core product fields
- variant options and variants
- price list behavior
- product modifiers
- related products
- custom fields
- product and variant metafields

This is the contract the next app should read when driving the visual designer and design-step pricing behavior.

### 4.4 Commerce Projection Layer

The commerce projection layer is responsible for writing and maintaining BigCommerce-facing representations according to the defined contract.

This includes:

- blank merchandise product projection
- variant projection
- modifier projection
- category and brand projection
- price list projection
- related-product projection
- contract metadata projection

### 4.5 Observability And Downstream Consumers

This seam is responsible for:

- detailed application and integration logging
- CloudWatch log structure, streams, dashboards, and alarms
- browser telemetry through RUM
- downstream export/indexing from BigCommerce into a vector database or other AI systems

This is intentionally not a second operational product datastore inside MerchMonk DB.

## 5. First Architecture Decision: BigCommerce Product Contract

Before finalizing deeper normalization or sync changes, the application needs an explicit BigCommerce product contract for blank decorated merchandise.

That contract must define how a downstream application determines:

- the base blank product and selected blank variant
- what decoration locations are allowed
- what decoration methods are allowed per location
- how decoration count affects pricing
- what pricing is base merchandise pricing versus decoration surcharge
- what data is machine-readable contract metadata versus lightweight display/admin metadata

This contract should be documented in [`docs/bigcommerce-product-contract-guide.md`](./bigcommerce-product-contract-guide.md) and treated as a required implementation artifact.

### 5.1 BigCommerce-native modeling rules

The contract should use BigCommerce-native primitives according to their actual semantic roles:

- products
  - represent the blank merchandise product shell and storefront merchandising entity
- variants
  - represent fulfillable blank SKU combinations such as color, size, or part-based blank options
- B2B Price Lists
  - represent effective storefront base pricing for the blank item
- modifiers
  - represent decoration-time choices that do not change the fulfilled blank SKU
- metafields
  - represent machine-readable structured contract data for downstream systems
  - store shared product-level designer defaults and minimal variant-level overrides where needed
- custom fields
  - represent lightweight, human-readable or merchandising-support metadata only

### 5.2 Shared options and shared modifiers strategy

The product contract should formalize a selective shared-definition strategy:

- use shared variant options or shared modifiers only when the labels and values are truly reusable across many products
- do not rely exclusively on shared modifier values for per-product decoration rules when location, method, or pricing differs by product
- keep per-product design and pricing rules in product-scoped contract metadata inside BigCommerce
- treat shared options and shared modifiers as reusable vocabulary, not as the full designer rule engine

This matters because cross-product consistency is useful, but decoration choices are often product-specific.

### 5.3 Required contract outputs

The product contract should explicitly define:

- required product fields
- required variant option names
- required modifier names
- required price list behavior
- required product metafield namespaces and keys
- required variant metafield namespaces and keys, if used
- allowed custom field names
- required relation between modifier data and design-step price calculation
- the runtime read model used by the public storefront and designer
- the target BFF response shape that downstream apps consume after blank selection

### 5.4 Acceptance criteria for the contract

- a downstream app can query BigCommerce and understand how to drive the visual designer without calling MerchMonk DB for product structure
- a downstream app can determine base blank price and decoration surcharges from BigCommerce data alone
- the contract distinguishes clearly between variant selection and decoration selection
- a UI developer can load basic product data from Storefront GraphQL and switch to a BFF for designer-specific data after blank selection
- the contract is stable, documented, and versioned

### 5.5 Runtime read model

The contract should be documented around a hybrid read model for the public storefront:

- PLP and initial PDP product data should come from BigCommerce Storefront GraphQL
- once the shopper selects a color or concrete blank variant, the UI should call a MerchMonk BFF
- the BFF should return a selection-scoped payload for the chosen blank variant
- the BFF should compose from BigCommerce product fields, variants, modifiers, images, metafields, related products, and pricing context
- MerchMonk DB should not be part of runtime product reads for the public site

### 5.6 Shared product defaults with variant overrides

The product contract should assume that most PromoStandards parts and BigCommerce variants share the same designer and pricing structure.

The documented target should therefore be:

- `productDesignerDefaults`
  - product-level shared locations, methods, charge rules, most pricing logic, and shared media classifications
- `variantDesignerOverrides`
  - minimal variant-specific overrides only where the selected blank materially changes behavior

The expected common case is:

- locations are shared at the product level
- methods are shared at the product level
- charge rules are shared at the product level
- most pricing logic is shared at the product level
- media classification is shared at the product level

The expected override case is:

- size-dependent decoration points or printable-area differences
- variant inventory
- variant price context
- any rare variant-specific design constraint that truly changes the experience

The BFF should be responsible for:

- starting from `productDesignerDefaults`
- applying the selected variant's override set
- returning only the resolved selection-scoped payload to the UI

This avoids duplicating the full designer contract across every variant when only a small subset of values differs.

## 6. Product And Pricing Authority

The application should keep BigCommerce as the product system of record while separating pricing policy from the current catalog writer.

### 6.1 Product authority

- BigCommerce should remain authoritative for operational product/catalog data used by the storefront, cart, checkout, and customization-facing product flow.
- MerchMonk DB should not become a second operational store for raw product snapshots, normalized product records, inventory snapshots, media snapshots, or pricing snapshots.
- If downstream AI indexing is needed, it should be built as an export/indexing pipeline from BigCommerce rather than as duplicate operational product storage inside MerchMonk DB.

### 6.2 Pricing authority

- BigCommerce product records should be treated as catalog shells and merchandising projections.
- BigCommerce B2B Price List `1` should be treated as the storefront pricing authority for blank merchandise pricing.
- Price list projection should be variant-aware by default so the selected blank variant is the effective pricing unit.
- Supplier-origin cost remains the input to pricing policy.
- MerchMonk owns the pricing policy and pricing projection logic.

### 6.3 Required pricing boundary

Introduce a dedicated pricing boundary before catalog writes. This boundary should:

- ingest supplier base price and supplier tier data
- resolve markup using a configured BigCommerce metafield namespace/key contract rather than relying on a fixed metafield ID
- compute the sell-price projection
- determine what goes to product-level fallback fields
- determine what goes to B2B Price List `1`
- separate base blank price from design-step and decoration-step surcharges
- write price list records through batch upsert flows with chunking, retry/backoff, and serialized store-level execution
- log pricing decisions and write outcomes in detail for traceability

Recommended service name:

- `PricingProjector`

### 6.4 Product-level fields after price list adoption

The roadmap must explicitly preserve intentional behavior for these fields:

- `cost_price`
  - store as the supplier-origin cost when available for internal commerce calculations and traceability
- base `price`
  - keep as an intentional fallback/display value aligned with the current pricing policy, not as the final storefront authority
  - do not treat product-level `price` as a substitute for variant-aware price list output
- bulk pricing rules
  - stop treating product-level bulk pricing rules as the primary pricing authority once the B2B price list projection is live
  - only retain product-level bulk rules if a documented fallback or compatibility reason remains
- markup visibility custom fields/modifiers
  - retain only what is needed for operational visibility or downstream compatibility
  - do not let markup display artifacts become the pricing source of truth

### 6.5 Pricing acceptance criteria

- B2B Price List `1` becomes the effective storefront pricing source for blank merchandise pricing.
- base blank pricing is projected per variant by default unless a documented exception applies
- Pricing changes can propagate without requiring full product recreation.
- Pricing results are reproducible from logs and configuration.
- Catalog writes and pricing writes have clear error ownership.
- Drift between intended pricing behavior and BigCommerce output is detectable.

## 7. Data Ownership

The app needs a simple ownership model with no duplicate operational product authority.

### 7.1 BigCommerce authoritative for

- storefront-visible catalog entities
- checkout-facing purchasable entities
- base blank product and variant structure
- pricing outputs exposed to the storefront
- inventory and media as presented in the live commerce system
- customization-facing product data required by the storefront, cart, checkout, and designer compatibility path
- machine-readable product contract metadata stored in BigCommerce

### 7.2 MerchMonk DB authoritative for

- vendor records and credentials
- endpoint mappings and vendor runtime mappings
- sync run records
- connection test records
- job telemetry and retry state
- operational logs and log metadata references needed for traceability

### 7.3 Explicit non-goals for MerchMonk DB

The plan should explicitly avoid turning MerchMonk DB into a second product store. That means:

- no permanent raw vendor payload archive as a default architecture requirement
- no normalized product snapshot store as a default architecture requirement
- no inventory/media/pricing/product duplication for live product-serving purposes

### 7.4 Snapshot retention outside MerchMonk DB

The product requirements still call for detailed API request and response snapshots for debugging and traceability.

To reconcile that requirement with the no-duplicate-product-store rule:

- do not keep full raw snapshots as primary data in MerchMonk DB
- keep immutable request/response snapshots in object storage, such as S3, when retention is operationally required
- store only references, metadata, and correlation pointers in the database and operational logs
- apply strict retention windows, redaction rules, and access controls
- treat snapshot archival as an observability and audit concern, not a runtime product-serving concern

### 7.5 AI and vector indexing direction

AI search/recommendation indexing should be treated as a downstream export pipeline from BigCommerce into a vector database or other search/indexing system.

The plan should assume:

- BigCommerce remains the operational product authority
- AI indexing is a derived export concern
- MerchMonk DB does not store the complete operational product catalog for AI access

### 7.6 Planned persistence additions

The roadmap should account for additions oriented around jobs and logs rather than duplicated product data:

- `integration_job`
- `integration_job_event`
- `connection_test_log`
- `sync_run_log` or expanded sync telemetry
- `endpoint_call_log`
- `retry_event_log`

## 8. Logging, CloudWatch, And RUM Requirements

Logging is a first-class requirement for this application and needs to be substantially expanded.

### 8.1 Logging objective

Every internal and external API interaction should be logged with detailed, structured, timestamped information rather than simple console messages.

This includes:

- inbound app API requests
- outbound calls to vendor APIs
- outbound calls to BigCommerce APIs
- internal service-to-service operations inside the app
- retries, failures, and fallback behavior
- pricing decisions and sync write outcomes
- contract projection decisions for product, variants, modifiers, and price list records

### 8.2 Logging implementation requirements

The plan should explicitly require:

- adoption of `@aws-sdk/client-cloudwatch-logs`
- structured log envelopes instead of ad hoc string logging
- named log groups and streams organized by application concern
- correlation IDs across a request, sync, or job lifecycle
- consistent event naming and schema
- CloudWatch dashboards and alarms tied to operational metrics
- browser telemetry through CloudWatch RUM
- a transport architecture that separates operational logs from longer-term snapshot retention
- subscription-based export or streaming for retained high-value logs and snapshots where required

### 8.3 Minimum log schema

Each log event should capture, where applicable:

- timestamp
- environment
- request ID / correlation ID / job ID / sync run ID
- user ID if available
- vendor ID if available
- integration family / endpoint name / operation name
- source and destination system
- HTTP method
- request URL or logical operation name
- request payload metadata
- response payload metadata
- status code / result state
- duration
- retry count
- error class, message, and stack when present

### 8.4 Sensitive data handling

Detailed logging does not mean unsafe logging. The plan should require:

- redaction of secrets, access tokens, passwords, and sensitive credentials
- payload summarization or field-level filtering for sensitive data
- safe logging rules for vendor secrets and BigCommerce auth values

### 8.5 Log stream structure

The plan should define log stream separation by concern, for example:

- application request logs
- vendor integration logs
- BigCommerce projection logs
- sync/job execution logs
- pricing logs
- product contract projection logs
- error/security logs
- browser RUM telemetry

### 8.6 Logging transport and retention architecture

The plan should explicitly separate these concerns:

- structured application and integration logs
  - primary operational telemetry written to CloudWatch Logs
- immutable API call snapshots retained for audit/debug use
  - archived outside the transactional database with references from logs or job records
- longer-term export or streaming
  - use subscription-based export/streaming where retained operational events need to flow into longer-term storage or downstream analysis systems

### 8.7 RUM requirements

CloudWatch RUM should be added for the embedded admin UI to capture:

- page load health
- front-end errors
- route-level performance
- failed browser requests
- operator-facing UX issues

CloudWatch RUM integration should be implemented in a CSP-safe way for an embedded BigCommerce app:

- prefer package-based client integration or approved hosted assets over brittle ad hoc third-party script loading
- avoid patterns likely to be blocked by iframe or admin CSP restrictions
- prefer server-mediated configuration where practical

### 8.8 Logging acceptance criteria

- every API call is observable with structured detail
- a single sync/job can be traced end-to-end via correlation IDs
- operators and developers can diagnose failures without guessing from minimal logs
- CloudWatch dashboards and alarms surface critical failure patterns
- browser-side issues are visible through RUM
- retained snapshots can be located from job or request traces without searching blindly

### 8.9 Baselines and service levels

The observability phase should establish baseline metrics and provisional service-level targets for:

- sync success rate
- queue lag
- retry resolution time
- price drift count
- operator mean time to diagnose and recover

Exact numeric targets should be locked after baseline measurement rather than guessed upfront.

## 9. Async Execution Strategy

The next infrastructure step should be async handoff, not immediate expansion into full orchestration tooling.

### 9.1 Why this is first after the contract and logging foundations

Today, syncs are triggered directly in API request/response flows, including:

- vendor creation auto-sync behavior
- manual sync execution from the vendor sync endpoint

That is workable for small cases, but it is not a reliable foundation for larger catalogs, periodic jobs, or order lifecycle polling.

### 9.2 First async cut

The first implementation step should be minimal and durable:

- `integration_job`
- `integration_job_event`
- worker entrypoint
- idempotency key
- retry policy
- dead-letter handling
- vendor-level concurrency lock so a vendor cannot run overlapping conflicting syncs
- replay/runbook guidance for DLQ recovery and operator remediation

Recommended service names:

- `SyncJobDispatcher`
- `CatalogProjector`

### 9.3 Async cutover requirements

The async cutover should explicitly define:

- idempotency key scope
  - include vendor identity plus mapping or sync scope, and a deterministic request window or fingerprint
- vendor-level concurrency behavior
  - block or coalesce overlapping runs for the same vendor where they would create conflicting writes
- submission versus execution boundaries
  - API handlers submit work; workers execute it
- DLQ replay rules
  - operators need a documented replay path with traceable failure context

### 9.4 API contract shift

The roadmap should explicitly call out a new submission/result model for:

- `POST /api/vendors`
  - vendor creation succeeds after validation and configuration persistence
  - initial sync is submitted as a job instead of blocking in the request
- `POST /api/vendors/[vendorId]/sync`
  - submits a sync job rather than directly performing the full sync inline
- optional future `GET /api/integration-jobs/[jobId]`
  - exposes execution status, errors, and operator diagnostics

### 9.5 Step Functions position

Step Functions should be treated as optional, not mandatory phase-one infrastructure.

Only introduce Step Functions if the queue-backed worker model proves insufficient for:

- multi-stage vendor sync checkpoints
- long-running approval/hold states
- complex order lifecycle orchestration with independent recovery stages

The default first move should be queue-backed async execution.

### 9.6 EventBridge scope

EventBridge scheduling should remain concrete and scoped to recurring jobs such as:

- inventory refresh
- order status polling
- shipment polling
- reconciliation jobs

## 10. UX Improvement Direction

The UX section should focus on operator workflows first and component-library choices second.

### 10.1 Priority workflows

1. Vendor onboarding wizard
2. Guided PromoStandards defaults
3. Health/status dashboard
4. Sync history with failed-item drilldown
5. Safer destructive and operator actions than `prompt` and `confirm`
6. Contract visibility so operators can understand how a blank product is being projected into BigCommerce

### 10.2 Custom API support staging

Custom API support should be phased:

- v1: guided templates, validation, clear protocol/runtime configuration UX
- later: schema-driven mapping builder with richer authoring support

### 10.3 UI library guidance

A UI library may still help, but it is secondary to workflow design. The primary objective is reducing operator error and making vendor/sync administration understandable to non-technical internal users.

If a UI library is introduced, it must be verified as fully compatible with React 19 and Next.js 16 before adoption.

### 10.4 Embedded app frontend constraints

Because this app runs inside the BigCommerce admin experience, frontend integrations should account for embedded-app constraints:

- prefer CSP-safe package integration over arbitrary external script tags
- avoid iframe-hostile frontend dependencies where possible
- prefer server-mediated configuration and token handling for browser observability or external service integration

## 11. Order Integration Direction

Order lifecycle support remains in scope, but it should follow the product-contract, logging, pricing-boundary, and async-execution foundations.

Recommended coordination boundary:

- `OrderIntegrationCoordinator`

Future responsibilities should include:

- purchase order submission
- order status polling
- shipment polling and projection
- invoice ingestion
- remittance handling
- operator-visible state transitions and retries

### 11.1 Required order capability matrix

Before order implementation begins, the plan should require a capability matrix covering the PromoStandards order-related endpoints in scope.

That matrix should include, at minimum:

- endpoint and operation name
- supported version(s)
- authentication mode
- whether support is optional by vendor
- submission versus polling behavior
- polling cadence or event trigger
- retry policy and dead-letter policy
- idempotency requirements
- operator-visible failure modes
- downstream state transitions affected

This should be built on the same job and observability model established for catalog syncs.

## 12. Phase Plan

The first implementation wave for this roadmap is tracked separately in [`docs/bigcommerce-vendors-foundation-tranche-implementation-plan.md`](./bigcommerce-vendors-foundation-tranche-implementation-plan.md). That document is the execution source of truth for what the initial tranche will and will not do.

The Phase 0 baseline-reconciliation cleanup wave is tracked separately in [`docs/bigcommerce-vendors-phase-0-cleanup-implementation-plan.md`](./bigcommerce-vendors-phase-0-cleanup-implementation-plan.md). That document is the execution source of truth for the documentation, manifest, and ADR cleanup work that aligns the repository with the implemented platform.

The operator workflow implementation wave for Phase 5 is tracked separately in [`docs/bigcommerce-vendors-operator-ux-tranche-implementation-plan.md`](./bigcommerce-vendors-operator-ux-tranche-implementation-plan.md). That document is the execution source of truth for the dashboard, vendor list, and onboarding/edit UX changes in this tranche.

The operator diagnostics implementation wave for failed-item drilldown and trace inspection is tracked separately in [`docs/bigcommerce-vendors-operator-diagnostics-tranche-implementation-plan.md`](./bigcommerce-vendors-operator-diagnostics-tranche-implementation-plan.md). That document is the execution source of truth for the next diagnostics-focused operator tranche.

The first order lifecycle implementation wave for Phase 6 is tracked separately in [`docs/bigcommerce-vendors-order-lifecycle-tranche-implementation-plan.md`](./bigcommerce-vendors-order-lifecycle-tranche-implementation-plan.md). That document is the execution source of truth for the initial order-domain control plane, polling, and operator workflow tranche.

The checkout and order-orchestration implementation wave that follows Phase 6 is tracked separately in [`docs/bigcommerce-vendors-checkout-order-orchestration-tranche-implementation-plan.md`](./bigcommerce-vendors-checkout-order-orchestration-tranche-implementation-plan.md). That document is the execution source of truth for automatic BigCommerce order intake, vendor split resolution, payload building, and webhook/platform intake wiring.

## Phase 0: Baseline Reconciliation

Objective: align documentation, architectural assumptions, and operational source of truth before deeper implementation.

Execution for this phase is tracked in [`docs/bigcommerce-vendors-phase-0-cleanup-implementation-plan.md`](./bigcommerce-vendors-phase-0-cleanup-implementation-plan.md).

Deliverables:

- update this roadmap to reflect the actual current architecture
- reconcile `README.md` deployment/persistence assumptions
- reconcile `app.json` legacy platform assumptions
- document the sibling `cdk-app` project as deployment source of truth
- remove runtime seed side effects from request paths and move seed behavior to migration/seed-time workflows
- create ADRs for:
  - product contract strategy
  - pricing authority
  - async job model
  - BigCommerce vs MerchMonk ownership
  - customization projection contract
  - logging and observability standards
- publish the ADR set in `docs/adrs/`

Success criteria:

- product, codebase, and deployment documents no longer contradict each other
- future implementation work references the AWS/CDK baseline consistently

## Phase 1: BigCommerce Product Contract And Design Schema

Objective: define the BigCommerce object contract for blank products, decoration configuration, and design-step pricing behavior before further implementation.

Execution for the next implementation tranche is tracked in [`docs/bigcommerce-vendors-storefront-designer-bff-tranche-implementation-plan.md`](./bigcommerce-vendors-storefront-designer-bff-tranche-implementation-plan.md).

Deliverables:

- finalize [`docs/bigcommerce-product-contract-guide.md`](./bigcommerce-product-contract-guide.md)
- create [`docs/bigcommerce-product-integration-guide.md`](./bigcommerce-product-integration-guide.md)
- define the stable product object shape for downstream consumers
- define the hybrid runtime read model for Storefront GraphQL plus selection-scoped BFF reads
- define the target use of products, variants, modifiers, price lists, custom fields, metafields, and related products
- define when shared options/shared modifiers are appropriate versus when product-specific contract metadata is required
- define the inheritance model of product-level designer defaults plus variant-level overrides
- define the machine-readable contract that the next app will use

Success criteria:

- the next application can be built against a documented BigCommerce contract instead of reverse-engineering current sync behavior
- the next application can load basic catalog data from GraphQL and resolved designer data from a documented BFF contract
- base blank pricing and decoration pricing responsibilities are clearly separated
- the contract explains which data is shared across variants and which data may vary by size
- the product contract is versioned and implementable

## Phase 2: Logging And Observability Foundation

Objective: make the application operationally traceable before deeper refactors.

Deliverables:

- replace lightweight ad hoc logging with structured logging
- integrate `@aws-sdk/client-cloudwatch-logs`
- define log groups, streams, event schema, and correlation IDs
- log every internal and external API interaction with detailed metadata
- define immutable snapshot archival outside the application database with retention and redaction rules
- define subscription-based export or streaming for retained logs and snapshots where needed
- add CloudWatch dashboards and alarms
- add CloudWatch RUM for the admin UI

Success criteria:

- every request, sync, and external call is traceable end-to-end
- failures can be diagnosed from logs without relying on guesswork
- browser and server observability are both available

## Phase 3: Pricing Boundary And Projection

Objective: separate pricing policy from the catalog writer and make B2B price lists authoritative.

Execution for the next implementation tranche is tracked in [`docs/bigcommerce-vendors-pricing-product-projection-tranche-implementation-plan.md`](./bigcommerce-vendors-pricing-product-projection-tranche-implementation-plan.md).

Deliverables:

- define and implement `PricingProjector`
- project price output to B2B Price List `1`
- make price list projection variant-aware by default
- formalize product-level fallback pricing behavior
- resolve markup from a namespace/key-based metafield contract rather than a fixed metafield ID
- implement batch price list writes with chunking, retry/backoff, and serialized store-level execution
- formalize design-step surcharge behavior relative to the product contract
- add pricing reconciliation logic
- add detailed logging around pricing decisions and writes

Success criteria:

- price list output becomes intentional and auditable
- price list updates are resilient to API write constraints and do not depend on parallel bulk writes
- pricing updates no longer require catalog-level rewrites as the primary mechanism

## Phase 4: Async Sync Handoff

Objective: remove long-running sync work from request/response handlers.

Deliverables:

- introduce `integration_job`
- introduce `integration_job_event`
- add job submission from vendor creation and manual sync endpoints
- add worker entrypoint and retry policy
- add vendor-level concurrency control and explicit idempotency scope
- add dead-letter handling and operator-visible failure status
- add replay/runbook guidance for failed jobs
- preserve detailed execution logs across the full sync lifecycle

Success criteria:

- sync submission is quick and reliable
- operators can inspect job progress without waiting on an API request
- repeated runs are idempotent
- overlapping vendor syncs do not create conflicting writes

## Phase 5: Workflow-Focused Operator UX

Objective: make the internal app safer and easier for non-technical users.

Deliverables:

- onboarding wizard for vendor setup
- guided PromoStandards setup path
- job and sync health dashboard
- failed-item drilldown
- safer action patterns and better validation
- surfacing of detailed log and trace information in operator-friendly views
- visibility into the BigCommerce product contract per vendor or product family

Success criteria:

- reduced operator error rate
- less dependence on raw endpoint and mapping knowledge

## Phase 6: Order Lifecycle Integration

Objective: expand the execution plane to cover supplier order flows.

Deliverables:

- PO submission workflow
- order status polling workflow
- shipment polling workflow
- invoice/remittance ingestion workflows
- documented order capability matrix covering the PromoStandards endpoints and vendor optionality assumptions
- operator-visible order integration state and retry controls
- full observability for order endpoint interactions

Success criteria:

- order lifecycle state is tracked consistently
- time-sensitive order events can be surfaced reliably

## Phase 7: Checkout And Order Orchestration

Objective: turn the supplier order lifecycle into an automated downstream of real BigCommerce commerce events instead of manual operator-prepared payloads.

Deliverables:

- automatic BigCommerce order intake from webhook and/or trusted platform callers
- BigCommerce order runtime hydration for order detail, products, and shipping addresses
- vendor split logic for multi-vendor orders
- automatic PromoStandards purchase-order payload building with support for enriched line-item overrides
- idempotent creation of vendor-scoped order integrations from a single customer order
- same-origin `merchmonk-app` proxy for future checkout-side order submission
- EventBridge events for intake success/failure and vendor split outcomes
- webhook registration/ensure flow for BigCommerce order-created events

Success criteria:

- real BigCommerce orders can be converted into vendor-scoped order integrations without operator-authored supplier payload JSON
- repeated webhook or checkout submissions do not create duplicate vendor order integrations
- intake failures are visible and diagnosable from operator traces and structured logs

## 13. Public APIs, Interfaces, And Service Boundaries

### 13.1 Planned API changes

- `POST /api/vendors`
  - validate, persist, and submit initial sync job
- `POST /api/vendors/[vendorId]/sync`
  - submit sync job rather than executing synchronously
- optional future `GET /api/integration-jobs/[jobId]`
  - expose job status and failure details
- future storefront/designer BFF
  - `GET /api/storefront/products/{productId}/designer?variantId={variantId}&quantity={quantity}`
  - return a resolved selection-scoped payload composed from BigCommerce runtime product data

### 13.2 Planned service boundaries

- `PricingProjector`
- `CatalogProjector`
- `SyncJobDispatcher`
- `OrderIntegrationCoordinator`
- storefront designer BFF resolver for product defaults plus variant overrides

### 13.3 Planned observability components

- structured server log service backed by `@aws-sdk/client-cloudwatch-logs`
- correlation ID and trace context utilities
- immutable snapshot archive and lookup references for retained request/response payloads
- subscription-based log export or streaming path for retained operational events where required
- CloudWatch dashboards and alarms
- CloudWatch RUM integration for the admin UI

### 13.4 Planned documentation artifacts

- [`docs/bigcommerce-product-contract-guide.md`](./bigcommerce-product-contract-guide.md)
- [`docs/bigcommerce-product-integration-guide.md`](./bigcommerce-product-integration-guide.md)
- ADR for BigCommerce product contract decisions
- ADR for pricing boundary behavior

## 14. Test And Validation Scenarios

The revised roadmap should explicitly require validation for:

- the BigCommerce product contract is documented and versioned
- a downstream app can determine base blank price and decoration pricing from BigCommerce data
- a downstream app can load basic product data from Storefront GraphQL and initialize the designer from one selection-scoped BFF request
- the contract explains how PromoStandards `partId` maps to the selected BigCommerce variant
- the contract explains which designer data is shared across variants and which data may vary by size
- vendor creation submits a job instead of blocking on a full sync
- product sync remains idempotent across repeated vendor runs
- overlapping vendor syncs do not create conflicting writes
- price list projection matches markup policy without requiring full product recreation
- markup resolution is driven by metafield namespace/key contract rather than a fixed metafield ID
- BigCommerce fallback/base pricing behavior remains intentional after price-list rollout
- customization metadata remains available to the storefront/cart/designer path after pricing and sync changes
- every internal and external API call is logged with structured detail
- logs can trace a full sync or request end-to-end using correlation IDs
- retained request/response snapshots can be resolved from log or job context without database-level raw payload duplication
- failed inventory, pricing, media, or order operations produce operator-visible diagnostics
- CloudWatch dashboards and alarms surface meaningful operational failures
- browser-side issues are visible through RUM
- runtime endpoint seeding is removed from request handlers
- repository docs and deployment docs reflect the actual AWS/Postgres assumptions

## 15. Assumptions And Defaults

- This document intentionally replaces the previous improvement plan instead of appending to it.
- The sibling `cdk-app` project is the current deployment source of truth.
- BigCommerce remains the operational system of record for product/catalog data.
- MerchMonk DB should remain limited to vendor records, mappings, logs, and execution telemetry rather than duplicate product storage.
- The BigCommerce product contract is the most important design artifact to finalize before implementation expands further.
- Queue-backed async execution is the default first move after the contract and observability foundations are in place.
- Step Functions are optional until real orchestration complexity justifies them.
- BigCommerce B2B Price List `1` remains the intended effective pricing target.
- AI indexing should be implemented as a downstream export from BigCommerce to a vector database or similar system.
- Order lifecycle integration stays in scope, but it should follow the product-contract, logging, pricing-boundary, and async-execution foundations.
