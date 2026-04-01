import { useMemo, useState } from 'react';
import type {
  CustomApiServiceType,
  MappingProtocol,
  PromostandardsCapabilityMatrix,
  PromostandardsEndpointCapability,
  VendorConnectionTestResult,
  VendorFormData,
} from '../types';
import {
  InlineNotice,
  fieldLabelStyle,
  pageCardStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  sectionTitleStyle,
  textInputStyle,
} from './operator/ui';

interface VendorFormProps {
  initialValues?: VendorFormData;
  onSubmit: (data: VendorFormData) => Promise<void> | void;
  onCancel: () => void;
  onTestConnection?: (data: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    integration_family?: VendorFormData['integration_family'];
    api_protocol?: MappingProtocol;
    hasCompanyDataEndpoint?: boolean;
    companyDataEndpointUrl?: string;
    promostandardsEndpoints?: PromostandardsEndpointCapability[];
  }) => Promise<VendorConnectionTestResult>;
  requireConnectionTest?: boolean;
}

const integrationFamilyOptions: Array<{ value: VendorFormData['integration_family']; label: string }> = [
  { value: 'PROMOSTANDARDS', label: 'PromoStandards' },
  { value: 'CUSTOM', label: 'Other' },
];

const vendorTypeOptions: Array<{ value: VendorFormData['vendor_type']; label: string }> = [
  { value: 'SUPPLIER', label: 'Supplier' },
  { value: 'DECORATOR', label: 'Decorator' },
];

const customApiServiceTypeOptions: Array<{ value: CustomApiServiceType; label: string }> = [
  { value: 'REST_API', label: 'REST API' },
  { value: 'SOAP_API', label: 'SOAP API' },
  { value: 'JSON_FEED', label: 'JSON Feed' },
  { value: 'XML_FEED', label: 'XML Feed' },
  { value: 'CSV_FEED', label: 'CSV Feed' },
];

const PROMOSTANDARDS_ENDPOINT_NAMES = [
  'CompanyData',
  'Inventory',
  'ProductMedia',
  'ProductCompliance',
  'ProductData',
  'PricingAndConfiguration',
  'purchaseOrder',
  'OrderStatusService',
  'OrderShipmentNotification',
  'Invoice',
  'RemittanceAdvice',
] as const;

function getProtocolForServiceType(serviceType: CustomApiServiceType | undefined): MappingProtocol | null {
  switch (serviceType) {
    case 'REST_API':
      return 'REST';
    case 'SOAP_API':
      return 'SOAP';
    case 'JSON_FEED':
      return 'JSON';
    case 'XML_FEED':
      return 'XML';
    case 'CSV_FEED':
    default:
      return null;
  }
}

function buildEmptyPromoEndpoint(endpointName: string): PromostandardsEndpointCapability {
  const endpointVersion = endpointName === 'CompanyData' ? '1.0.0' : null;
  return {
    endpointName,
    endpointVersion,
    endpointUrl: '',
    available: false,
    status_code: null,
    message: '',
    wsdl_available: null,
    credentials_valid: null,
    live_probe_message: null,
    versionDetectionStatus: endpointVersion ? 'manual' : 'failed',
    requiresManualVersionSelection: true,
    availableVersions: endpointVersion ? [endpointVersion] : [],
  };
}

function mergePromostandardsEndpoints(
  currentEndpoints: PromostandardsEndpointCapability[],
  options?: { includeAllSupportedEndpoints?: boolean },
): PromostandardsEndpointCapability[] {
  const endpointByName = new Map(currentEndpoints.map(endpoint => [endpoint.endpointName, endpoint]));
  const nextEndpoints = options?.includeAllSupportedEndpoints
    ? PROMOSTANDARDS_ENDPOINT_NAMES.map(endpointName => endpointByName.get(endpointName) ?? buildEmptyPromoEndpoint(endpointName))
    : currentEndpoints;

  if (options?.includeAllSupportedEndpoints && !endpointByName.has('CompanyData')) {
    return nextEndpoints.map(endpoint => endpoint.endpointName === 'CompanyData' ? buildEmptyPromoEndpoint('CompanyData') : endpoint);
  }

  return nextEndpoints;
}

function inferHasCompanyDataEndpoint(input?: VendorFormData): boolean {
  if (typeof input?.hasCompanyDataEndpoint === 'boolean') {
    return input.hasCompanyDataEndpoint;
  }

  return Boolean(
    input?.companyDataEndpointUrl?.trim() ||
      input?.promostandardsCapabilities?.endpoints.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl?.trim(),
  );
}

function buildConnectionFingerprint(values: VendorFormData): string {
  return JSON.stringify({
    vendorAccountId: values.vendor_account_id ?? '',
    vendorSecret: values.vendor_secret ?? '',
    integrationFamily: values.integration_family,
    hasCompanyDataEndpoint: values.hasCompanyDataEndpoint ?? false,
    companyDataEndpointUrl: values.companyDataEndpointUrl ?? '',
    promostandardsEndpoints: (values.promostandardsEndpoints ?? []).map(endpoint => ({
      endpointName: endpoint.endpointName,
      endpointVersion: endpoint.endpointVersion ?? '',
      endpointUrl: endpoint.endpointUrl ?? '',
    })),
  });
}

function getInitialPromostandardsEndpoints(initialValues?: VendorFormData): PromostandardsEndpointCapability[] {
  const currentEndpoints =
    initialValues?.promostandardsEndpoints ??
    initialValues?.promostandardsCapabilities?.endpoints ??
    [];

  if (inferHasCompanyDataEndpoint(initialValues)) {
    return currentEndpoints.length > 0 ? currentEndpoints : [buildEmptyPromoEndpoint('CompanyData')];
  }

  return mergePromostandardsEndpoints(currentEndpoints, { includeAllSupportedEndpoints: true });
}

function getInitialValues(initialValues?: VendorFormData): VendorFormData {
  const hasCompanyDataEndpoint = inferHasCompanyDataEndpoint(initialValues);
  const promostandardsEndpoints = getInitialPromostandardsEndpoints(initialValues);
  const companyDataEndpointUrl =
    initialValues?.companyDataEndpointUrl ??
    promostandardsEndpoints.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl ??
    '';

  return {
    vendor_name: initialValues?.vendor_name ?? '',
    vendor_type: initialValues?.vendor_type ?? 'SUPPLIER',
    vendor_api_url: initialValues?.vendor_api_url ?? '',
    vendor_account_id: initialValues?.vendor_account_id ?? '',
    vendor_secret: initialValues?.vendor_secret ?? '',
    integration_family: initialValues?.integration_family ?? 'PROMOSTANDARDS',
    api_protocol: initialValues?.api_protocol ?? 'SOAP',
    custom_api_service_type: initialValues?.custom_api_service_type,
    custom_api_format_data: initialValues?.custom_api_format_data ?? '',
    endpoint_mappings: initialValues?.endpoint_mappings ?? [],
    endpoint_mapping_ids: initialValues?.endpoint_mapping_ids ?? [],
    connection_tested: initialValues?.connection_tested ?? false,
    hasCompanyDataEndpoint,
    companyDataEndpointUrl,
    promostandardsEndpoints,
    promostandardsCapabilities: initialValues?.promostandardsCapabilities ?? null,
    connection_config: initialValues?.connection_config ?? {},
    auto_sync: initialValues?.auto_sync ?? true,
  };
}

function compactPromostandardsCapabilities(
  capabilities: PromostandardsCapabilityMatrix | null | undefined,
): PromostandardsCapabilityMatrix | null {
  if (!capabilities) {
    return null;
  }

  return {
    fingerprint: capabilities.fingerprint,
    testedAt: capabilities.testedAt,
    availableEndpointCount: capabilities.availableEndpointCount,
    credentialsValid: capabilities.credentialsValid ?? null,
    endpoints: capabilities.endpoints.map(endpoint => ({
      endpointName: endpoint.endpointName,
      endpointVersion: endpoint.endpointVersion ?? null,
      endpointUrl: endpoint.endpointUrl ?? '',
      available: endpoint.available,
      status_code: endpoint.status_code,
      message: endpoint.message,
      wsdl_available: endpoint.wsdl_available ?? null,
      credentials_valid: endpoint.credentials_valid ?? null,
      live_probe_message: endpoint.live_probe_message ?? null,
      versionDetectionStatus: endpoint.versionDetectionStatus ?? 'failed',
      requiresManualVersionSelection: endpoint.requiresManualVersionSelection ?? true,
      availableVersions: endpoint.availableVersions ?? [],
    })),
  };
}

function mergeEndpointTestResults(
  currentEndpoints: PromostandardsEndpointCapability[],
  testedEndpoints: PromostandardsEndpointCapability[],
  includeAllSupportedEndpoints: boolean,
): PromostandardsEndpointCapability[] {
  const testedByName = new Map(testedEndpoints.map(endpoint => [endpoint.endpointName, endpoint]));
  const merged = currentEndpoints.map(endpoint => testedByName.get(endpoint.endpointName) ?? endpoint);
  return includeAllSupportedEndpoints
    ? mergePromostandardsEndpoints(merged, { includeAllSupportedEndpoints: true })
    : testedEndpoints;
}

const VendorForm = ({
  initialValues,
  onSubmit,
  onCancel,
  onTestConnection,
  requireConnectionTest = false,
}: VendorFormProps) => {
  const [values, setValues] = useState<VendorFormData>(() => getInitialValues(initialValues));
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>(
    initialValues?.promostandardsCapabilities ? 'success' : 'idle',
  );
  const [connectionMessage, setConnectionMessage] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastTestFingerprint, setLastTestFingerprint] = useState(() =>
    initialValues?.promostandardsCapabilities ? buildConnectionFingerprint(getInitialValues(initialValues)) : '',
  );

  const currentFingerprint = buildConnectionFingerprint(values);
  const requiresPromoTest = requireConnectionTest && values.integration_family === 'PROMOSTANDARDS';
  const hasAvailablePromoEndpoints =
    (values.promostandardsCapabilities?.availableEndpointCount ?? 0) > 0;
  const isPromoDiscoveryCurrent =
    connectionStatus === 'success' &&
    lastTestFingerprint === currentFingerprint &&
    hasAvailablePromoEndpoints;

  const canSubmit =
    !isSubmitting &&
    values.vendor_name.trim().length > 0 &&
    (values.integration_family === 'PROMOSTANDARDS'
      ? !requiresPromoTest || isPromoDiscoveryCurrent
      : Boolean(values.custom_api_service_type));

  const promoEndpoints = useMemo(
    () => values.promostandardsEndpoints ?? [],
    [values.promostandardsEndpoints],
  );

  const handleFieldChange = <K extends keyof VendorFormData>(key: K, nextValue: VendorFormData[K]) => {
    setSubmissionError('');
    if (key === 'integration_family') {
      setConnectionStatus('idle');
      setConnectionMessage('');
      setLastTestFingerprint('');
    }

    setValues(prev => {
      const next = {
        ...prev,
        [key]: nextValue,
      };

      if (key === 'integration_family') {
        if (nextValue === 'PROMOSTANDARDS') {
          next.api_protocol = 'SOAP';
          next.custom_api_service_type = undefined;
          next.custom_api_format_data = '';
          next.hasCompanyDataEndpoint = true;
          next.promostandardsEndpoints = [buildEmptyPromoEndpoint('CompanyData')];
          next.promostandardsCapabilities = null;
        } else {
          next.promostandardsCapabilities = null;
          next.connection_tested = false;
          next.api_protocol = getProtocolForServiceType(next.custom_api_service_type);
        }
      }

      if (key === 'custom_api_service_type') {
        next.api_protocol = getProtocolForServiceType(nextValue as CustomApiServiceType);
      }

      return next;
    });
  };

  const handleHasCompanyDataEndpointChange = (nextValue: boolean) => {
    setConnectionStatus('idle');
    setConnectionMessage('');
    setLastTestFingerprint('');

    setValues(prev => {
      const currentEndpoints = prev.promostandardsEndpoints ?? [];
      const nextEndpoints = nextValue
        ? currentEndpoints.length > 0
          ? currentEndpoints
          : [buildEmptyPromoEndpoint('CompanyData')]
        : mergePromostandardsEndpoints(currentEndpoints, { includeAllSupportedEndpoints: true });

      return {
        ...prev,
        hasCompanyDataEndpoint: nextValue,
        promostandardsEndpoints: nextEndpoints,
        companyDataEndpointUrl:
          nextEndpoints.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl ?? '',
        promostandardsCapabilities: null,
        endpoint_mapping_ids: [],
      };
    });
  };

  const handleCompanyDataUrlChange = (nextValue: string) => {
    setConnectionStatus('idle');
    setConnectionMessage('');
    setLastTestFingerprint('');
    setValues(prev => ({
      ...prev,
      companyDataEndpointUrl: nextValue,
      promostandardsEndpoints: (prev.promostandardsEndpoints ?? []).map(endpoint =>
        endpoint.endpointName === 'CompanyData'
          ? {
              ...endpoint,
              endpointUrl: nextValue,
            }
          : endpoint,
      ),
    }));
  };

  const handlePromoEndpointFieldChange = (
    endpointName: string,
    patch: Partial<PromostandardsEndpointCapability>,
  ) => {
    setConnectionStatus('idle');
    setConnectionMessage('');
    setLastTestFingerprint('');
    setValues(prev => ({
      ...prev,
      promostandardsEndpoints: (prev.promostandardsEndpoints ?? []).map(endpoint =>
        endpoint.endpointName === endpointName
          ? {
              ...endpoint,
              ...patch,
            }
          : endpoint,
      ),
    }));
  };

  const handleTestConnection = async () => {
    if (!onTestConnection) return;

    setConnectionStatus('testing');
    setConnectionMessage('Testing PromoStandards endpoint configuration...');

    try {
      const result =
        values.integration_family === 'PROMOSTANDARDS'
          ? await onTestConnection({
              vendor_account_id: values.vendor_account_id,
              vendor_secret: values.vendor_secret,
              integration_family: values.integration_family,
              api_protocol: values.api_protocol ?? 'SOAP',
              hasCompanyDataEndpoint: values.hasCompanyDataEndpoint,
              companyDataEndpointUrl: values.companyDataEndpointUrl,
              promostandardsEndpoints: values.hasCompanyDataEndpoint
                ? undefined
                : values.promostandardsEndpoints,
            })
          : await onTestConnection({
              vendor_api_url: values.vendor_api_url,
              vendor_account_id: values.vendor_account_id,
              vendor_secret: values.vendor_secret,
              integration_family: values.integration_family,
              api_protocol: values.api_protocol ?? undefined,
            });

      const nextCapabilities: PromostandardsCapabilityMatrix | null =
        values.integration_family === 'PROMOSTANDARDS'
          ? {
              fingerprint: result.fingerprint ?? '',
              testedAt: result.testedAt ?? new Date().toISOString(),
              availableEndpointCount: result.availableEndpointCount ?? 0,
              credentialsValid: result.credentialsValid ?? null,
              endpoints: result.endpoints ?? [],
            }
          : null;

      const testedEndpoints = result.endpoints ?? [];
      const includeAllSupportedEndpoints = values.hasCompanyDataEndpoint !== true;
      const nextEndpoints =
        values.integration_family === 'PROMOSTANDARDS'
          ? mergeEndpointTestResults(
              values.promostandardsEndpoints ?? [],
              testedEndpoints,
              includeAllSupportedEndpoints,
            )
          : values.promostandardsEndpoints;

      const nextValues = {
        ...values,
        endpoint_mapping_ids: result.endpointMappingIds ?? [],
        promostandardsCapabilities: nextCapabilities,
        promostandardsEndpoints: nextEndpoints,
        companyDataEndpointUrl:
          nextEndpoints?.find(endpoint => endpoint.endpointName === 'CompanyData')?.endpointUrl ??
          values.companyDataEndpointUrl,
        connection_tested: result.ok,
      };

      setValues(nextValues);

      setConnectionStatus(result.ok ? 'success' : 'failed');
      setConnectionMessage(result.message ?? (result.ok ? 'Connection successful.' : 'Connection failed.'));
      setLastTestFingerprint(buildConnectionFingerprint(nextValues));
    } catch (error) {
      setConnectionStatus('failed');
      setConnectionMessage(error instanceof Error ? error.message : 'Vendor connection test failed.');
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      if (requiresPromoTest && !isPromoDiscoveryCurrent) {
        setConnectionStatus('failed');
        setConnectionMessage('Run Test Vendor successfully before saving this PromoStandards vendor.');
      }
      return;
    }

    setIsSubmitting(true);
    setSubmissionError('');

    try {
      await onSubmit({
        ...values,
        vendor_name: values.vendor_name.trim(),
        vendor_api_url: values.vendor_api_url?.trim() || undefined,
        vendor_account_id: values.vendor_account_id?.trim() || undefined,
        vendor_secret: values.vendor_secret?.trim() || undefined,
        api_protocol:
          values.integration_family === 'PROMOSTANDARDS'
            ? 'SOAP'
            : getProtocolForServiceType(values.custom_api_service_type),
        endpoint_mappings: [],
        promostandardsCapabilities:
          values.integration_family === 'PROMOSTANDARDS'
            ? compactPromostandardsCapabilities(values.promostandardsCapabilities)
            : null,
        promostandardsEndpoints:
          values.integration_family === 'PROMOSTANDARDS'
            ? values.promostandardsEndpoints
            : [],
        connection_tested:
          values.integration_family === 'PROMOSTANDARDS' ? isPromoDiscoveryCurrent : true,
      });
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : 'Failed to save vendor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ ...pageCardStyle, display: 'grid', gap: '24px' }}>
      <div style={{ alignItems: 'flex-start', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
        <div>
          <h2 style={sectionTitleStyle}>{initialValues ? 'Edit Vendor' : 'Add New Vendor'}</h2>
          <p style={{ color: '#475569', margin: '8px 0 0' }}>
            Configure vendor credentials, endpoint URLs, and validate the connection before saving.
          </p>
        </div>
        {values.integration_family === 'PROMOSTANDARDS' ? (
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={connectionStatus === 'testing'}
            style={{
              ...secondaryButtonStyle,
              opacity: connectionStatus === 'testing' ? 0.6 : 1,
            }}
          >
            {connectionStatus === 'testing' ? 'Testing Vendor...' : 'Test Vendor'}
          </button>
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: '18px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <label>
          <span style={fieldLabelStyle}>Vendor Name</span>
          <input
            aria-label="Vendor Name"
            value={values.vendor_name}
            onChange={event => handleFieldChange('vendor_name', event.target.value)}
            style={textInputStyle}
          />
        </label>

        <label>
          <span style={fieldLabelStyle}>Vendor Type</span>
          <select
            aria-label="Vendor Type"
            value={values.vendor_type}
            onChange={event => handleFieldChange('vendor_type', event.target.value as VendorFormData['vendor_type'])}
            style={textInputStyle}
          >
            {vendorTypeOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span style={fieldLabelStyle}>API Type</span>
          <select
            aria-label="API Type"
            value={values.integration_family}
            onChange={event =>
              handleFieldChange('integration_family', event.target.value as VendorFormData['integration_family'])
            }
            style={textInputStyle}
          >
            {integrationFamilyOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {values.integration_family === 'CUSTOM' ? (
          <label>
            <span style={fieldLabelStyle}>Vendor API</span>
            <input
              aria-label="Vendor API"
              value={values.vendor_api_url ?? ''}
              onChange={event => handleFieldChange('vendor_api_url', event.target.value)}
              style={textInputStyle}
            />
          </label>
        ) : null}

        <label>
          <span style={fieldLabelStyle}>Vendor Account ID</span>
          <input
            aria-label="Vendor Account ID"
            value={values.vendor_account_id ?? ''}
            onChange={event => handleFieldChange('vendor_account_id', event.target.value)}
            style={textInputStyle}
          />
        </label>

        <label>
          <span style={fieldLabelStyle}>Vendor Secret</span>
          <input
            aria-label="Vendor Secret"
            type="password"
            value={values.vendor_secret ?? ''}
            onChange={event => handleFieldChange('vendor_secret', event.target.value)}
            style={textInputStyle}
          />
        </label>
      </div>

      {values.integration_family === 'CUSTOM' ? (
        <div style={{ display: 'grid', gap: '18px' }}>
          <label>
            <span style={fieldLabelStyle}>API Service Type</span>
            <select
              aria-label="API Service Type"
              value={values.custom_api_service_type ?? ''}
              onChange={event =>
                handleFieldChange(
                  'custom_api_service_type',
                  (event.target.value || undefined) as VendorFormData['custom_api_service_type'],
                )
              }
              style={textInputStyle}
            >
              <option value="">Select a service type</option>
              {customApiServiceTypeOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span style={fieldLabelStyle}>Format Data</span>
            <textarea
              aria-label="Format Data"
              value={values.custom_api_format_data ?? ''}
              onChange={event => handleFieldChange('custom_api_format_data', event.target.value)}
              rows={8}
              style={{
                ...textInputStyle,
                minHeight: '180px',
                resize: 'vertical',
              }}
            />
          </label>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label>
              <span style={fieldLabelStyle}>Has CompanyData Endpoint</span>
              <select
                aria-label="Has CompanyData Endpoint"
                value={values.hasCompanyDataEndpoint ? 'yes' : 'no'}
                onChange={event => handleHasCompanyDataEndpointChange(event.target.value === 'yes')}
                style={textInputStyle}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            {values.hasCompanyDataEndpoint ? (
              <label>
                <span style={fieldLabelStyle}>CompanyData Endpoint URL</span>
                <input
                  aria-label="CompanyData Endpoint URL"
                  value={values.companyDataEndpointUrl ?? ''}
                  onChange={event => handleCompanyDataUrlChange(event.target.value)}
                  style={textInputStyle}
                />
              </label>
            ) : null}
          </div>

          <InlineNotice
            tone={connectionStatus === 'failed' ? 'error' : connectionStatus === 'success' ? 'success' : 'info'}
            title={
              connectionStatus === 'success'
                ? 'PromoStandards endpoint test complete'
                : connectionStatus === 'testing'
                  ? 'Testing PromoStandards endpoints'
                  : 'PromoStandards endpoint validation required'
            }
            description={
              connectionMessage ||
              'Run Test Vendor to confirm the configured PromoStandards endpoint URLs before saving.'
            }
          />

          {(!values.hasCompanyDataEndpoint || promoEndpoints.length > 1 || initialValues) ? (
            <div
              style={{
                border: '1px solid #dbe3ef',
                borderRadius: '14px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: '#f8fafc',
                  borderBottom: '1px solid #dbe3ef',
                  color: '#0f172a',
                  display: 'grid',
                  fontSize: '13px',
                  fontWeight: 700,
                  gap: '12px',
                  gridTemplateColumns: '1fr 1.5fr 0.75fr 0.9fr',
                  padding: '12px 16px',
                }}
              >
                <span>Endpoint</span>
                <span>Full URL</span>
                <span>Version</span>
                <span>Status</span>
              </div>
              {promoEndpoints.map(endpoint => (
                <div
                  key={endpoint.endpointName}
                  style={{
                    borderBottom: '1px solid #eef2f7',
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: '1fr 1.5fr 0.75fr 0.9fr',
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ color: '#0f172a', fontWeight: 700 }}>{endpoint.endpointName}</div>
                  <input
                    aria-label={`${endpoint.endpointName} Endpoint URL`}
                    value={endpoint.endpointUrl}
                    onChange={event =>
                      handlePromoEndpointFieldChange(endpoint.endpointName, {
                        endpointUrl: event.target.value,
                        available: false,
                      })
                    }
                    style={textInputStyle}
                  />
                  {endpoint.requiresManualVersionSelection ? (
                    <select
                      aria-label={`${endpoint.endpointName} Endpoint Version`}
                      value={endpoint.endpointVersion ?? ''}
                      onChange={event =>
                        handlePromoEndpointFieldChange(endpoint.endpointName, {
                          endpointVersion: event.target.value || null,
                          versionDetectionStatus: event.target.value ? 'manual' : 'failed',
                          requiresManualVersionSelection: !event.target.value,
                        })
                      }
                      style={textInputStyle}
                    >
                      <option value="">Select version</option>
                      {(endpoint.availableVersions ?? []).map(version => (
                        <option key={version} value={version}>
                          {version}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{ color: '#334155' }}>{endpoint.endpointVersion ?? 'Detect on test'}</div>
                  )}
                  <div
                    style={{
                      color: endpoint.available ? '#047857' : endpoint.message ? '#b45309' : '#64748b',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    {endpoint.available ? 'Confirmed' : endpoint.message || 'Not tested'}
                    {endpoint.live_probe_message ? (
                      <div style={{ color: '#64748b', fontWeight: 400, marginTop: '4px' }}>
                        {endpoint.live_probe_message}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {submissionError ? (
        <InlineNotice tone="error" title="Unable to save vendor" description={submissionError} />
      ) : null}

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            ...primaryButtonStyle,
            opacity: canSubmit ? 1 : 0.55,
          }}
        >
          {isSubmitting ? 'Saving Vendor...' : initialValues ? 'Save Vendor Changes' : 'Save Vendor'}
        </button>
      </div>
    </form>
  );
};

export default VendorForm;
