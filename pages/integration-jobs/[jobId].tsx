import { useRouter } from 'next/router';
import useSWR from 'swr';
import ErrorMessage from '../../components/error';
import Loading from '../../components/loading';
import { OperatorTraceSection, formatOperatorDate } from '../../components/operator/diagnostics';
import { InlineNotice, OperatorMetricCard, pageCardStyle, secondaryButtonStyle, sectionTitleStyle } from '../../components/operator/ui';
import { useSession } from '../../context/session';
import type { IntegrationJob, IntegrationJobEvent, OperatorTrace } from '../../types';

const fetcher = (url: string) => fetch(url).then(res => res.json());

interface IntegrationJobDiagnosticsResponse {
  job: IntegrationJob;
  events: IntegrationJobEvent[];
  traces: OperatorTrace[];
}

const IntegrationJobDiagnosticsPage = () => {
  const router = useRouter();
  const { context } = useSession();
  const jobId = Number(router.query.jobId);

  const diagnosticsUrl =
    Number.isFinite(jobId) && context
      ? `/api/integration-jobs/${jobId}?context=${encodeURIComponent(context)}`
      : null;

  const { data, error } = useSWR<IntegrationJobDiagnosticsResponse>(diagnosticsUrl, fetcher);

  if (!data && !error) return <Loading />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  const { job, events, traces } = data;

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
            <h2 style={sectionTitleStyle}>Integration Job #{job.integration_job_id}</h2>
            <p style={{ color: '#475569', margin: '8px 0 0' }}>
              Review job lifecycle events, failure details, and trace activity for this sync execution.
            </p>
          </div>
          <button type="button" onClick={() => router.back()} style={secondaryButtonStyle}>
            Back
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gap: '16px',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}
        >
          <OperatorMetricCard label="Status" value={job.status} />
          <OperatorMetricCard label="Attempts" value={String(job.attempt_count)} />
          <OperatorMetricCard label="Source Action" value={job.source_action} />
          <OperatorMetricCard label="Vendor ID" value={String(job.vendor_id)} />
          <OperatorMetricCard label="Submitted" value={formatOperatorDate(job.submitted_at)} />
          <OperatorMetricCard label="Correlation ID" value={job.correlation_id} />
        </div>
      </section>

      {job.last_error ? (
        <InlineNotice tone="error" title="Latest job error" description={job.last_error} />
      ) : null}

      <section style={pageCardStyle}>
        <div style={{ marginBottom: '18px' }}>
          <h3 style={sectionTitleStyle}>Job Timeline</h3>
        </div>
        <div style={{ display: 'grid', gap: '12px' }}>
          {events.length === 0 ? (
            <div style={{ color: '#475569' }}>No job events were recorded for this job.</div>
          ) : (
            events.map(event => (
              <div
                key={event.integration_job_event_id}
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
                  <div style={{ color: '#0f172a', fontWeight: 700 }}>{event.event_name}</div>
                  <div style={{ color: '#64748b', fontSize: '13px' }}>{formatOperatorDate(event.created_at)}</div>
                </div>
                <div style={{ color: event.level === 'error' ? '#b91c1c' : '#475569', marginTop: '8px' }}>
                  Level: {event.level}
                </div>
                {Object.keys(event.payload ?? {}).length > 0 ? (
                  <pre
                    style={{
                      background: '#f8fafc',
                      borderRadius: '12px',
                      color: '#334155',
                      fontSize: '12px',
                      margin: '12px 0 0',
                      overflow: 'auto',
                      padding: '14px',
                    }}
                  >
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>

      <OperatorTraceSection traces={traces} contextQuery={context} />
    </div>
  );
};

export default IntegrationJobDiagnosticsPage;
