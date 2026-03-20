import { randomUUID } from 'node:crypto';
import type { IntegrationJobKind } from '../../types';
import { findDueOrderIntegrationStates } from '../etl/repository';
import logger from '../logger';
import { getRequestContext } from '../requestContext';
import { submitOrderLifecycleJob } from '../integrationJobs';

type PollJobKind = Extract<IntegrationJobKind, 'ORDER_STATUS_POLL' | 'ORDER_SHIPMENT_POLL' | 'ORDER_INVOICE_POLL'>;

function getPollField(jobKind: PollJobKind): 'next_status_poll_at' | 'next_shipment_poll_at' | 'next_invoice_poll_at' {
  switch (jobKind) {
    case 'ORDER_STATUS_POLL':
      return 'next_status_poll_at';
    case 'ORDER_SHIPMENT_POLL':
      return 'next_shipment_poll_at';
    case 'ORDER_INVOICE_POLL':
      return 'next_invoice_poll_at';
    default:
      return 'next_status_poll_at';
  }
}

function getSourceAction(jobKind: PollJobKind): string {
  switch (jobKind) {
    case 'ORDER_STATUS_POLL':
      return 'scheduler_status_poll';
    case 'ORDER_SHIPMENT_POLL':
      return 'scheduler_shipment_poll';
    case 'ORDER_INVOICE_POLL':
      return 'scheduler_invoice_poll';
    default:
      return 'scheduler_status_poll';
  }
}

export async function enqueueDueOrderPollJobs(input: {
  jobKind: PollJobKind;
  limit?: number;
}): Promise<{
  queued: number;
  deduplicated: number;
  scanned: number;
}> {
  const dueStates = await findDueOrderIntegrationStates({
    pollField: getPollField(input.jobKind),
    limit: input.limit ?? Number(process.env.ORDER_POLL_SCHEDULER_BATCH_SIZE ?? '100'),
  });
  let queued = 0;
  let deduplicated = 0;

  for (const state of dueStates) {
    const submitted = await submitOrderLifecycleJob({
      vendorId: state.vendor_id,
      orderIntegrationStateId: state.order_integration_state_id,
      jobKind: input.jobKind,
      sourceAction: getSourceAction(input.jobKind),
      correlationId: getRequestContext()?.correlationId ?? randomUUID(),
      requestPayload: {
        scheduled_at: new Date().toISOString(),
      },
    });

    if (submitted.deduplicated) {
      deduplicated += 1;
    } else {
      queued += 1;
    }
  }

  logger.info('due order poll jobs evaluated', {
    jobKind: input.jobKind,
    scanned: dueStates.length,
    queued,
    deduplicated,
  });

  return {
    queued,
    deduplicated,
    scanned: dueStates.length,
  };
}
