import type {
  DashboardRecentFailureItem,
  DashboardRecentSyncItem,
  IntegrationJobStatus,
  OperatorDashboardSummary,
  SyncRunStatus,
  VendorOperatorSummary,
  VendorOperationalStatus,
} from '../../types';
import prisma from '../prisma';
import { listVendors } from '../vendors';
import { getCustomApiServiceTypeLabel, getVendorConnectionSections } from './vendorConfig';

export function deriveVendorOperationalStatus(input: {
  is_active: boolean;
  hasActiveJob: boolean;
  latestSyncRunStatus: SyncRunStatus | null;
  latestJobTerminalStatus: IntegrationJobStatus | null;
}): VendorOperationalStatus {
  if (!input.is_active) {
    return 'DEACTIVATED';
  }

  if (input.hasActiveJob) {
    return 'SYNCING';
  }

  if (input.latestJobTerminalStatus === 'FAILED' || input.latestJobTerminalStatus === 'DEAD_LETTERED') {
    return 'SYNC_FAILED';
  }

  if (input.latestSyncRunStatus === 'FAILED') {
    return 'SYNC_FAILED';
  }

  return 'SYNCED';
}

export function calculateVendorHealthPercent(input: {
  successfulSyncs: number;
  failedSyncs: number;
}): number | null {
  const completedSyncs = input.successfulSyncs + input.failedSyncs;
  if (completedSyncs === 0) {
    return null;
  }

  return Math.round((input.successfulSyncs / completedSyncs) * 100);
}

function getTerminalJobStatus(status: IntegrationJobStatus): IntegrationJobStatus | null {
  if (status === 'FAILED' || status === 'DEAD_LETTERED' || status === 'SUCCEEDED' || status === 'CANCELLED') {
    return status;
  }

  return null;
}

export async function countVendorActiveProducts(vendorId: number): Promise<number> {
  return prisma.vendorProductMap.count({
    where: {
      vendor_id: vendorId,
      bigcommerce_product_id: {
        not: null,
      },
    },
  });
}

export async function assertVendorCanDeactivate(vendorId: number): Promise<void> {
  const activeProductCount = await countVendorActiveProducts(vendorId);
  if (activeProductCount > 0) {
    const error = new Error(
      `This vendor still has ${activeProductCount} active synced product${activeProductCount === 1 ? '' : 's'} and cannot be deactivated.`,
    ) as Error & { statusCode?: number };
    error.statusCode = 409;
    throw error;
  }
}

export async function listVendorOperatorSummaries(includeInactive = true): Promise<VendorOperatorSummary[]> {
  const vendors = await listVendors(includeInactive);
  if (vendors.length === 0) {
    return [];
  }

  const vendorIds = vendors.map(vendor => vendor.vendor_id);

  const [
    totalProductCounts,
    activeProductCounts,
    completedSyncCounts,
    syncRuns,
    jobs,
  ] = await Promise.all([
    prisma.vendorProductMap.groupBy({
      by: ['vendor_id'],
      where: {
        vendor_id: {
          in: vendorIds,
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.vendorProductMap.groupBy({
      by: ['vendor_id'],
      where: {
        vendor_id: {
          in: vendorIds,
        },
        bigcommerce_product_id: {
          not: null,
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.etlSyncRun.groupBy({
      by: ['vendor_id', 'status'],
      where: {
        vendor_id: {
          in: vendorIds,
        },
        status: {
          in: ['SUCCESS', 'FAILED'],
        },
      },
      _count: {
        _all: true,
      },
    }),
    prisma.etlSyncRun.findMany({
      where: {
        vendor_id: {
          in: vendorIds,
        },
      },
      orderBy: {
        started_at: 'desc',
      },
      select: {
        vendor_id: true,
        status: true,
        ended_at: true,
        started_at: true,
      },
    }),
    prisma.integrationJob.findMany({
      where: {
        vendor_id: {
          in: vendorIds,
        },
      },
      orderBy: {
        submitted_at: 'desc',
      },
      select: {
        vendor_id: true,
        status: true,
      },
    }),
  ]);

  const totalProductsByVendor = new Map<number, number>();
  for (const row of totalProductCounts) {
    totalProductsByVendor.set(row.vendor_id, row._count._all);
  }

  const activeProductsByVendor = new Map<number, number>();
  for (const row of activeProductCounts) {
    activeProductsByVendor.set(row.vendor_id, row._count._all);
  }

  const syncStatsByVendor = new Map<number, { successful: number; failed: number }>();
  for (const row of completedSyncCounts) {
    const existing = syncStatsByVendor.get(row.vendor_id) ?? { successful: 0, failed: 0 };
    if (row.status === 'SUCCESS') {
      existing.successful = row._count._all;
    }
    if (row.status === 'FAILED') {
      existing.failed = row._count._all;
    }
    syncStatsByVendor.set(row.vendor_id, existing);
  }

  const latestSyncByVendor = new Map<number, { status: SyncRunStatus; ended_at: string | null }>();
  for (const run of syncRuns) {
    if (latestSyncByVendor.has(run.vendor_id)) continue;
    latestSyncByVendor.set(run.vendor_id, {
      status: run.status as SyncRunStatus,
      ended_at: run.ended_at ? run.ended_at.toISOString() : run.started_at.toISOString(),
    });
  }

  const hasActiveJobByVendor = new Set<number>();
  const latestTerminalJobStatusByVendor = new Map<number, IntegrationJobStatus>();
  for (const job of jobs) {
    if (job.status === 'PENDING' || job.status === 'ENQUEUED' || job.status === 'RUNNING' || job.status === 'CANCEL_REQUESTED') {
      hasActiveJobByVendor.add(job.vendor_id);
      continue;
    }

    if (!latestTerminalJobStatusByVendor.has(job.vendor_id)) {
      const terminalStatus = getTerminalJobStatus(job.status as IntegrationJobStatus);
      if (terminalStatus) {
        latestTerminalJobStatusByVendor.set(job.vendor_id, terminalStatus);
      }
    }
  }

  return vendors.map(vendor => {
    const sections = getVendorConnectionSections(vendor.connection_config);
    const syncStats = syncStatsByVendor.get(vendor.vendor_id) ?? { successful: 0, failed: 0 };
    const totalProducts = totalProductsByVendor.get(vendor.vendor_id) ?? 0;
    const activeProducts = activeProductsByVendor.get(vendor.vendor_id) ?? 0;
    const latestSync = latestSyncByVendor.get(vendor.vendor_id);
    const vendorStatus = deriveVendorOperationalStatus({
      is_active: vendor.is_active,
      hasActiveJob: hasActiveJobByVendor.has(vendor.vendor_id),
      latestSyncRunStatus: latestSync?.status ?? null,
      latestJobTerminalStatus: latestTerminalJobStatusByVendor.get(vendor.vendor_id) ?? null,
    });

    return {
      vendor_id: vendor.vendor_id,
      vendor_name: vendor.vendor_name,
      vendor_type: vendor.vendor_type,
      integration_family: vendor.integration_family,
      api_protocol: vendor.api_protocol,
      is_active: vendor.is_active,
      datetime_added: vendor.datetime_added,
      datetime_modified: vendor.datetime_modified,
      vendor_status: vendorStatus,
      api_type_label:
        vendor.integration_family === 'PROMOSTANDARDS'
          ? 'PromoStandards'
          : getCustomApiServiceTypeLabel(sections.custom_api?.service_type),
      health_percent: calculateVendorHealthPercent({
        successfulSyncs: syncStats.successful,
        failedSyncs: syncStats.failed,
      }),
      total_products_synced: totalProducts,
      total_products_active: activeProducts,
      last_synced_at: latestSync?.ended_at ?? null,
      can_deactivate: activeProducts === 0,
    };
  });
}

export async function getOperatorDashboardSummary(): Promise<OperatorDashboardSummary> {
  const vendorSummaries = await listVendorOperatorSummaries(true);
  const [recentSyncs, recentFailures] = await Promise.all([
    prisma.etlSyncRun.findMany({
      orderBy: {
        started_at: 'desc',
      },
      take: 12,
      include: {
        vendor: true,
      },
    }),
    prisma.integrationJob.findMany({
      where: {
        status: {
          in: ['FAILED', 'DEAD_LETTERED'],
        },
      },
      orderBy: {
        submitted_at: 'desc',
      },
      take: 8,
      include: {
        vendor: true,
      },
    }),
  ]);

  const totals = vendorSummaries.reduce(
    (summary, vendor) => {
      summary.vendors += 1;
      summary.active_products += vendor.total_products_active;

      if (vendor.vendor_status === 'SYNCING') summary.syncing += 1;
      if (vendor.vendor_status === 'SYNCED') summary.synced += 1;
      if (vendor.vendor_status === 'SYNC_FAILED') summary.sync_failed += 1;
      if (vendor.vendor_status === 'DEACTIVATED') summary.deactivated += 1;

      return summary;
    },
    {
      vendors: 0,
      syncing: 0,
      synced: 0,
      sync_failed: 0,
      deactivated: 0,
      active_products: 0,
    },
  );

  const normalizedRecentSyncs: DashboardRecentSyncItem[] = recentSyncs.map(run => ({
    etl_sync_run_id: Number(run.etl_sync_run_id),
    vendor_id: run.vendor_id,
    vendor_name: run.vendor.vendor_name,
    status: run.status,
    sync_scope: run.sync_scope,
    records_read: run.records_read,
    records_written: run.records_written,
    started_at: run.started_at.toISOString(),
    ended_at: run.ended_at ? run.ended_at.toISOString() : null,
    error_message: run.error_message,
  }));

  const normalizedFailures: DashboardRecentFailureItem[] = recentFailures.map(job => ({
    integration_job_id: Number(job.integration_job_id),
    vendor_id: job.vendor_id,
    vendor_name: job.vendor.vendor_name,
    status: job.status,
    submitted_at: job.submitted_at.toISOString(),
    last_error: job.last_error,
  }));

  return {
    totals,
    recent_syncs: normalizedRecentSyncs,
    recent_failures: normalizedFailures,
  };
}
