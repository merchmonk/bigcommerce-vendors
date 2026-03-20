import {
  createOrderIntegrationAndMaybeSubmit,
  enqueueManualOrderPoll,
} from '@lib/orders/orderCoordinator';

const mockGetVendorById = jest.fn();
const mockResolvePrimaryOrderCapabilityForJobKind = jest.fn();
const mockCreateOrderIntegrationState = jest.fn();
const mockPublishPlatformEvent = jest.fn();
const mockSubmitOrderLifecycleJob = jest.fn();
const mockGetIntegrationJobStatus = jest.fn();
const mockUpdateOrderIntegrationState = jest.fn();
const mockGetOrderIntegrationStateById = jest.fn();

jest.mock('@lib/vendors', () => ({
  getVendorById: (...args: unknown[]) => mockGetVendorById(...args),
}));

jest.mock('@lib/orders/orderCapabilityResolver', () => ({
  resolvePrimaryOrderCapabilityForJobKind: (...args: unknown[]) =>
    mockResolvePrimaryOrderCapabilityForJobKind(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  createOrderIntegrationState: (...args: unknown[]) => mockCreateOrderIntegrationState(...args),
  updateOrderIntegrationState: (...args: unknown[]) => mockUpdateOrderIntegrationState(...args),
  getOrderIntegrationStateById: (...args: unknown[]) => mockGetOrderIntegrationStateById(...args),
  listIntegrationJobsForOrderIntegrationState: jest.fn(),
  listOperatorTraces: jest.fn(),
}));

jest.mock('@lib/platformEvents', () => ({
  publishPlatformEvent: (...args: unknown[]) => mockPublishPlatformEvent(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  submitOrderLifecycleJob: (...args: unknown[]) => mockSubmitOrderLifecycleJob(...args),
  getIntegrationJobStatus: (...args: unknown[]) => mockGetIntegrationJobStatus(...args),
}));

describe('orderCoordinator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetVendorById.mockResolvedValue({
      vendor_id: 14,
      vendor_name: 'Acme Supplier',
      vendor_type: 'SUPPLIER',
      integration_family: 'PROMOSTANDARDS',
      is_active: true,
    });
    mockResolvePrimaryOrderCapabilityForJobKind.mockResolvedValue({
      capability_key: 'po_send',
    });
  });

  test('creates an order integration and queues submission when autoSubmit is true', async () => {
    mockCreateOrderIntegrationState.mockResolvedValue({
      order_integration_state_id: 71,
      vendor_id: 14,
      external_order_id: 'bc-1001',
      purchase_order_number: 'MM-PO-1001',
      lifecycle_status: 'PENDING_SUBMISSION',
      submission_payload: { lineItems: [] },
      metadata: {},
    });
    mockSubmitOrderLifecycleJob.mockResolvedValue({
      job: {
        integration_job_id: 501,
      },
      deduplicated: false,
    });
    mockGetIntegrationJobStatus.mockResolvedValue({
      job: {
        integration_job_id: 501,
        status: 'ENQUEUED',
      },
      events: [],
    });
    mockUpdateOrderIntegrationState.mockResolvedValue({});
    mockGetOrderIntegrationStateById.mockResolvedValue({
      order_integration_state_id: 71,
      vendor_id: 14,
      external_order_id: 'bc-1001',
      purchase_order_number: 'MM-PO-1001',
      lifecycle_status: 'SUBMISSION_QUEUED',
      submission_payload: { lineItems: [] },
      metadata: {},
    });

    const result = await createOrderIntegrationAndMaybeSubmit({
      vendor_id: 14,
      external_order_id: 'bc-1001',
      purchase_order_number: 'MM-PO-1001',
      submission_payload: { lineItems: [] },
      auto_submit: true,
    });

    expect(mockCreateOrderIntegrationState).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_id: 14,
        external_order_id: 'bc-1001',
        purchase_order_number: 'MM-PO-1001',
      }),
    );
    expect(mockSubmitOrderLifecycleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        orderIntegrationStateId: 71,
        jobKind: 'ORDER_SUBMISSION',
      }),
    );
    expect(result.submittedJob?.job.integration_job_id).toBe(501);
  });

  test('queues a manual shipment poll when the vendor capability exists', async () => {
    mockGetOrderIntegrationStateById.mockResolvedValue({
      order_integration_state_id: 71,
      vendor_id: 14,
      purchase_order_number: 'MM-PO-1001',
    });
    mockResolvePrimaryOrderCapabilityForJobKind.mockResolvedValue({
      capability_key: 'shipment_v2_1',
    });
    mockSubmitOrderLifecycleJob.mockResolvedValue({
      job: {
        integration_job_id: 777,
      },
      deduplicated: false,
    });
    mockGetIntegrationJobStatus.mockResolvedValue({
      job: {
        integration_job_id: 777,
        status: 'ENQUEUED',
      },
      events: [],
    });

    const result = await enqueueManualOrderPoll(
      71,
      'ORDER_SHIPMENT_POLL',
      'operator_manual_shipment_poll',
    );

    expect(mockSubmitOrderLifecycleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        orderIntegrationStateId: 71,
        jobKind: 'ORDER_SHIPMENT_POLL',
        sourceAction: 'operator_manual_shipment_poll',
      }),
    );
    expect(result.job.integration_job_id).toBe(777);
  });
});
