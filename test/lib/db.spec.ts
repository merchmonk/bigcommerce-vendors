export {};

const mockStoreUpsert = jest.fn();
const mockStoreFindFirst = jest.fn();
const mockStoreFindUnique = jest.fn();

jest.mock('@lib/prisma', () => ({
  __esModule: true,
  default: {
    store: {
      upsert: (...args: unknown[]) => mockStoreUpsert(...args),
      findFirst: (...args: unknown[]) => mockStoreFindFirst(...args),
      findUnique: (...args: unknown[]) => mockStoreFindUnique(...args),
    },
  },
}));

describe('db store session persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('persists a store token even when scope is missing', async () => {
    const { default: db } = await import('@lib/db');

    await db.setStore({
      context: 'stores/abc123',
      access_token: ' store-token ',
      user: {
        id: 1,
        email: 'user@example.com',
      },
    });

    expect(mockStoreUpsert).toHaveBeenCalledWith({
      where: { store_hash: 'abc123' },
      create: {
        store_hash: 'abc123',
        access_token: 'store-token',
        scope: null,
      },
      update: {
        access_token: 'store-token',
      },
    });
  });

  test('does not overwrite an existing token with null when only scope is present', async () => {
    const { default: db } = await import('@lib/db');

    await db.setStore({
      context: 'stores/abc123',
      scope: 'store_v2_products',
      user: {
        id: 1,
        email: 'user@example.com',
      },
    });

    expect(mockStoreUpsert).toHaveBeenCalledWith({
      where: { store_hash: 'abc123' },
      create: {
        store_hash: 'abc123',
        access_token: null,
        scope: 'store_v2_products',
      },
      update: {
        scope: 'store_v2_products',
      },
    });
  });

  test('selects the first store that actually has a token for background execution', async () => {
    mockStoreFindFirst.mockResolvedValue({
      store_hash: 'abc123',
      access_token: 'store-token',
      markup_percent: 35,
      scope: 'scope',
    });

    const { getPrimaryStoreConnection } = await import('@lib/db');
    const result = await getPrimaryStoreConnection();

    expect(mockStoreFindFirst).toHaveBeenCalledWith({
      where: {
        access_token: {
          not: null,
        },
      },
      orderBy: {
        store_id: 'asc',
      },
      select: {
        store_hash: true,
        access_token: true,
        markup_percent: true,
        scope: true,
      },
    });
    expect(result).toEqual({
      storeHash: 'abc123',
      accessToken: 'store-token',
      markupPercent: 35,
      scope: 'scope',
    });
  });

  test('reads persisted markup percent from the store record', async () => {
    mockStoreFindUnique.mockResolvedValue({
      markup_percent: 42,
    });

    const { getStoreMarkupPercent } = await import('@lib/db');
    const result = await getStoreMarkupPercent('abc123');

    expect(mockStoreFindUnique).toHaveBeenCalledWith({
      where: { store_hash: 'abc123' },
      select: {
        markup_percent: true,
      },
    });
    expect(result).toBe(42);
  });
});
