import { useRouter } from 'next/router';
import VendorForm from '../../components/vendorForm';
import { useSession } from '../../context/session';
import type { VendorFormData } from '../../types';

const NewVendorPage = () => {
  const router = useRouter();
  const { context } = useSession();

  const handleSubmit = async (data: VendorFormData) => {
    await fetch(`/api/vendors?context=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    router.push('/vendors');
  };

  const handleCancel = () => {
    router.push('/vendors');
  };

  return <VendorForm onSubmit={handleSubmit} onCancel={handleCancel} />;
};

export default NewVendorPage;

