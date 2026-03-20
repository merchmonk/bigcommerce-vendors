import type { AppProps } from 'next/app';
import { useEffect } from 'react';
import Header from '../components/header';
import SessionProvider from '../context/session';

const MyApp = ({ Component, pageProps }: AppProps) => {
    useEffect(() => {
        let cancelled = false;

        const initializeRum = async () => {
            try {
                const configResponse = await fetch('/api/observability-config');
                const configPayload = (await configResponse.json()) as {
                    rum?: {
                        appMonitorId?: string | null;
                        identityPoolId?: string | null;
                        guestRoleArn?: string | null;
                        region?: string | null;
                    };
                };
                const appMonitorId = configPayload.rum?.appMonitorId;
                const identityPoolId = configPayload.rum?.identityPoolId;
                const guestRoleArn = configPayload.rum?.guestRoleArn;
                const region = configPayload.rum?.region ?? 'us-east-1';

                if (!appMonitorId || !identityPoolId || !guestRoleArn) {
                    return;
                }

                const { AwsRum, TelemetryEnum } = await import('aws-rum-web');
                if (cancelled || typeof window === 'undefined') {
                    return;
                }

                const rumWindow = window as Window & { __MERCHMONK_RUM__?: unknown };
                if (rumWindow.__MERCHMONK_RUM__) {
                    return;
                }

                rumWindow.__MERCHMONK_RUM__ = new AwsRum(appMonitorId, '1.0.0', region, {
                    allowCookies: true,
                    enableXRay: false,
                    guestRoleArn,
                    identityPoolId,
                    sessionSampleRate: 1,
                    telemetries: [
                        TelemetryEnum.Errors,
                        TelemetryEnum.Performance,
                        TelemetryEnum.Http,
                    ],
                });
            } catch (error) {
                console.warn('cloudwatch rum initialization failed', error);
            }
        };

        void initializeRum();

        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <>
            <div
                style={{
                    margin: '0 auto',
                    maxWidth: '1100px',
                    padding: '24px',
                    fontFamily: 'Arial, sans-serif',
                    color: '#1f2937',
                }}
            >
                <Header />
                <SessionProvider>
                    <Component {...pageProps} />
                </SessionProvider>
            </div>
            <style jsx global>{`
                * {
                    box-sizing: border-box;
                }

                body {
                    margin: 0;
                    background: #f8fafc;
                }

                button,
                input,
                select,
                textarea {
                    font: inherit;
                }

                a {
                    color: inherit;
                }
            `}</style>
        </>
    );
};

export default MyApp;
