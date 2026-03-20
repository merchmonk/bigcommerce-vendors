import { GetAppMonitorCommand } from '@aws-sdk/client-rum';
import type { NextApiRequest, NextApiResponse } from 'next';
import { getRumClient } from '../../lib/awsClients';
import logger from '../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

let rumAppMonitorIdLookup: Promise<string | null> | null = null;

async function resolveRumAppMonitorId(): Promise<string | null> {
  const configuredAppMonitorId = process.env.NEXT_PUBLIC_CLOUDWATCH_RUM_APP_MONITOR_ID ?? null;
  if (configuredAppMonitorId) {
    return configuredAppMonitorId;
  }

  const appMonitorName = process.env.CLOUDWATCH_RUM_APP_MONITOR_NAME;
  if (!appMonitorName) {
    return null;
  }

  if (!rumAppMonitorIdLookup) {
    rumAppMonitorIdLookup = getRumClient()
      .send(new GetAppMonitorCommand({ Name: appMonitorName }))
      .then(response => response.AppMonitor?.Id ?? null)
      .catch((error) => {
        rumAppMonitorIdLookup = null;
        throw error;
      });
  }

  try {
    return await rumAppMonitorIdLookup;
  } catch (error) {
    logger.warn('cloudwatch rum app monitor lookup failed', {
      errorMessage: error instanceof Error ? error.message : 'unknown error',
      appMonitorName,
    });
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('observability config API request');
    const appMonitorId = await resolveRumAppMonitorId();

    res.status(200).json({
      rum: {
        appMonitorId,
        identityPoolId: process.env.NEXT_PUBLIC_CLOUDWATCH_RUM_IDENTITY_POOL_ID ?? null,
        guestRoleArn: process.env.NEXT_PUBLIC_CLOUDWATCH_RUM_GUEST_ROLE_ARN ?? null,
        region: process.env.NEXT_PUBLIC_AWS_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
      },
    });
  });
}
