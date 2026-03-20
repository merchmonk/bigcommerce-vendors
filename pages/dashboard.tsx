import useSWR from 'swr';
import Link from 'next/link';
import ErrorMessage from '../components/error';
import Loading from '../components/loading';
import { OperatorMetricCard, pageCardStyle, sectionTitleStyle } from '../components/operator/ui';
import { useSession } from '../context/session';
import type { OperatorDashboardSummary } from '../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

const DashboardPage = () => {
  const { context } = useSession();
  const { data, error } = useSWR<{ data: OperatorDashboardSummary }>(
    context ? `/api/dashboard/summary?context=${encodeURIComponent(context)}` : null,
    fetcher,
    {
      refreshInterval: 10000,
    },
  );

  const summary = data?.data;

  if (!summary && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!summary) return null;

  return (
    <div style={{ display: 'grid', gap: '24px' }}>
      <section style={pageCardStyle}>
        <div style={{ marginBottom: '22px' }}>
          <h2 style={sectionTitleStyle}>Sync, Health, and History Dashboard</h2>
          <p style={{ color: '#475569', margin: '8px 0 0' }}>
            Monitor vendor health, active sync activity, recent failures, and synced product coverage.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <OperatorMetricCard label="Total Vendors" value={String(summary.totals.vendors)} />
          <OperatorMetricCard label="Syncing" value={String(summary.totals.syncing)} />
          <OperatorMetricCard label="Healthy" value={String(summary.totals.synced)} />
          <OperatorMetricCard label="Failed" value={String(summary.totals.sync_failed)} />
          <OperatorMetricCard label="Deactivated" value={String(summary.totals.deactivated)} />
          <OperatorMetricCard label="Active Products" value={String(summary.totals.active_products)} />
        </div>
      </section>

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Recent Sync History</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Vendor</th>
                <th style={tableHeaderStyle}>Run</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={tableHeaderStyle}>Scope</th>
                <th style={tableHeaderStyle}>Records</th>
                <th style={tableHeaderStyle}>Started</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent_syncs.map(run => (
                <tr key={run.sync_run_id}>
                  <td style={tableCellStyle}>
                    <Link href={`/vendors/${run.vendor_id}`} style={tableLinkStyle}>
                      {run.vendor_name}
                    </Link>
                  </td>
                  <td style={tableCellStyle}>
                    <Link href={`/vendors/${run.vendor_id}/sync-runs/${run.sync_run_id}`} style={tableLinkStyle}>
                      #{run.sync_run_id}
                    </Link>
                  </td>
                  <td style={tableCellStyle}>{run.status}</td>
                  <td style={tableCellStyle}>{run.sync_scope}</td>
                  <td style={tableCellStyle}>
                    {run.records_written} written / {run.records_read} read
                  </td>
                  <td style={tableCellStyle}>{formatDate(run.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Recent Failures</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle}>Vendor</th>
                <th style={tableHeaderStyle}>Job</th>
                <th style={tableHeaderStyle}>Status</th>
                <th style={tableHeaderStyle}>Submitted</th>
                <th style={tableHeaderStyle}>Error</th>
              </tr>
            </thead>
            <tbody>
              {summary.recent_failures.length === 0 ? (
                <tr>
                  <td style={tableCellStyle} colSpan={5}>
                    No recent failed jobs.
                  </td>
                </tr>
              ) : (
                summary.recent_failures.map(job => (
                  <tr key={job.integration_job_id}>
                    <td style={tableCellStyle}>
                      <Link href={`/vendors/${job.vendor_id}`} style={tableLinkStyle}>
                        {job.vendor_name}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>
                      <Link href={`/integration-jobs/${job.integration_job_id}`} style={tableLinkStyle}>
                        #{job.integration_job_id}
                      </Link>
                    </td>
                    <td style={tableCellStyle}>{job.status}</td>
                    <td style={tableCellStyle}>{formatDate(job.submitted_at)}</td>
                    <td style={tableCellStyle}>{job.last_error ?? 'Unknown failure'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
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
};

const tableLinkStyle: React.CSSProperties = {
  color: '#0f766e',
  fontWeight: 700,
  textDecoration: 'none',
};

export default DashboardPage;
