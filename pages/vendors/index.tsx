import { Button, Panel, Table } from '@bigcommerce/big-design';
import { MoreHorizIcon } from '@bigcommerce/big-design-icons';
import { useRouter } from 'next/router';
import { ReactElement } from 'react';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { useSession } from '../../context/session';
import type { Vendor } from '../../lib/vendors';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const VendorsPage = () => {
  const router = useRouter();
  const { context } = useSession();

  const { data, error, mutate } = useSWR<{ data: Vendor[] }>(
    context ? `/api/vendors?context=${encodeURIComponent(context)}` : null,
    fetcher,
  );

  const vendors = data?.data ?? [];

  const handleAddNew = () => {
    router.push('/vendors/new');
  };

  const handleEdit = (vendorId: number) => {
    router.push(`/vendors/${vendorId}`);
  };

  const handleDeactivate = async (vendorId: number) => {
    await fetch(`/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: false }),
    });
    mutate();
  };

  const handleDelete = async (vendorId: number) => {
    // Simple confirmation; in a real app we might use a modal
    // eslint-disable-next-line no-alert
    if (!window.confirm('Are you sure you want to delete this vendor?')) return;

    await fetch(`/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`, {
      method: 'DELETE',
    });
    mutate();
  };

  const rows = vendors.map(vendor => ({
    id: vendor.vendor_id,
    name: vendor.vendor_name,
    isPromoStandards: vendor.is_promo_standards ? 'Yes' : 'No',
    status: vendor.is_active ? 'Active' : 'Inactive',
  }));

  const renderActions = (vendorId: number): ReactElement => (
    <Button
      iconOnly={<MoreHorizIcon color="secondary60" />}
      variant="subtle"
      aria-label="Vendor actions"
      onClick={event => {
        event.preventDefault();
        const menu = window.prompt('Choose action: edit / deactivate / delete');
        if (menu === 'edit') {
          handleEdit(vendorId);
        } else if (menu === 'deactivate') {
          handleDeactivate(vendorId);
        } else if (menu === 'delete') {
          handleDelete(vendorId);
        }
      }}
    />
  );

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <Panel header="Vendors" action={<Button onClick={handleAddNew}>Add New Vendor</Button>} id="vendors">
      <Table
        columns={[
          {
            header: 'Vendor name',
            hash: 'name',
            render: ({ id, name }) => (
              <Button variant="link" onClick={() => handleEdit(id as number)}>
                {name}
              </Button>
            ),
          },
          {
            header: 'PromoStandards',
            hash: 'isPromoStandards',
            render: ({ isPromoStandards }) => <span>{isPromoStandards}</span>,
          },
          {
            header: 'Status',
            hash: 'status',
            render: ({ status }) => <span>{status}</span>,
          },
          {
            header: 'Actions',
            hideHeader: true,
            hash: 'id',
            render: ({ id }) => renderActions(id as number),
          },
        ]}
        items={rows}
        itemName="Vendors"
      />
    </Panel>
  );
};

export default VendorsPage;

