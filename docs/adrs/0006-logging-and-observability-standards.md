# ADR 0006: Logging And Observability Standards

- Status: Accepted
- Date: 2026-03-20

## Context

This application is operationally critical: it coordinates vendor connectivity, catalog sync, pricing projection, product contract delivery, and supplier order orchestration. Lightweight console logging is insufficient for diagnosing failures, replaying integration problems, or supporting operators.

## Decision

The platform uses an AWS-native observability standard with these rules:

- structured application logs with correlation IDs are the default logging format
- every internal and external API call logs detailed metadata
- secrets, credentials, and tokens are redacted before logging or archival
- `@aws-sdk/client-cloudwatch-logs` is used for direct structured log delivery where required
- CloudWatch log groups, dashboards, and alarms are first-class operational resources
- CloudWatch RUM is used for the embedded admin UI with CSP-safe package-based integration
- filtered full request/response snapshots are archived for:
  - external vendor API calls
  - BigCommerce API calls
  - failed internal request/job boundaries
- archived snapshots live outside PostgreSQL, with pointers recorded in logs and job telemetry
- platform lifecycle events are published to EventBridge for downstream operational consumers

## Consequences

- failures are diagnosable without guesswork or manual reproduction
- PostgreSQL remains a control-plane store instead of a raw-payload archive
- future features must adopt the existing request context, logging, and snapshot conventions instead of inventing parallel observability paths
