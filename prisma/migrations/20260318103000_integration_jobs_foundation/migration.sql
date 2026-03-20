CREATE TYPE "IntegrationJobKind" AS ENUM ('CATALOG_SYNC');
CREATE TYPE "IntegrationJobStatus" AS ENUM ('PENDING', 'ENQUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED');

CREATE TABLE "integration_jobs" (
    "integration_job_id" BIGSERIAL NOT NULL,
    "job_kind" "IntegrationJobKind" NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "mapping_id" INTEGER,
    "sync_scope" "SyncScope" NOT NULL DEFAULT 'MAPPING',
    "source_action" VARCHAR(128) NOT NULL,
    "dedupe_key" VARCHAR(512) NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "request_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "status" "IntegrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "queue_message_id" VARCHAR(255),
    "last_error" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    CONSTRAINT "integration_jobs_pkey" PRIMARY KEY ("integration_job_id")
);

CREATE TABLE "integration_job_events" (
    "integration_job_event_id" BIGSERIAL NOT NULL,
    "integration_job_id" BIGINT NOT NULL,
    "event_name" VARCHAR(128) NOT NULL,
    "level" VARCHAR(16) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "integration_job_events_pkey" PRIMARY KEY ("integration_job_event_id")
);

CREATE INDEX "integration_jobs_vendor_id_status_idx"
ON "integration_jobs"("vendor_id", "status");

CREATE INDEX "integration_jobs_dedupe_key_status_idx"
ON "integration_jobs"("dedupe_key", "status");

CREATE INDEX "integration_jobs_submitted_at_idx"
ON "integration_jobs"("submitted_at");

CREATE INDEX "integration_job_events_integration_job_id_created_at_idx"
ON "integration_job_events"("integration_job_id", "created_at");

ALTER TABLE "integration_jobs"
ADD CONSTRAINT "integration_jobs_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "integration_jobs"
ADD CONSTRAINT "integration_jobs_mapping_id_fkey"
FOREIGN KEY ("mapping_id") REFERENCES "endpoint_mappings"("mapping_id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_job_events"
ADD CONSTRAINT "integration_job_events_integration_job_id_fkey"
FOREIGN KEY ("integration_job_id") REFERENCES "integration_jobs"("integration_job_id")
ON DELETE CASCADE ON UPDATE CASCADE;
