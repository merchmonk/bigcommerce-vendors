-- AlterTable
ALTER TABLE "endpoint_mappings" ALTER COLUMN "structure_json" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "request_schema" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "response_schema" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "transform_schema" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "etl_sync_runs" ALTER COLUMN "details" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "integration_job_events" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "integration_jobs" ALTER COLUMN "request_payload" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "operator_traces" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "order_integration_states" ALTER COLUMN "submission_payload" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "latest_vendor_payload" SET DEFAULT '{}'::jsonb,
ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "pending_related_product_links" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "product_enrichment_retries" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "vendor_endpoint_mappings" ALTER COLUMN "runtime_config" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "vendor_product_map" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "connection_config" SET DEFAULT '{}'::jsonb;
