export {};

const mockUpdate = jest.fn();
const mockDeleteMany = jest.fn();
const mockUpsert = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../../lib/runtimeDatabaseUrl', () => ({
  ensureRuntimeDatabaseUrl: jest.fn().mockResolvedValue('postgresql://example'),
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    integrationJob: {
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    vendorEndpointMapping: {
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  })),
}));

describe('prisma lazy proxy', () => {
  beforeEach(() => {
    jest.resetModules();
    mockUpdate.mockReset();
    mockDeleteMany.mockReset();
    mockUpsert.mockReset();
    mockTransaction.mockReset();
  });

  test('supports catch chaining on delegate operations', async () => {
    mockUpdate.mockRejectedValue(new Error('update failed'));

    const prismaModule = await import('../../lib/prisma');
    const result = await prismaModule.default.integrationJob
      .update({
        where: { integration_job_id: BigInt(1) },
        data: { status: 'FAILED' },
      })
      .catch(() => null);

    expect(result).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('preserves raw Prisma operations inside transaction arrays', async () => {
    const deleteOperation = { kind: 'deleteMany-op' };
    const upsertOperation = { kind: 'upsert-op' };
    mockDeleteMany.mockReturnValue(deleteOperation);
    mockUpsert.mockReturnValue(upsertOperation);
    mockTransaction.mockResolvedValue([]);

    const prismaModule = await import('../../lib/prisma');

    await prismaModule.default.$transaction([
      prismaModule.default.vendorEndpointMapping.deleteMany({
        where: { vendor_id: 1 },
      }),
      prismaModule.default.vendorEndpointMapping.upsert({
        where: { vendor_id_mapping_id: { vendor_id: 1, mapping_id: 2 } },
        create: { vendor_id: 1, mapping_id: 2, is_enabled: true, runtime_config: {} },
        update: { is_enabled: true },
      }),
    ]);

    expect(mockTransaction).toHaveBeenCalledWith([deleteOperation, upsertOperation], undefined);
  });
});
