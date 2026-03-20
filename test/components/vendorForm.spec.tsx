import { fireEvent, render, screen, waitFor } from '@test/utils';
import VendorForm from '@components/vendorForm';

describe('VendorForm', () => {
  test('requires PromoStandards discovery before save becomes enabled', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Found endpoints',
      available_endpoint_count: 1,
      fingerprint: 'abc123',
      tested_at: '2026-03-19T10:00:00.000Z',
      endpoints: [
        {
          endpoint_name: 'CompanyData',
          endpoint_version: '1.0.0',
          operation_name: 'getCompanyData',
          available: true,
          status_code: 200,
          message: 'ok',
        },
      ],
    });

    render(
      <VendorForm
        onSubmit={handleSubmit}
        onCancel={jest.fn()}
        onTestConnection={handleTestConnection}
        requireConnectionTest
      />,
    );

    fireEvent.change(screen.getByLabelText('Vendor Name'), {
      target: { value: 'Hit Promo' },
    });
    fireEvent.change(screen.getByLabelText('Vendor API'), {
      target: { value: 'https://example.com/soap' },
    });

    const saveButton = screen.getByRole('button', { name: 'Save Vendor' });
    expect(saveButton.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Test Vendor' }));

    await waitFor(() => expect(handleTestConnection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton.hasAttribute('disabled')).toBe(false));

    fireEvent.click(saveButton);

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_name: 'Hit Promo',
        connection_tested: true,
        integration_family: 'PROMOSTANDARDS',
      }),
    );
  });

  test('allows custom API vendors to save once the service type is selected', async () => {
    const handleSubmit = jest.fn();

    render(
      <VendorForm
        onSubmit={handleSubmit}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Vendor Name'), {
      target: { value: 'Custom Feed Vendor' },
    });
    fireEvent.change(screen.getByLabelText('API Type'), {
      target: { value: 'CUSTOM' },
    });
    fireEvent.change(screen.getByLabelText('API Service Type'), {
      target: { value: 'JSON_FEED' },
    });

    const saveButton = screen.getByRole('button', { name: 'Save Vendor' });
    expect(saveButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_family: 'CUSTOM',
        api_protocol: 'JSON',
        custom_api_service_type: 'JSON_FEED',
      }),
    );
  });
});
