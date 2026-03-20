# ADR 0002: Pricing Authority

- Status: Accepted
- Date: 2026-03-20

## Context

Pricing was previously entangled with the general catalog writer, which made it hard to reason about authoritative storefront price versus fallback catalog fields and design-step surcharges.

The app also needs a durable markup lookup mechanism that survives environment differences without depending on fixed metafield IDs.

## Decision

Pricing authority is defined as follows:

- BigCommerce B2B Price List `1` is the authoritative base storefront sell-price projection
- price-list projection is variant-aware by default
- product `price`, `cost_price`, and any product-level bulk-pricing fields are retained only as intentional fallback or compatibility fields
- markup configuration is resolved by namespace/key metafield contract, not fixed metafield ID
- price-list writes are batched, retried with backoff, and serialized at the store level to avoid conflicting bulk upserts
- decoration-step surcharges are calculated from BigCommerce-stored contract data resolved by the designer/BFF layer

## Consequences

- pricing policy is a distinct projection boundary, not an incidental side effect of general catalog writes
- downstream apps can trust BigCommerce for base blank pricing and the designer contract for surcharge behavior
- implementation changes to pricing should preserve the separation between authoritative price-list outputs and fallback compatibility fields
