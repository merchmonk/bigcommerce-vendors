import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import {
  InlineNotice,
  fieldLabelStyle,
  pageCardStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionTitleStyle,
  textInputStyle,
} from '../../components/operator/ui';
import { useSession } from '../../context/session';
import type { VendorOperatorSummary } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

const defaultPayload = `{
  "request_fields": {}
}`;

const NewOrderIntegrationPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const [vendorId, setVendorId] = useState('');
  const [externalOrderId, setExternalOrderId] = useState('');
  const [purchaseOrderNumber, setPurchaseOrderNumber] = useState('');
  const [salesOrderNumber, setSalesOrderNumber] = useState('');
  const [orderType, setOrderType] = useState('');
  const [orderSource, setOrderSource] = useState('BIGCOMMERCE');
  const [submissionPayloadText, setSubmissionPayloadText] = useState(defaultPayload);
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const { data, error } = useSWR<{ data: VendorOperatorSummary[] }>(
    context
      ? `/api/vendors?context=${encodeURIComponent(context)}&view=operator`
      : null,
    fetcher,
  );

  const availableVendors = useMemo(
    () =>
      (data?.data ?? []).filter(
        vendor => vendor.integration_family === 'PROMOSTANDARDS' && vendor.vendor_type === 'SUPPLIER' && vendor.is_active,
      ),
    [data?.data],
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSubmitting(true);

    try {
      const parsedPayload = JSON.parse(submissionPayloadText) as Record<string, unknown>;
      const response = await fetch(`/api/order-integrations?context=${encodeURIComponent(context)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: Number(vendorId),
          external_order_id: externalOrderId,
          purchase_order_number: purchaseOrderNumber,
          sales_order_number: salesOrderNumber || undefined,
          order_type: orderType || undefined,
          order_source: orderSource,
          submission_payload: parsedPayload,
          auto_submit: autoSubmit,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Failed to create order integration');
      }

      const orderIntegrationStateId = payload?.data?.order_integration_state_id;
      if (orderIntegrationStateId) {
        await router.push(`/orders/${orderIntegrationStateId}`);
        return;
      }

      await router.push('/orders');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create order integration.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;

  return (
    <section style={{ ...pageCardStyle, maxWidth: '920px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={sectionTitleStyle}>Create Order Integration</h2>
        <p style={{ color: '#475569', margin: '8px 0 0' }}>
          Create a vendor-scoped supplier order record and optionally queue the initial PromoStandards `sendPO` submission.
        </p>
      </div>

      {availableVendors.length === 0 ? (
        <InlineNotice
          tone="warning"
          title="No PromoStandards supplier vendors are available"
          description="Create and validate at least one active PromoStandards supplier vendor before creating order integrations."
        />
      ) : null}

      {errorMessage ? (
        <div style={{ marginBottom: '18px' }}>
          <InlineNotice tone="error" title="Unable to create order integration" description={errorMessage} />
        </div>
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '18px' }}>
        <div style={{ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label>
            <span style={fieldLabelStyle}>Vendor</span>
            <select
              value={vendorId}
              onChange={event => setVendorId(event.target.value)}
              style={textInputStyle}
              required
            >
              <option value="">Select a vendor</option>
              {availableVendors.map(vendor => (
                <option key={vendor.vendor_id} value={vendor.vendor_id}>
                  {vendor.vendor_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span style={fieldLabelStyle}>External Order ID</span>
            <input
              value={externalOrderId}
              onChange={event => setExternalOrderId(event.target.value)}
              style={textInputStyle}
              placeholder="bc-1001"
              required
            />
          </label>

          <label>
            <span style={fieldLabelStyle}>Purchase Order Number</span>
            <input
              value={purchaseOrderNumber}
              onChange={event => setPurchaseOrderNumber(event.target.value)}
              style={textInputStyle}
              placeholder="MM-PO-1001"
              required
            />
          </label>

          <label>
            <span style={fieldLabelStyle}>Sales Order Number</span>
            <input
              value={salesOrderNumber}
              onChange={event => setSalesOrderNumber(event.target.value)}
              style={textInputStyle}
              placeholder="Optional supplier sales order number"
            />
          </label>

          <label>
            <span style={fieldLabelStyle}>Order Type</span>
            <input
              value={orderType}
              onChange={event => setOrderType(event.target.value)}
              style={textInputStyle}
              placeholder="Standard"
            />
          </label>

          <label>
            <span style={fieldLabelStyle}>Order Source</span>
            <input
              value={orderSource}
              onChange={event => setOrderSource(event.target.value)}
              style={textInputStyle}
              placeholder="BIGCOMMERCE"
            />
          </label>
        </div>

        <label>
          <span style={fieldLabelStyle}>PromoStandards Submission Payload</span>
          <textarea
            value={submissionPayloadText}
            onChange={event => setSubmissionPayloadText(event.target.value)}
            style={{
              ...textInputStyle,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              minHeight: '280px',
            }}
            required
          />
        </label>

        <label
          style={{
            alignItems: 'center',
            color: '#334155',
            display: 'inline-flex',
            gap: '10px',
            fontWeight: 600,
          }}
        >
          <input
            checked={autoSubmit}
            onChange={event => setAutoSubmit(event.target.checked)}
            type="checkbox"
          />
          Queue PromoStandards order submission immediately after creation
        </label>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button type="button" style={secondaryButtonStyle} onClick={() => router.push('/orders')}>
            Cancel
          </button>
          <button type="submit" style={primaryButtonStyle} disabled={submitting || availableVendors.length === 0}>
            {submitting ? 'Creating...' : 'Create Order Integration'}
          </button>
        </div>
      </form>
    </section>
  );
};

export default NewOrderIntegrationPage;
