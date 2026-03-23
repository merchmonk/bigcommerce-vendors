import { fireEvent, render, screen, waitFor } from '@test/utils';
import VendorForm from '@components/vendorForm';

describe('VendorForm', () => {
  test('requires PromoStandards discovery before save becomes enabled', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Found endpoints',
      available_endpoint_count: 1,
      endpoint_mapping_ids: [101],
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
        endpoint_mapping_ids: [101],
        promostandards_capabilities: {
          fingerprint: 'abc123',
          tested_at: '2026-03-19T10:00:00.000Z',
          available_endpoint_count: 1,
          credentials_valid: null,
          endpoints: [
            {
              endpoint_name: 'CompanyData',
              endpoint_version: '1.0.0',
              operation_name: 'getCompanyData',
              capability_scope: undefined,
              lifecycle_role: undefined,
              optional_by_vendor: undefined,
              recommended_poll_minutes: null,
              available: true,
              status_code: 200,
              message: 'ok',
              wsdl_available: null,
              credentials_valid: null,
              live_probe_message: null,
              resolved_endpoint_url: null,
              custom_endpoint_url: null,
            },
          ],
        },
      }),
    );
  });

  test('strips verbose PromoStandards probe diagnostics before submit', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Found endpoints',
      available_endpoint_count: 1,
      credentials_valid: true,
      endpoint_mapping_ids: [201],
      fingerprint: 'compact-123',
      tested_at: '2026-03-21T22:00:00.000Z',
      endpoints: [
        {
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          available: true,
          status_code: 500,
          message: 'Operation listed in endpoint WSDL.',
          wsdl_available: true,
          credentials_valid: true,
          live_probe_message: 'localizationCountry not found.',
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
      target: { value: 'Compact Vendor' },
    });
    fireEvent.change(screen.getByLabelText('Vendor API'), {
      target: { value: 'https://example.com/soap' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Test Vendor' }));
    await waitFor(() => expect(handleTestConnection).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Save Vendor' }));

    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint_mapping_ids: [201],
        promostandards_capabilities: {
          fingerprint: 'compact-123',
          tested_at: '2026-03-21T22:00:00.000Z',
          available_endpoint_count: 1,
          credentials_valid: true,
          endpoints: [
            {
              endpoint_name: 'ProductData',
              endpoint_version: '2.0.0',
              operation_name: 'getProductSellable',
              capability_scope: undefined,
              lifecycle_role: undefined,
              optional_by_vendor: undefined,
              recommended_poll_minutes: null,
              available: true,
              status_code: 500,
              message: 'Operation listed in endpoint WSDL.',
              wsdl_available: true,
              credentials_valid: true,
              live_probe_message: 'localizationCountry not found.',
              resolved_endpoint_url: null,
              custom_endpoint_url: null,
            },
          ],
        },
      }),
    );
  });

  test('allows a custom endpoint URI override to be tested and submitted', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        message: 'Found endpoints',
        available_endpoint_count: 2,
        endpoint_mapping_ids: [301],
        fingerprint: 'override-123',
        tested_at: '2026-03-22T18:00:00.000Z',
        endpoints: [
          {
            endpoint_name: 'PricingAndConfiguration',
            endpoint_version: '1.0.0',
            operation_name: 'getConfigurationAndPricing',
            available: true,
            status_code: 200,
            message: 'Operation listed in endpoint WSDL.',
            resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
          },
          {
            endpoint_name: 'PricingAndConfiguration',
            endpoint_version: '1.0.0',
            operation_name: 'getAvailableLocations',
            available: true,
            status_code: 200,
            message: 'Operation listed in endpoint WSDL.',
            resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        message: 'Operation listed in endpoint WSDL.',
      })
      .mockResolvedValueOnce({
        ok: true,
        message: 'Operation listed in endpoint WSDL.',
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
      target: { value: 'Override Vendor' },
    });
    fireEvent.change(screen.getByLabelText('Vendor API'), {
      target: { value: 'https://vendor.example.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Test Vendor' }));
    await waitFor(() => expect(handleTestConnection).toHaveBeenCalledTimes(1));

    fireEvent.change(
      screen.getByLabelText('Custom endpoint URI for PricingAndConfiguration 1.0.0'),
      {
        target: { value: '/custom/pricing/soap' },
      },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test URI' }));
    await waitFor(() => expect(handleTestConnection).toHaveBeenCalledTimes(3));
    expect(handleTestConnection).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpoint_name: 'PricingAndConfiguration',
        endpoint_version: '1.0.0',
        operation_name: 'getConfigurationAndPricing',
        runtime_config: {
          endpoint_path: '/custom/pricing/soap',
        },
      }),
    );
    expect(handleTestConnection).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        endpoint_name: 'PricingAndConfiguration',
        endpoint_version: '1.0.0',
        operation_name: 'getAvailableLocations',
        runtime_config: {
          endpoint_path: '/custom/pricing/soap',
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Vendor' }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint_mapping_ids: [301],
        promostandards_capabilities: expect.objectContaining({
          endpoints: expect.arrayContaining([
            expect.objectContaining({
              endpoint_name: 'PricingAndConfiguration',
              operation_name: 'getConfigurationAndPricing',
              resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
              custom_endpoint_url: '/custom/pricing/soap',
            }),
            expect.objectContaining({
              endpoint_name: 'PricingAndConfiguration',
              operation_name: 'getAvailableLocations',
              resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
              custom_endpoint_url: '/custom/pricing/soap',
            }),
          ]),
        }),
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
