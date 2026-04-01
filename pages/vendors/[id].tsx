import { useRouter } from 'next/router';
import useSWR from 'swr';
import { InlineNotice } from '../../components/operator/ui';
import VendorForm from '../../components/vendorForm';
import VendorSyncPanel from '../../components/vendorSyncPanel';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';
import { getVendorConnectionSections } from '../../lib/vendors/vendorConfig';
import type { Vendor } from '../../lib/vendors';
import type { MappingProtocol, VendorConnectionTestResult, VendorFormData } from '../../types';
import type { EndpointMappingDraft } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface VendorApiResponse extends Vendor {
  endpoint_mappings?: EndpointMappingDraft[];
}

const EditVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const vendorId = Number(router.query.id);

  const requireContext = () => {
    if (!context) {
      throw new Error('Session context is missing. Reload the app from BigCommerce and try again.');
    }

    return encodeURIComponent(context);
  };

  const withContext = (path: string) => `${path}?context=${requireContext()}`;

  const { data, error, mutate } = useSWR<VendorApiResponse>(
    Number.isFinite(vendorId) && context
      ? `/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`
      : null,
    fetcher,
  );

  const handleSubmit = async (formData: VendorFormData) => {
    const response = await fetch(withContext(`/api/vendors/${vendorId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.message ?? 'Failed to update vendor');
    }

    await mutate();
    router.push(withContext('/vendors'));
  };

  const handleCancel = () => {
    router.push(withContext('/vendors'));
  };

  const handleTestConnection = async (connectionData: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    integration_family?: VendorFormData['integration_family'];
    api_protocol?: MappingProtocol;
    hasCompanyDataEndpoint?: boolean;
    companyDataEndpointUrl?: string;
    promostandardsEndpoints?: VendorFormData['promostandardsEndpoints'];
  }): Promise<VendorConnectionTestResult> => {
    const response = await fetch(withContext('/api/vendors/test-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectionData),
    });
    const payload = await response.json();
    return {
      ok: response.ok && !!payload?.ok,
      message: payload?.message,
      availableEndpointCount: payload?.availableEndpointCount,
      credentialsValid: payload?.credentialsValid,
      endpointMappingIds: payload?.endpointMappingIds,
      fingerprint: payload?.fingerprint,
      testedAt: payload?.testedAt,
      endpoints: payload?.endpoints,
    };
  };

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const sections = getVendorConnectionSections(data.connection_config ?? {});
  const initialValues: VendorFormData = {
    vendor_name: data.vendor_name,
    vendor_type: data.vendor_type,
    vendor_api_url: data.vendor_api_url ?? undefined,
    vendor_account_id: data.vendor_account_id ?? undefined,
    vendor_secret: data.vendor_secret ?? undefined,
    integration_family: data.integration_family,
    api_protocol: (data.api_protocol ?? 'SOAP') as MappingProtocol,
    endpoint_mappings: [],
    custom_api_service_type: sections.custom_api?.service_type,
    custom_api_format_data: sections.custom_api?.format_data ?? '',
    promostandardsCapabilities: sections.promostandards_capabilities ?? null,
    promostandardsEndpoints: sections.promostandards_capabilities?.endpoints ?? [],
    hasCompanyDataEndpoint: Boolean(
      sections.promostandards_capabilities?.endpoints.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl,
    ),
    companyDataEndpointUrl:
      sections.promostandards_capabilities?.endpoints.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl ?? '',
    connection_config: data.connection_config ?? {},
  };

  return (
    <>
      {data.is_active ? (
        <div style={{ marginBottom: '18px' }}>
          <InlineNotice
            tone="warning"
            title="Editing an active vendor can break live sync behavior"
            description="Changing credentials, vendor type, or API configuration for an active vendor can disrupt syncs and downstream catalog behavior. Confirm the new configuration before saving."
          />
        </div>
      ) : null}
      <VendorForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        onTestConnection={handleTestConnection}
      />
      <VendorSyncPanel vendorId={vendorId} context={context} />
    </>
  );
};

export default EditVendorPage;
