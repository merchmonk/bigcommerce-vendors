import handler from '../../../pages/api/storefront/products/[productId]/designer';

const mockGetSystemSessionContext = jest.fn();
const mockGetProductDesignerPayload = jest.fn();
const mockRecordInternalFailure = jest.fn();

jest.mock('@lib/auth', () => ({
  getSystemSessionContext: (...args: unknown[]) => mockGetSystemSessionContext(...args),
}));

jest.mock('@lib/storefront/productDesignerBff', () => ({
  getProductDesignerPayload: (...args: unknown[]) => mockGetProductDesignerPayload(...args),
}));

jest.mock('@lib/apiTelemetry', () => ({
  recordInternalFailure: (...args: unknown[]) => mockRecordInternalFailure(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

function createResponseMock() {
  const headers = new Map<string, string | string[]>();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: jest.fn((name: string, value: string | string[]) => {
      headers.set(name, value);
      return response;
    }),
    status: jest.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: jest.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    end: jest.fn(),
    headers,
  };

  return response;
}

describe('storefront designer API route', () => {
  beforeEach(() => {
    mockGetSystemSessionContext.mockReset();
    mockGetProductDesignerPayload.mockReset();
    mockRecordInternalFailure.mockReset();
    process.env.PRODUCT_PLATFORM_SHARED_TOKEN = 'shared-token';
  });

  afterEach(() => {
    delete process.env.PRODUCT_PLATFORM_SHARED_TOKEN;
  });

  test('returns the designer payload for an authorized request', async () => {
    mockGetSystemSessionContext.mockResolvedValue({
      accessToken: 'token',
      storeHash: 'storehash',
      user: { id: 0 },
    });
    mockGetProductDesignerPayload.mockResolvedValue({
      product: { productId: 1457 },
    });

    const res = createResponseMock();
    await handler(
      {
        method: 'GET',
        url: '/api/storefront/products/1457/designer?variantId=8842&quantity=96',
        query: {
          productId: '1457',
          variantId: '8842',
          quantity: '96',
        },
        headers: {
          'x-product-platform-token': 'shared-token',
        },
      } as any,
      res as any,
    );

    expect(mockGetProductDesignerPayload).toHaveBeenCalledWith({
      accessToken: 'token',
      storeHash: 'storehash',
      productId: 1457,
      variantId: 8842,
      quantity: 96,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      product: { productId: 1457 },
    });
  });

  test('rejects an unauthorized request', async () => {
    const res = createResponseMock();
    await handler(
      {
        method: 'GET',
        url: '/api/storefront/products/1457/designer?variantId=8842&quantity=96',
        query: {
          productId: '1457',
          variantId: '8842',
          quantity: '96',
        },
        headers: {},
      } as any,
      res as any,
    );

    expect(mockGetSystemSessionContext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Unauthorized product-platform request.',
    });
  });
});
