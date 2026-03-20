import { getSystemSessionContext } from '../auth';
import { findOrderIntegrationStateByExternalOrder } from '../etl/repository';
import logger from '../logger';
import { publishPlatformEvent } from '../platformEvents';
import { createOrderIntegrationAndMaybeSubmit } from './orderCoordinator';
import { hydrateBigCommerceOrder } from './bigcommerceOrderReader';
import type { OrderIntakeOverrides } from './bigcommerceOrderTypes';
import { buildPromostandardsPurchaseOrder } from './promostandardsPoBuilder';
import { resolveVendorOrderGroups } from './orderVendorSplit';

export type OrderIntakeSource = 'BIGCOMMERCE_WEBHOOK' | 'MERCHMONK_CHECKOUT' | 'OPERATOR';

export interface OrderIntakeResult {
  order_id: number;
  store_hash: string;
  created_count: number;
  deduplicated_count: number;
  order_integrations: Array<{
    vendor_id: number;
    order_integration_state_id: number;
    purchase_order_number: string;
    deduplicated: boolean;
    submitted_job_id: number | null;
  }>;
}

export async function intakeBigCommerceOrder(input: {
  orderId: number;
  source: OrderIntakeSource;
  autoSubmit?: boolean;
  overrides?: OrderIntakeOverrides;
  metadata?: Record<string, unknown>;
}): Promise<OrderIntakeResult> {
  const session = await getSystemSessionContext();
  const externalOrderId = String(input.orderId);

  await publishPlatformEvent({
    detailType: 'order.intake.received',
    detail: {
      order_id: input.orderId,
      source: input.source,
      store_hash: session.storeHash,
    },
  });

  try {
    const orderBundle = await hydrateBigCommerceOrder({
      accessToken: session.accessToken,
      storeHash: session.storeHash,
      orderId: input.orderId,
    });

    const vendorGroups = await resolveVendorOrderGroups({
      accessToken: session.accessToken,
      storeHash: session.storeHash,
      externalOrderId,
      orderBundle,
      overrides: input.overrides,
    });

    const orderIntegrations: OrderIntakeResult['order_integrations'] = [];

    for (const vendorGroup of vendorGroups) {
      const existing = await findOrderIntegrationStateByExternalOrder(vendorGroup.vendor_id, externalOrderId);
      if (existing) {
        orderIntegrations.push({
          vendor_id: vendorGroup.vendor_id,
          order_integration_state_id: existing.order_integration_state_id,
          purchase_order_number: existing.purchase_order_number,
          deduplicated: true,
          submitted_job_id: null,
        });

        await publishPlatformEvent({
          detailType: 'order.intake.vendor_split.created',
          detail: {
            order_id: input.orderId,
            vendor_id: vendorGroup.vendor_id,
            deduplicated: true,
            line_count: vendorGroup.line_count,
          },
        });
        continue;
      }

      const submissionPayload = buildPromostandardsPurchaseOrder({
        vendorId: vendorGroup.vendor_id,
        externalOrderId,
        purchaseOrderNumber: vendorGroup.purchase_order_number,
        orderBundle,
        vendorLineItems: vendorGroup.vendor_line_items,
        overrides: input.overrides,
      });

      const created = await createOrderIntegrationAndMaybeSubmit({
        vendor_id: vendorGroup.vendor_id,
        external_order_id: externalOrderId,
        purchase_order_number: vendorGroup.purchase_order_number,
        order_type: submissionPayload.order_type,
        order_source: input.source,
        submission_payload: submissionPayload as unknown as Record<string, unknown>,
        metadata: {
          ...(input.metadata ?? {}),
          intake_source: input.source,
          line_count: vendorGroup.line_count,
          store_hash: session.storeHash,
          ...submissionPayload.metadata,
        },
        auto_submit: input.autoSubmit ?? true,
      });

      orderIntegrations.push({
        vendor_id: vendorGroup.vendor_id,
        order_integration_state_id: created.orderIntegrationState.order_integration_state_id,
        purchase_order_number: created.orderIntegrationState.purchase_order_number,
        deduplicated: false,
        submitted_job_id: created.submittedJob?.job.integration_job_id ?? null,
      });

      await publishPlatformEvent({
        detailType: 'order.intake.vendor_split.created',
        detail: {
          order_id: input.orderId,
          vendor_id: vendorGroup.vendor_id,
          deduplicated: false,
          line_count: vendorGroup.line_count,
          order_integration_state_id: created.orderIntegrationState.order_integration_state_id,
        },
      });
    }

    const result: OrderIntakeResult = {
      order_id: input.orderId,
      store_hash: session.storeHash,
      created_count: orderIntegrations.filter(item => !item.deduplicated).length,
      deduplicated_count: orderIntegrations.filter(item => item.deduplicated).length,
      order_integrations: orderIntegrations,
    };

    await publishPlatformEvent({
      detailType: 'order.intake.succeeded',
      detail: {
        order_id: input.orderId,
        store_hash: session.storeHash,
        created_count: result.created_count,
        deduplicated_count: result.deduplicated_count,
      },
    });

    logger.info('bigcommerce order intake completed', {
      order_id: result.order_id,
      store_hash: result.store_hash,
      created_count: result.created_count,
      deduplicated_count: result.deduplicated_count,
      order_integrations: result.order_integrations,
    });
    return result;
  } catch (error) {
    await publishPlatformEvent({
      detailType: 'order.intake.failed',
      detail: {
        order_id: input.orderId,
        source: input.source,
        store_hash: session.storeHash,
        error: error instanceof Error ? error.message : 'Unknown intake error',
      },
    });
    throw error;
  }
}
