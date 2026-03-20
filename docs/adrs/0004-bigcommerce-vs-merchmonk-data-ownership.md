# ADR 0004: BigCommerce Vs MerchMonk Data Ownership

- Status: Accepted
- Date: 2026-03-20

## Context

The platform needs fast storefront/designer product reads at scale while also preserving internal control-plane data, integration state, and diagnostics. Duplicating the full product catalog into MerchMonk DB would create a second operational source of truth and increase drift risk.

## Decision

Data ownership is split as follows:

- BigCommerce is authoritative for:
  - storefront-visible catalog entities
  - blank-product runtime structure
  - checkout-facing purchasable entities
  - price-list outputs and other storefront pricing projections
- MerchMonk DB is authoritative for:
  - vendor records and credentials
  - endpoint mappings and runtime capability metadata
  - sync and order job telemetry
  - operator diagnostics metadata and snapshot pointers
  - order integration state

MerchMonk DB is not a second product-serving data store. Downstream AI and indexing exports should originate from BigCommerce-facing product data, not a shadow product catalog in the application database.

## Consequences

- runtime storefront and designer behavior must be satisfiable from BigCommerce plus BFF composition
- schema additions in MerchMonk DB should support control-plane and workflow needs, not duplicate the entire catalog
- historical payload retention should use external archival mechanisms rather than bloating PostgreSQL with full product snapshots
