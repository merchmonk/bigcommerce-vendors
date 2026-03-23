import type { IntegrationJob, IntegrationJobKind, OrderIntegrationState, OrderLifecycleStatus } from '../../types';
import { getVendorById } from '../vendors';
import { resolveEndpointAdapter } from '../etl/adapters/factory';
import { resolveRuntimeEndpointUrl } from '../etl/endpointUrl';
import {
  getOrderIntegrationStateById,
  updateOrderIntegrationState,
} from '../etl/repository';
import logger from '../logger';
import { getRequestContext } from '../requestContext';
import { serializeError } from '../telemetry';
import {
  getPrimaryCapabilityPreferenceKeysForJobKind,
} from './promostandardsOrderCapabilities';
import {
  getRecommendedPollMinutes,
  listVendorResolvedOrderCapabilities,
  resolveAuxiliaryOrderCapabilitiesFromList,
  resolvePrimaryOrderCapabilityFromList,
  type VendorResolvedOrderCapability,
} from './orderCapabilityResolver';

export interface OrderLifecycleExecutionResult {
  orderIntegrationState: OrderIntegrationState;
  summary: Record<string, unknown>;
}

interface ServiceMessage {
  code?: string | number;
  description: string;
  severity?: string | null;
}

interface VendorOrderExecutionContext {
  job: IntegrationJob;
  orderIntegrationState: OrderIntegrationState;
  capabilities: VendorResolvedOrderCapability[];
}

function makeOrderError(message: string, statusCode = 400): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function normalizeKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function collectValuesByKey(
  value: unknown,
  targetKeys: string[],
  output: unknown[] = [],
): unknown[] {
  const normalizedTargets = new Set(targetKeys.map(normalizeKey));

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (normalizedTargets.has(normalizeKey(key))) {
        output.push(child);
      }

      walk(child);
    }
  }

  walk(value);
  return output;
}

function extractFirstString(value: unknown, targetKeys: string[]): string | null {
  for (const candidate of collectValuesByKey(value, targetKeys)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      return String(candidate);
    }
  }

  return null;
}

function extractAllStrings(value: unknown, targetKeys: string[]): string[] {
  const results: string[] = [];
  for (const candidate of collectValuesByKey(value, targetKeys)) {
    if (typeof candidate === 'string' && candidate.trim()) {
      results.push(candidate.trim());
      continue;
    }

    if (typeof candidate === 'number' || typeof candidate === 'boolean') {
      results.push(String(candidate));
    }
  }

  return results;
}

function extractAllRecords(value: unknown, targetKeys: string[]): Record<string, unknown>[] {
  return collectValuesByKey(value, targetKeys)
    .flatMap(candidate => toArray(candidate))
    .map(asRecord)
    .filter(record => Object.keys(record).length > 0);
}

function extractServiceMessages(payload: unknown): ServiceMessage[] {
  const messages: ServiceMessage[] = [];

  for (const record of extractAllRecords(payload, ['ServiceMessage', 'serviceMessage'])) {
    messages.push({
      code: typeof record.code === 'string' || typeof record.code === 'number' ? record.code : undefined,
      description:
        typeof record.description === 'string' && record.description.trim()
          ? record.description.trim()
          : 'Vendor service message returned.',
      severity:
        typeof record.severity === 'string' && record.severity.trim()
          ? record.severity.trim()
          : null,
    });
  }

  return messages;
}

function assertNoVendorServiceError(payload: unknown, fallbackMessage: string): void {
  const errorMessage = extractServiceMessages(payload).find(message =>
    normalizeKey(message.severity ?? '') === 'error',
  );

  if (errorMessage) {
    throw makeOrderError(errorMessage.description || fallbackMessage, 502);
  }
}

function parseJsonPayload(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed);
    } catch {
      return {};
    }
  }

  return asRecord(value);
}

function resolveSubmissionRequestPayload(
  orderIntegrationState: OrderIntegrationState,
  requestPayload: Record<string, unknown>,
): Record<string, unknown> {
  const requestedSubmissionPayload = parseJsonPayload(requestPayload.submission_payload);
  const currentSubmissionPayload = parseJsonPayload(orderIntegrationState.submission_payload);
  const preferredPayload =
    Object.keys(requestedSubmissionPayload).length > 0 ? requestedSubmissionPayload : currentSubmissionPayload;

  const requestFields = parseJsonPayload(preferredPayload.request_fields);
  if (Object.keys(requestFields).length > 0) {
    return requestFields;
  }

  return preferredPayload;
}

function resolveQueryReference(
  orderIntegrationState: OrderIntegrationState,
  options: {
    v2?: boolean;
  } = {},
): { queryType: string | number; referenceNumber: string } {
  if (orderIntegrationState.sales_order_number?.trim()) {
    return {
      queryType: options.v2 ? 'soSearch' : 2,
      referenceNumber: orderIntegrationState.sales_order_number.trim(),
    };
  }

  if (orderIntegrationState.purchase_order_number.trim()) {
    return {
      queryType: options.v2 ? 'poSearch' : 1,
      referenceNumber: orderIntegrationState.purchase_order_number.trim(),
    };
  }

  throw makeOrderError('Order integration is missing both purchase and sales order numbers.', 409);
}

function addMinutes(baseDate: Date, minutes: number | null): Date | null {
  if (!minutes || minutes < 1) {
    return null;
  }

  return new Date(baseDate.getTime() + minutes * 60_000);
}

function clearCompletedPollSchedule(input: {
  lifecycle_status: OrderLifecycleStatus;
  next_status_poll_at?: Date | null;
  next_shipment_poll_at?: Date | null;
  next_invoice_poll_at?: Date | null;
}): {
  next_status_poll_at?: Date | null;
  next_shipment_poll_at?: Date | null;
  next_invoice_poll_at?: Date | null;
} {
  if (input.lifecycle_status === 'COMPLETED' || input.lifecycle_status === 'CANCELLED' || input.lifecycle_status === 'FAILED') {
    return {
      next_status_poll_at: null,
      next_shipment_poll_at: null,
      next_invoice_poll_at: null,
    };
  }

  return {
    next_status_poll_at: input.next_status_poll_at,
    next_shipment_poll_at: input.next_shipment_poll_at,
    next_invoice_poll_at: input.next_invoice_poll_at,
  };
}

function mergeLatestVendorPayload(
  orderIntegrationState: OrderIntegrationState,
  jobKind: IntegrationJobKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const existing = parseJsonPayload(orderIntegrationState.latest_vendor_payload);
  return {
    ...existing,
    [jobKind]: {
      recorded_at: new Date().toISOString(),
      payload,
    },
  };
}

function mergeMetadata(
  orderIntegrationState: OrderIntegrationState,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...parseJsonPayload(orderIntegrationState.metadata),
    ...patch,
  };
}

function mapStatusToLifecycle(
  statusLabel: string | null,
  hasIssue: boolean,
): OrderLifecycleStatus {
  const normalized = normalizeKey(statusLabel ?? '');

  if (normalized.includes('cancel')) {
    return 'CANCELLED';
  }
  if (normalized.includes('complete')) {
    return 'COMPLETED';
  }
  if (normalized.includes('partial') && normalized.includes('ship')) {
    return 'PARTIALLY_SHIPPED';
  }
  if (normalized.includes('ship')) {
    return 'SHIPPED';
  }
  if (hasIssue || normalized.includes('hold') || normalized.includes('issue')) {
    return 'ISSUE';
  }

  return 'SUBMITTED';
}

async function persistOrderStateUpdate(
  orderIntegrationState: OrderIntegrationState,
  patch: Parameters<typeof updateOrderIntegrationState>[0],
): Promise<OrderIntegrationState> {
  const updated = await updateOrderIntegrationState(patch);
  if (!updated) {
    throw makeOrderError(
      `Order integration ${orderIntegrationState.order_integration_state_id} could not be updated.`,
      500,
    );
  }

  return updated;
}

async function invokeCapability(
  context: VendorOrderExecutionContext,
  capability: VendorResolvedOrderCapability,
  requestFields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const vendor = await getVendorById(context.orderIntegrationState.vendor_id);
  if (!vendor?.vendor_api_url) {
    throw makeOrderError(`Vendor ${context.orderIntegrationState.vendor_id} is missing vendor_api_url.`, 409);
  }

  const adapter = resolveEndpointAdapter(capability.protocol);
  const result = await adapter.invokeEndpoint({
    endpointUrl: resolveRuntimeEndpointUrl({
      vendorApiUrl: vendor.vendor_api_url,
      runtimeConfig: capability.runtime_config,
    }),
    endpointName: capability.endpoint_name,
    operationName: capability.operation_name,
    endpointVersion: capability.endpoint_version,
    vendorAccountId: vendor.vendor_account_id,
    vendorSecret: vendor.vendor_secret,
    runtimeConfig: {
      ...(capability.runtime_config ?? {}),
      request_fields: requestFields,
    },
  });

  if (result.status >= 400) {
    throw makeOrderError(
      `${capability.operation_name} returned HTTP ${result.status}.`,
      502,
    );
  }

  const payload = asRecord(result.parsedBody);
  assertNoVendorServiceError(payload, `${capability.operation_name} returned an error.`);
  return payload;
}

async function executeOrderSubmission(
  context: VendorOrderExecutionContext,
  primaryCapability: VendorResolvedOrderCapability,
): Promise<OrderLifecycleExecutionResult> {
  const now = new Date();
  const submissionRequest = resolveSubmissionRequestPayload(
    context.orderIntegrationState,
    context.job.request_payload,
  );
  if (Object.keys(submissionRequest).length === 0) {
    throw makeOrderError('Order submission payload is empty.', 400);
  }

  const submissionResponse = await invokeCapability(context, primaryCapability, submissionRequest);
  const salesOrderNumber = extractFirstString(submissionResponse, [
    'salesOrderNumber',
    'salesOrderNo',
  ]);
  const capabilities = context.capabilities;
  const nextStatusPollAt = addMinutes(
    now,
    getRecommendedPollMinutes(capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_STATUS_POLL')),
  );
  const nextShipmentPollAt = addMinutes(
    now,
    getRecommendedPollMinutes(capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_SHIPMENT_POLL')),
  );
  const nextInvoicePollAt = addMinutes(
    now,
    getRecommendedPollMinutes(capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_INVOICE_POLL')),
  );

  const updatedState = await persistOrderStateUpdate(context.orderIntegrationState, {
    order_integration_state_id: context.orderIntegrationState.order_integration_state_id,
    sales_order_number: salesOrderNumber ?? context.orderIntegrationState.sales_order_number,
    lifecycle_status: 'SUBMITTED',
    status_label: 'Submitted',
    last_error: null,
    submitted_at: now,
    next_status_poll_at: nextStatusPollAt,
    next_shipment_poll_at: nextShipmentPollAt,
    next_invoice_poll_at: nextInvoicePollAt,
    latest_vendor_payload: mergeLatestVendorPayload(
      context.orderIntegrationState,
      context.job.job_kind,
      submissionResponse,
    ),
    metadata: mergeMetadata(context.orderIntegrationState, {
      submission_capability: primaryCapability.capability_key,
      submission_operation: primaryCapability.operation_name,
    }),
  });

  return {
    orderIntegrationState: updatedState,
    summary: {
      lifecycle_status: updatedState.lifecycle_status,
      sales_order_number: updatedState.sales_order_number,
      next_status_poll_at: updatedState.next_status_poll_at,
      next_shipment_poll_at: updatedState.next_shipment_poll_at,
      next_invoice_poll_at: updatedState.next_invoice_poll_at,
    },
  };
}

async function executeOrderStatusPoll(
  context: VendorOrderExecutionContext,
  primaryCapability: VendorResolvedOrderCapability,
): Promise<OrderLifecycleExecutionResult> {
  const now = new Date();
  const queryReference = resolveQueryReference(context.orderIntegrationState, {
    v2: primaryCapability.capability_key === 'order_status_v2',
  });
  const requestFields =
    primaryCapability.capability_key === 'order_status_v2'
      ? {
          queryType: queryReference.queryType,
          referenceNumber: queryReference.referenceNumber,
          statusTimeStamp: context.orderIntegrationState.last_status_polled_at ?? undefined,
          returnIssueDetailType: 'allIssues',
          returnProductDetail: true,
        }
      : {
          queryType: queryReference.queryType,
          referenceNumber: queryReference.referenceNumber,
          statusTimeStamp: context.orderIntegrationState.last_status_polled_at ?? undefined,
        };

  const statusResponse = await invokeCapability(context, primaryCapability, requestFields);
  const statusDetails = extractAllRecords(statusResponse, ['OrderStatusDetail']);
  const primaryDetail = statusDetails[0] ?? asRecord(statusResponse);
  const statusLabel = extractFirstString(primaryDetail, ['status']);
  const issueRecords = extractAllRecords(primaryDetail, ['Issue']);
  const issueCategories = extractAllStrings(primaryDetail, ['issueCategory']);
  const lifecycleStatus = mapStatusToLifecycle(statusLabel, issueRecords.length > 0 || issueCategories.length > 0);
  const salesOrderNumber =
    extractFirstString(primaryDetail, ['salesOrderNumber']) ?? context.orderIntegrationState.sales_order_number;
  const nextStatusPollAt = addMinutes(
    now,
    getRecommendedPollMinutes(context.capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_STATUS_POLL')),
  );
  const schedulePatch = clearCompletedPollSchedule({
    lifecycle_status: lifecycleStatus,
    next_status_poll_at: nextStatusPollAt,
    next_shipment_poll_at: undefined,
    next_invoice_poll_at: undefined,
  });

  const updatedState = await persistOrderStateUpdate(context.orderIntegrationState, {
    order_integration_state_id: context.orderIntegrationState.order_integration_state_id,
    sales_order_number: salesOrderNumber,
    lifecycle_status: lifecycleStatus,
    status_label: statusLabel,
    status_code: issueCategories[0] ?? context.orderIntegrationState.status_code,
    last_error: null,
    last_status_polled_at: now,
    next_status_poll_at: schedulePatch.next_status_poll_at,
    latest_vendor_payload: mergeLatestVendorPayload(
      context.orderIntegrationState,
      context.job.job_kind,
      statusResponse,
    ),
    metadata: mergeMetadata(context.orderIntegrationState, {
      latest_issue_ids: extractAllStrings(primaryDetail, ['issueId']),
    }),
    ...(lifecycleStatus === 'COMPLETED' || lifecycleStatus === 'CANCELLED'
      ? { completed_at: now }
      : {}),
  });

  return {
    orderIntegrationState: updatedState,
    summary: {
      lifecycle_status: updatedState.lifecycle_status,
      status_label: updatedState.status_label,
      sales_order_number: updatedState.sales_order_number,
      issue_count: issueRecords.length,
    },
  };
}

async function executeOrderShipmentPoll(
  context: VendorOrderExecutionContext,
  primaryCapability: VendorResolvedOrderCapability,
): Promise<OrderLifecycleExecutionResult> {
  const now = new Date();
  const queryReference = resolveQueryReference(context.orderIntegrationState);
  const shipmentResponse = await invokeCapability(context, primaryCapability, {
    queryType: queryReference.queryType,
    referenceNumber: queryReference.referenceNumber,
    shipmentDateTimestamp: context.orderIntegrationState.last_shipment_polled_at ?? undefined,
  });

  const shipmentNotifications = extractAllRecords(shipmentResponse, ['OrderShipmentNotification']);
  const shipmentRecords = extractAllRecords(shipmentResponse, ['Shipment']);
  const salesOrderNumbers = extractAllStrings(shipmentResponse, ['salesOrderNumber']);
  const fullFlags = collectValuesByKey(shipmentResponse, [
    'purchaseOrderShippedInFull',
    'salesOrderShippedInFull',
  ]).filter(value => typeof value === 'boolean') as boolean[];
  const fullyShipped = fullFlags.some(Boolean);
  const shipmentLifecycleStatus: OrderLifecycleStatus =
    fullyShipped
      ? (context.orderIntegrationState.invoice_status ? 'COMPLETED' : 'SHIPPED')
      : shipmentRecords.length > 0 || shipmentNotifications.length > 0
        ? 'PARTIALLY_SHIPPED'
        : context.orderIntegrationState.lifecycle_status;
  const shipmentStatus = fullyShipped
    ? 'Shipped in full'
    : shipmentRecords.length > 0 || shipmentNotifications.length > 0
      ? 'Partial shipment detected'
      : 'No shipments returned';
  const nextShipmentPollAt = addMinutes(
    now,
    getRecommendedPollMinutes(context.capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_SHIPMENT_POLL')),
  );
  const schedulePatch = clearCompletedPollSchedule({
    lifecycle_status: shipmentLifecycleStatus,
    next_shipment_poll_at: nextShipmentPollAt,
  });

  const updatedState = await persistOrderStateUpdate(context.orderIntegrationState, {
    order_integration_state_id: context.orderIntegrationState.order_integration_state_id,
    sales_order_number: salesOrderNumbers[0] ?? context.orderIntegrationState.sales_order_number,
    lifecycle_status: shipmentLifecycleStatus,
    shipment_status: shipmentStatus,
    last_error: null,
    last_shipment_polled_at: now,
    next_shipment_poll_at: schedulePatch.next_shipment_poll_at,
    latest_vendor_payload: mergeLatestVendorPayload(
      context.orderIntegrationState,
      context.job.job_kind,
      shipmentResponse,
    ),
    ...(shipmentLifecycleStatus === 'COMPLETED'
      ? { completed_at: now }
      : {}),
  });

  return {
    orderIntegrationState: updatedState,
    summary: {
      lifecycle_status: updatedState.lifecycle_status,
      shipment_status: updatedState.shipment_status,
      shipment_count: shipmentRecords.length,
    },
  };
}

async function executeOrderInvoicePoll(
  context: VendorOrderExecutionContext,
  primaryCapability: VendorResolvedOrderCapability,
): Promise<OrderLifecycleExecutionResult> {
  const now = new Date();
  const queryReference = resolveQueryReference(context.orderIntegrationState);
  const invoiceResponse = await invokeCapability(context, primaryCapability, {
    queryType: queryReference.queryType,
    referenceNumber: queryReference.referenceNumber,
    availableTimeStamp: context.orderIntegrationState.last_invoice_polled_at ?? undefined,
  });
  const auxiliaryCapabilities = resolveAuxiliaryOrderCapabilitiesFromList(context.capabilities, context.job.job_kind);
  let voidedInvoicePayload: Record<string, unknown> | null = null;
  const voidedInvoiceCapability = auxiliaryCapabilities.find(capability => capability.capability_key === 'invoice_voided');
  if (voidedInvoiceCapability) {
    try {
      voidedInvoicePayload = await invokeCapability(context, voidedInvoiceCapability, {
        queryType: queryReference.queryType,
        referenceNumber: queryReference.referenceNumber,
        availableTimeStamp: context.orderIntegrationState.last_invoice_polled_at ?? undefined,
      });
    } catch (error) {
      logger.warn('optional voided invoice lookup failed', {
        integrationJobId: context.job.integration_job_id,
        orderIntegrationStateId: context.orderIntegrationState.order_integration_state_id,
        error: serializeError(error),
      });
    }
  }

  const invoiceNumbers = extractAllStrings(invoiceResponse, ['invoiceNumber']);
  const invoiceStatus = invoiceNumbers.length > 0
    ? `Invoices available (${invoiceNumbers.length})`
    : context.orderIntegrationState.invoice_status ?? 'No invoices returned';
  const invoiceLifecycleStatus =
    invoiceNumbers.length > 0
      ? (context.orderIntegrationState.lifecycle_status === 'SHIPPED' ? 'COMPLETED' : 'INVOICED')
      : context.orderIntegrationState.lifecycle_status;
  const nextInvoicePollAt = addMinutes(
    now,
    getRecommendedPollMinutes(context.capabilities, getPrimaryCapabilityPreferenceKeysForJobKind('ORDER_INVOICE_POLL')),
  );
  const schedulePatch = clearCompletedPollSchedule({
    lifecycle_status: invoiceLifecycleStatus,
    next_invoice_poll_at: nextInvoicePollAt,
  });

  const latestVendorPayload = mergeLatestVendorPayload(
    context.orderIntegrationState,
    context.job.job_kind,
    {
      invoices: invoiceResponse,
      ...(voidedInvoicePayload ? { voided_invoices: voidedInvoicePayload } : {}),
    },
  );

  const updatedState = await persistOrderStateUpdate(context.orderIntegrationState, {
    order_integration_state_id: context.orderIntegrationState.order_integration_state_id,
    lifecycle_status: invoiceLifecycleStatus,
    invoice_status: invoiceStatus,
    last_error: null,
    last_invoice_polled_at: now,
    next_invoice_poll_at: schedulePatch.next_invoice_poll_at,
    latest_vendor_payload: latestVendorPayload,
    metadata: mergeMetadata(context.orderIntegrationState, {
      latest_invoice_numbers: invoiceNumbers,
    }),
    ...(invoiceLifecycleStatus === 'COMPLETED'
      ? { completed_at: now }
      : {}),
  });

  return {
    orderIntegrationState: updatedState,
    summary: {
      lifecycle_status: updatedState.lifecycle_status,
      invoice_status: updatedState.invoice_status,
      invoice_numbers: invoiceNumbers,
    },
  };
}

async function executeRemittanceSubmission(
  context: VendorOrderExecutionContext,
  primaryCapability: VendorResolvedOrderCapability,
): Promise<OrderLifecycleExecutionResult> {
  const now = new Date();
  const remittancePayload = parseJsonPayload(
    context.job.request_payload.remittance_payload ?? context.orderIntegrationState.metadata,
  );
  const requestFields = parseJsonPayload(remittancePayload.request_fields);
  const resolvedRequestFields = Object.keys(requestFields).length > 0 ? requestFields : remittancePayload;
  if (Object.keys(resolvedRequestFields).length === 0) {
    throw makeOrderError('Remittance payload is required before remittance can be submitted.', 400);
  }

  const remittanceResponse = await invokeCapability(context, primaryCapability, resolvedRequestFields);
  const updatedState = await persistOrderStateUpdate(context.orderIntegrationState, {
    order_integration_state_id: context.orderIntegrationState.order_integration_state_id,
    remittance_status: 'Submitted',
    last_error: null,
    last_remittance_submitted_at: now,
    latest_vendor_payload: mergeLatestVendorPayload(
      context.orderIntegrationState,
      context.job.job_kind,
      remittanceResponse,
    ),
  });

  return {
    orderIntegrationState: updatedState,
    summary: {
      remittance_status: updatedState.remittance_status,
      last_remittance_submitted_at: updatedState.last_remittance_submitted_at,
    },
  };
}

export async function executeOrderLifecycleJob(
  job: IntegrationJob,
): Promise<OrderLifecycleExecutionResult> {
  if (!job.order_integration_state_id) {
    throw makeOrderError(
      `Integration job ${job.integration_job_id} is missing order_integration_state_id.`,
      409,
    );
  }

  const orderIntegrationState = await getOrderIntegrationStateById(job.order_integration_state_id);
  if (!orderIntegrationState) {
    throw makeOrderError(
      `Order integration ${job.order_integration_state_id} not found.`,
      404,
    );
  }

  const vendor = await getVendorById(orderIntegrationState.vendor_id);
  if (!vendor) {
    throw makeOrderError(`Vendor ${orderIntegrationState.vendor_id} not found.`, 404);
  }
  if (vendor.integration_family !== 'PROMOSTANDARDS') {
    throw makeOrderError('Order lifecycle execution currently supports PromoStandards vendors only.', 409);
  }

  const capabilities = await listVendorResolvedOrderCapabilities(orderIntegrationState.vendor_id);
  const primaryCapability = resolvePrimaryOrderCapabilityFromList(capabilities, job.job_kind);
  if (!primaryCapability) {
    throw makeOrderError(
      `Vendor ${orderIntegrationState.vendor_id} does not support ${job.job_kind} for order lifecycle execution.`,
      409,
    );
  }

  const context: VendorOrderExecutionContext = {
    job,
    orderIntegrationState,
    capabilities,
  };
  const requestContext = getRequestContext();
  logger.info('executing order lifecycle job', {
    integrationJobId: job.integration_job_id,
    orderIntegrationStateId: orderIntegrationState.order_integration_state_id,
    vendorId: orderIntegrationState.vendor_id,
    jobKind: job.job_kind,
    correlationId: requestContext?.correlationId,
    capabilityKey: primaryCapability.capability_key,
  });

  switch (job.job_kind) {
    case 'ORDER_SUBMISSION':
      return executeOrderSubmission(context, primaryCapability);
    case 'ORDER_STATUS_POLL':
      return executeOrderStatusPoll(context, primaryCapability);
    case 'ORDER_SHIPMENT_POLL':
      return executeOrderShipmentPoll(context, primaryCapability);
    case 'ORDER_INVOICE_POLL':
      return executeOrderInvoicePoll(context, primaryCapability);
    case 'ORDER_REMITTANCE_SUBMISSION':
      return executeRemittanceSubmission(context, primaryCapability);
    default:
      throw makeOrderError(`Unsupported order job kind ${job.job_kind}.`, 400);
  }
}
