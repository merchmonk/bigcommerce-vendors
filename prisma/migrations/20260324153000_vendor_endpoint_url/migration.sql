CREATE TABLE "vendor_endpoint_url" (
    "vendor_endpoint_url_id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "endpoint_mapping_id" INTEGER NOT NULL,
    "endpoint_url" VARCHAR(2048) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_endpoint_url_pkey" PRIMARY KEY ("vendor_endpoint_url_id")
);

CREATE UNIQUE INDEX "vendor_endpoint_url_vendor_id_endpoint_mapping_id_key"
    ON "vendor_endpoint_url"("vendor_id", "endpoint_mapping_id");

ALTER TABLE "vendor_endpoint_url"
    ADD CONSTRAINT "vendor_endpoint_url_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("vendor_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "vendor_endpoint_url"
    ADD CONSTRAINT "vendor_endpoint_url_endpoint_mapping_id_fkey"
    FOREIGN KEY ("endpoint_mapping_id") REFERENCES "endpoint_mappings"("mapping_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "vendor_endpoint_url" ("vendor_id", "endpoint_mapping_id", "endpoint_url")
SELECT
    vem."vendor_id",
    vem."mapping_id",
    TRIM(BOTH FROM COALESCE(
        NULLIF(vem."runtime_config"->>'endpoint_url', ''),
        NULLIF(vem."runtime_config"->>'endpointUrl', ''),
        CASE
            WHEN COALESCE(NULLIF(v."vendor_api_url", ''), '') = '' THEN NULL
            ELSE
                RTRIM(v."vendor_api_url", '/') || '/' ||
                LTRIM(COALESCE(
                    NULLIF(vem."runtime_config"->>'endpoint_path', ''),
                    NULLIF(vem."runtime_config"->>'endpointPath', ''),
                    NULLIF(vem."runtime_config"->>'custom_endpoint_path', '')
                ), '/')
        END
    )) AS endpoint_url
FROM "vendor_endpoint_mappings" vem
JOIN "vendors" v ON v."vendor_id" = vem."vendor_id"
JOIN "endpoint_mappings" em ON em."mapping_id" = vem."mapping_id"
WHERE em."standard_type" = 'PROMOSTANDARDS'
  AND TRIM(BOTH FROM COALESCE(
      NULLIF(vem."runtime_config"->>'endpoint_url', ''),
      NULLIF(vem."runtime_config"->>'endpointUrl', ''),
      CASE
          WHEN COALESCE(NULLIF(v."vendor_api_url", ''), '') = '' THEN NULL
          ELSE
              RTRIM(v."vendor_api_url", '/') || '/' ||
              LTRIM(COALESCE(
                  NULLIF(vem."runtime_config"->>'endpoint_path', ''),
                  NULLIF(vem."runtime_config"->>'endpointPath', ''),
                  NULLIF(vem."runtime_config"->>'custom_endpoint_path', '')
              ), '/')
      END
  )) <> '';
