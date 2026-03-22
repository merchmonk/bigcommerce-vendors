import { useRouter } from 'next/router';
import VendorForm from '../../components/vendorForm';
import { useSession } from '../../context/session';
import type { MappingProtocol, VendorConnectionTestResult, VendorFormData } from '../../types';

const NewVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();

  const requireContext = () => {
    if (!context) {
      throw new Error('Session context is missing. Reload the app from BigCommerce and try again.');
    }

    return encodeURIComponent(context);
  };

  const withContext = (path: string) => `${path}?context=${requireContext()}`;

  const handleSubmit = async (data: VendorFormData) => {
    const response = await fetch(withContext('/api/vendors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.message ?? 'Failed to create vendor');
    }
    router.push(withContext('/vendors'));
  };

  const handleCancel = () => {
    router.push(withContext('/vendors'));
  };

  const handleTestConnection = async (data: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    integration_family?: VendorFormData['integration_family'];
    api_protocol?: MappingProtocol;
  }): Promise<VendorConnectionTestResult> => {
    const response = await fetch(withContext('/api/vendors/test-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await response.json();
    return {
      ok: response.ok && !!payload?.ok,
      message: payload?.message,
      available_endpoint_count: payload?.available_endpoint_count,
      credentials_valid: payload?.credentials_valid,
      endpoint_mapping_ids: payload?.endpoint_mapping_ids,
      fingerprint: payload?.fingerprint,
      tested_at: payload?.tested_at,
      endpoints: payload?.endpoints,
    };
  };

  return (
    <VendorForm
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      onTestConnection={handleTestConnection}
      requireConnectionTest
    />
  );
};

export default NewVendorPage;
