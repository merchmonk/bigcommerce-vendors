import { GetServerSideProps } from 'next';
import { encodePayload, getBCVerify, setSession } from '../lib/auth';
import logger from '../lib/logger';
import type { SessionProps } from '../types';

/**
 * Build redirect URL with context param for single-click app launch.
 * BC often sends url: "/" — we treat that as "app default" and send users to /vendors.
 */
function buildRedirectUrl(url: string | undefined, encodedContext: string): string {
  const raw = (url && url.trim()) || '';
  const path = raw === '' || raw === '/' ? '/vendors' : raw;
  const [pathOnly, query = ''] = path.split('?');
  const queryParams = new URLSearchParams(`context=${encodedContext}&${query}`);
  return `${pathOnly}?${queryParams}`;
}

/**
 * BigCommerce calls GET /load when a user opens the app in the control panel.
 * We verify the signed_payload_jwt, persist the session, then redirect to the app UI.
 */
export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  try {
    const session = await getBCVerify(query as { signed_payload?: string; signed_payload_jwt?: string });
    const encodedContext = encodePayload(session as SessionProps);
    await setSession(session as SessionProps);

    const redirectUrl = buildRedirectUrl((session as SessionProps & { url?: string }).url, encodedContext);
    logger.info('load page success', { redirectUrl });

    return { redirect: { destination: redirectUrl, permanent: false } };
  } catch (error: unknown) {
    const err = error as { message?: string; response?: { status?: number }; stack?: string };
    logger.error('load page error', {
      message: err?.message,
      stack: err?.stack,
      status: err?.response?.status,
    });
    return { props: { error: err?.message ?? 'Load failed' } };
  }
};

type LoadPageProps = { error?: string };

/**
 * User should never see this on success; we redirect in getServerSideProps.
 * On verification error we show the error message.
 */
export default function LoadPage({ error }: LoadPageProps) {
  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#c00' }}>Could not load app</p>
        <p>{error}</p>
      </div>
    );
  }
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Redirecting to app…</p>
    </div>
  );
}
