import type {
  IntegrationJobStatus,
  OrderIntegrationState,
  OrderLifecycleStatus,
} from '../../types';
import prisma from '../prisma';
import { getVendorById } from '../vendors';
import {
  listIntegrationJobsForOrderIntegrationState,
  listOperatorTraces,
} from '../etl/repository';
import { listVendorResolvedOrderCapabilities } from './orderCapabilityResolver';

export interface OrderOperatorSummary {
  order_integration_state_id: number;
  vendor_id: number;
  vendor_name: string;
  external_order_id: string;
  purchase_order_number: string;
  sales_order_number: string | null;
  order_type: string | null;
  lifecycle_status: OrderLifecycleStatus;
  status_label: string | null;
  shipment_status: string | null;
  invoice_status: string | null;
  submitted_at: string | null;
  next_status_poll_at: string | null;
  next_shipment_poll_at: string | null;
  next_invoice_poll_at: string | null;
  last_error: string | null;
  has_active_job: boolean;
  latest_job_status: IntegrationJobStatus | null;
  updated_at: string;
}

function serializeSummary(
  state: OrderIntegrationState,
  vendorName: string,
  input: {
    hasActiveJob: boolean;
    latestJobStatus: IntegrationJobStatus | null;
  },
): OrderOperatorSummary {
  return {
    order_integration_state_id: state.order_integration_state_id,
    vendor_id: state.vendor_id,
    vendor_name: vendorName,
    external_order_id: state.external_order_id,
    purchase_order_number: state.purchase_order_number,
    sales_order_number: state.sales_order_number,
    order_type: state.order_type,
    lifecycle_status: state.lifecycle_status,
    status_label: state.status_label,
    shipment_status: state.shipment_status,
    invoice_status: state.invoice_status,
    submitted_at: state.submitted_at,
    next_status_poll_at: state.next_status_poll_at,
    next_shipment_poll_at: state.next_shipment_poll_at,
    next_invoice_poll_at: state.next_invoice_poll_at,
    last_error: state.last_error,
    has_active_job: input.hasActiveJob,
    latest_job_status: input.latestJobStatus,
    updated_at: state.updated_at,
  };
}

function getTerminalJobStatus(status: IntegrationJobStatus): IntegrationJobStatus | null {
  if (status === 'FAILED' || status === 'DEAD_LETTERED' || status === 'SUCCEEDED' || status === 'CANCELLED') {
    return status;
  }

  return null;
}

export async function listOrderOperatorSummaries(vendorId?: number): Promise<OrderOperatorSummary[]> {
  const rows = await prisma.orderIntegrationState.findMany({
    where: {
      vendor_id: vendorId,
    },
    orderBy: [
      { updated_at: 'desc' },
      { order_integration_state_id: 'desc' },
    ],
  });

  if (rows.length === 0) {
    return [];
  }

  const vendorIds = Array.from(new Set(rows.map(row => row.vendor_id)));
  const [vendors, jobs] = await Promise.all([
    prisma.vendor.findMany({
      where: {
        vendor_id: {
          in: vendorIds,
        },
      },
      select: {
        vendor_id: true,
        vendor_name: true,
      },
    }),
    prisma.integrationJob.findMany({
      where: {
        order_integration_state_id: {
          in: rows.map(row => row.order_integration_state_id),
        },
      },
      orderBy: {
        submitted_at: 'desc',
      },
      select: {
        order_integration_state_id: true,
        status: true,
      },
    }),
  ]);

  const vendorNameById = new Map(vendors.map(vendor => [vendor.vendor_id, vendor.vendor_name]));
  const activeJobsByOrder = new Set<number>();
  const latestJobStatusByOrder = new Map<number, IntegrationJobStatus>();
  for (const job of jobs) {
    const orderIntegrationStateId = Number(job.order_integration_state_id);
    if (job.status === 'PENDING' || job.status === 'ENQUEUED' || job.status === 'RUNNING' || job.status === 'CANCEL_REQUESTED') {
      activeJobsByOrder.add(orderIntegrationStateId);
      continue;
    }

    if (!latestJobStatusByOrder.has(orderIntegrationStateId)) {
      const terminalStatus = getTerminalJobStatus(job.status as IntegrationJobStatus);
      if (terminalStatus) {
        latestJobStatusByOrder.set(orderIntegrationStateId, terminalStatus);
      }
    }
  }

  return rows.map(row =>
    serializeSummary(
      {
        ...row,
        order_integration_state_id: Number(row.order_integration_state_id),
        vendor_id: row.vendor_id,
        external_order_id: row.external_order_id,
        order_source: row.order_source,
        purchase_order_number: row.purchase_order_number,
        sales_order_number: row.sales_order_number,
        order_type: row.order_type,
        lifecycle_status: row.lifecycle_status as OrderLifecycleStatus,
        status_label: row.status_label,
        status_code: row.status_code,
        shipment_status: row.shipment_status,
        invoice_status: row.invoice_status,
        remittance_status: row.remittance_status,
        submission_payload: (row.submission_payload ?? {}) as Record<string, unknown>,
        latest_vendor_payload: (row.latest_vendor_payload ?? {}) as Record<string, unknown>,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
        last_error: row.last_error,
        submitted_at: row.submitted_at?.toISOString() ?? null,
        last_status_polled_at: row.last_status_polled_at?.toISOString() ?? null,
        next_status_poll_at: row.next_status_poll_at?.toISOString() ?? null,
        last_shipment_polled_at: row.last_shipment_polled_at?.toISOString() ?? null,
        next_shipment_poll_at: row.next_shipment_poll_at?.toISOString() ?? null,
        last_invoice_polled_at: row.last_invoice_polled_at?.toISOString() ?? null,
        next_invoice_poll_at: row.next_invoice_poll_at?.toISOString() ?? null,
        last_remittance_submitted_at: row.last_remittance_submitted_at?.toISOString() ?? null,
        completed_at: row.completed_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      },
      vendorNameById.get(row.vendor_id) ?? `Vendor ${row.vendor_id}`,
      {
        hasActiveJob: activeJobsByOrder.has(Number(row.order_integration_state_id)),
        latestJobStatus: latestJobStatusByOrder.get(Number(row.order_integration_state_id)) ?? null,
      },
    ),
  );
}

export async function getOrderOperatorDetail(orderIntegrationStateId: number) {
  const summary = await prisma.orderIntegrationState.findUnique({
    where: {
      order_integration_state_id: BigInt(orderIntegrationStateId),
    },
  });
  if (!summary) {
    const error = new Error(`Order integration ${orderIntegrationStateId} not found.`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  const [vendor, jobs, traces, capabilities] = await Promise.all([
    getVendorById(summary.vendor_id),
    listIntegrationJobsForOrderIntegrationState(orderIntegrationStateId, 50),
    listOperatorTraces({
      order_integration_state_id: orderIntegrationStateId,
      limit: 100,
    }),
    listVendorResolvedOrderCapabilities(summary.vendor_id),
  ]);

  return {
    orderIntegrationState: {
      order_integration_state_id: Number(summary.order_integration_state_id),
      vendor_id: summary.vendor_id,
      external_order_id: summary.external_order_id,
      order_source: summary.order_source,
      purchase_order_number: summary.purchase_order_number,
      sales_order_number: summary.sales_order_number,
      order_type: summary.order_type,
      lifecycle_status: summary.lifecycle_status as OrderLifecycleStatus,
      status_label: summary.status_label,
      status_code: summary.status_code,
      shipment_status: summary.shipment_status,
      invoice_status: summary.invoice_status,
      remittance_status: summary.remittance_status,
      submission_payload: (summary.submission_payload ?? {}) as Record<string, unknown>,
      latest_vendor_payload: (summary.latest_vendor_payload ?? {}) as Record<string, unknown>,
      metadata: (summary.metadata ?? {}) as Record<string, unknown>,
      last_error: summary.last_error,
      submitted_at: summary.submitted_at?.toISOString() ?? null,
      last_status_polled_at: summary.last_status_polled_at?.toISOString() ?? null,
      next_status_poll_at: summary.next_status_poll_at?.toISOString() ?? null,
      last_shipment_polled_at: summary.last_shipment_polled_at?.toISOString() ?? null,
      next_shipment_poll_at: summary.next_shipment_poll_at?.toISOString() ?? null,
      last_invoice_polled_at: summary.last_invoice_polled_at?.toISOString() ?? null,
      next_invoice_poll_at: summary.next_invoice_poll_at?.toISOString() ?? null,
      last_remittance_submitted_at: summary.last_remittance_submitted_at?.toISOString() ?? null,
      completed_at: summary.completed_at?.toISOString() ?? null,
      created_at: summary.created_at.toISOString(),
      updated_at: summary.updated_at.toISOString(),
    } satisfies OrderIntegrationState,
    vendor,
    jobs,
    traces,
    capabilities,
  };
}
