import { useRouter } from 'next/router';
import useSWR from 'swr';
import VendorForm from '../../components/vendorForm';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';
import type { Vendor } from '../../lib/vendors';
import type { VendorFormData } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const EditVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const vendorId = Number(router.query.id);

  const { data, error, mutate } = useSWR<Vendor>(
    Number.isFinite(vendorId) && context
      ? `/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`
      : null,
    fetcher,
  );

  const handleSubmit = async (formData: VendorFormData) => {
    await fetch(`/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });
    await mutate();
    router.push('/vendors');
  };

  const handleCancel = () => {
    router.push('/vendors');
  };

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const initialValues: VendorFormData = {
    vendor_name: data.vendor_name,
    vendor_api_url: data.vendor_api_url ?? undefined,
    vendor_account_id: data.vendor_account_id ?? undefined,
    vendor_secret: data.vendor_secret ?? undefined,
    is_promo_standards: data.is_promo_standards,
    promo_endpoints: data.promo_endpoints as any,
    format_data: data.format_data ?? undefined,
    api_service_type: data.api_service_type as any,
  };

  return <VendorForm initialValues={initialValues} onSubmit={handleSubmit} onCancel={handleCancel} />;
};

export default EditVendorPage;

