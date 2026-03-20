import { Prisma } from '@prisma/client';
import prisma from './prisma';

const LOCK_TIMEOUT_MS = 60 * 60 * 1000;

export async function withExecutionLock<T>(
  lockName: string,
  callback: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  return prisma.$transaction(
    async tx => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_lock(hashtext(${lockName})) AS locked`,
      );
      const locked = rows[0]?.locked === true;
      if (!locked) {
        return { acquired: false } as const;
      }

      try {
        const result = await callback();
        return { acquired: true, result } as const;
      } finally {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(hashtext(${lockName}))`);
      }
    },
    {
      maxWait: 5000,
      timeout: LOCK_TIMEOUT_MS,
    },
  );
}

export async function withVendorExecutionLock<T>(
  vendorId: number,
  callback: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  return withExecutionLock(`vendor:${vendorId}`, callback);
}

export async function withOrderIntegrationExecutionLock<T>(
  orderIntegrationStateId: number,
  callback: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  return withExecutionLock(`order:${orderIntegrationStateId}`, callback);
}
