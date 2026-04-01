import { fireEvent, render, screen, waitFor } from '@test/utils';
import VendorForm from '@components/vendorForm';

describe('VendorForm', () => {
  test('requires PromoStandards validation before save becomes enabled', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Found endpoints',
      availableEndpointCount: 1,
      endpointMappingIds: [101],
      fingerprint: 'abc123',
      testedAt: '2026-03-19T10:00:00.000Z',
      endpoints: [
        {
          endpointName: 'CompanyData',
          endpointVersion: '1.0.0',
          endpointUrl: 'https://example.com/companydata/1.0.0',
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
    fireEvent.change(screen.getByLabelText('Vendor Account ID'), {
      target: { value: 'acct-1' },
    });
    fireEvent.change(screen.getByLabelText('Vendor Secret'), {
      target: { value: 'secret-1' },
    });
    fireEvent.change(screen.getByLabelText('CompanyData Endpoint URL'), {
      target: { value: 'https://example.com/companydata/1.0.0' },
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
        companyDataEndpointUrl: 'https://example.com/companydata/1.0.0',
        promostandardsCapabilities: {
          fingerprint: 'abc123',
          testedAt: '2026-03-19T10:00:00.000Z',
          availableEndpointCount: 1,
          credentialsValid: null,
          endpoints: [
            {
              endpointName: 'CompanyData',
              endpointVersion: '1.0.0',
              endpointUrl: 'https://example.com/companydata/1.0.0',
              available: true,
              status_code: 200,
              message: 'ok',
              wsdl_available: null,
              credentials_valid: null,
              live_probe_message: null,
              versionDetectionStatus: 'failed',
              requiresManualVersionSelection: false,
              availableVersions: [],
            },
          ],
        },
      }),
    );
  });

  test('passes manual endpoint URLs for vendors without CompanyData discovery', async () => {
    const handleSubmit = jest.fn();
    const handleTestConnection = jest.fn().mockResolvedValue({
      ok: true,
      message: 'Confirmed 1 PromoStandards endpoint.',
      availableEndpointCount: 1,
      credentialsValid: true,
      endpointMappingIds: [201],
      fingerprint: 'manual-123',
      testedAt: '2026-03-24T10:00:00.000Z',
      endpoints: [
        {
          endpointName: 'ProductData',
          endpointVersion: '2.0.0',
          endpointUrl: 'https://vendor.example.com/ProductData/v2/GemlineProductDataService.svc',
          available: true,
          status_code: 200,
          message: 'Operation listed in endpoint WSDL.',
          versionDetectionStatus: 'detected_from_url',
          requiresManualVersionSelection: false,
          availableVersions: ['1.0.0', '2.0.0'],
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
      target: { value: 'Manual Vendor' },
    });
    fireEvent.change(screen.getByLabelText('Vendor Account ID'), {
      target: { value: 'acct-2' },
    });
    fireEvent.change(screen.getByLabelText('Vendor Secret'), {
      target: { value: 'secret-2' },
    });
    fireEvent.change(screen.getByLabelText('Has CompanyData Endpoint'), {
      target: { value: 'no' },
    });
    fireEvent.change(screen.getByLabelText('ProductData Endpoint URL'), {
      target: { value: 'https://vendor.example.com/ProductData/v2/GemlineProductDataService.svc' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Test Vendor' }));

    await waitFor(() => expect(handleTestConnection).toHaveBeenCalledTimes(1));
    expect(handleTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        hasCompanyDataEndpoint: false,
        companyDataEndpointUrl: '',
        promostandardsEndpoints: expect.arrayContaining([
          expect.objectContaining({
            endpointName: 'CompanyData',
          }),
          expect.objectContaining({
            endpointName: 'ProductData',
            endpointUrl: 'https://vendor.example.com/ProductData/v2/GemlineProductDataService.svc',
          }),
        ]),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Vendor' }));
    await waitFor(() => expect(handleSubmit).toHaveBeenCalledTimes(1));
    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        hasCompanyDataEndpoint: false,
        endpoint_mapping_ids: [201],
        promostandardsCapabilities: expect.objectContaining({
          fingerprint: 'manual-123',
          availableEndpointCount: 1,
        }),
      }),
    );
  });

});
