import { applyPromostandardsEndpointRuntimeOverrides } from '@lib/vendors/vendorConfig';

describe('vendorConfig', () => {
  test('rehydrates saved endpoint runtime overrides back into PromoStandards capabilities', () => {
    const capabilities = applyPromostandardsEndpointRuntimeOverrides({
      capabilities: {
        fingerprint: 'fingerprint-1',
        tested_at: '2026-03-23T20:00:00.000Z',
        available_endpoint_count: 1,
        credentials_valid: true,
        endpoints: [
          {
            endpoint_name: 'OrderShipmentNotification',
            endpoint_version: '2.1.0',
            operation_name: 'getOrderShipmentNotification',
            available: true,
            status_code: 200,
            message: 'ok',
            resolved_endpoint_url: null,
            custom_endpoint_url: null,
          },
        ],
      },
      endpointMappings: [
        {
          endpoint_name: 'OrderShipmentNotification',
          endpoint_version: '2.1.0',
          operation_name: 'getOrderShipmentNotification',
          runtime_config: {
            endpoint_path: '/custom/order-shipment/2.1.0',
            endpoint_url: 'https://vendor.example.com/custom/order-shipment/2.1.0',
          },
        },
      ],
    });

    expect(capabilities).toEqual({
      fingerprint: 'fingerprint-1',
      tested_at: '2026-03-23T20:00:00.000Z',
      available_endpoint_count: 1,
      credentials_valid: true,
      endpoints: [
        expect.objectContaining({
          endpoint_name: 'OrderShipmentNotification',
          endpoint_version: '2.1.0',
          operation_name: 'getOrderShipmentNotification',
          custom_endpoint_url: '/custom/order-shipment/2.1.0',
          resolved_endpoint_url: 'https://vendor.example.com/custom/order-shipment/2.1.0',
        }),
      ],
    });
  });
});
