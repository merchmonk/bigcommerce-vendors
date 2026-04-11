import {
  buildSoapEnvelope,
  getBuiltInSoapOperationMetadata,
  resolveSoapEndpointUrl,
  resolveSoapOperationName,
} from '../../lib/etl/soapClient';

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

  it('preserves explicit service endpoint URLs that use a vendor-specific version token and trailing svc segment', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://wsp.gemline.com/GemlineWebService/Inventory/v2/GemlineInventoryService.svc',
        endpointName: 'Inventory',
        endpointVersion: '2.0.0',
      }),
    ).toBe('https://wsp.gemline.com/GemlineWebService/Inventory/v2/GemlineInventoryService.svc');
  });

  it('treats explicit custom endpoint URLs as final when requested by the caller', () => {
    expect(
      resolveSoapEndpointUrl({
        endpointUrl: 'https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc',
        endpointUrlIsFinal: true,
        endpointName: 'ProductData',
        endpointVersion: '2.0.0',
      }),
    ).toBe('https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc');
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
  it('ships built-in ProductData metadata for worker-safe document-literal requests', () => {
    expect(
      getBuiltInSoapOperationMetadata({
        endpointName: 'ProductData',
        endpointVersion: '2.0.0',
        operationName: 'getProductSellable',
      }),
    ).toEqual({
      requestElementName: 'GetProductSellableRequest',
      targetNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/',
      childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
    });
  });

  it('ships built-in metadata for other worker-enriched document-literal services', () => {
    expect(
      getBuiltInSoapOperationMetadata({
        endpointName: 'PricingAndConfiguration',
        endpointVersion: '1.0.0',
        operationName: 'getAvailableLocations',
      }),
    ).toEqual(
      expect.objectContaining({
        requestElementName: 'GetAvailableLocationsRequest',
        targetNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/',
        childElementNamespace: 'http://www.promostandards.org/WSDL/PricingAndConfiguration/1.0.0/SharedObjects/',
      }),
    );

    expect(
      getBuiltInSoapOperationMetadata({
        endpointName: 'Inventory',
        endpointVersion: '2.0.0',
        operationName: 'getInventoryLevels',
      }),
    ).toEqual({
      requestElementName: 'GetInventoryLevelsRequest',
      targetNamespace: 'http://www.promostandards.org/WSDL/Inventory/2.0.0/',
      childElementNamespace: 'http://www.promostandards.org/WSDL/Inventory/2.0.0/SharedObjects/',
    });
  });

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
        childElementNamespace: 'http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/',
      },
    );

    expect(envelope).toContain('<tns:GetProductSellableRequest>');
    expect(envelope).toContain('xmlns:sh="http://www.promostandards.org/WSDL/ProductDataService/2.0.0/SharedObjects/"');
    expect(envelope).toContain('<sh:wsVersion>2.0.0</sh:wsVersion>');
    expect(envelope).toContain('<sh:id>acct-1</sh:id>');
    expect(envelope).toContain('<sh:password>secret-1</sh:password>');
    expect(envelope).not.toContain('<urn:wsVersion>');
    expect(envelope).not.toContain('<urn:id>');
    expect(envelope).not.toContain('<urn:password>');
  });

  it('serializes PricingAndConfiguration child fields in schema order', () => {
    const envelope = buildSoapEnvelope(
      {
        endpointUrl: 'https://vendor.example.com',
        endpointName: 'PricingAndConfiguration',
        endpointVersion: '1.0.0',
        operationName: 'getConfigurationAndPricing',
        vendorAccountId: 'acct-1',
        vendorSecret: 'secret-1',
        requestFields: {
          productId: '100062',
          localizationCountry: 'US',
          localizationLanguage: 'en',
          partId: '100062-001',
          currency: 'USD',
          fobId: '1',
          priceType: 'List',
          configurationType: 'Decorated',
        },
      },
      getBuiltInSoapOperationMetadata({
        endpointName: 'PricingAndConfiguration',
        endpointVersion: '1.0.0',
        operationName: 'getConfigurationAndPricing',
      }),
    );

    expect(envelope.indexOf('<sh:productId>100062</sh:productId>')).toBeLessThan(
      envelope.indexOf('<sh:partId>100062-001</sh:partId>'),
    );
    expect(envelope.indexOf('<sh:partId>100062-001</sh:partId>')).toBeLessThan(
      envelope.indexOf('<sh:currency>USD</sh:currency>'),
    );
    expect(envelope.indexOf('<sh:currency>USD</sh:currency>')).toBeLessThan(
      envelope.indexOf('<sh:fobId>1</sh:fobId>'),
    );
    expect(envelope.indexOf('<sh:fobId>1</sh:fobId>')).toBeLessThan(
      envelope.indexOf('<sh:priceType>List</sh:priceType>'),
    );
    expect(envelope.indexOf('<sh:priceType>List</sh:priceType>')).toBeLessThan(
      envelope.indexOf('<sh:localizationCountry>US</sh:localizationCountry>'),
    );
    expect(envelope.indexOf('<sh:localizationCountry>US</sh:localizationCountry>')).toBeLessThan(
      envelope.indexOf('<sh:localizationLanguage>en</sh:localizationLanguage>'),
    );
    expect(envelope.indexOf('<sh:localizationLanguage>en</sh:localizationLanguage>')).toBeLessThan(
      envelope.indexOf('<sh:configurationType>Blank</sh:configurationType>'),
    );
  });

  it('keeps child elements in the request namespace when no shared namespace is required', () => {
    const envelope = buildSoapEnvelope(
      {
        endpointUrl: 'https://vendor.example.com',
        endpointName: 'ProductCompliance',
        endpointVersion: '1.0.0',
        operationName: 'getCompliance',
        vendorAccountId: 'acct-1',
        vendorSecret: 'secret-1',
      },
      {
        requestElementName: 'GetComplianceRequest',
        targetNamespace: 'http://www.promostandards.org/WSDL/ProductComplianceService/1.0.0/',
      },
    );

    expect(envelope).toContain('<tns:GetComplianceRequest>');
    expect(envelope).not.toContain('xmlns:sh=');
    expect(envelope).toContain('<wsVersion>1.0.0</wsVersion>');
    expect(envelope).toContain('<id>acct-1</id>');
    expect(envelope).toContain('<password>secret-1</password>');
  });
});
