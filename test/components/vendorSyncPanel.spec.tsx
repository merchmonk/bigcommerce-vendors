import { fireEvent, render, screen, waitFor } from '@test/utils';
import VendorSyncPanel from '@components/vendorSyncPanel';

describe('VendorSyncPanel', () => {
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
});
