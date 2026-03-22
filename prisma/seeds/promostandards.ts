import type { IntegrationFamily, MappingPayloadFormat, MappingProtocol } from '@prisma/client';
import {
  PROMOSTANDARDS_ORDER_CAPABILITIES,
  getPromostandardsOrderCapabilityMetadata,
} from '../../lib/orders/promostandardsOrderCapabilities';

export interface PromoSeedRecord {
  standard_type: IntegrationFamily;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  payload_format: MappingPayloadFormat;
  is_product_endpoint: boolean;
  structure_json: Record<string, unknown>;
  structure_xml: string | null;
  request_schema: Record<string, unknown>;
  response_schema: Record<string, unknown>;
  transform_schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface PromoSeedSourceRecord {
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  is_product_endpoint: boolean;
  metadata?: Record<string, unknown>;
}

function createDefaultTransform(endpointName: string, operationName: string): Record<string, unknown> {
  if (endpointName === 'ProductData' && operationName === 'getProduct') {
    return {
      operation: operationName,
      entity: 'product',
      strategy: 'product_data_detail',
      product: {
        product_id_path: 'productId',
        part_id_path: 'partId',
        sku_paths: ['partId', 'sku', 'SKU'],
        name_paths: ['productName', 'name', 'Name'],
        description_paths: ['description', 'Description'],
      },
    };
  }

  if (
    endpointName === 'ProductData' &&
    ['getProductSellable', 'getProductDateModified'].includes(operationName)
  ) {
    return {
      operation: operationName,
      entity: 'product_reference',
      strategy: 'product_data_discovery',
      references: {
        product_id_path: 'productId',
        part_id_path: 'partId',
      },
    };
  }

  const isProductEndpoint = [
    'Inventory',
    'ProductMedia',
    'ProductCompliance',
    'ProductData',
    'PricingAndConfiguration',
  ].includes(endpointName);

  if (isProductEndpoint) {
    return {
      operation: operationName,
      entity: 'product',
      product: {
        sku_paths: ['sku', 'SKU', 'partId', 'PartID'],
        name_paths: ['name', 'Name', 'productName', 'ProductName'],
        description_paths: ['description', 'Description', 'productDescription', 'ProductDescription'],
      },
    };
  }

  return {
    operation: operationName,
    entity: 'generic',
  };
}

const PROMOSTANDARDS_SEED_SOURCE_RECORDS: PromoSeedSourceRecord[] = [
  { endpoint_name: 'CompanyData', endpoint_version: '1.0.0', operation_name: 'getCompanyData', is_product_endpoint: false },
  { endpoint_name: 'Inventory', endpoint_version: '1.0.0', operation_name: 'getInventoryLevels', is_product_endpoint: true },
  { endpoint_name: 'Inventory', endpoint_version: '1.2.1', operation_name: 'getInventoryLevels', is_product_endpoint: true },
  { endpoint_name: 'Inventory', endpoint_version: '2.0.0', operation_name: 'getInventoryLevels', is_product_endpoint: true },
  { endpoint_name: 'ProductMedia', endpoint_version: '1.0.0', operation_name: 'getMediaContent', is_product_endpoint: true },
  { endpoint_name: 'ProductMedia', endpoint_version: '1.1.0', operation_name: 'getMediaContent', is_product_endpoint: true },
  { endpoint_name: 'ProductCompliance', endpoint_version: '1.0.0', operation_name: 'getComplianceData', is_product_endpoint: true },
  {
    endpoint_name: 'ProductData',
    endpoint_version: '1.0.0',
    operation_name: 'getProductSellable',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'ProductData',
    endpoint_version: '1.0.0',
    operation_name: 'getProductDateModified',
    is_product_endpoint: true,
  },
  { endpoint_name: 'ProductData', endpoint_version: '1.0.0', operation_name: 'getProduct', is_product_endpoint: true },
  {
    endpoint_name: 'ProductData',
    endpoint_version: '2.0.0',
    operation_name: 'getProductSellable',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'ProductData',
    endpoint_version: '2.0.0',
    operation_name: 'getProductDateModified',
    is_product_endpoint: true,
  },
  { endpoint_name: 'ProductData', endpoint_version: '2.0.0', operation_name: 'getProduct', is_product_endpoint: true },
  {
    endpoint_name: 'PricingAndConfiguration',
    endpoint_version: '1.0.0',
    operation_name: 'getAvailableLocations',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'PricingAndConfiguration',
    endpoint_version: '1.0.0',
    operation_name: 'getDecorationColors',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'PricingAndConfiguration',
    endpoint_version: '1.0.0',
    operation_name: 'getFobPoints',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'PricingAndConfiguration',
    endpoint_version: '1.0.0',
    operation_name: 'getAvailableCharges',
    is_product_endpoint: true,
  },
  {
    endpoint_name: 'PricingAndConfiguration',
    endpoint_version: '1.0.0',
    operation_name: 'getConfigurationAndPricing',
    is_product_endpoint: true,
  },
  ...PROMOSTANDARDS_ORDER_CAPABILITIES.map(capability => ({
    endpoint_name: capability.endpoint_name,
    endpoint_version: capability.endpoint_version,
    operation_name: capability.operation_name,
    is_product_endpoint: false,
    metadata: getPromostandardsOrderCapabilityMetadata(capability),
  })),
];

export const PROMOSTANDARDS_SEED_RECORDS: PromoSeedRecord[] = PROMOSTANDARDS_SEED_SOURCE_RECORDS.map(item => ({
  standard_type: 'PROMOSTANDARDS',
  endpoint_name: item.endpoint_name,
  endpoint_version: item.endpoint_version,
  operation_name: item.operation_name,
  protocol: 'SOAP',
  payload_format: 'XML',
  is_product_endpoint: item.is_product_endpoint,
  structure_json: {
    accountId_path: 'accountId',
    password_path: 'password',
    wsVersion_path: 'wsVersion',
  },
  structure_xml: null,
  request_schema: {},
  response_schema: {},
  transform_schema: createDefaultTransform(item.endpoint_name, item.operation_name),
  metadata: {
    seed: 'promostandards',
    capability_scope: item.is_product_endpoint ? 'catalog' : 'generic',
    ...(item.metadata ?? {}),
  },
}));
