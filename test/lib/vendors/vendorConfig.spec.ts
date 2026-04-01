import { applyPromostandardsEndpointUrlOverrides } from '@lib/vendors/vendorConfig';

describe('vendorConfig', () => {
  test('rehydrates saved endpoint URLs back into PromoStandards capabilities', () => {
    const capabilities = applyPromostandardsEndpointUrlOverrides({
      capabilities: {
        fingerprint: 'fingerprint-1',
        testedAt: '2026-03-23T20:00:00.000Z',
        availableEndpointCount: 1,
        credentialsValid: true,
        endpoints: [
          {
            endpointName: 'OrderShipmentNotification',
            endpointVersion: '2.1.0',
            endpointUrl: '',
            available: true,
            status_code: 200,
            message: 'ok',
          },
        ],
      },
      endpointUrls: [
        {
          endpointName: 'OrderShipmentNotification',
          endpointVersion: '2.1.0',
          endpointUrl: 'https://vendor.example.com/custom/order-shipment/2.1.0',
        },
      ],
    });

    expect(capabilities).toEqual({
      fingerprint: 'fingerprint-1',
      testedAt: '2026-03-23T20:00:00.000Z',
      availableEndpointCount: 1,
      credentialsValid: true,
      endpoints: [
        expect.objectContaining({
          endpointName: 'OrderShipmentNotification',
          endpointVersion: '2.1.0',
          endpointUrl: 'https://vendor.example.com/custom/order-shipment/2.1.0',
        }),
      ],
    });
  });
});
