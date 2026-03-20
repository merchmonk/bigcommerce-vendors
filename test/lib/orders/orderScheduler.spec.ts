import { enqueueDueOrderPollJobs } from '@lib/orders/orderScheduler';

const mockFindDueOrderIntegrationStates = jest.fn();
const mockSubmitOrderLifecycleJob = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  findDueOrderIntegrationStates: (...args: unknown[]) => mockFindDueOrderIntegrationStates(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  submitOrderLifecycleJob: (...args: unknown[]) => mockSubmitOrderLifecycleJob(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('enqueueDueOrderPollJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('queues due status polls and counts deduplicated jobs', async () => {
    mockFindDueOrderIntegrationStates.mockResolvedValue([
      {
        order_integration_state_id: 71,
        vendor_id: 14,
      },
      {
        order_integration_state_id: 72,
        vendor_id: 14,
      },
    ]);
    mockSubmitOrderLifecycleJob
      .mockResolvedValueOnce({
        job: { integration_job_id: 1 },
        deduplicated: false,
      })
      .mockResolvedValueOnce({
        job: { integration_job_id: 2 },
        deduplicated: true,
      });

    const result = await enqueueDueOrderPollJobs({
      jobKind: 'ORDER_STATUS_POLL',
      limit: 20,
    });

    expect(mockFindDueOrderIntegrationStates).toHaveBeenCalledWith({
      pollField: 'next_status_poll_at',
      limit: 20,
    });
    expect(mockSubmitOrderLifecycleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        orderIntegrationStateId: 71,
        jobKind: 'ORDER_STATUS_POLL',
        sourceAction: 'scheduler_status_poll',
      }),
    );
    expect(result).toEqual({
      queued: 1,
      deduplicated: 1,
      scanned: 2,
    });
  });
});
