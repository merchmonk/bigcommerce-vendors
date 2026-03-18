CREATE TYPE "PendingRelatedLinkStatus" AS ENUM ('PENDING', 'RESOLVED', 'FAILED');
CREATE TYPE "EnrichmentSource" AS ENUM ('PRICING', 'INVENTORY', 'MEDIA');
CREATE TYPE "EnrichmentRetryStatus" AS ENUM ('PENDING', 'RETRYING', 'RESOLVED', 'FAILED');

CREATE TABLE "pending_related_product_links" (
    "pending_related_product_link_id" BIGSERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "source_vendor_product_id" VARCHAR(255) NOT NULL,
    "target_vendor_product_id" VARCHAR(255) NOT NULL,
    "source_bigcommerce_product_id" BIGINT,
    "target_bigcommerce_product_id" BIGINT,
    "status" "PendingRelatedLinkStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "pending_related_product_links_pkey" PRIMARY KEY ("pending_related_product_link_id")
);

CREATE TABLE "product_enrichment_retries" (
    "product_enrichment_retry_id" BIGSERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "vendor_product_id" VARCHAR(255) NOT NULL,
    "source" "EnrichmentSource" NOT NULL,
    "status" "EnrichmentRetryStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "next_retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "resolved_at" TIMESTAMPTZ(6),
    CONSTRAINT "product_enrichment_retries_pkey" PRIMARY KEY ("product_enrichment_retry_id")
);

CREATE UNIQUE INDEX "pending_related_product_links_vendor_id_source_vendor_product_id_target_vendor_product_id_key"
ON "pending_related_product_links"("vendor_id", "source_vendor_product_id", "target_vendor_product_id");

CREATE INDEX "pending_related_product_links_vendor_id_status_idx"
ON "pending_related_product_links"("vendor_id", "status");

CREATE UNIQUE INDEX "product_enrichment_retries_vendor_id_vendor_product_id_source_key"
ON "product_enrichment_retries"("vendor_id", "vendor_product_id", "source");

CREATE INDEX "product_enrichment_retries_vendor_id_status_source_idx"
ON "product_enrichment_retries"("vendor_id", "status", "source");

ALTER TABLE "pending_related_product_links"
ADD CONSTRAINT "pending_related_product_links_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_enrichment_retries"
ADD CONSTRAINT "product_enrichment_retries_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;
