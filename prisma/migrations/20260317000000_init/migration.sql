CREATE TYPE "IntegrationFamily" AS ENUM ('PROMOSTANDARDS', 'CUSTOM');
CREATE TYPE "MappingProtocol" AS ENUM ('SOAP', 'REST', 'RPC', 'XML', 'JSON');
CREATE TYPE "MappingPayloadFormat" AS ENUM ('JSON', 'XML');
CREATE TYPE "SyncScope" AS ENUM ('MAPPING', 'ALL');
CREATE TYPE "SyncRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_userId_key" ON "users"("userId");

CREATE TABLE "stores" (
    "id" SERIAL NOT NULL,
    "storeHash" VARCHAR(10) NOT NULL,
    "accessToken" TEXT,
    "scope" TEXT,
    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_storeHash_key" ON "stores"("storeHash");

CREATE TABLE "storeUsers" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "storeHash" VARCHAR(10) NOT NULL,
    "isAdmin" BOOLEAN,
    CONSTRAINT "storeUsers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "storeUsers_userId_storeHash_key" ON "storeUsers"("userId", "storeHash");

CREATE TABLE "vendors" (
    "vendor_id" SERIAL NOT NULL,
    "vendor_name" VARCHAR(255) NOT NULL,
    "vendor_api_url" VARCHAR(2048),
    "vendor_account_id" VARCHAR(255),
    "vendor_secret" TEXT,
    "integration_family" "IntegrationFamily" NOT NULL DEFAULT 'CUSTOM',
    "api_protocol" "MappingProtocol",
    "connection_config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
    "datetime_added" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "datetime_modified" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "vendors_pkey" PRIMARY KEY ("vendor_id")
);

CREATE TABLE "endpoint_mappings" (
    "mapping_id" SERIAL NOT NULL,
    "standard_type" "IntegrationFamily" NOT NULL,
    "endpoint_name" VARCHAR(128) NOT NULL,
    "endpoint_version" VARCHAR(32) NOT NULL,
    "operation_name" VARCHAR(128) NOT NULL DEFAULT '',
    "protocol" "MappingProtocol" NOT NULL DEFAULT 'SOAP',
    "payload_format" "MappingPayloadFormat" NOT NULL DEFAULT 'JSON',
    "is_product_endpoint" BOOLEAN NOT NULL DEFAULT FALSE,
    "structure_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "structure_xml" TEXT,
    "request_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "response_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "transform_schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "endpoint_mappings_pkey" PRIMARY KEY ("mapping_id")
);

CREATE UNIQUE INDEX "endpoint_mappings_standard_type_endpoint_name_endpoint_version_operation_name_key"
ON "endpoint_mappings"("standard_type", "endpoint_name", "endpoint_version", "operation_name");

CREATE TABLE "vendor_endpoint_mappings" (
    "vendor_endpoint_mapping_id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "mapping_id" INTEGER NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "runtime_config" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "vendor_endpoint_mappings_pkey" PRIMARY KEY ("vendor_endpoint_mapping_id")
);

CREATE UNIQUE INDEX "vendor_endpoint_mappings_vendor_id_mapping_id_key"
ON "vendor_endpoint_mappings"("vendor_id", "mapping_id");

CREATE TABLE "etl_sync_runs" (
    "sync_run_id" BIGSERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "mapping_id" INTEGER,
    "sync_scope" "SyncScope" NOT NULL DEFAULT 'MAPPING',
    "status" "SyncRunStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "ended_at" TIMESTAMPTZ(6),
    "records_read" INTEGER NOT NULL DEFAULT 0,
    "records_written" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "etl_sync_runs_pkey" PRIMARY KEY ("sync_run_id")
);

CREATE TABLE "vendor_product_map" (
    "vendor_product_map_id" BIGSERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "mapping_id" INTEGER,
    "vendor_product_id" VARCHAR(255),
    "bigcommerce_product_id" BIGINT,
    "sku" VARCHAR(255) NOT NULL,
    "product_name" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "vendor_product_map_pkey" PRIMARY KEY ("vendor_product_map_id")
);

CREATE UNIQUE INDEX "vendor_product_map_vendor_id_sku_key"
ON "vendor_product_map"("vendor_id", "sku");

ALTER TABLE "vendor_endpoint_mappings"
ADD CONSTRAINT "vendor_endpoint_mappings_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_endpoint_mappings"
ADD CONSTRAINT "vendor_endpoint_mappings_mapping_id_fkey"
FOREIGN KEY ("mapping_id") REFERENCES "endpoint_mappings"("mapping_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "etl_sync_runs"
ADD CONSTRAINT "etl_sync_runs_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "etl_sync_runs"
ADD CONSTRAINT "etl_sync_runs_mapping_id_fkey"
FOREIGN KEY ("mapping_id") REFERENCES "endpoint_mappings"("mapping_id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_product_map"
ADD CONSTRAINT "vendor_product_map_vendor_id_fkey"
FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_product_map"
ADD CONSTRAINT "vendor_product_map_mapping_id_fkey"
FOREIGN KEY ("mapping_id") REFERENCES "endpoint_mappings"("mapping_id")
ON DELETE SET NULL ON UPDATE CASCADE;
