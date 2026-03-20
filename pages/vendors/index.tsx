import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import {
  ConfirmDialog,
  RowActionMenu,
  StatusBadge,
  ToastViewport,
  type OperatorToast,
  pageCardStyle,
  primaryButtonStyle,
  sectionTitleStyle,
} from '../../components/operator/ui';
import { useSession } from '../../context/session';
import type { VendorOperatorSummary } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

type SortKey =
  | 'vendor_id'
  | 'vendor_status'
  | 'vendor_name'
  | 'vendor_type'
  | 'api_type_label'
  | 'health_percent'
  | 'total_products_synced'
  | 'last_synced_at'
  | 'datetime_added';

const vendorStatusSortOrder: Record<VendorOperatorSummary['vendor_status'], number> = {
  SYNCING: 0,
  SYNC_FAILED: 1,
  SYNCED: 2,
  DEACTIVATED: 3,
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function compareValues(left: VendorOperatorSummary, right: VendorOperatorSummary, sortKey: SortKey): number {
  const getValue = (vendor: VendorOperatorSummary): string | number => {
    switch (sortKey) {
      case 'vendor_id':
        return vendor.vendor_id;
      case 'vendor_status':
        return vendorStatusSortOrder[vendor.vendor_status];
      case 'vendor_name':
        return vendor.vendor_name;
      case 'vendor_type':
        return vendor.vendor_type;
      case 'api_type_label':
        return vendor.api_type_label;
      case 'health_percent':
        return vendor.health_percent ?? -1;
      case 'total_products_synced':
        return vendor.total_products_synced;
      case 'last_synced_at':
        return vendor.last_synced_at ? new Date(vendor.last_synced_at).getTime() : 0;
      case 'datetime_added':
      default:
        return new Date(vendor.datetime_added).getTime();
    }
  };

  const leftValue = getValue(left);
  const rightValue = getValue(right);

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue));
}

const VendorsPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const [sortKey, setSortKey] = useState<SortKey>('vendor_name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [toasts, setToasts] = useState<OperatorToast[]>([]);
  const [pendingDeactivateVendor, setPendingDeactivateVendor] = useState<VendorOperatorSummary | null>(null);
  const [pendingEditVendor, setPendingEditVendor] = useState<VendorOperatorSummary | null>(null);

  const { data, error, mutate } = useSWR<{ data: VendorOperatorSummary[] }>(
    context ? `/api/vendors?context=${encodeURIComponent(context)}&includeInactive=1&view=operator` : null,
    fetcher,
    {
      refreshInterval: currentData =>
        (currentData?.data ?? []).some(vendor => vendor.vendor_status === 'SYNCING') ? 10000 : 0,
    },
  );

  const addToast = (toast: Omit<OperatorToast, 'id'>) => {
    setToasts(current => [
      ...current,
      {
        id: Date.now() + current.length,
        ...toast,
      },
    ]);
  };

  const vendors = useMemo(() => {
    const next = [...(data?.data ?? [])];
    next.sort((left, right) => {
      const result = compareValues(left, right, sortKey);
      return sortDirection === 'asc' ? result : -result;
    });
    return next;
  }, [data?.data, sortDirection, sortKey]);

  const updateSort = (nextSortKey: SortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection('asc');
  };

  const handleEditSelection = (vendor: VendorOperatorSummary) => {
    if (vendor.is_active) {
      setPendingEditVendor(vendor);
      return;
    }

    router.push(`/vendors/${vendor.vendor_id}`);
  };

  const handleSyncNow = async (vendor: VendorOperatorSummary) => {
    const response = await fetch(`/api/vendors/${vendor.vendor_id}/sync?context=${encodeURIComponent(context)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_all: true }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.message ?? 'Failed to submit sync job');
    }

    addToast({
      tone: 'success',
      title: payload?.deduplicated ? 'Sync already running' : 'Sync submitted',
      description: payload?.deduplicated
        ? `Vendor ${vendor.vendor_name} already has an active sync job.`
        : `A sync job was queued for ${vendor.vendor_name}.`,
    });
    await mutate();
  };

  const confirmDeactivate = async () => {
    if (!pendingDeactivateVendor) return;

    try {
      const response = await fetch(
        `/api/vendors/${pendingDeactivateVendor.vendor_id}?context=${encodeURIComponent(context)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: false }),
        },
      );
      const payload = response.status === 204 ? null : await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.message ?? 'Failed to deactivate vendor');
      }

      addToast({
        tone: 'success',
        title: 'Vendor deactivated',
        description: `${pendingDeactivateVendor.vendor_name} is now inactive.`,
      });
      setPendingDeactivateVendor(null);
      await mutate();
    } catch (error) {
      addToast({
        tone: 'error',
        title: 'Unable to deactivate vendor',
        description: error instanceof Error ? error.message : 'Failed to deactivate vendor.',
      });
      setPendingDeactivateVendor(null);
    }
  };

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <>
      <ToastViewport
        toasts={toasts}
        onDismiss={id => setToasts(current => current.filter(toast => toast.id !== id))}
      />

      <ConfirmDialog
        open={Boolean(pendingEditVendor)}
        title="Editing an active vendor can break the app"
        description={`Changes to ${pendingEditVendor?.vendor_name ?? 'this vendor'} can interrupt syncs or break downstream catalog behavior if the new credentials or API settings are wrong. Continue only if you have validated the new configuration.`}
        confirmLabel="Continue to edit"
        onCancel={() => setPendingEditVendor(null)}
        onConfirm={() => {
          if (pendingEditVendor) {
            router.push(`/vendors/${pendingEditVendor.vendor_id}`);
          }
          setPendingEditVendor(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDeactivateVendor)}
        title="Deactivate vendor?"
        description={`Deactivate ${pendingDeactivateVendor?.vendor_name ?? 'this vendor'} only if it no longer needs to sync. Vendors with active synced products cannot be deactivated.`}
        confirmLabel="Deactivate vendor"
        tone="danger"
        onCancel={() => setPendingDeactivateVendor(null)}
        onConfirm={confirmDeactivate}
      />

      <section style={pageCardStyle}>
        <div
          style={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: '16px',
            justifyContent: 'space-between',
            marginBottom: '22px',
          }}
        >
          <div>
            <h2 style={sectionTitleStyle}>Vendors</h2>
            <p style={{ color: '#475569', margin: '8px 0 0' }}>
              Track onboarding, health, sync state, and safe vendor actions from one operator table.
            </p>
          </div>
          <button type="button" onClick={() => router.push('/vendors/new')} style={primaryButtonStyle}>
            Add New Vendor
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <SortableHeader label="ID" active={sortKey === 'vendor_id'} direction={sortDirection} onClick={() => updateSort('vendor_id')} />
                <SortableHeader label="Status" active={sortKey === 'vendor_status'} direction={sortDirection} onClick={() => updateSort('vendor_status')} />
                <SortableHeader label="Name" active={sortKey === 'vendor_name'} direction={sortDirection} onClick={() => updateSort('vendor_name')} />
                <SortableHeader label="Vendor Type" active={sortKey === 'vendor_type'} direction={sortDirection} onClick={() => updateSort('vendor_type')} />
                <SortableHeader label="API Type" active={sortKey === 'api_type_label'} direction={sortDirection} onClick={() => updateSort('api_type_label')} />
                <SortableHeader label="Health" active={sortKey === 'health_percent'} direction={sortDirection} onClick={() => updateSort('health_percent')} />
                <SortableHeader label="# of Products" active={sortKey === 'total_products_synced'} direction={sortDirection} onClick={() => updateSort('total_products_synced')} />
                <SortableHeader label="Last Synced" active={sortKey === 'last_synced_at'} direction={sortDirection} onClick={() => updateSort('last_synced_at')} />
                <SortableHeader label="Added" active={sortKey === 'datetime_added'} direction={sortDirection} onClick={() => updateSort('datetime_added')} />
                <th style={tableHeaderStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map(vendor => (
                <tr key={vendor.vendor_id}>
                  <td style={tableCellStyle}>#{vendor.vendor_id}</td>
                  <td style={tableCellStyle}>
                    <StatusBadge status={vendor.vendor_status} />
                  </td>
                  <td style={tableCellStyle}>
                    <button
                      type="button"
                      onClick={() => handleEditSelection(vendor)}
                      style={linkButtonStyle}
                    >
                      {vendor.vendor_name}
                    </button>
                  </td>
                  <td style={tableCellStyle}>{vendor.vendor_type === 'SUPPLIER' ? 'Supplier' : 'Decorator'}</td>
                  <td style={tableCellStyle}>{vendor.api_type_label}</td>
                  <td style={tableCellStyle}>{vendor.health_percent === null ? '—' : `${vendor.health_percent}%`}</td>
                  <td style={tableCellStyle}>
                    {vendor.total_products_synced} synced / {vendor.total_products_active} active
                  </td>
                  <td style={tableCellStyle}>{formatDate(vendor.last_synced_at)}</td>
                  <td style={tableCellStyle}>{formatDate(vendor.datetime_added)}</td>
                  <td style={tableCellStyle}>
                    <RowActionMenu
                      actions={[
                        {
                          id: 'sync',
                          label: 'Sync now',
                          onSelect: () =>
                            handleSyncNow(vendor).catch(error =>
                              addToast({
                                tone: 'error',
                                title: 'Unable to submit sync',
                                description: error instanceof Error ? error.message : 'Failed to submit sync.',
                              }),
                            ),
                        },
                        {
                          id: 'edit',
                          label: 'Edit',
                          onSelect: () => handleEditSelection(vendor),
                        },
                        {
                          id: 'deactivate',
                          label: 'Deactivate',
                          tone: 'danger',
                          onSelect: () => {
                            if (vendor.total_products_active > 0) {
                              addToast({
                                tone: 'error',
                                title: 'Vendor cannot be deactivated',
                                description: `${vendor.vendor_name} still has ${vendor.total_products_active} active products.`,
                              });
                              return;
                            }
                            setPendingDeactivateVendor(vendor);
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

const SortableHeader = (props: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: () => void;
}) => (
  <th style={tableHeaderStyle}>
    <button
      type="button"
      onClick={props.onClick}
      style={{
        alignItems: 'center',
        background: 'transparent',
        border: 'none',
        color: props.active ? '#0f172a' : '#475569',
        cursor: 'pointer',
        display: 'inline-flex',
        fontWeight: 700,
        gap: '6px',
        padding: 0,
      }}
    >
      {props.label}
      <span style={{ color: props.active ? '#0f766e' : '#94a3b8' }}>
        {props.active ? (props.direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  </th>
);

const tableHeaderStyle: React.CSSProperties = {
  borderBottom: '1px solid #dbe3ef',
  padding: '12px 14px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const tableCellStyle: React.CSSProperties = {
  borderBottom: '1px solid #eef2f7',
  color: '#334155',
  padding: '14px',
  verticalAlign: 'top',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#0f766e',
  cursor: 'pointer',
  fontWeight: 700,
  padding: 0,
  textAlign: 'left',
};

export default VendorsPage;
