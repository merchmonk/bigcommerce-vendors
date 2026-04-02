import { fireEvent, render, screen, waitFor } from '@test/utils';
import VendorSyncPanel, { vendorSyncPanelSwrOptions } from '@components/vendorSyncPanel';

describe('VendorSyncPanel', () => {
  test('disables automatic SWR refresh behavior', () => {
    expect(vendorSyncPanelSwrOptions).toEqual({
      refreshInterval: 0,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/mappings')) {
        return {
          json: async () => ({
            data: [],
          }),
        } as Response;
      }

      if (url.includes('/sync') && (!init || init.method === 'GET')) {
        return {
          json: async () => ({
            data: [],
            active_job: {
              integration_job_id: 77,
              status: 'RUNNING',
              sync_scope: 'ALL',
              mapping_id: null,
              submitted_at: new Date().toISOString(),
            },
          }),
        } as Response;
      }

      if (url.includes('/sync') && init?.method === 'POST') {
        return {
          json: async () => ({
            data: {
              integration_job_id: 77,
              status: 'CANCEL_REQUESTED',
            },
            events: [],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;
  });

  test('shows cancel action for an active sync and requests cancellation', async () => {
    render(<VendorSyncPanel vendorId={4} context="store-context" />);

    expect(await screen.findByText(/Active job/i)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Active Sync' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/4/sync?context=store-context'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            action: 'cancel',
            integration_job_id: 77,
          }),
        }),
      );
    });
  });

  test('shows a resume button and submits the last checkpoint start index', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/mappings')) {
        return {
          json: async () => ({
            data: [],
          }),
        } as Response;
      }

      if (url.includes('/sync') && (!init || init.method === 'GET')) {
        return {
          json: async () => ({
            data: [],
            active_job: null,
            resume_checkpoint: {
              sync_run_id: 213,
              start_reference_index: 275,
              status: 'FAILED',
              last_processed_product_id: '100882',
              last_processed_sku: '100882-275',
            },
          }),
        } as Response;
      }

      if (url.includes('/sync') && init?.method === 'POST') {
        return {
          json: async () => ({
            data: {
              integration_job_id: 88,
              status: 'ENQUEUED',
            },
            events: [],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    render(<VendorSyncPanel vendorId={5} context="resume-context" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Resume From Last Checkpoint' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/vendors/5/sync?context=resume-context'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            sync_all: true,
            start_reference_index: 275,
          }),
        }),
      );
    });
  });
});
