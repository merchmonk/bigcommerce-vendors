import { requestJson } from '@lib/etl/bigcommerceApi';

const mockRecordApiExchange = jest.fn();

jest.mock('@lib/apiTelemetry', () => ({
  recordApiExchange: (...args: unknown[]) => mockRecordApiExchange(...args),
}));

describe('requestJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records a non-error telemetry action for successful responses', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    });
    global.fetch = fetchMock as typeof fetch;

    await requestJson(
      'token',
      'https://api.bigcommerce.com/stores/test/v3/catalog/products?name=Spiral%20eco%20notebook',
      { method: 'GET' },
      'Failed to list BigCommerce products by name',
    );

    expect(mockRecordApiExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'bigcommerce-api',
        action: 'list BigCommerce products by name',
        status: 200,
      }),
    );
  });
});
