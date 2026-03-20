import { randomUUID } from 'node:crypto';
import type {
  IntegrationJob,
  IntegrationJobEvent,
  IntegrationJobKind,
  OrderIntegrationState,
} from '../../types';
import { getVendorById } from '../vendors';
import {
  createOrderIntegrationState,
  getOrderIntegrationStateById,
  listIntegrationJobsForOrderIntegrationState,
  listOperatorTraces,
  updateOrderIntegrationState,
} from '../etl/repository';
import {
  getIntegrationJobStatus,
  submitOrderLifecycleJob,
} from '../integrationJobs';
import { publishPlatformEvent } from '../platformEvents';
import { getRequestContext } from '../requestContext';
import { resolvePrimaryOrderCapabilityForJobKind } from './orderCapabilityResolver';

export interface CreateOrderIntegrationInput {
  vendor_id: number;
  external_order_id: string;
  purchase_order_number: string;
  sales_order_number?: string | null;
  order_type?: string | null;
  order_source?: string | null;
  submission_payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  auto_submit?: boolean;
}

export interface SubmittedOrderLifecycleJob {
  job: IntegrationJob;
  events: IntegrationJobEvent[];
  deduplicated: boolean;
}

function makeOrderError(message: string, statusCode = 400): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function requireString(value: string | undefined | null, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw makeOrderError(`${fieldName} is required.`);
  }

  return normalized;
}

async function requireSupplierVendor(vendorId: number) {
  const vendor = await getVendorById(vendorId);
  if (!vendor) {
    throw makeOrderError(`Vendor ${vendorId} not found.`, 404);
  }

  if (!vendor.is_active) {
    throw makeOrderError('Order integrations can only be created for active vendors.', 409);
  }

  if (vendor.vendor_type !== 'SUPPLIER') {
    throw makeOrderError('Order integrations currently support supplier vendors only.', 409);
  }

  if (vendor.integration_family !== 'PROMOSTANDARDS') {
    throw makeOrderError('Order integrations currently support PromoStandards vendors only.', 409);
  }

  return vendor;
}

async function enqueueOrderJob(input: {
  orderIntegrationState: OrderIntegrationState;
  jobKind: Extract<
    IntegrationJobKind,
    | 'ORDER_SUBMISSION'
    | 'ORDER_STATUS_POLL'
    | 'ORDER_SHIPMENT_POLL'
    | 'ORDER_INVOICE_POLL'
    | 'ORDER_REMITTANCE_SUBMISSION'
  >;
  sourceAction: string;
  requestPayload?: Record<string, unknown>;
}): Promise<SubmittedOrderLifecycleJob> {
  const correlationId = getRequestContext()?.correlationId ?? randomUUID();
  const submitted = await submitOrderLifecycleJob({
    vendorId: input.orderIntegrationState.vendor_id,
    orderIntegrationStateId: input.orderIntegrationState.order_integration_state_id,
    jobKind: input.jobKind,
    sourceAction: input.sourceAction,
    correlationId,
    requestPayload: input.requestPayload,
  });
  const status = await getIntegrationJobStatus(submitted.job.integration_job_id);

  if (!submitted.deduplicated && input.jobKind === 'ORDER_SUBMISSION') {
    await updateOrderIntegrationState({
      order_integration_state_id: input.orderIntegrationState.order_integration_state_id,
      lifecycle_status: 'SUBMISSION_QUEUED',
      last_error: null,
    });
  }

  return {
    job: status.job,
    events: status.events,
    deduplicated: submitted.deduplicated,
  };
}

export async function createOrderIntegrationAndMaybeSubmit(
  input: CreateOrderIntegrationInput,
): Promise<{
  orderIntegrationState: OrderIntegrationState;
  submittedJob: SubmittedOrderLifecycleJob | null;
}> {
  await requireSupplierVendor(input.vendor_id);
  const submissionCapability = await resolvePrimaryOrderCapabilityForJobKind(
    input.vendor_id,
    'ORDER_SUBMISSION',
  );
  if (!submissionCapability) {
    throw makeOrderError('This vendor does not expose the PromoStandards sendPO capability.', 409);
  }

  const orderIntegrationState = await createOrderIntegrationState({
    vendor_id: input.vendor_id,
    external_order_id: requireString(input.external_order_id, 'external_order_id'),
    purchase_order_number: requireString(input.purchase_order_number, 'purchase_order_number'),
    sales_order_number: input.sales_order_number?.trim() || null,
    order_type: input.order_type?.trim() || null,
    order_source: input.order_source?.trim() || 'BIGCOMMERCE',
    lifecycle_status: 'PENDING_SUBMISSION',
    submission_payload: input.submission_payload ?? {},
    metadata: {
      ...(input.metadata ?? {}),
      submission_capability: submissionCapability.capability_key,
    },
  });

  await publishPlatformEvent({
    detailType: 'order.integration.created',
    detail: {
      order_integration_state_id: orderIntegrationState.order_integration_state_id,
      vendor_id: orderIntegrationState.vendor_id,
      external_order_id: orderIntegrationState.external_order_id,
      purchase_order_number: orderIntegrationState.purchase_order_number,
      order_type: orderIntegrationState.order_type,
    },
  });

  if (!input.auto_submit) {
    return {
      orderIntegrationState,
      submittedJob: null,
    };
  }

  const submittedJob = await enqueueOrderJob({
    orderIntegrationState,
    jobKind: 'ORDER_SUBMISSION',
    sourceAction: 'operator_create_order',
    requestPayload: {
      submission_payload: input.submission_payload,
    },
  });

  const refreshedState = await getOrderIntegrationStateById(orderIntegrationState.order_integration_state_id);
  return {
    orderIntegrationState: refreshedState ?? orderIntegrationState,
    submittedJob,
  };
}

export async function submitExistingOrderIntegration(
  orderIntegrationStateId: number,
  input?: {
    sourceAction?: string;
    requestPayload?: Record<string, unknown>;
  },
): Promise<SubmittedOrderLifecycleJob> {
  const orderIntegrationState = await getOrderIntegrationStateById(orderIntegrationStateId);
  if (!orderIntegrationState) {
    throw makeOrderError(`Order integration ${orderIntegrationStateId} not found.`, 404);
  }

  return enqueueOrderJob({
    orderIntegrationState,
    jobKind: 'ORDER_SUBMISSION',
    sourceAction: input?.sourceAction ?? 'operator_retry_submission',
    requestPayload: input?.requestPayload,
  });
}

export async function enqueueManualOrderPoll(
  orderIntegrationStateId: number,
  jobKind: Extract<IntegrationJobKind, 'ORDER_STATUS_POLL' | 'ORDER_SHIPMENT_POLL' | 'ORDER_INVOICE_POLL'>,
  sourceAction: string,
): Promise<SubmittedOrderLifecycleJob> {
  const orderIntegrationState = await getOrderIntegrationStateById(orderIntegrationStateId);
  if (!orderIntegrationState) {
    throw makeOrderError(`Order integration ${orderIntegrationStateId} not found.`, 404);
  }

  const capability = await resolvePrimaryOrderCapabilityForJobKind(orderIntegrationState.vendor_id, jobKind);
  if (!capability) {
    throw makeOrderError(`The vendor does not support ${jobKind}.`, 409);
  }

  return enqueueOrderJob({
    orderIntegrationState,
    jobKind,
    sourceAction,
  });
}

export async function submitOrderRemittance(
  orderIntegrationStateId: number,
  remittancePayload: Record<string, unknown>,
): Promise<SubmittedOrderLifecycleJob> {
  const orderIntegrationState = await getOrderIntegrationStateById(orderIntegrationStateId);
  if (!orderIntegrationState) {
    throw makeOrderError(`Order integration ${orderIntegrationStateId} not found.`, 404);
  }

  const capability = await resolvePrimaryOrderCapabilityForJobKind(
    orderIntegrationState.vendor_id,
    'ORDER_REMITTANCE_SUBMISSION',
  );
  if (!capability) {
    throw makeOrderError('The vendor does not support remittance advice submission.', 409);
  }

  return enqueueOrderJob({
    orderIntegrationState,
    jobKind: 'ORDER_REMITTANCE_SUBMISSION',
    sourceAction: 'operator_submit_remittance',
    requestPayload: {
      remittance_payload: remittancePayload,
    },
  });
}

export async function getOrderIntegrationDetail(orderIntegrationStateId: number) {
  const orderIntegrationState = await getOrderIntegrationStateById(orderIntegrationStateId);
  if (!orderIntegrationState) {
    throw makeOrderError(`Order integration ${orderIntegrationStateId} not found.`, 404);
  }

  const [vendor, jobs, traces] = await Promise.all([
    getVendorById(orderIntegrationState.vendor_id),
    listIntegrationJobsForOrderIntegrationState(orderIntegrationState.order_integration_state_id, 50),
    listOperatorTraces({
      order_integration_state_id: orderIntegrationState.order_integration_state_id,
      limit: 100,
    }),
  ]);

  return {
    orderIntegrationState,
    vendor,
    jobs,
    traces,
  };
}
