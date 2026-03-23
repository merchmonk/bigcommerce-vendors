import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

interface VendorSyncPanelProps {
  vendorId: number;
  context: string;
}

interface VendorMappingRow {
  vendor_endpoint_mapping_id: number;
  vendor_id: number;
  mapping_id: number;
  is_enabled: boolean;
  mapping: {
    endpoint_name: string;
    endpoint_version: string;
    operation_name: string;
    is_product_endpoint: boolean;
  } | null;
}

interface SyncRunRow {
  sync_run_id: number;
  status: string;
  sync_scope: string;
  records_read: number;
  records_written: number;
  error_message?: string | null;
  started_at: string;
  ended_at?: string | null;
}

interface ActiveJobRow {
  integration_job_id: number;
  status: string;
  sync_scope: string;
  mapping_id: number | null;
  submitted_at: string;
}

const fetcher = (url: string) => fetch(url).then(res => res.json());

const panelStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  marginTop: '20px',
  padding: '24px',
  fontFamily: 'Helvetica, Arial, sans-serif',
  fontSize: '11px',
};

const primaryButtonStyle: React.CSSProperties = {
  background: '#2563eb',
  border: 'none',
  borderRadius: '8px',
  color: '#ffffff',
  cursor: 'pointer',
  padding: '10px 14px',
};

const subtleButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  cursor: 'pointer',
  padding: '8px 12px',
};

export const vendorSyncPanelSwrOptions = {
  refreshInterval: 0,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
} as const;

const VendorSyncPanel = ({ vendorId, context }: VendorSyncPanelProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const withContext = (path: string) => `${path}?context=${encodeURIComponent(context)}`;
  const mappingsUrl = `/api/vendors/${vendorId}/mappings?context=${encodeURIComponent(context)}`;
  const runsUrl = `/api/vendors/${vendorId}/sync?context=${encodeURIComponent(context)}`;
  const { data: mappingsData, mutate: mutateMappings } = useSWR<{ data: VendorMappingRow[] }>(
    mappingsUrl,
    fetcher,
    vendorSyncPanelSwrOptions,
  );
  const { data: runsData, mutate: mutateRuns } = useSWR<{ data: SyncRunRow[]; active_job?: ActiveJobRow | null }>(
    runsUrl,
    fetcher,
    vendorSyncPanelSwrOptions,
  );

  const runSync = async (body: { mapping_id?: number; sync_all?: boolean }) => {
    setIsSubmitting(true);
    try {
      await fetch(runsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await Promise.all([mutateMappings(), mutateRuns()]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const cancelActiveSync = async () => {
    if (!runsData?.active_job) return;
    setIsSubmitting(true);
    try {
      await fetch(runsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancel',
          integration_job_id: runsData.active_job.integration_job_id,
        }),
      });
      await Promise.all([mutateMappings(), mutateRuns()]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const mappings = mappingsData?.data ?? [];
  const runs = runsData?.data ?? [];
  const activeJob = runsData?.active_job ?? null;
  const hasActiveSync = Boolean(
    activeJob && ['PENDING', 'ENQUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(activeJob.status),
  );

  return (
    <section style={panelStyle}>
      <h3 style={{ marginTop: 0 }}>Vendor ETL Sync</h3>
      {activeJob ? (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #dbe3ef',
            borderRadius: '10px',
            color: '#334155',
            marginBottom: '16px',
            padding: '12px 14px',
          }}
        >
          Active job{' '}
          <Link href={withContext(`/integration-jobs/${activeJob.integration_job_id}`)} style={tableLinkStyle}>
            #{activeJob.integration_job_id}
          </Link>{' '}
          is <strong>{activeJob.status}</strong>.
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <button
          type="button"
          style={primaryButtonStyle}
          onClick={() => runSync({ sync_all: true })}
          disabled={Boolean(hasActiveSync) || isSubmitting}
        >
          Run All Product ETLs
        </button>
        {hasActiveSync ? (
          <button
            type="button"
            style={subtleButtonStyle}
            onClick={cancelActiveSync}
            disabled={isSubmitting}
          >
            {activeJob?.status === 'CANCEL_REQUESTED' ? 'Cancellation Requested' : 'Cancel Active Sync'}
          </button>
        ) : null}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h4>Endpoint ETLs</h4>
        {mappings.length === 0 ? (
          <div style={{ color: '#6b7280' }}>No endpoint mappings assigned.</div>
        ) : (
          mappings
            .filter(row => row.mapping?.is_product_endpoint)
            .map(row => (
              <div
                key={row.vendor_endpoint_mapping_id}
                style={{
                  alignItems: 'center',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                }}
              >
                <div>
                  <strong>{row.mapping?.endpoint_name}</strong> v{row.mapping?.endpoint_version} ({row.mapping?.operation_name || 'default'})
                </div>
                <button
                  type="button"
                  style={subtleButtonStyle}
                  onClick={() => runSync({ mapping_id: row.mapping_id })}
                  disabled={Boolean(hasActiveSync) || isSubmitting}
                >
                  Run Endpoint ETL
                </button>
              </div>
            ))
        )}
      </div>

      <div>
        <h4>Recent Sync Runs</h4>
        {runs.length === 0 ? (
          <div style={{ color: '#6b7280' }}>No sync runs yet.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Run</th>
                <th style={tableHeaderStyle}>Scope</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={tableHeaderStyle}>Read</th>
                <th style={tableHeaderStyle}>Written</th>
                <th style={tableHeaderStyle}>Diagnostics</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 10).map(run => (
                <tr key={run.sync_run_id}>
                  <td style={tableCellStyle}>
                    <Link
                      href={withContext(`/vendors/${vendorId}/sync-runs/${run.sync_run_id}`)}
                      style={tableLinkStyle}
                    >
                      #{run.sync_run_id}
                    </Link>
                  </td>
                  <td style={tableCellStyle}>{run.sync_scope}</td>
                  <td style={tableCellStyle}>{run.status}</td>
                  <td style={tableCellStyle}>{run.records_read}</td>
                  <td style={tableCellStyle}>{run.records_written}</td>
                  <td style={tableCellStyle}>
                    <Link
                      href={withContext(`/vendors/${vendorId}/sync-runs/${run.sync_run_id}`)}
                      style={tableLinkStyle}
                    >
                      View diagnostics
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};

const tableHeaderStyle: React.CSSProperties = {
  borderBottom: '1px solid #d1d5db',
  padding: '8px',
  textAlign: 'left',
};

const tableCellStyle: React.CSSProperties = {
  borderBottom: '1px solid #e5e7eb',
  padding: '8px',
  overflow: 'visible',
};

const tableLinkStyle: React.CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
  textDecoration: 'none',
};

export default VendorSyncPanel;
