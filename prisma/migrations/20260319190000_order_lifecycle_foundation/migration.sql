DO $$
BEGIN
  ALTER TYPE "IntegrationJobKind" ADD VALUE IF NOT EXISTS 'ORDER_SUBMISSION';
  ALTER TYPE "IntegrationJobKind" ADD VALUE IF NOT EXISTS 'ORDER_STATUS_POLL';
  ALTER TYPE "IntegrationJobKind" ADD VALUE IF NOT EXISTS 'ORDER_SHIPMENT_POLL';
  ALTER TYPE "IntegrationJobKind" ADD VALUE IF NOT EXISTS 'ORDER_INVOICE_POLL';
  ALTER TYPE "IntegrationJobKind" ADD VALUE IF NOT EXISTS 'ORDER_REMITTANCE_SUBMISSION';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "OrderLifecycleStatus" AS ENUM (
  'PENDING_SUBMISSION',
  'SUBMISSION_QUEUED',
  'SUBMITTED',
  'ISSUE',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'INVOICED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "order_integration_states" (
  "order_integration_state_id" BIGSERIAL PRIMARY KEY,
  "vendor_id" INTEGER NOT NULL,
  "external_order_id" VARCHAR(255) NOT NULL,
  "order_source" VARCHAR(64) NOT NULL DEFAULT 'BIGCOMMERCE',
  "purchase_order_number" VARCHAR(255) NOT NULL,
  "sales_order_number" VARCHAR(255),
  "order_type" VARCHAR(64),
  "lifecycle_status" "OrderLifecycleStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
  "status_label" VARCHAR(255),
  "status_code" VARCHAR(64),
  "shipment_status" VARCHAR(64),
  "invoice_status" VARCHAR(64),
  "remittance_status" VARCHAR(64),
  "submission_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "latest_vendor_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "last_error" TEXT,
  "submitted_at" TIMESTAMPTZ(6),
  "last_status_polled_at" TIMESTAMPTZ(6),
  "next_status_poll_at" TIMESTAMPTZ(6),
  "last_shipment_polled_at" TIMESTAMPTZ(6),
  "next_shipment_poll_at" TIMESTAMPTZ(6),
  "last_invoice_polled_at" TIMESTAMPTZ(6),
  "next_invoice_poll_at" TIMESTAMPTZ(6),
  "last_remittance_submitted_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "order_integration_states"
  ADD CONSTRAINT "order_integration_states_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_jobs"
  ADD COLUMN "order_integration_state_id" BIGINT;

ALTER TABLE "operator_traces"
  ADD COLUMN "order_integration_state_id" BIGINT;

CREATE UNIQUE INDEX "order_integration_states_vendor_id_external_order_id_key"
  ON "order_integration_states" ("vendor_id", "external_order_id");

CREATE UNIQUE INDEX "order_integration_states_vendor_id_purchase_order_number_key"
  ON "order_integration_states" ("vendor_id", "purchase_order_number");

CREATE INDEX "order_integration_states_vendor_id_lifecycle_status_idx"
  ON "order_integration_states" ("vendor_id", "lifecycle_status");

CREATE INDEX "order_integration_states_next_status_poll_at_idx"
  ON "order_integration_states" ("next_status_poll_at");

CREATE INDEX "order_integration_states_next_shipment_poll_at_idx"
  ON "order_integration_states" ("next_shipment_poll_at");

CREATE INDEX "order_integration_states_next_invoice_poll_at_idx"
  ON "order_integration_states" ("next_invoice_poll_at");

CREATE INDEX "integration_jobs_order_integration_state_id_status_idx"
  ON "integration_jobs" ("order_integration_state_id", "status");

CREATE INDEX "operator_traces_order_integration_state_id_created_at_idx"
  ON "operator_traces" ("order_integration_state_id", "created_at");
