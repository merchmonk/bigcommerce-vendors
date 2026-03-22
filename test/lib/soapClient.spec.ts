import { buildSoapEnvelope, resolveSoapEndpointUrl } from '../../lib/etl/soapClient';

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
