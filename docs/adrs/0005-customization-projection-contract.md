# ADR 0005: Customization Projection Contract

- Status: Accepted
- Date: 2026-03-20

## Context

Most PromoStandards parts and BigCommerce variants share the same design and pricing structure, while a smaller set of variant-specific differences, especially size-driven location-point changes, must still be represented accurately.

The platform needs a contract that avoids duplicating the full design schema onto every variant while remaining easy for the BFF to resolve.

## Decision

Customization data is projected with a shared-defaults plus minimal-overrides model:

- product-level metafields store `productDesignerDefaults`
  - shared locations
  - shared methods
  - shared charge rules
  - most shared pricing logic
  - shared media classification
- variant-level metafields or variant-linked contract fragments store `variantDesignerOverrides`
  - size-specific printable-area or decoration-point changes
  - rare variant-specific constraints that materially change the designer experience

Shared options and shared modifiers may be used as reusable vocabulary, but they are not the primary storage mechanism for the full customization contract.

The BFF resolves:

1. product defaults
2. selected variant overrides
3. final selection-scoped designer payload

## Consequences

- downstream UI clients consume one resolved payload rather than reimplementing merge logic
- the catalog avoids large-scale duplication across mostly identical variants
- future supplier mapping changes should preserve the distinction between shared defaults and true variant overrides
