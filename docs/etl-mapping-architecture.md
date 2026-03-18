# ETL Mapping Architecture

## Summary

The ETL layer is now database-first and API-agnostic:

- Endpoint mappings are stored in `endpoint_mappings`.
- Vendor mapping assignments are stored in `vendor_endpoint_mappings`.
- Mapping definitions can be JSON or XML structures and are not sourced from local files.
- PromoStandards support is seeded into the database (no runtime folder scanning).

## Database Model

### `vendors`

- `integration_family` (`PROMOSTANDARDS` or `CUSTOM`)
- `api_protocol` (`SOAP`, `REST`, `RPC`, `XML`, `JSON`)
- `connection_config` (JSONB for vendor-level runtime config)

Legacy fields are removed from runtime usage:

- `is_promo_standards`
- `promo_endpoints`
- `format_data`
- `api_service_type`

### `endpoint_mappings`

- Stable `mapping_id` per endpoint mapping record
- `standard_type`, `protocol`, and `payload_format`
- `structure_json` and `structure_xml` for mapping source structure definitions
- `transform_schema` and `metadata` for mapping behavior

### `vendor_endpoint_mappings`

- Associates vendors with reusable endpoint mapping records
- Stores per-vendor mapping runtime config

## Seeding Strategy

`lib/etl/promostandardsSeed.ts` upserts deterministic PromoStandards mappings into the database.
This seed path is used by APIs and replaces filesystem-derived mapping generation.

## Adapter Architecture

ETL execution now resolves protocol adapters via:

- `lib/etl/adapters/factory.ts`
- `lib/etl/adapters/types.ts`

Implemented:

- SOAP adapter (`soapAdapter`)

Scaffolded:

- Unsupported adapters for non-SOAP protocols return explicit "not implemented yet" errors, keeping extension points explicit.

## API Surface

- `GET|POST /api/etl/mappings`
  - list mappings by filters
  - upsert mappings
  - optionally seed PromoStandards mappings
- `POST /api/vendors`
  - create vendor with inline mapping definitions
- `PUT /api/vendors/[vendorId]`
  - update vendor and mapping assignments
- `GET|PUT /api/vendors/[vendorId]/mappings`
  - inspect and update vendor mapping assignments
- `POST /api/vendors/test-connection`
  - protocol-aware connection test
- `GET|POST /api/vendors/[vendorId]/sync`
  - list runs and execute sync

## Vendor UI

Vendor form now supports:

- Integration family selection
- API protocol selection
- Inline endpoint mapping rows
- Per-row JSON/XML structure input
- Connection testing before save for PromoStandards

ProductData-specific orchestration details are documented in `docs/productdata-workflow.md`.
