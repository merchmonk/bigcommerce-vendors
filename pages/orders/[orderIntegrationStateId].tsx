import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { OperatorTraceSection, formatOperatorDate } from '../../components/operator/diagnostics';
import {
  InlineNotice,
  OperatorMetricCard,
  ToastViewport,
  type OperatorToast,
  pageCardStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionTitleStyle,
  textInputStyle,
} from '../../components/operator/ui';
import { useSession } from '../../context/session';
import type { IntegrationJob, OperatorTrace, OrderIntegrationState } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface OrderIntegrationDetailResponse {
  orderIntegrationState: OrderIntegrationState;
  vendor: {
    vendor_id: number;
    vendor_name: string;
  } | null;
  jobs: IntegrationJob[];
  traces: OperatorTrace[];
  capabilities: Array<{
    capability_key: string;
    endpoint_name: string;
    endpoint_version: string;
    operation_name: string;
    recommended_poll_minutes: number | null;
  }>;
}

const defaultRemittancePayload = `{
  "request_fields": {}
}`;

const OrderIntegrationDetailPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const withContext = (path: string) => (context ? `${path}?context=${encodeURIComponent(context)}` : path);
  const orderIntegrationStateId = Number(router.query.orderIntegrationStateId);
  const [toasts, setToasts] = useState<OperatorToast[]>([]);
  const [remittancePayloadText, setRemittancePayloadText] = useState(defaultRemittancePayload);

  const { data, error, mutate } = useSWR<OrderIntegrationDetailResponse>(
    Number.isFinite(orderIntegrationStateId) && context
      ? `/api/order-integrations/${orderIntegrationStateId}?context=${encodeURIComponent(context)}`
      : null,
    fetcher,
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

  const runAction = async (action: string, payload?: Record<string, unknown>) => {
    try {
      const response = await fetch(
        `/api/order-integrations/${orderIntegrationStateId}/actions?context=${encodeURIComponent(context)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(payload ? payload : {}),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.message ?? 'Failed to queue order action');
      }

      addToast({
        tone: 'success',
        title: body?.deduplicated ? 'Job already active' : 'Order action queued',
        description: body?.deduplicated
          ? 'A matching active job already exists for this order.'
          : `Queued ${action.replaceAll('_', ' ')}.`,
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
  if (!data) return null;

  const { orderIntegrationState, vendor, jobs, traces, capabilities } = data;

  return (
    <>
      <ToastViewport
        toasts={toasts}
        onDismiss={id => setToasts(current => current.filter(toast => toast.id !== id))}
      />

      <div style={{ display: 'grid', gap: '24px' }}>
        <section style={pageCardStyle}>
          <div
            style={{
              alignItems: 'flex-start',
              display: 'flex',
              gap: '16px',
              justifyContent: 'space-between',
              marginBottom: '18px',
            }}
          >
            <div>
              <h2 style={sectionTitleStyle}>Order Integration #{orderIntegrationState.order_integration_state_id}</h2>
              <p style={{ color: '#475569', margin: '8px 0 0' }}>
                Supplier-facing order lifecycle state for {vendor?.vendor_name ?? `Vendor ${orderIntegrationState.vendor_id}`}.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="button" onClick={() => router.push(withContext('/orders'))} style={secondaryButtonStyle}>
                Back to Orders
              </button>
              <button
                type="button"
                onClick={() => {
                  void runAction(orderIntegrationState.submitted_at ? 'retry_submission' : 'submit');
                }}
                style={primaryButtonStyle}
              >
                {orderIntegrationState.submitted_at ? 'Retry Submission' : 'Submit Order'}
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gap: '16px',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <OperatorMetricCard label="Lifecycle" value={orderIntegrationState.lifecycle_status} />
            <OperatorMetricCard label="Vendor" value={vendor?.vendor_name ?? `Vendor ${orderIntegrationState.vendor_id}`} />
            <OperatorMetricCard label="PO Number" value={orderIntegrationState.purchase_order_number} />
            <OperatorMetricCard label="External Order" value={orderIntegrationState.external_order_id} />
            <OperatorMetricCard label="Submitted" value={formatOperatorDate(orderIntegrationState.submitted_at)} />
            <OperatorMetricCard label="Updated" value={formatOperatorDate(orderIntegrationState.updated_at)} />
          </div>
        </section>

        {orderIntegrationState.last_error ? (
          <InlineNotice tone="error" title="Latest order error" description={orderIntegrationState.last_error} />
        ) : null}

        <section style={pageCardStyle}>
          <div style={{ marginBottom: '18px' }}>
            <h3 style={sectionTitleStyle}>Manual Controls</h3>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <button type="button" style={primaryButtonStyle} onClick={() => { void runAction('poll_status'); }}>
              Poll Status
            </button>
            <button type="button" style={primaryButtonStyle} onClick={() => { void runAction('poll_shipment'); }}>
              Poll Shipment
            </button>
            <button type="button" style={primaryButtonStyle} onClick={() => { void runAction('poll_invoice'); }}>
              Poll Invoice
            </button>
          </div>

          <div style={{ marginTop: '24px' }}>
            <div style={{ color: '#0f172a', fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>
              Remittance Advice
            </div>
            <textarea
              value={remittancePayloadText}
              onChange={event => setRemittancePayloadText(event.target.value)}
              style={{
                ...textInputStyle,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                minHeight: '180px',
              }}
            />
            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  try {
                    const remittancePayload = JSON.parse(remittancePayloadText) as Record<string, unknown>;
                    void runAction('submit_remittance', { remittance_payload: remittancePayload });
                  } catch (error) {
                    addToast({
                      tone: 'error',
                      title: 'Invalid remittance payload',
                      description: error instanceof Error ? error.message : 'Remittance payload must be valid JSON.',
                    });
                  }
                }}
              >
                Submit Remittance
              </button>
            </div>
          </div>
        </section>

        <section style={pageCardStyle}>
          <div style={{ marginBottom: '18px' }}>
            <h3 style={sectionTitleStyle}>Lifecycle State</h3>
          </div>
          <pre style={jsonBlockStyle}>{JSON.stringify(orderIntegrationState, null, 2)}</pre>
        </section>

        <section style={pageCardStyle}>
          <div style={{ marginBottom: '18px' }}>
            <h3 style={sectionTitleStyle}>Vendor Order Capabilities</h3>
          </div>
          <div style={{ display: 'grid', gap: '12px' }}>
            {capabilities.length === 0 ? (
              <div style={{ color: '#475569' }}>No order capabilities were discovered for this vendor.</div>
            ) : (
              capabilities.map(capability => (
                <div
                  key={`${capability.capability_key}-${capability.operation_name}`}
                  style={{
                    border: '1px solid #dbe3ef',
                    borderRadius: '14px',
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ color: '#0f172a', fontWeight: 700 }}>{capability.capability_key}</div>
                  <div style={{ color: '#475569', marginTop: '6px' }}>
                    {capability.endpoint_name} {capability.endpoint_version} · {capability.operation_name}
                  </div>
                  <div style={{ color: '#64748b', marginTop: '6px' }}>
                    Recommended poll cadence: {capability.recommended_poll_minutes ? `${capability.recommended_poll_minutes} minutes` : 'n/a'}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section style={pageCardStyle}>
          <div style={{ marginBottom: '18px' }}>
            <h3 style={sectionTitleStyle}>Related Jobs</h3>
          </div>
          <div style={{ display: 'grid', gap: '12px' }}>
            {jobs.length === 0 ? (
              <div style={{ color: '#475569' }}>No order jobs have been recorded yet.</div>
            ) : (
              jobs.map(job => (
                <div
                  key={job.integration_job_id}
                  style={{
                    border: '1px solid #dbe3ef',
                    borderRadius: '14px',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '12px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <Link href={`/integration-jobs/${job.integration_job_id}`} style={tableLinkStyle}>
                        Integration Job #{job.integration_job_id}
                      </Link>
                      <div style={{ color: '#475569', marginTop: '6px' }}>
                        {job.job_kind} · {job.status}
                      </div>
                    </div>
                    <div style={{ color: '#64748b', fontSize: '13px' }}>{formatOperatorDate(job.submitted_at)}</div>
                  </div>
                  {job.last_error ? (
                    <div style={{ color: '#b91c1c', marginTop: '10px' }}>{job.last_error}</div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        <OperatorTraceSection traces={traces} contextQuery={context} />
      </div>
    </>
  );
};

const jsonBlockStyle: React.CSSProperties = {
  background: '#0f172a',
  borderRadius: '14px',
  color: '#e2e8f0',
  fontSize: '12px',
  margin: 0,
  maxHeight: '520px',
  overflow: 'auto',
  padding: '18px',
};

const tableLinkStyle: React.CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
  textDecoration: 'none',
};

export default OrderIntegrationDetailPage;
