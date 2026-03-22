import type { IntegrationJobKind } from '../../types';

export interface PromostandardsOrderCapabilityDefinition {
  capability_key: string;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  lifecycle_role:
    | 'submission'
    | 'submission_discovery'
    | 'polling'
    | 'polling_diagnostics'
    | 'reference_discovery';
  optional_by_vendor: boolean;
  recommended_poll_minutes: number | null;
}

export const PROMOSTANDARDS_ORDER_CAPABILITIES: PromostandardsOrderCapabilityDefinition[] = [
  {
    capability_key: 'po_supported_order_types',
    endpoint_name: 'purchaseOrder',
    endpoint_version: '1.0.0',
    operation_name: 'getSupportedOrderTypes',
    lifecycle_role: 'submission_discovery',
    optional_by_vendor: true,
    recommended_poll_minutes: null,
  },
  {
    capability_key: 'po_send',
    endpoint_name: 'purchaseOrder',
    endpoint_version: '1.0.0',
    operation_name: 'sendPO',
    lifecycle_role: 'submission',
    optional_by_vendor: false,
    recommended_poll_minutes: null,
  },
  {
    capability_key: 'order_status_v2',
    endpoint_name: 'OrderStatusService',
    endpoint_version: '2.0.0',
    operation_name: 'getOrderStatus',
    lifecycle_role: 'polling',
    optional_by_vendor: false,
    recommended_poll_minutes: 15,
  },
  {
    capability_key: 'order_issue_v2',
    endpoint_name: 'OrderStatusService',
    endpoint_version: '2.0.0',
    operation_name: 'getIssue',
    lifecycle_role: 'polling_diagnostics',
    optional_by_vendor: true,
    recommended_poll_minutes: 15,
  },
  {
    capability_key: 'order_status_v1',
    endpoint_name: 'OrderStatusService',
    endpoint_version: '1.0.0',
    operation_name: 'getOrderStatusDetails',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 15,
  },
  {
    capability_key: 'order_status_types_v1',
    endpoint_name: 'OrderStatusService',
    endpoint_version: '1.0.0',
    operation_name: 'getOrderStatusTypes',
    lifecycle_role: 'reference_discovery',
    optional_by_vendor: true,
    recommended_poll_minutes: null,
  },
  {
    capability_key: 'shipment_v1_0',
    endpoint_name: 'OrderShipmentNotification',
    endpoint_version: '1.0.0',
    operation_name: 'getOrderShipmentNotification',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 30,
  },
  {
    capability_key: 'shipment_v2_1',
    endpoint_name: 'OrderShipmentNotification',
    endpoint_version: '2.1.0',
    operation_name: 'getOrderShipmentNotification',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 30,
  },
  {
    capability_key: 'shipment_v2_0',
    endpoint_name: 'OrderShipmentNotification',
    endpoint_version: '2.0.0',
    operation_name: 'getOrderShipmentNotification',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 30,
  },
  {
    capability_key: 'invoice_get',
    endpoint_name: 'Invoice',
    endpoint_version: '1.0.0',
    operation_name: 'getInvoices',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 360,
  },
  {
    capability_key: 'invoice_voided',
    endpoint_name: 'Invoice',
    endpoint_version: '1.0.0',
    operation_name: 'getVoidedInvoices',
    lifecycle_role: 'polling',
    optional_by_vendor: true,
    recommended_poll_minutes: 360,
  },
  {
    capability_key: 'remittance_service_methods',
    endpoint_name: 'RemittanceAdvice',
    endpoint_version: '1.0.0',
    operation_name: 'getServiceMethods',
    lifecycle_role: 'submission_discovery',
    optional_by_vendor: true,
    recommended_poll_minutes: null,
  },
  {
    capability_key: 'remittance_send',
    endpoint_name: 'RemittanceAdvice',
    endpoint_version: '1.0.0',
    operation_name: 'sendRemittanceAdvice',
    lifecycle_role: 'submission',
    optional_by_vendor: true,
    recommended_poll_minutes: null,
  },
];

export function getPromostandardsOrderCapabilityMetadata(definition: PromostandardsOrderCapabilityDefinition) {
  return {
    capability_scope: 'order',
    capability_key: definition.capability_key,
    lifecycle_role: definition.lifecycle_role,
    optional_by_vendor: definition.optional_by_vendor,
    recommended_poll_minutes: definition.recommended_poll_minutes,
  };
}

export function findPromostandardsOrderCapability(input: {
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
}): PromostandardsOrderCapabilityDefinition | undefined {
  return PROMOSTANDARDS_ORDER_CAPABILITIES.find(
    definition =>
      definition.endpoint_name === input.endpoint_name &&
      definition.endpoint_version === input.endpoint_version &&
      definition.operation_name === input.operation_name,
  );
}

export function getRequiredCapabilityKeysForJobKind(
  jobKind: IntegrationJobKind,
): string[] {
  switch (jobKind) {
    case 'ORDER_SUBMISSION':
      return ['po_send'];
    case 'ORDER_STATUS_POLL':
      return ['order_status_v2', 'order_status_v1'];
    case 'ORDER_SHIPMENT_POLL':
      return ['shipment_v2_1', 'shipment_v2_0', 'shipment_v1_0'];
    case 'ORDER_INVOICE_POLL':
      return ['invoice_get', 'invoice_voided'];
    case 'ORDER_REMITTANCE_SUBMISSION':
      return ['remittance_send'];
    default:
      return [];
  }
}

export function getPrimaryCapabilityPreferenceKeysForJobKind(
  jobKind: IntegrationJobKind,
): string[] {
  switch (jobKind) {
    case 'ORDER_SUBMISSION':
      return ['po_send'];
    case 'ORDER_STATUS_POLL':
      return ['order_status_v2', 'order_status_v1'];
    case 'ORDER_SHIPMENT_POLL':
      return ['shipment_v2_1', 'shipment_v2_0', 'shipment_v1_0'];
    case 'ORDER_INVOICE_POLL':
      return ['invoice_get'];
    case 'ORDER_REMITTANCE_SUBMISSION':
      return ['remittance_send'];
    default:
      return [];
  }
}

export function getAuxiliaryCapabilityKeysForJobKind(jobKind: IntegrationJobKind): string[] {
  switch (jobKind) {
    case 'ORDER_SUBMISSION':
      return ['po_supported_order_types'];
    case 'ORDER_STATUS_POLL':
      return ['order_issue_v2', 'order_status_types_v1'];
    case 'ORDER_REMITTANCE_SUBMISSION':
      return ['remittance_service_methods'];
    default:
      return [];
  }
}

export function isOrderLifecycleJobKind(jobKind: IntegrationJobKind): boolean {
  return (
    jobKind === 'ORDER_SUBMISSION' ||
    jobKind === 'ORDER_STATUS_POLL' ||
    jobKind === 'ORDER_SHIPMENT_POLL' ||
    jobKind === 'ORDER_INVOICE_POLL' ||
    jobKind === 'ORDER_REMITTANCE_SUBMISSION'
  );
}
