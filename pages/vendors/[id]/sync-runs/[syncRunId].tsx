import { useRouter } from 'next/router';
import useSWR from 'swr';
import ErrorMessage from '../../../../components/error';
import Loading from '../../../../components/loading';
import { OperatorTraceSection, formatOperatorDate } from '../../../../components/operator/diagnostics';
import { InlineNotice, OperatorMetricCard, pageCardStyle, secondaryButtonStyle, sectionTitleStyle } from '../../../../components/operator/ui';
import { useSession } from '../../../../context/session';
import type { EtlSyncRun, OperatorTrace } from '../../../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface SyncRunDiagnosticsResponse {
  syncRun: EtlSyncRun;
  summary: {
    endpointFailures: Array<Record<string, unknown>>;
    blockedProducts: Array<Record<string, unknown>>;
    mediaRetries: Array<Record<string, unknown>>;
    failedItemCount: number;
  };
  traces: OperatorTrace[];
}

const VendorSyncRunDiagnosticsPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const vendorId = Number(router.query.id);
  const syncRunId = Number(router.query.syncRunId);

  const diagnosticsUrl =
    Number.isFinite(vendorId) && Number.isFinite(syncRunId) && context
      ? `/api/vendors/${vendorId}/sync-runs/${syncRunId}?context=${encodeURIComponent(context)}`
      : null;

  const { data, error } = useSWR<SyncRunDiagnosticsResponse>(diagnosticsUrl, fetcher);

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const { syncRun, summary, traces } = data;

  return (
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
            <h2 style={sectionTitleStyle}>Sync Run #{syncRun.sync_run_id}</h2>
            <p style={{ color: '#475569', margin: '8px 0 0' }}>
              Review endpoint failures, blocked items, retry markers, and related traces for this vendor sync run.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/vendors/${vendorId}`)}
            style={secondaryButtonStyle}
          >
            Back to Vendor
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <OperatorMetricCard label="Status" value={syncRun.status} />
          <OperatorMetricCard label="Records Read" value={String(syncRun.records_read)} />
          <OperatorMetricCard label="Records Written" value={String(syncRun.records_written)} />
          <OperatorMetricCard label="Failed Items" value={String(summary.failedItemCount)} />
          <OperatorMetricCard label="Started" value={formatOperatorDate(syncRun.started_at)} />
          <OperatorMetricCard label="Ended" value={formatOperatorDate(syncRun.ended_at)} />
        </div>
      </section>

      {syncRun.error_message ? (
        <InlineNotice tone="error" title="Sync run error" description={syncRun.error_message} />
      ) : null}

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Endpoint Failures</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Endpoint</th>
                <th style={tableHeaderStyle}>Version</th>
                <th style={tableHeaderStyle}>Operation</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={tableHeaderStyle}>Message</th>
              </tr>
            </thead>
            <tbody>
              {summary.endpointFailures.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No endpoint failures were recorded for this run.
                  </td>
                </tr>
              ) : (
                summary.endpointFailures.map((failure, index) => (
                  <tr key={`${failure.mapping_id ?? index}-${index}`}>
                    <td style={tableCellStyle}>{String(failure.endpoint_name ?? 'Unknown')}</td>
                    <td style={tableCellStyle}>{String(failure.endpoint_version ?? '—')}</td>
                    <td style={tableCellStyle}>{String(failure.operation_name ?? '—')}</td>
                    <td style={tableCellStyle}>{String(failure.status ?? '—')}</td>
                    <td style={tableCellStyle}>{String(failure.message ?? '—')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Blocked Products</h3>
        </div>
        <div style={{ display: 'grid', gap: '12px' }}>
          {summary.blockedProducts.length === 0 ? (
            <div style={{ color: '#475569' }}>No blocked products were recorded for this run.</div>
          ) : (
            summary.blockedProducts.map((item, index) => {
              const gatingReasons = Array.isArray(item.gating_reasons)
                ? item.gating_reasons.map(reason => String(reason)).join(', ')
                : 'Unknown gating reason';

              return (
                <div
                  key={`${item.sku ?? 'blocked'}-${index}`}
                  style={{
                    border: '1px solid #dbe3ef',
                    borderRadius: '14px',
                    padding: '16px',
                  }}
                >
                  <div style={{ color: '#0f172a', fontWeight: 700 }}>{String(item.sku ?? 'Unknown SKU')}</div>
                  {item.vendor_product_id ? (
                    <div style={{ color: '#64748b', marginTop: '4px' }}>
                      Vendor Product ID: {String(item.vendor_product_id)}
                    </div>
                  ) : null}
                  <div style={{ color: '#334155', marginTop: '10px' }}>{gatingReasons}</div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Media Retry Markers</h3>
        </div>
        <div style={{ display: 'grid', gap: '12px' }}>
          {summary.mediaRetries.length === 0 ? (
            <div style={{ color: '#475569' }}>No media retries were recorded for this run.</div>
          ) : (
            summary.mediaRetries.map((item, index) => (
              <div
                key={`${item.vendor_product_id ?? item.sku ?? 'media'}-${index}`}
                style={{
                  border: '1px solid #dbe3ef',
                  borderRadius: '14px',
                  padding: '16px',
                }}
              >
                <div style={{ color: '#0f172a', fontWeight: 700 }}>{String(item.sku ?? 'Unknown SKU')}</div>
                <div style={{ color: '#64748b', marginTop: '4px' }}>
                  Vendor Product ID: {String(item.vendor_product_id ?? '—')}
                </div>
                <div style={{ color: '#334155', marginTop: '10px' }}>{String(item.message ?? 'Media retry created')}</div>
              </div>
            ))
          )}
        </div>
      </section>

      <OperatorTraceSection
        traces={traces}
        contextQuery={context}
      />
    </div>
  );
};

const tableHeaderStyle: React.CSSProperties = {
  borderBottom: '1px solid #dbe3ef',
  padding: '12px 14px',
  textAlign: 'left',
};

const tableCellStyle: React.CSSProperties = {
  borderBottom: '1px solid #eef2f7',
  color: '#334155',
  padding: '14px',
  verticalAlign: 'top',
};

export default VendorSyncRunDiagnosticsPage;
