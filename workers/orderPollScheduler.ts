import { randomUUID } from 'node:crypto';
import { enqueueDueOrderPollJobs } from '../lib/orders/orderScheduler';
import logger from '../lib/logger';
import { runWithRequestContext } from '../lib/requestContext';

interface OrderPollSchedulerEvent {
  pollKind?: 'ORDER_STATUS_POLL' | 'ORDER_SHIPMENT_POLL' | 'ORDER_INVOICE_POLL';
}

function resolvePollKind(value: string | undefined): 'ORDER_STATUS_POLL' | 'ORDER_SHIPMENT_POLL' | 'ORDER_INVOICE_POLL' {
  if (value === 'ORDER_STATUS_POLL' || value === 'ORDER_SHIPMENT_POLL' || value === 'ORDER_INVOICE_POLL') {
    return value;
  }

  throw new Error(`Unsupported order poll kind "${value ?? 'undefined'}".`);
}

export async function handler(event: OrderPollSchedulerEvent): Promise<{
  pollKind: string;
  queued: number;
  deduplicated: number;
  scanned: number;
}> {
  const pollKind = resolvePollKind(event.pollKind);
  const correlationId = randomUUID();

  return runWithRequestContext(
    {
      correlationId,
      source: 'scheduler',
      path: 'workers/orderPollScheduler',
    },
    async () => {
      logger.info('running order poll scheduler', {
        pollKind,
      });

      const result = await enqueueDueOrderPollJobs({
        jobKind: pollKind,
      });

      return {
        pollKind,
        ...result,
      };
    },
  );
}
