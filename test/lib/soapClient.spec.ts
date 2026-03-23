import { buildSoapEnvelope, resolveSoapEndpointUrl, resolveSoapOperationName } from '../../lib/etl/soapClient';

describe('resolveSoapEndpointUrl', () => {
  it('appends endpoint name and version to a base vendor URL', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://www.spectorapps.com/',
        endpointName: 'Inventory',
        endpointVersion: '1.2.1',
      }),
    ).toBe('https://www.spectorapps.com/inventory/1.2.1');
  });

  it('preserves a fully qualified endpoint URL', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://www.spectorapps.com/inventory/1.2.1',
        endpointName: 'Inventory',
        endpointVersion: '1.2.1',
      }),
    ).toBe('https://www.spectorapps.com/inventory/1.2.1');
  });

  it('adds the version when the vendor URL already points at an endpoint path', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://www.spectorapps.com/productdata',
        endpointName: 'ProductData',
        endpointVersion: '2.0.0',
      }),
    ).toBe('https://www.spectorapps.com/productdata/2.0.0');
  });

  it('uses Spector pricing endpoint alias when resolving PricingAndConfiguration', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://www.spectorapps.com/',
        endpointName: 'PricingAndConfiguration',
        endpointVersion: '1.0.0',
      }),
    ).toBe('https://www.spectorapps.com/productpriceandconfiguration/1.0.0');
  });

  it('preserves explicit versioned endpoint paths even when the path token differs from the endpoint name', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://www.spectorapps.com/orderstatus/2.0.0',
        endpointName: 'OrderStatusService',
        endpointVersion: '2.0.0',
      }),
    ).toBe('https://www.spectorapps.com/orderstatus/2.0.0');
  });

  it('preserves explicit resolved service URLs that include the endpoint version before a trailing transport segment', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
        endpointName: 'PricingAndConfiguration',
        endpointVersion: '1.0.0',
      }),
    ).toBe('https://vendor.example.com/api/promostandards/PPC/1.0.0/soap');
  });
});

describe('resolveSoapOperationName', () => {
  it('maps the legacy ProductCompliance operation name to getCompliance', () => {
    expect(
      resolveSoapOperationName({
        endpointName: 'ProductCompliance',
        operationName: 'getComplianceData',
      }),
    ).toBe('getCompliance');
  });

  it('leaves other operation names unchanged', () => {
    expect(
      resolveSoapOperationName({
        endpointName: 'ProductData',
        operationName: 'getProduct',
      }),
    ).toBe('getProduct');
  });
});

describe('buildSoapEnvelope', () => {
  it('does not emit unbound urn-prefixed child elements for document-literal requests', () => {
    const envelope = buildSoapEnvelope(
      {
        endpointUrl: 'https://vendor.example.com',
        endpointName: 'ProductData',
        endpointVersion: '2.0.0',
        operationName: 'getProductSellable',
        vendorAccountId: 'acct-1',
        vendorSecret: 'secret-1',
      },
      {
        requestElementName: 'GetProductSellableRequest',
        targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
      },
    );

    expect(envelope).toContain('<tns:GetProductSellableRequest>');
    expect(envelope).toContain('<wsVersion>2.0.0</wsVersion>');
    expect(envelope).toContain('<id>acct-1</id>');
    expect(envelope).toContain('<password>secret-1</password>');
    expect(envelope).not.toContain('<urn:wsVersion>');
    expect(envelope).not.toContain('<urn:id>');
    expect(envelope).not.toContain('<urn:password>');
  });
});
