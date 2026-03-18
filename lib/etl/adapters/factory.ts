import type { MappingProtocol } from '../../../types';
import type { EndpointAdapter } from './types';
import { soapAdapter } from './soapAdapter';
import { createUnsupportedAdapter } from './unsupportedAdapter';

export function resolveEndpointAdapter(protocol: MappingProtocol): EndpointAdapter {
  if (protocol === 'SOAP') {
    return soapAdapter;
  }
  return createUnsupportedAdapter(protocol);
}
