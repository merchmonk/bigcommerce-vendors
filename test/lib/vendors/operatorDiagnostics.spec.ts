import {
  getIntegrationJobDiagnostics,
  getSyncRunDiagnostics,
  summarizeSyncRunDetails,
} from '@lib/vendors/operatorDiagnostics';

const mockGetSyncRunById = jest.fn();
const mockListOperatorTraces = jest.fn();
const mockGetOperatorTraceById = jest.fn();
const mockGetIntegrationJobStatus = jest.fn();
const mockReadSnapshotArchivePayload = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  getSyncRunById: (...args: unknown[]) => mockGetSyncRunById(...args),
  listOperatorTraces: (...args: unknown[]) => mockListOperatorTraces(...args),
  getOperatorTraceById: (...args: unknown[]) => mockGetOperatorTraceById(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  getIntegrationJobStatus: (...args: unknown[]) => mockGetIntegrationJobStatus(...args),
}));

jest.mock('@lib/snapshotArchive', () => ({
  readSnapshotArchivePayload: (...args: unknown[]) => mockReadSnapshotArchivePayload(...args),
}));

describe('operatorDiagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('summarizes sync run details into operator-facing drilldown groups', () => {
    const summary = summarizeSyncRunDetails({
      endpointResults: [
        {
          mapping_id: 10,
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          status: 500,
          products_found: 0,
          message: 'Inventory call failed',
        },
        {
          mapping_id: 11,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
          status: 200,
          products_found: 14,
        },
      ],
      productStatuses: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          blocked: true,
          gating_reasons: ['PricingAndConfiguration enrichment failed.'],
          enrichment_status: {
            pricing: 'FAILED',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: ['PricingAndConfiguration enrichment failed.'],
            media_errors: [],
          },
        },
        {
          sku: 'SKU-2',
          blocked: false,
          gating_reasons: [],
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: [],
            media_errors: [],
          },
        },
      ],
      mediaRetries: [
        {
          sku: 'SKU-9',
          vendor_product_id: 'PROD-9',
          message: 'Media enrichment failed for PROD-9.',
        },
      ],
    });

    expect(summary.endpointFailures).toHaveLength(1);
    expect(summary.blockedProducts).toHaveLength(1);
    expect(summary.mediaRetries).toHaveLength(1);
    expect(summary.failedItemCount).toBe(2);
  });

  test('loads sync run diagnostics with traces', async () => {
    mockGetSyncRunById.mockResolvedValue({
      sync_run_id: 77,
      vendor_id: 12,
      mapping_id: null,
      sync_scope: 'ALL',
      status: 'FAILED',
      started_at: '2026-03-19T02:00:00.000Z',
      ended_at: '2026-03-19T02:04:00.000Z',
      records_read: 30,
      records_written: 18,
      error_message: 'Vendor sync failed',
      details: {
        endpointResults: [
          {
            mapping_id: 4,
            endpoint_name: 'Inventory',
            endpoint_version: '1.2.1',
            operation_name: 'getInventoryLevels',
            status: 500,
            products_found: 0,
            message: 'Inventory call failed',
          },
        ],
        productStatuses: [
          {
            sku: 'SKU-1',
            blocked: true,
            gating_reasons: ['Inventory enrichment failed.'],
            enrichment_status: {
              pricing: 'SUCCESS',
              inventory: 'FAILED',
              media: 'SUCCESS',
              gating_reasons: ['Inventory enrichment failed.'],
              media_errors: [],
            },
          },
        ],
        mediaRetries: [],
      },
    });
    mockListOperatorTraces.mockResolvedValue([
      {
        operator_trace_id: 900,
        category: 'VENDOR_API',
        correlation_id: 'corr-1',
        vendor_id: 12,
        integration_job_id: 44,
        sync_run_id: 77,
        method: 'POST',
        target: 'https://vendor.example.com',
        action: 'getInventoryLevels:1.2.1',
        status_code: 500,
        snapshot_bucket: 'bucket',
        snapshot_key: 'vendor-api/key.json',
        metadata: {},
        created_at: '2026-03-19T02:01:00.000Z',
      },
    ]);

    const diagnostics = await getSyncRunDiagnostics(77, 12);

    expect(diagnostics.syncRun.etl_sync_run_id).toBe(77);
    expect(diagnostics.summary.failedItemCount).toBe(1);
    expect(diagnostics.traces).toHaveLength(1);
  });

  test('loads job diagnostics and can resolve snapshot previews', async () => {
    mockGetIntegrationJobStatus.mockResolvedValue({
      job: {
        integration_job_id: 44,
        job_kind: 'CATALOG_SYNC',
        vendor_id: 12,
        mapping_id: null,
        sync_scope: 'ALL',
        source_action: 'manual_sync',
        dedupe_key: 'catalog_sync:12:ALL:all:manual_sync',
        correlation_id: 'corr-1',
        request_payload: {},
        status: 'FAILED',
        attempt_count: 2,
        queue_message_id: 'msg-1',
        last_error: 'boom',
        submitted_at: '2026-03-19T02:00:00.000Z',
        started_at: '2026-03-19T02:00:05.000Z',
        ended_at: '2026-03-19T02:02:00.000Z',
      },
      events: [
        {
          integration_job_event_id: 1,
          integration_job_id: 44,
          event_name: 'job_started',
          level: 'info',
          payload: {},
          created_at: '2026-03-19T02:00:05.000Z',
        },
      ],
    });
    mockListOperatorTraces.mockResolvedValue([
      {
        operator_trace_id: 900,
        category: 'INTERNAL_FAILURE',
        correlation_id: 'corr-1',
        vendor_id: 12,
        integration_job_id: 44,
        sync_run_id: null,
        method: 'POST',
        target: '/api/vendors/12/sync',
        action: 'vendor_sync_api_request',
        status_code: 500,
        snapshot_bucket: 'bucket',
        snapshot_key: 'internal/key.json',
        metadata: {},
        created_at: '2026-03-19T02:02:00.000Z',
      },
    ]);
    mockReadSnapshotArchivePayload.mockResolvedValue({
      request: { foo: 'bar' },
    });
    mockGetOperatorTraceById.mockResolvedValue({
      operator_trace_id: 900,
      snapshot_bucket: 'bucket',
      snapshot_key: 'internal/key.json',
    });

    const diagnostics = await getIntegrationJobDiagnostics(44);
    const snapshot = await diagnostics.readTraceSnapshot(900);

    expect(diagnostics.job.integration_job_id).toBe(44);
    expect(diagnostics.traces).toHaveLength(1);
    expect(snapshot).toEqual({ request: { foo: 'bar' } });
  });
});
