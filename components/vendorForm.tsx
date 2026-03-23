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
    endpoint_name?: string;
    endpoint_version?: string;
    operation_name?: string;
    runtime_config?: Record<string, unknown>;
  }) => Promise<VendorConnectionTestResult>;
  requireConnectionTest?: boolean;
}

interface PromoEndpointGroup {
  key: string;
  endpoint_name: string;
  endpoint_version: string;
  operations: PromostandardsCapabilityMatrix['endpoints'];
  operation_names: string[];
  available_count: number;
  wsdl_available: boolean | null;
  credentials_valid: boolean | null;
  resolved_endpoint_url: string | null;
  custom_endpoint_url: string | null;
  summary_message: string;
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

function compactPromoCapabilitiesForSubmission(
  capabilities: PromostandardsCapabilityMatrix | null | undefined,
): PromostandardsCapabilityMatrix | null {
  if (!capabilities) {
    return null;
  }

  return {
    fingerprint: capabilities.fingerprint,
    tested_at: capabilities.tested_at,
    available_endpoint_count: capabilities.available_endpoint_count,
    credentials_valid: capabilities.credentials_valid ?? null,
    endpoints: capabilities.endpoints.map(endpoint => ({
      endpoint_name: endpoint.endpoint_name,
      endpoint_version: endpoint.endpoint_version,
      operation_name: endpoint.operation_name,
      capability_scope: endpoint.capability_scope,
      lifecycle_role: endpoint.lifecycle_role,
      optional_by_vendor: endpoint.optional_by_vendor,
      recommended_poll_minutes: endpoint.recommended_poll_minutes ?? null,
      available: endpoint.available,
      status_code: endpoint.status_code,
      message: endpoint.message,
      wsdl_available: endpoint.wsdl_available ?? null,
      credentials_valid: endpoint.credentials_valid ?? null,
      live_probe_message: endpoint.live_probe_message ?? null,
      resolved_endpoint_url: endpoint.resolved_endpoint_url ?? null,
      custom_endpoint_url: endpoint.custom_endpoint_url ?? null,
    })),
  };
}

function getPromoEndpointGroupKey(endpoint: PromostandardsCapabilityMatrix['endpoints'][number]): string {
  return `${endpoint.endpoint_name}|${endpoint.endpoint_version}`;
}

function summarizePromoEndpointGroup(
  operations: PromostandardsCapabilityMatrix['endpoints'],
): string {
  if (operations.length === 1) {
    const operation = operations[0];
    return `${operation.message}${operation.live_probe_message ? ` ${operation.live_probe_message}` : ''}`;
  }

  const availableCount = operations.filter(operation => operation.available).length;
  if (availableCount === operations.length) {
    return `All ${operations.length} operations on this endpoint version were confirmed.`;
  }
  if (availableCount > 0) {
    return `${availableCount} of ${operations.length} operations on this endpoint version were confirmed.`;
  }
  return `No operations on this endpoint version were confirmed yet.`;
}

function buildPromoEndpointGroups(
  endpoints: PromostandardsCapabilityMatrix['endpoints'],
): PromoEndpointGroup[] {
  const grouped = new Map<string, PromostandardsCapabilityMatrix['endpoints']>();

  for (const endpoint of endpoints) {
    const key = getPromoEndpointGroupKey(endpoint);
    const existing = grouped.get(key) ?? [];
    existing.push(endpoint);
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .map(([key, operations]) => {
      const first = operations[0];
      const operationNames = Array.from(new Set(operations.map(operation => operation.operation_name))).sort();
      const availableCount = operations.filter(operation => operation.available).length;
      const wsdlAvailable = operations.some(operation => operation.wsdl_available === true)
        ? true
        : operations.every(operation => operation.wsdl_available === false)
          ? false
          : null;
      const credentialsValid = operations.some(operation => operation.credentials_valid === true)
        ? true
        : operations.some(operation => operation.credentials_valid === false)
          ? false
          : null;

      return {
        key,
        endpoint_name: first.endpoint_name,
        endpoint_version: first.endpoint_version,
        operations,
        operation_names: operationNames,
        available_count: availableCount,
        wsdl_available: wsdlAvailable,
        credentials_valid: credentialsValid,
        resolved_endpoint_url: operations.find(operation => operation.resolved_endpoint_url)?.resolved_endpoint_url ?? null,
        custom_endpoint_url: operations.find(operation => operation.custom_endpoint_url)?.custom_endpoint_url ?? null,
        summary_message: summarizePromoEndpointGroup(operations),
      };
    })
    .sort((left, right) => {
      if (left.endpoint_name !== right.endpoint_name) {
        return left.endpoint_name.localeCompare(right.endpoint_name);
      }
      return left.endpoint_version.localeCompare(right.endpoint_version);
    });
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
  const [endpointTestStatus, setEndpointTestStatus] = useState<Record<string, {
    status: 'idle' | 'testing' | 'success' | 'failed';
    message: string;
  }>>({});
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
  const promoEndpointGroups = useMemo(
    () => buildPromoEndpointGroups(promoEndpointRows),
    [promoEndpointRows],
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

  const handlePromoEndpointFieldChange = (
    groupKey: string,
    nextValue: string,
  ) => {
    setValues(prev => {
      const capabilities = prev.promostandards_capabilities;
      if (!capabilities) return prev;

      return {
        ...prev,
        promostandards_capabilities: {
          ...capabilities,
          endpoints: capabilities.endpoints.map(endpoint =>
            getPromoEndpointGroupKey(endpoint) === groupKey
              ? {
                ...endpoint,
                custom_endpoint_url: nextValue.trim() || null,
              }
              : endpoint,
          ),
        },
      };
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
              credentials_valid: result.credentials_valid ?? null,
              endpoints: result.endpoints ?? [],
              fingerprint: result.fingerprint ?? '',
              tested_at: result.tested_at ?? new Date().toISOString(),
            }
          : null;

      setValues(prev => ({
        ...prev,
        endpoint_mapping_ids: result.endpoint_mapping_ids ?? [],
        promostandards_capabilities: capabilities,
        connection_tested: result.ok,
      }));
      setConnectionStatus(result.ok ? 'success' : 'failed');
      setConnectionMessage(result.message ?? (result.ok ? 'Connection successful.' : 'Connection failed.'));
      setLastTestFingerprint(currentFingerprint);
      setEndpointTestStatus({});
    } catch (error) {
      setConnectionStatus('failed');
      setConnectionMessage(error instanceof Error ? error.message : 'Vendor connection test failed.');
    }
  };

  const handlePromoEndpointTest = async (group: PromoEndpointGroup) => {
    if (!onTestConnection) return;

    const endpointKey = group.key;
    const customEndpointPath = group.custom_endpoint_url?.trim();
    const resolvedEndpointUrl = group.resolved_endpoint_url?.trim();
    if (!customEndpointPath && !resolvedEndpointUrl) {
      setEndpointTestStatus(prev => ({
        ...prev,
        [endpointKey]: {
          status: 'failed',
          message: 'Enter or discover an endpoint URL before testing.',
        },
      }));
      return;
    }

    setEndpointTestStatus(prev => ({
      ...prev,
      [endpointKey]: {
        status: 'testing',
        message: 'Testing endpoint URI...',
      },
    }));

    try {
      const results = await Promise.all(
        group.operations.map(endpoint =>
          onTestConnection({
            vendor_api_url: values.vendor_api_url,
            vendor_account_id: values.vendor_account_id,
            vendor_secret: values.vendor_secret,
            integration_family: values.integration_family,
            api_protocol: values.api_protocol ?? 'SOAP',
            endpoint_name: endpoint.endpoint_name,
            endpoint_version: endpoint.endpoint_version,
            operation_name: endpoint.operation_name,
            runtime_config: customEndpointPath
              ? {
                endpoint_path: customEndpointPath,
              }
              : {
                endpoint_url: resolvedEndpointUrl,
              },
          }),
        ),
      );
      const successCount = results.filter(result => result.ok).length;
      const message =
        successCount === 0
          ? (results.find(result => result.message)?.message ?? 'Endpoint test failed.')
          : successCount === group.operations.length
            ? `Confirmed for ${successCount} operation${successCount === 1 ? '' : 's'}.`
            : `Confirmed for ${successCount} of ${group.operations.length} operations.`;

      setEndpointTestStatus(prev => ({
        ...prev,
        [endpointKey]: {
          status: successCount > 0 ? 'success' : 'failed',
          message,
        },
      }));
    } catch (error) {
      setEndpointTestStatus(prev => ({
        ...prev,
        [endpointKey]: {
          status: 'failed',
          message: error instanceof Error ? error.message : 'Endpoint test failed.',
        },
      }));
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
        endpoint_mapping_ids:
          values.integration_family === 'PROMOSTANDARDS' ? values.endpoint_mapping_ids ?? [] : values.endpoint_mapping_ids,
        promostandards_capabilities:
          values.integration_family === 'PROMOSTANDARDS'
            ? compactPromoCapabilitiesForSubmission(values.promostandards_capabilities)
            : null,
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
                gridTemplateColumns: '1.1fr 0.8fr 1fr 0.8fr 0.9fr',
                padding: '12px 16px',
              }}
            >
              <span>Endpoint</span>
              <span>Version</span>
              <span>Operations</span>
              <span>WSDL</span>
              <span>Live Probe</span>
            </div>
            {promoEndpointGroups.length === 0 ? (
              <div style={{ color: '#64748b', padding: '18px 16px' }}>
                No PromoStandards discovery results yet.
              </div>
            ) : (
              promoEndpointGroups.map(group => (
                (() => {
                  const endpointKey = group.key;
                  const endpointUrlValue = group.custom_endpoint_url ?? '';
                  const testState = endpointTestStatus[endpointKey];

                  return (
                <div
                  key={endpointKey}
                  style={{
                    borderBottom: '1px solid #eef2f7',
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: '1.1fr 0.8fr 1fr 0.8fr 0.9fr',
                    padding: '14px 16px',
                  }}
                >
                  <div>
                    <div style={{ color: '#0f172a', fontWeight: 700 }}>{group.endpoint_name}</div>
                    <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>
                      {group.summary_message}
                    </div>
                    <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                      <label style={{ display: 'grid', gap: '4px' }}>
                        <span style={{ color: '#334155', fontSize: '12px', fontWeight: 700 }}>
                          Custom Endpoint URI Format
                        </span>
                        <input
                          aria-label={`Custom endpoint URI for ${group.endpoint_name} ${group.endpoint_version}`}
                          value={endpointUrlValue}
                          onChange={event => handlePromoEndpointFieldChange(endpointKey, event.target.value)}
                          placeholder="/promostandards/custom/service"
                          style={textInputStyle}
                        />
                      </label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handlePromoEndpointTest(group)}
                          style={secondaryButtonStyle}
                          disabled={testState?.status === 'testing'}
                        >
                          {testState?.status === 'testing' ? 'Testing URI...' : 'Test URI'}
                        </button>
                        {group.resolved_endpoint_url ? (
                          <span style={{ color: '#64748b', fontSize: '12px' }}>
                            Discovered: {group.resolved_endpoint_url}
                          </span>
                        ) : null}
                        {testState?.message ? (
                          <span
                            style={{
                              color: testState.status === 'success' ? '#047857' : testState.status === 'failed' ? '#b91c1c' : '#64748b',
                              fontSize: '12px',
                            }}
                          >
                            {testState.message}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div style={{ color: '#334155' }}>{group.endpoint_version}</div>
                  <div style={{ color: '#334155' }}>
                    {group.operation_names.length === 1
                      ? group.operation_names[0]
                      : `${group.operation_names.length} operations`}
                  </div>
                  <div
                    style={{
                      color: (group.wsdl_available ?? (group.available_count > 0)) ? '#047857' : '#b91c1c',
                      fontWeight: 700,
                    }}
                  >
                    {(group.wsdl_available ?? (group.available_count > 0)) ? 'Listed' : 'Missing'}
                  </div>
                  <div
                    style={{
                      color:
                        group.credentials_valid === true
                          ? '#047857'
                          : group.credentials_valid === false
                            ? '#b91c1c'
                            : '#b45309',
                      fontWeight: 700,
                    }}
                  >
                    {group.credentials_valid === true
                      ? 'Accepted'
                      : group.credentials_valid === false
                        ? 'Rejected'
                        : 'Needs input'}
                  </div>
                </div>
                  );
                })()
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
