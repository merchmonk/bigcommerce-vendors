import { useRouter } from 'next/router';
import VendorForm from '../../components/vendorForm';
import { useSession } from '../../context/session';
import type { MappingProtocol, VendorConnectionTestResult, VendorFormData } from '../../types';

const NewVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();

  const handleSubmit = async (data: VendorFormData) => {
    const response = await fetch(`/api/vendors?context=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.message ?? 'Failed to create vendor');
    }
    router.push('/vendors');
  };

  const handleCancel = () => {
    router.push('/vendors');
  };

  const handleTestConnection = async (data: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    integration_family?: VendorFormData['integration_family'];
    api_protocol?: MappingProtocol;
  }): Promise<VendorConnectionTestResult> => {
    const response = await fetch(`/api/vendors/test-connection?context=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const payload = await response.json();
    return {
      ok: response.ok && !!payload?.ok,
      message: payload?.message,
      available_endpoint_count: payload?.available_endpoint_count,
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
