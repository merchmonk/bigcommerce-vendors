CREATE TYPE "OperatorTraceCategory" AS ENUM ('VENDOR_API', 'BIGCOMMERCE_API', 'INTERNAL_FAILURE');

CREATE TABLE "operator_traces" (
    "operator_trace_id" BIGSERIAL NOT NULL,
    "category" "OperatorTraceCategory" NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "vendor_id" INTEGER,
    "integration_job_id" BIGINT,
    "sync_run_id" BIGINT,
    "method" VARCHAR(16) NOT NULL,
    "target" VARCHAR(2048) NOT NULL,
    "action" VARCHAR(255) NOT NULL,
    "status_code" INTEGER,
    "snapshot_bucket" VARCHAR(255),
    "snapshot_key" VARCHAR(1024),
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_traces_pkey" PRIMARY KEY ("operator_trace_id")
);

CREATE INDEX "operator_traces_vendor_id_created_at_idx"
ON "operator_traces"("vendor_id", "created_at");

CREATE INDEX "operator_traces_integration_job_id_created_at_idx"
ON "operator_traces"("integration_job_id", "created_at");

CREATE INDEX "operator_traces_sync_run_id_created_at_idx"
ON "operator_traces"("sync_run_id", "created_at");

CREATE INDEX "operator_traces_correlation_id_created_at_idx"
ON "operator_traces"("correlation_id", "created_at");
