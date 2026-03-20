# PromoStandards Order Capability Matrix

This document defines the PromoStandards order-related operations currently in scope for MerchMonk Phase 6 implementation.

It is the reference used for:

- endpoint seeding
- vendor capability discovery
- order job-kind routing
- polling cadence defaults
- operator expectations for optional vendor support

## Capability Matrix

| Service | Version | Operation | Lifecycle Role | Required For Full Flow | Notes |
| --- | --- | --- | --- | --- | --- |
| purchaseOrder | 1.0.0 | `getSupportedOrderTypes` | submission discovery | Optional | Used to discover vendor-supported PO order types before submission. |
| purchaseOrder | 1.0.0 | `sendPO` | submission | Yes | Primary supplier PO submission operation. |
| OrderStatusService | 2.0.0 | `getOrderStatus` | polling | Yes | Primary order-status polling operation for current status state. |
| OrderStatusService | 2.0.0 | `getIssue` | polling diagnostics | Optional | Used to retrieve issue or hold detail when a supplier exposes it. |
| OrderStatusService | 1.0.0 | `getOrderStatusDetails` | polling fallback | Optional | Legacy fallback when a vendor only supports Order Status 1.0.0. |
| OrderStatusService | 1.0.0 | `getOrderStatusTypes` | reference discovery | Optional | Used to translate legacy status codes if needed. |
| OrderShipmentNotification | 2.1.0 | `getOrderShipmentNotification` | polling | Optional | Preferred shipment polling version when supported. |
| OrderShipmentNotification | 2.0.0 | `getOrderShipmentNotification` | polling fallback | Optional | Shipment polling fallback for vendors not on 2.1.0. |
| Invoice | 1.0.0 | `getInvoices` | polling | Optional | Retrieves invoices associated with the vendor PO / sales order. |
| Invoice | 1.0.0 | `getVoidedInvoices` | polling | Optional | Retrieves voided invoice updates that may change finance state. |
| RemittanceAdvice | 1.0.0 | `getServiceMethods` | submission discovery | Optional | Used to discover which remittance advice delivery methods are supported. |
| RemittanceAdvice | 1.0.0 | `sendRemittanceAdvice` | submission | Optional | Sends remittance advice once invoice/payment workflows require it. |

## Default Capability Rules

- `sendPO` is the core gateway for a supplier order integration.
- `getOrderStatus` is the preferred status polling operation when available.
- `getOrderStatusDetails` is the legacy fallback when only Order Status 1.0.0 is supported.
- shipment, invoice, and remittance operations are vendor-optional and should not block vendor onboarding when absent.
- `getIssue` is diagnostic and enrichment-oriented; it should augment operator visibility but not be required to move an order forward.

## Default Polling Cadence

| Lifecycle Role | Default Cadence | Reason |
| --- | --- | --- |
| order status polling | every 15 minutes | customer-facing and operator-visible state changes can be time sensitive |
| shipment polling | every 30 minutes | shipment changes are important but typically less frequent than raw status movement |
| invoice polling | every 6 hours | finance documents change less frequently |
| remittance submission | no recurring poll | explicit action or downstream payment workflow trigger |

## Idempotency And Retry Expectations

- `sendPO` should dedupe on vendor + purchase order number.
- status, shipment, and invoice polling should dedupe on vendor order integration + poll kind while a job is active.
- recurring poll scheduling should only enqueue jobs when the integration is due and the same job kind is not already active.
- optional endpoints should record capability gaps as operator-visible notes instead of generic failures.
