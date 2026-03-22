import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockUseSession = jest.fn();
const mockUseSwr = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
  }),
}));

jest.mock('../../context/session', () => ({
  useSession: () => mockUseSession(),
}));

jest.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseSwr(...args),
}));

describe('vendors index actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({ context: 'store-context' });
    mockUseSwr.mockReturnValue({
      data: {
        data: [
          {
            vendor_id: 12,
            vendor_name: 'Inactive Vendor',
            vendor_type: 'SUPPLIER',
            integration_family: 'PROMOSTANDARDS',
            api_protocol: 'SOAP',
            is_active: false,
            datetime_added: '2026-03-21T00:00:00.000Z',
            datetime_modified: '2026-03-21T00:00:00.000Z',
            vendor_status: 'DEACTIVATED',
            api_type_label: 'PromoStandards',
            health_percent: null,
            total_products_synced: 0,
            total_products_active: 0,
            last_synced_at: null,
            can_deactivate: true,
          },
        ],
      },
      error: undefined,
      mutate: jest.fn().mockResolvedValue(undefined),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ is_active: true }),
    }) as jest.Mock;
  });

  test('shows Reactivate for inactive vendors and sends is_active=true on confirm', async () => {
    const VendorsPage = (await import('../../pages/vendors/index')).default;

    render(<VendorsPage />);

    fireEvent.click(screen.getByLabelText('Vendor row actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Reactivate vendor?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reactivate vendor' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/vendors/12?context=store-context',
        expect.objectContaining({
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: true }),
        }),
      );
    });
  });
});
