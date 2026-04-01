ALTER TABLE "users" RENAME TO "user";
ALTER TABLE "user" DROP CONSTRAINT "users_pkey";
DROP INDEX IF EXISTS "users_user_id_key";
ALTER TABLE "user" ADD CONSTRAINT "user_pkey" PRIMARY KEY ("user_id");
ALTER TABLE "user" DROP COLUMN "id";
DROP SEQUENCE IF EXISTS "users_id_seq";

ALTER TABLE "stores" RENAME TO "store";
ALTER TABLE "store" RENAME COLUMN "id" TO "store_id";
ALTER TABLE "store" RENAME CONSTRAINT "stores_pkey" TO "store_pkey";
ALTER SEQUENCE "stores_id_seq" RENAME TO "store_store_id_seq";
ALTER INDEX "stores_store_hash_key" RENAME TO "store_store_hash_key";

ALTER TABLE "store_users" RENAME TO "store_user";
ALTER TABLE "store_user" RENAME COLUMN "id" TO "store_user_id";
ALTER TABLE "store_user" RENAME CONSTRAINT "store_users_pkey" TO "store_user_pkey";
ALTER SEQUENCE "store_users_id_seq" RENAME TO "store_user_store_user_id_seq";
ALTER INDEX "store_users_user_id_store_hash_key" RENAME TO "store_user_user_id_store_hash_key";

ALTER TABLE "vendors" RENAME TO "vendor";
ALTER TABLE "vendor" RENAME CONSTRAINT "vendors_pkey" TO "vendor_pkey";
ALTER SEQUENCE "vendors_vendor_id_seq" RENAME TO "vendor_vendor_id_seq";

ALTER TABLE "endpoint_mappings" RENAME TO "endpoint_mapping";
ALTER TABLE "endpoint_mapping" RENAME COLUMN "mapping_id" TO "endpoint_mapping_id";
ALTER TABLE "endpoint_mapping" RENAME CONSTRAINT "endpoint_mappings_pkey" TO "endpoint_mapping_pkey";
ALTER SEQUENCE "endpoint_mappings_mapping_id_seq" RENAME TO "endpoint_mapping_endpoint_mapping_id_seq";
ALTER INDEX "endpoint_mappings_standard_type_endpoint_name_endpoint_vers_key"
  RENAME TO "endpoint_mapping_standard_type_endpoint_name_endpoint_vers_key";

ALTER TABLE "vendor_endpoint_mappings" RENAME TO "vendor_endpoint_mapping";
ALTER TABLE "vendor_endpoint_mapping" RENAME COLUMN "mapping_id" TO "endpoint_mapping_id";
ALTER TABLE "vendor_endpoint_mapping" RENAME CONSTRAINT "vendor_endpoint_mappings_pkey" TO "vendor_endpoint_mapping_pkey";
ALTER TABLE "vendor_endpoint_mapping" RENAME CONSTRAINT "vendor_endpoint_mappings_vendor_id_fkey" TO "vendor_endpoint_mapping_vendor_id_fkey";
ALTER TABLE "vendor_endpoint_mapping" RENAME CONSTRAINT "vendor_endpoint_mappings_mapping_id_fkey" TO "vendor_endpoint_mapping_endpoint_mapping_id_fkey";
ALTER SEQUENCE "vendor_endpoint_mappings_vendor_endpoint_mapping_id_seq"
  RENAME TO "vendor_endpoint_mapping_vendor_endpoint_mapping_id_seq";
ALTER INDEX "vendor_endpoint_mappings_vendor_id_mapping_id_key"
  RENAME TO "vendor_endpoint_mapping_vendor_id_endpoint_mapping_id_key";

ALTER TABLE "etl_sync_runs" RENAME TO "etl_sync_run";
ALTER TABLE "etl_sync_run" RENAME COLUMN "sync_run_id" TO "etl_sync_run_id";
ALTER TABLE "etl_sync_run" RENAME COLUMN "mapping_id" TO "endpoint_mapping_id";
ALTER TABLE "etl_sync_run" RENAME CONSTRAINT "etl_sync_runs_pkey" TO "etl_sync_run_pkey";
ALTER TABLE "etl_sync_run" RENAME CONSTRAINT "etl_sync_runs_vendor_id_fkey" TO "etl_sync_run_vendor_id_fkey";
ALTER TABLE "etl_sync_run" RENAME CONSTRAINT "etl_sync_runs_mapping_id_fkey" TO "etl_sync_run_endpoint_mapping_id_fkey";
ALTER SEQUENCE "etl_sync_runs_sync_run_id_seq" RENAME TO "etl_sync_run_etl_sync_run_id_seq";

ALTER TABLE "integration_jobs" RENAME TO "integration_job";
ALTER TABLE "integration_job" RENAME COLUMN "mapping_id" TO "endpoint_mapping_id";
ALTER TABLE "integration_job" RENAME CONSTRAINT "integration_jobs_pkey" TO "integration_job_pkey";
ALTER TABLE "integration_job" RENAME CONSTRAINT "integration_jobs_vendor_id_fkey" TO "integration_job_vendor_id_fkey";
ALTER TABLE "integration_job" RENAME CONSTRAINT "integration_jobs_mapping_id_fkey" TO "integration_job_endpoint_mapping_id_fkey";
ALTER SEQUENCE "integration_jobs_integration_job_id_seq" RENAME TO "integration_job_integration_job_id_seq";
ALTER INDEX "integration_jobs_vendor_id_status_idx" RENAME TO "integration_job_vendor_id_status_idx";
ALTER INDEX "integration_jobs_dedupe_key_status_idx" RENAME TO "integration_job_dedupe_key_status_idx";
ALTER INDEX "integration_jobs_submitted_at_idx" RENAME TO "integration_job_submitted_at_idx";
ALTER INDEX "integration_jobs_order_integration_state_id_status_idx"
  RENAME TO "integration_job_order_integration_state_id_status_idx";

ALTER TABLE "integration_job_events" RENAME TO "integration_job_event";
ALTER TABLE "integration_job_event" RENAME CONSTRAINT "integration_job_events_pkey" TO "integration_job_event_pkey";
ALTER TABLE "integration_job_event" RENAME CONSTRAINT "integration_job_events_integration_job_id_fkey" TO "integration_job_event_integration_job_id_fkey";
ALTER SEQUENCE "integration_job_events_integration_job_event_id_seq"
  RENAME TO "integration_job_event_integration_job_event_id_seq";
ALTER INDEX "integration_job_events_integration_job_id_created_at_idx"
  RENAME TO "integration_job_event_integration_job_id_created_at_idx";

ALTER TABLE "operator_traces" RENAME TO "operator_trace";
ALTER TABLE "operator_trace" RENAME COLUMN "sync_run_id" TO "etl_sync_run_id";
ALTER TABLE "operator_trace" RENAME CONSTRAINT "operator_traces_pkey" TO "operator_trace_pkey";
ALTER SEQUENCE "operator_traces_operator_trace_id_seq" RENAME TO "operator_trace_operator_trace_id_seq";
ALTER INDEX "operator_traces_vendor_id_created_at_idx" RENAME TO "operator_trace_vendor_id_created_at_idx";
ALTER INDEX "operator_traces_integration_job_id_created_at_idx"
  RENAME TO "operator_trace_integration_job_id_created_at_idx";
ALTER INDEX "operator_traces_sync_run_id_created_at_idx"
  RENAME TO "operator_trace_etl_sync_run_id_created_at_idx";
ALTER INDEX "operator_traces_correlation_id_created_at_idx"
  RENAME TO "operator_trace_correlation_id_created_at_idx";
ALTER INDEX "operator_traces_order_integration_state_id_created_at_idx"
  RENAME TO "operator_trace_order_integration_state_id_created_at_idx";

ALTER TABLE "order_integration_states" RENAME TO "order_integration_state";
ALTER TABLE "order_integration_state" RENAME CONSTRAINT "order_integration_states_vendor_id_fkey" TO "order_integration_state_vendor_id_fkey";
ALTER SEQUENCE "order_integration_states_order_integration_state_id_seq"
  RENAME TO "order_integration_state_order_integration_state_id_seq";
ALTER INDEX "order_integration_states_vendor_id_external_order_id_key"
  RENAME TO "order_integration_state_vendor_id_external_order_id_key";
ALTER INDEX "order_integration_states_vendor_id_purchase_order_number_key"
  RENAME TO "order_integration_state_vendor_id_purchase_order_number_key";
ALTER INDEX "order_integration_states_vendor_id_lifecycle_status_idx"
  RENAME TO "order_integration_state_vendor_id_lifecycle_status_idx";
ALTER INDEX "order_integration_states_next_status_poll_at_idx"
  RENAME TO "order_integration_state_next_status_poll_at_idx";
ALTER INDEX "order_integration_states_next_shipment_poll_at_idx"
  RENAME TO "order_integration_state_next_shipment_poll_at_idx";
ALTER INDEX "order_integration_states_next_invoice_poll_at_idx"
  RENAME TO "order_integration_state_next_invoice_poll_at_idx";

ALTER TABLE "vendor_product_map" RENAME COLUMN "mapping_id" TO "endpoint_mapping_id";
ALTER TABLE "vendor_product_map" RENAME CONSTRAINT "vendor_product_map_mapping_id_fkey" TO "vendor_product_map_endpoint_mapping_id_fkey";

ALTER TABLE "pending_related_product_links" RENAME TO "pending_related_product_link";
ALTER TABLE "pending_related_product_link" RENAME CONSTRAINT "pending_related_product_links_pkey" TO "pending_related_product_link_pkey";
ALTER TABLE "pending_related_product_link" RENAME CONSTRAINT "pending_related_product_links_vendor_id_fkey" TO "pending_related_product_link_vendor_id_fkey";
ALTER SEQUENCE "pending_related_product_links_pending_related_product_link__seq"
  RENAME TO "pending_related_product_link_pending_related_product_link_id_seq";
ALTER INDEX "pending_related_product_links_vendor_id_source_vendor_produ_key"
  RENAME TO "pending_related_product_link_vendor_id_source_vendor_produc_key";
ALTER INDEX "pending_related_product_links_vendor_id_status_idx"
  RENAME TO "pending_related_product_link_vendor_id_status_idx";

ALTER TABLE "product_enrichment_retries" RENAME TO "product_enrichment_retry";
ALTER TABLE "product_enrichment_retry" RENAME CONSTRAINT "product_enrichment_retries_pkey" TO "product_enrichment_retry_pkey";
ALTER TABLE "product_enrichment_retry" RENAME CONSTRAINT "product_enrichment_retries_vendor_id_fkey" TO "product_enrichment_retry_vendor_id_fkey";
ALTER SEQUENCE "product_enrichment_retries_product_enrichment_retry_id_seq"
  RENAME TO "product_enrichment_retry_product_enrichment_retry_id_seq";
ALTER INDEX "product_enrichment_retries_vendor_id_vendor_product_id_sour_key"
  RENAME TO "product_enrichment_retry_vendor_id_vendor_product_id_sourc_key";
ALTER INDEX "product_enrichment_retries_vendor_id_status_source_idx"
  RENAME TO "product_enrichment_retry_vendor_id_status_source_idx";
