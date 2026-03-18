import { useRouter } from 'next/router';
import useSWR from 'swr';
import VendorForm from '../../components/vendorForm';
import VendorSyncPanel from '../../components/vendorSyncPanel';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';
import type { Vendor } from '../../lib/vendors';
import type { MappingProtocol, VendorFormData } from '../../types';
import type { EndpointMappingDraft } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface VendorApiResponse extends Vendor {
  endpoint_mappings?: EndpointMappingDraft[];
}

const EditVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const vendorId = Number(router.query.id);

  const { data, error, mutate } = useSWR<VendorApiResponse>(
    Number.isFinite(vendorId) && context
      ? `/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`
      : null,
    fetcher,
  );

  const handleSubmit = async (formData: VendorFormData) => {
    const response = await fetch(`/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.message ?? 'Failed to update vendor');
    }

    await mutate();
    router.push('/vendors');
  };

  const handleCancel = () => {
    router.push('/vendors');
  };

  const handleTestConnection = async (connectionData: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    api_protocol?: MappingProtocol;
    operation_name?: string;
    endpoint_version?: string;
    runtime_config?: Record<string, unknown>;
  }) => {
    const response = await fetch(`/api/vendors/test-connection?context=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(connectionData),
    });
    const payload = await response.json();
    return {
      ok: response.ok && !!payload?.ok,
      message: payload?.message,
    };
  };

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const initialValues: VendorFormData = {
    vendor_name: data.vendor_name,
    vendor_api_url: data.vendor_api_url ?? undefined,
    vendor_account_id: data.vendor_account_id ?? undefined,
    vendor_secret: data.vendor_secret ?? undefined,
    integration_family: data.integration_family,
    api_protocol: (data.api_protocol ?? 'SOAP') as MappingProtocol,
    endpoint_mappings: data.endpoint_mappings ?? [],
    connection_config: data.connection_config ?? {},
  };

  return (
    <>
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
