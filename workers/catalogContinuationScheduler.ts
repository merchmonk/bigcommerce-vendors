import { randomUUID } from 'node:crypto';
import { enqueuePendingCatalogContinuationJobs } from '../lib/etl/catalogContinuationScheduler';
import logger from '../lib/logger';
import { runWithRequestContext } from '../lib/requestContext';

export async function handler(): Promise<{
  queued: number;
  deduplicated: number;
  skipped: number;
  scanned: number;
}> {
  const correlationId = randomUUID();

  return runWithRequestContext(
    {
      correlationId,
      source: 'scheduler',
      path: 'workers/catalogContinuationScheduler',
    },
    async () => {
      logger.info('running catalog continuation scheduler');
      return enqueuePendingCatalogContinuationJobs();
    },
  );
}
