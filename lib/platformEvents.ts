import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getEventBridgeClient } from './awsClients';
import logger from './logger';
import { getRequestContext } from './requestContext';
import { redactValue } from './telemetry';

export interface PlatformEventInput {
  detailType: string;
  detail: Record<string, unknown>;
  source?: string;
}

function getEventBusName(): string | undefined {
  return process.env.COMMERCE_PLATFORM_EVENT_BUS_NAME;
}

export async function publishPlatformEvent(input: PlatformEventInput): Promise<void> {
  const eventBusName = getEventBusName();
  if (!eventBusName || process.env.NODE_ENV === 'test') {
    return;
  }

  const context = getRequestContext();
  await getEventBridgeClient().send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: eventBusName,
          Source: input.source ?? 'merchmonk.bigcommerce-vendors',
          DetailType: input.detailType,
          Detail: JSON.stringify(
            redactValue({
              correlation_id: context?.correlationId,
              vendor_id: context?.vendorId,
              integration_job_id: context?.integrationJobId,
              ...input.detail,
            }),
          ),
        },
      ],
    }),
  );
  logger.info('platform event published', {
    detailType: input.detailType,
    eventBusName,
  });
}
