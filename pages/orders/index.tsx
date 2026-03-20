import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import {
  RowActionMenu,
  ToastViewport,
  type OperatorToast,
  InlineNotice,
  OperatorMetricCard,
  pageCardStyle,
  primaryButtonStyle,
  sectionTitleStyle,
} from '../../components/operator/ui';
import { useSession } from '../../context/session';
import type { OrderOperatorSummary } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

type SortKey =
  | 'order_integration_state_id'
  | 'vendor_name'
  | 'external_order_id'
  | 'purchase_order_number'
  | 'lifecycle_status'
  | 'submitted_at'
  | 'updated_at';

function formatDate(value: string | null): string {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function compareOrders(left: OrderOperatorSummary, right: OrderOperatorSummary, sortKey: SortKey): number {
  const getValue = (item: OrderOperatorSummary): string | number => {
    switch (sortKey) {
      case 'order_integration_state_id':
        return item.order_integration_state_id;
      case 'vendor_name':
        return item.vendor_name;
      case 'external_order_id':
        return item.external_order_id;
      case 'purchase_order_number':
        return item.purchase_order_number;
      case 'lifecycle_status':
        return item.lifecycle_status;
      case 'submitted_at':
        return item.submitted_at ? new Date(item.submitted_at).getTime() : 0;
      case 'updated_at':
      default:
        return new Date(item.updated_at).getTime();
    }
  };

  const leftValue = getValue(left);
  const rightValue = getValue(right);
  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    return leftValue - rightValue;
  }

  return String(leftValue).localeCompare(String(rightValue));
}

const OrdersPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [toasts, setToasts] = useState<OperatorToast[]>([]);

  const { data, error, mutate } = useSWR<{ data: OrderOperatorSummary[] }>(
    context ? `/api/order-integrations?context=${encodeURIComponent(context)}` : null,
    fetcher,
    {
      refreshInterval: currentData =>
        (currentData?.data ?? []).some(order => order.has_active_job) ? 10000 : 0,
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

  const orders = useMemo(() => {
    const next = [...(data?.data ?? [])];
    next.sort((left, right) => {
      const result = compareOrders(left, right, sortKey);
      return sortDirection === 'asc' ? result : -result;
    });
    return next;
  }, [data?.data, sortDirection, sortKey]);

  const metrics = useMemo(() => {
    const values = {
      total: orders.length,
      pending: 0,
      active: 0,
      completed: 0,
      issue: 0,
    };

    for (const order of orders) {
      if (order.has_active_job) {
        values.active += 1;
      }
      if (order.lifecycle_status === 'PENDING_SUBMISSION' || order.lifecycle_status === 'SUBMISSION_QUEUED') {
        values.pending += 1;
      }
      if (order.lifecycle_status === 'COMPLETED') {
        values.completed += 1;
      }
      if (order.lifecycle_status === 'ISSUE' || order.lifecycle_status === 'FAILED') {
        values.issue += 1;
      }
    }

    return values;
  }, [orders]);

  const updateSort = (nextSortKey: SortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection(current => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === 'updated_at' ? 'desc' : 'asc');
  };

  const triggerAction = async (orderIntegrationStateId: number, action: string, successMessage: string) => {
    try {
      const response = await fetch(
        `/api/order-integrations/${orderIntegrationStateId}/actions?context=${encodeURIComponent(context)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Failed to queue order action');
      }

      addToast({
        tone: 'success',
        title: payload?.deduplicated ? 'Job already active' : 'Order action queued',
        description: payload?.deduplicated
          ? 'An active job for this order action already exists.'
          : successMessage,
      });
      await mutate();
    } catch (error) {
      addToast({
        tone: 'error',
        title: 'Unable to queue order action',
        description: error instanceof Error ? error.message : 'Order action failed.',
      });
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

      <div style={{ display: 'grid', gap: '24px' }}>
        <section
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <OperatorMetricCard label="Order Integrations" value={String(metrics.total)} />
          <OperatorMetricCard label="Pending Submission" value={String(metrics.pending)} />
          <OperatorMetricCard label="Jobs In Flight" value={String(metrics.active)} />
          <OperatorMetricCard label="Completed" value={String(metrics.completed)} />
          <OperatorMetricCard label="Needs Attention" value={String(metrics.issue)} />
        </section>

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
              <h2 style={sectionTitleStyle}>Order Lifecycle</h2>
              <p style={{ color: '#475569', margin: '8px 0 0' }}>
                Track supplier-facing purchase orders, polling cadence, and lifecycle issues from one operator view.
              </p>
            </div>
            <button type="button" onClick={() => router.push('/orders/new')} style={primaryButtonStyle}>
              Create Order Integration
            </button>
          </div>

          {orders.length === 0 ? (
            <InlineNotice
              tone="info"
              title="No order integrations yet"
              description="Create the first order integration to test PromoStandards order submission and polling."
            />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                <thead>
                  <tr>
                    <SortableHeader label="ID" active={sortKey === 'order_integration_state_id'} direction={sortDirection} onClick={() => updateSort('order_integration_state_id')} />
                    <SortableHeader label="Vendor" active={sortKey === 'vendor_name'} direction={sortDirection} onClick={() => updateSort('vendor_name')} />
                    <SortableHeader label="External Order" active={sortKey === 'external_order_id'} direction={sortDirection} onClick={() => updateSort('external_order_id')} />
                    <SortableHeader label="PO Number" active={sortKey === 'purchase_order_number'} direction={sortDirection} onClick={() => updateSort('purchase_order_number')} />
                    <SortableHeader label="Lifecycle" active={sortKey === 'lifecycle_status'} direction={sortDirection} onClick={() => updateSort('lifecycle_status')} />
                    <SortableHeader label="Submitted" active={sortKey === 'submitted_at'} direction={sortDirection} onClick={() => updateSort('submitted_at')} />
                    <SortableHeader label="Updated" active={sortKey === 'updated_at'} direction={sortDirection} onClick={() => updateSort('updated_at')} />
                    <th style={headerStyle}>Next Polls</th>
                    <th style={headerStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(order => (
                    <tr key={order.order_integration_state_id}>
                      <td style={cellStyle}>
                        <Link href={`/orders/${order.order_integration_state_id}`} style={tableLinkStyle}>
                          #{order.order_integration_state_id}
                        </Link>
                      </td>
                      <td style={cellStyle}>{order.vendor_name}</td>
                      <td style={cellStyle}>{order.external_order_id}</td>
                      <td style={cellStyle}>
                        <div>{order.purchase_order_number}</div>
                        {order.sales_order_number ? (
                          <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>
                            SO: {order.sales_order_number}
                          </div>
                        ) : null}
                      </td>
                      <td style={cellStyle}>
                        <div style={{ color: '#0f172a', fontWeight: 700 }}>{order.lifecycle_status}</div>
                        {order.status_label ? (
                          <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>
                            {order.status_label}
                          </div>
                        ) : null}
                        {order.last_error ? (
                          <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '4px' }}>
                            {order.last_error}
                          </div>
                        ) : null}
                      </td>
                      <td style={cellStyle}>{formatDate(order.submitted_at)}</td>
                      <td style={cellStyle}>{formatDate(order.updated_at)}</td>
                      <td style={cellStyle}>
                        <div>Status: {formatDate(order.next_status_poll_at)}</div>
                        <div>Shipment: {formatDate(order.next_shipment_poll_at)}</div>
                        <div>Invoice: {formatDate(order.next_invoice_poll_at)}</div>
                      </td>
                      <td style={cellStyle}>
                        <RowActionMenu
                          actions={[
                            {
                              id: 'view',
                              label: 'View details',
                              onSelect: () => router.push(`/orders/${order.order_integration_state_id}`),
                            },
                            {
                              id: 'submit',
                              label: order.submitted_at ? 'Retry submission' : 'Submit now',
                              onSelect: () =>
                                void triggerAction(
                                  order.order_integration_state_id,
                                  order.submitted_at ? 'retry_submission' : 'submit',
                                  `Queued ${order.submitted_at ? 'a resubmission' : 'an order submission'} for ${order.purchase_order_number}.`,
                                ),
                            },
                            {
                              id: 'poll_status',
                              label: 'Poll status',
                              onSelect: () =>
                                void triggerAction(
                                  order.order_integration_state_id,
                                  'poll_status',
                                  `Queued a status poll for ${order.purchase_order_number}.`,
                                ),
                            },
                            {
                              id: 'poll_shipment',
                              label: 'Poll shipment',
                              onSelect: () =>
                                void triggerAction(
                                  order.order_integration_state_id,
                                  'poll_shipment',
                                  `Queued a shipment poll for ${order.purchase_order_number}.`,
                                ),
                            },
                            {
                              id: 'poll_invoice',
                              label: 'Poll invoice',
                              onSelect: () =>
                                void triggerAction(
                                  order.order_integration_state_id,
                                  'poll_invoice',
                                  `Queued an invoice poll for ${order.purchase_order_number}.`,
                                ),
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
};

function SortableHeader(props: {
  label: string;
  active: boolean;
  direction: 'asc' | 'desc';
  onClick: () => void;
}) {
  return (
    <th style={headerStyle}>
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
        {props.active ? (props.direction === 'asc' ? '↑' : '↓') : '↕'}
      </button>
    </th>
  );
}

const headerStyle: React.CSSProperties = {
  borderBottom: '1px solid #dbe3ef',
  padding: '12px 14px',
  textAlign: 'left',
};

const cellStyle: React.CSSProperties = {
  borderBottom: '1px solid #eef2f7',
  color: '#334155',
  padding: '14px',
  verticalAlign: 'top',
};

const tableLinkStyle: React.CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
  textDecoration: 'none',
};

export default OrdersPage;
