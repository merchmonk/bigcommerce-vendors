export type OrderLifecycleStatus =
  | 'PENDING_SUBMISSION'
  | 'SUBMISSION_QUEUED'
  | 'SUBMITTED'
  | 'ISSUE'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'INVOICED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface OrderIntegrationState {
  order_integration_state_id: number;
  vendor_id: number;
  external_order_id: string;
  order_source: string;
  purchase_order_number: string;
  sales_order_number: string | null;
  order_type: string | null;
  lifecycle_status: OrderLifecycleStatus;
  status_label: string | null;
  status_code: string | null;
  shipment_status: string | null;
  invoice_status: string | null;
  remittance_status: string | null;
  submission_payload: Record<string, unknown>;
  latest_vendor_payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_error: string | null;
  submitted_at: string | null;
  last_status_polled_at: string | null;
  next_status_poll_at: string | null;
  last_shipment_polled_at: string | null;
  next_shipment_poll_at: string | null;
  last_invoice_polled_at: string | null;
  next_invoice_poll_at: string | null;
  last_remittance_submitted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

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
  latest_job_status: string | null;
  updated_at: string;
}
