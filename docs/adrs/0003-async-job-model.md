# ADR 0003: Async Job Model

- Status: Accepted
- Date: 2026-03-20

## Context

Vendor syncs and later order workflows are operationally long-running, failure-prone, and integration-heavy. Running them inline inside request handlers makes retries, observability, operator feedback, and concurrency control unreliable.

## Decision

The app uses an async control-plane model built around:

- `IntegrationJob`
- `IntegrationJobEvent`
- SQS-backed worker execution
- vendor-level PostgreSQL advisory locks
- explicit retry and dead-letter handling
- resumable catalog continuation jobs for large ProductData syncs

API handlers submit jobs and return control-plane status information rather than running full integrations inline.

Core execution continues to use the existing domain-specific runners, but those runners execute inside worker-owned lifecycle management instead of directly in user requests.

For large catalog imports, the runner may intentionally stop after a bounded number of ProductData references, persist sync progress, and enqueue a continuation job with the next reference offset. This keeps catalog syncs within Lambda execution limits while preserving one logical sync chain.

## Consequences

- syncs and order workflows are visible, traceable, and replayable through a consistent control plane
- duplicate active work can be deduplicated by job keys and lock enforcement
- future integration domains should extend this job model rather than introducing a second async orchestration pattern
- long vendor catalog imports can complete across multiple worker jobs instead of failing at the 15-minute Lambda timeout
