import { intakeBigCommerceOrder } from '@lib/orders/orderIntake';

const mockGetSystemSessionContext = jest.fn();
const mockHydrateBigCommerceOrder = jest.fn();
const mockResolveVendorOrderGroups = jest.fn();
const mockBuildPromostandardsPurchaseOrder = jest.fn();
const mockFindOrderIntegrationStateByExternalOrder = jest.fn();
const mockCreateOrderIntegrationAndMaybeSubmit = jest.fn();
const mockPublishPlatformEvent = jest.fn();

jest.mock('@lib/auth', () => ({
  getSystemSessionContext: (...args: unknown[]) => mockGetSystemSessionContext(...args),
}));

jest.mock('@lib/orders/bigcommerceOrderReader', () => ({
  hydrateBigCommerceOrder: (...args: unknown[]) => mockHydrateBigCommerceOrder(...args),
}));

jest.mock('@lib/orders/orderVendorSplit', () => ({
  resolveVendorOrderGroups: (...args: unknown[]) => mockResolveVendorOrderGroups(...args),
}));

jest.mock('@lib/orders/promostandardsPoBuilder', () => ({
  buildPromostandardsPurchaseOrder: (...args: unknown[]) => mockBuildPromostandardsPurchaseOrder(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  findOrderIntegrationStateByExternalOrder: (...args: unknown[]) =>
    mockFindOrderIntegrationStateByExternalOrder(...args),
}));

jest.mock('@lib/orders/orderCoordinator', () => ({
  createOrderIntegrationAndMaybeSubmit: (...args: unknown[]) =>
    mockCreateOrderIntegrationAndMaybeSubmit(...args),
}));

jest.mock('@lib/platformEvents', () => ({
  publishPlatformEvent: (...args: unknown[]) => mockPublishPlatformEvent(...args),
}));

describe('orderIntake', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSystemSessionContext.mockResolvedValue({
      accessToken: 'token',
      storeHash: 'abc123',
      user: {
        id: 0,
        email: 'system@merchmonk.local',
        username: 'system',
      },
    });
    mockHydrateBigCommerceOrder.mockResolvedValue({
      order: { id: 1001 },
      products: [],
      shippingAddresses: [],
    });
    mockResolveVendorOrderGroups.mockResolvedValue([
      {
        vendor_id: 14,
        order_type: 'Blank',
        purchase_order_number: 'MM-1001-V14',
        line_count: 2,
        vendor_line_items: [{}, {}],
      },
      {
        vendor_id: 22,
        order_type: 'Configured',
        purchase_order_number: 'MM-1001-V22',
        line_count: 1,
        vendor_line_items: [{}],
      },
    ]);
    mockBuildPromostandardsPurchaseOrder
      .mockReturnValueOnce({
        order_type: 'Blank',
        request_fields: {
          PO: {
            orderNumber: 'MM-1001-V14',
          },
        },
        metadata: { line_count: 2 },
      })
      .mockReturnValueOnce({
        order_type: 'Configured',
        request_fields: {
          PO: {
            orderNumber: 'MM-1001-V22',
          },
        },
        metadata: { line_count: 1 },
      });
    mockFindOrderIntegrationStateByExternalOrder.mockResolvedValue(null);
    mockCreateOrderIntegrationAndMaybeSubmit
      .mockResolvedValueOnce({
        orderIntegrationState: {
          order_integration_state_id: 71,
          vendor_id: 14,
          external_order_id: '1001',
          purchase_order_number: 'MM-1001-V14',
        },
        submittedJob: {
          job: { integration_job_id: 501 },
        },
      })
      .mockResolvedValueOnce({
        orderIntegrationState: {
          order_integration_state_id: 72,
          vendor_id: 22,
          external_order_id: '1001',
          purchase_order_number: 'MM-1001-V22',
        },
        submittedJob: {
          job: { integration_job_id: 502 },
        },
      });
  });

  test('hydrates a BigCommerce order, splits it by vendor, and creates vendor order integrations', async () => {
    const result = await intakeBigCommerceOrder({
      orderId: 1001,
      source: 'BIGCOMMERCE_WEBHOOK',
      autoSubmit: true,
    });

    expect(mockHydrateBigCommerceOrder).toHaveBeenCalledWith({
      accessToken: 'token',
      storeHash: 'abc123',
      orderId: 1001,
    });
    expect(mockResolveVendorOrderGroups).toHaveBeenCalled();
    expect(mockCreateOrderIntegrationAndMaybeSubmit).toHaveBeenCalledTimes(2);
    expect(mockCreateOrderIntegrationAndMaybeSubmit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        vendor_id: 14,
        external_order_id: '1001',
        purchase_order_number: 'MM-1001-V14',
        auto_submit: true,
      }),
    );
    expect(result.created_count).toBe(2);
    expect(result.deduplicated_count).toBe(0);
    expect(result.order_integrations).toHaveLength(2);
  });

  test('reuses existing vendor order integrations instead of creating duplicates', async () => {
    mockFindOrderIntegrationStateByExternalOrder
      .mockResolvedValueOnce({
        order_integration_state_id: 71,
        vendor_id: 14,
        external_order_id: '1001',
        purchase_order_number: 'MM-1001-V14',
      })
      .mockResolvedValueOnce(null);

    const result = await intakeBigCommerceOrder({
      orderId: 1001,
      source: 'MERCHMONK_CHECKOUT',
      autoSubmit: true,
    });

    expect(mockCreateOrderIntegrationAndMaybeSubmit).toHaveBeenCalledTimes(1);
    expect(result.created_count).toBe(1);
    expect(result.deduplicated_count).toBe(1);
    expect(result.order_integrations[0]).toMatchObject({
      vendor_id: 14,
      deduplicated: true,
    });
  });
});
