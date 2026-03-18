import type { MappingProtocol } from '../../../types';
import type { EndpointAdapter } from './types';

export function createUnsupportedAdapter(protocol: MappingProtocol): EndpointAdapter {
  return {
    protocol,
    async testConnection() {
      throw new Error(`${protocol} adapter is not implemented yet`);
    },
    async invokeEndpoint() {
      throw new Error(`${protocol} adapter is not implemented yet`);
    },
  };
}
