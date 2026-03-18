import { resolveEndpointAdapter } from '@lib/etl/adapters/factory';

describe('resolveEndpointAdapter', () => {
  test('returns soap adapter for SOAP protocol', () => {
    const adapter = resolveEndpointAdapter('SOAP');
    expect(adapter.protocol).toBe('SOAP');
  });

  test('returns unsupported adapter for unimplemented protocols', async () => {
    const adapter = resolveEndpointAdapter('REST');
    await expect(
      adapter.testConnection({
        endpointUrl: 'https://example.com',
      }),
    ).rejects.toThrow('REST adapter is not implemented yet');
  });
});
