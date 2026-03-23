const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();
const mockCreateOperatorTrace = jest.fn();
const mockWriteSnapshotArchive = jest.fn();

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockError(...args),
  },
}));

jest.mock('@lib/etl/repository', () => ({
  createOperatorTrace: (...args: unknown[]) => mockCreateOperatorTrace(...args),
}));

jest.mock('@lib/snapshotArchive', () => ({
  writeSnapshotArchive: (...args: unknown[]) => mockWriteSnapshotArchive(...args),
}));

jest.mock('@lib/requestContext', () => ({
  getRequestContext: () => ({
    correlationId: 'corr-1',
    vendorId: 6,
    integrationJobId: 46,
    syncRunId: 77,
  }),
}));

import { recordApiExchange } from '@lib/apiTelemetry';

describe('recordApiExchange', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteSnapshotArchive.mockResolvedValue({
      bucket: 'bucket',
      key: 'key',
    });
    mockCreateOperatorTrace.mockResolvedValue(null);
  });

  test('includes failed API response text in the structured log entry', async () => {
    await recordApiExchange({
      category: 'bigcommerce-api',
      target: 'https://api.bigcommerce.com/stores/test/v3/catalog/products/1/images',
      method: 'POST',
      action: 'Failed to create BigCommerce product image',
      status: 422,
      request: {
        body: '{"image_url":"https://example.com/test image.png"}',
      },
      response: {
        body: '{"status":422,"title":"Invalid field(s): image_url","errors":{"image_url":"url must be an actual URL or an empty string"}}',
      },
    });

    expect(mockInfo).toHaveBeenCalledWith(
      'external api call completed',
      expect.objectContaining({
        category: 'bigcommerce-api',
        status: 422,
        response_summary:
          '{"status":422,"title":"Invalid field(s): image_url","errors":{"image_url":"url must be an actual URL or an empty string"}}',
      }),
    );
  });
});
