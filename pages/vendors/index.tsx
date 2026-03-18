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
    if (!window.confirm('Are you sure you want to delete this vendor?')) return;

    await fetch(`/api/vendors/${vendorId}?context=${encodeURIComponent(context)}`, {
      method: 'DELETE',
    });
    mutate();
  };

  const rows = vendors.map(vendor => ({
    id: vendor.vendor_id,
    name: vendor.vendor_name,
    integrationFamily: vendor.integration_family,
    protocol: vendor.api_protocol ?? 'n/a',
    status: vendor.is_active ? 'Active' : 'Inactive',
  }));

  const renderActions = (vendorId: number): ReactElement => (
    <button
      type="button"
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
      style={{
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: '8px',
        cursor: 'pointer',
        padding: '6px 10px',
      }}
    >
      Actions
    </button>
  );

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <section
      id="vendors"
      style={{
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '24px',
      }}
    >
      <div
        style={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '20px',
        }}
      >
        <h2 style={{ margin: 0 }}>Vendors</h2>
        <button
          type="button"
          onClick={handleAddNew}
          style={{
            background: '#2563eb',
            border: 'none',
            borderRadius: '8px',
            color: '#ffffff',
            cursor: 'pointer',
            padding: '10px 14px',
          }}
        >
          Add New Vendor
        </button>
      </div>

      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th style={tableHeaderStyle}>Vendor name</th>
            <th style={tableHeaderStyle}>Integration</th>
            <th style={tableHeaderStyle}>Protocol</th>
            <th style={tableHeaderStyle}>Status</th>
            <th style={tableHeaderStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td style={tableCellStyle}>
                <button
                  type="button"
                  onClick={() => handleEdit(row.id as number)}
                  style={linkButtonStyle}
                >
                  {row.name}
                </button>
              </td>
              <td style={tableCellStyle}>{row.integrationFamily}</td>
              <td style={tableCellStyle}>{row.protocol}</td>
              <td style={tableCellStyle}>{row.status}</td>
              <td style={tableCellStyle}>{renderActions(row.id as number)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

const tableHeaderStyle: React.CSSProperties = {
  borderBottom: '1px solid #d1d5db',
  padding: '12px',
  textAlign: 'left',
};

const tableCellStyle: React.CSSProperties = {
  borderBottom: '1px solid #e5e7eb',
  padding: '12px',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#2563eb',
  cursor: 'pointer',
  padding: 0,
};

export default VendorsPage;
