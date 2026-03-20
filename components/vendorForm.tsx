import { useMemo, useState } from 'react';
import type {
  CustomApiServiceType,
  MappingProtocol,
  PromostandardsCapabilityMatrix,
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

function buildConnectionFingerprint(values: VendorFormData): string {
  return [
    values.vendor_api_url ?? '',
    values.vendor_account_id ?? '',
    values.vendor_secret ?? '',
    values.integration_family,
    values.api_protocol ?? '',
  ].join('|');
}

function getInitialValues(initialValues?: VendorFormData): VendorFormData {
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
    promostandards_capabilities: initialValues?.promostandards_capabilities ?? null,
    connection_tested: initialValues?.connection_tested ?? false,
    connection_config: initialValues?.connection_config ?? {},
    auto_sync: initialValues?.auto_sync ?? true,
  };
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
    initialValues?.promostandards_capabilities ? 'success' : 'idle',
  );
  const [connectionMessage, setConnectionMessage] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastTestFingerprint, setLastTestFingerprint] = useState(() =>
    initialValues?.promostandards_capabilities ? buildConnectionFingerprint(getInitialValues(initialValues)) : '',
  );

  const currentFingerprint = buildConnectionFingerprint(values);
  const requiresPromoTest = requireConnectionTest && values.integration_family === 'PROMOSTANDARDS';
  const hasAvailablePromoEndpoints =
    (values.promostandards_capabilities?.available_endpoint_count ?? 0) > 0;
  const isPromoDiscoveryCurrent =
    connectionStatus === 'success' &&
    lastTestFingerprint === currentFingerprint &&
    hasAvailablePromoEndpoints;

  const activeConnectionMessage =
    connectionStatus === 'success' && !isPromoDiscoveryCurrent
      ? 'Vendor settings changed. Run Test Vendor again to refresh PromoStandards capabilities.'
      : connectionMessage;
  const promoEndpointRows = useMemo(
    () => values.promostandards_capabilities?.endpoints ?? [],
    [values.promostandards_capabilities],
  );

  const canSubmit =
    !isSubmitting &&
    values.vendor_name.trim().length > 0 &&
    (values.integration_family === 'PROMOSTANDARDS'
      ? !requiresPromoTest || isPromoDiscoveryCurrent
      : Boolean(values.custom_api_service_type));

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
        } else {
          next.promostandards_capabilities = null;
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

  const handleTestConnection = async () => {
    if (!onTestConnection) return;
    if (!values.vendor_api_url?.trim()) {
      setConnectionStatus('failed');
      setConnectionMessage('Vendor API is required before testing.');
      return;
    }

    setConnectionStatus('testing');
    setConnectionMessage('Testing vendor connection and discovering available PromoStandards endpoints...');

    try {
      const result = await onTestConnection({
        vendor_api_url: values.vendor_api_url,
        vendor_account_id: values.vendor_account_id,
        vendor_secret: values.vendor_secret,
        integration_family: values.integration_family,
        api_protocol: values.api_protocol ?? 'SOAP',
      });

      const capabilities: PromostandardsCapabilityMatrix | null =
        values.integration_family === 'PROMOSTANDARDS'
          ? {
              available_endpoint_count: result.available_endpoint_count ?? 0,
              endpoints: result.endpoints ?? [],
              fingerprint: result.fingerprint ?? '',
              tested_at: result.tested_at ?? new Date().toISOString(),
            }
          : null;

      setValues(prev => ({
        ...prev,
        promostandards_capabilities: capabilities,
        connection_tested: result.ok,
      }));
      setConnectionStatus(result.ok ? 'success' : 'failed');
      setConnectionMessage(result.message ?? (result.ok ? 'Connection successful.' : 'Connection failed.'));
      setLastTestFingerprint(currentFingerprint);
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
        promostandards_capabilities:
          values.integration_family === 'PROMOSTANDARDS' ? values.promostandards_capabilities ?? null : null,
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
            Configure vendor credentials, choose the API family, and validate the connection before saving.
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
            value={values.vendor_name}
            onChange={event => handleFieldChange('vendor_name', event.target.value)}
            style={textInputStyle}
          />
        </label>

        <label>
          <span style={fieldLabelStyle}>Vendor Type</span>
          <select
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

        <label>
          <span style={fieldLabelStyle}>Vendor API</span>
          <input
            value={values.vendor_api_url ?? ''}
            onChange={event => handleFieldChange('vendor_api_url', event.target.value)}
            style={textInputStyle}
          />
        </label>

        <label>
          <span style={fieldLabelStyle}>Vendor Account ID</span>
          <input
            value={values.vendor_account_id ?? ''}
            onChange={event => handleFieldChange('vendor_account_id', event.target.value)}
            style={textInputStyle}
          />
        </label>

        <label>
          <span style={fieldLabelStyle}>Vendor Secret</span>
          <input
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
          <InlineNotice
            tone={connectionStatus === 'failed' ? 'error' : connectionStatus === 'success' ? 'success' : 'info'}
            title={
              connectionStatus === 'success'
                ? 'PromoStandards discovery complete'
                : connectionStatus === 'testing'
                  ? 'Testing vendor connection'
                  : 'PromoStandards discovery required'
            }
            description={
              activeConnectionMessage ||
              'Run Test Vendor to discover which PromoStandards endpoint versions are available for this vendor.'
            }
          />

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
                gridTemplateColumns: '1.1fr 0.8fr 1fr 0.8fr',
                padding: '12px 16px',
              }}
            >
              <span>Endpoint</span>
              <span>Version</span>
              <span>Operation</span>
              <span>Status</span>
            </div>
            {promoEndpointRows.length === 0 ? (
              <div style={{ color: '#64748b', padding: '18px 16px' }}>
                No PromoStandards discovery results yet.
              </div>
            ) : (
              promoEndpointRows.map(endpoint => (
                <div
                  key={`${endpoint.endpoint_name}|${endpoint.endpoint_version}`}
                  style={{
                    borderBottom: '1px solid #eef2f7',
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: '1.1fr 0.8fr 1fr 0.8fr',
                    padding: '14px 16px',
                  }}
                >
                  <div>
                    <div style={{ color: '#0f172a', fontWeight: 700 }}>{endpoint.endpoint_name}</div>
                    <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>{endpoint.message}</div>
                  </div>
                  <div style={{ color: '#334155' }}>{endpoint.endpoint_version}</div>
                  <div style={{ color: '#334155' }}>{endpoint.operation_name}</div>
                  <div
                    style={{
                      color: endpoint.available ? '#047857' : '#b91c1c',
                      fontWeight: 700,
                    }}
                  >
                    {endpoint.available ? 'Available' : 'Unavailable'}
                  </div>
                </div>
              ))
            )}
          </div>
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
