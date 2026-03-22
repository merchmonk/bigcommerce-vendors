import { PROMOSTANDARDS_SEED_RECORDS } from '../../prisma/seeds/promostandards';

function hasSeedRecord(endpointName: string, endpointVersion: string, operationName: string): boolean {
  return PROMOSTANDARDS_SEED_RECORDS.some(
    record =>
      record.endpoint_name === endpointName &&
      record.endpoint_version === endpointVersion &&
      record.operation_name === operationName,
  );
}

describe('PROMOSTANDARDS_SEED_RECORDS', () => {
  test('includes the expanded catalog and order endpoint versions needed for discovery', () => {
    expect(hasSeedRecord('ProductMedia', '1.1.0', 'getMediaContent')).toBe(true);

    expect(hasSeedRecord('Inventory', '1.0.0', 'getInventoryLevels')).toBe(true);
    expect(hasSeedRecord('Inventory', '1.2.1', 'getInventoryLevels')).toBe(true);
    expect(hasSeedRecord('Inventory', '2.0.0', 'getInventoryLevels')).toBe(true);

    expect(hasSeedRecord('ProductData', '1.0.0', 'getProduct')).toBe(true);
    expect(hasSeedRecord('ProductData', '1.0.0', 'getProductSellable')).toBe(true);
    expect(hasSeedRecord('ProductData', '1.0.0', 'getProductDateModified')).toBe(true);

    expect(hasSeedRecord('OrderShipmentNotification', '1.0.0', 'getOrderShipmentNotification')).toBe(true);
  });
});
