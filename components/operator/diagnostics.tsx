import { useState } from 'react';
import type { OperatorTrace } from '../../types';
import {
  InlineNotice,
  pageCardStyle,
  primaryButtonStyle,
  sectionTitleStyle,
} from './ui';

export function formatOperatorDate(value: string | null | undefined): string {
  if (!value) return '—';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

interface SnapshotState {
  loading: boolean;
  error: string;
  traceId: number | null;
  payload: Record<string, unknown> | null;
}

export function OperatorTraceSection(props: {
  traces: OperatorTrace[];
  contextQuery?: string;
}) {
  const [snapshot, setSnapshot] = useState<SnapshotState>({
    loading: false,
    error: '',
    traceId: null,
    payload: null,
  });

  const handleViewSnapshot = async (traceId: number) => {
    setSnapshot({
      loading: true,
      error: '',
      traceId,
      payload: null,
    });

    try {
      const suffix = props.contextQuery ? `?context=${encodeURIComponent(props.contextQuery)}` : '';
      const response = await fetch(`/api/operator-traces/${traceId}/snapshot${suffix}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message ?? 'Failed to load snapshot');
      }

      setSnapshot({
        loading: false,
        error: '',
        traceId,
        payload: payload?.data ?? null,
      });
    } catch (error) {
      setSnapshot({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load snapshot',
        traceId,
        payload: null,
      });
    }
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Trace Timeline</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>When</th>
                <th style={tableHeaderStyle}>Category</th>
                <th style={tableHeaderStyle}>Action</th>
                <th style={tableHeaderStyle}>Target</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={tableHeaderStyle}>Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {props.traces.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={6}>
                    No operator traces were captured for this item.
                  </td>
                </tr>
              ) : (
                props.traces.map(trace => (
                  <tr key={trace.operator_trace_id}>
                    <td style={tableCellStyle}>{formatOperatorDate(trace.created_at)}</td>
                    <td style={tableCellStyle}>{formatTraceCategory(trace.category)}</td>
                    <td style={tableCellStyle}>{trace.action}</td>
                    <td style={tableCellStyle}>{trace.target}</td>
                    <td style={tableCellStyle}>{trace.status_code ?? '—'}</td>
                    <td style={tableCellStyle}>
                      {trace.snapshot_bucket && trace.snapshot_key ? (
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => handleViewSnapshot(trace.operator_trace_id)}
                        >
                          View snapshot
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {snapshot.traceId ? (
        <section style={pageCardStyle}>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={sectionTitleStyle}>Snapshot Payload</h3>
          </div>
          {snapshot.loading ? (
            <div style={{ color: '#475569' }}>Loading snapshot...</div>
          ) : snapshot.error ? (
            <InlineNotice tone="error" title="Unable to load snapshot" description={snapshot.error} />
          ) : (
            <pre
              style={{
                background: '#0f172a',
                borderRadius: '14px',
                color: '#e2e8f0',
                fontSize: '12px',
                margin: 0,
                maxHeight: '480px',
                overflow: 'auto',
                padding: '18px',
              }}
            >
              {JSON.stringify(snapshot.payload ?? {}, null, 2)}
            </pre>
          )}
        </section>
      ) : null}
    </div>
  );
}

function formatTraceCategory(category: OperatorTrace['category']): string {
  switch (category) {
    case 'BIGCOMMERCE_API':
      return 'BigCommerce API';
    case 'VENDOR_API':
      return 'Vendor API';
    case 'INTERNAL_FAILURE':
      return 'Internal Failure';
    default:
      return category;
  }
}

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
