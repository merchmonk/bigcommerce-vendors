import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useSession } from '../context/session';
import type { EndpointMappingDraft, VendorFormData } from '../types';
import type { MappingPayloadFormat, MappingProtocol } from '../types';

interface VendorFormProps {
  initialValues?: VendorFormData;
  onSubmit: (data: VendorFormData) => Promise<void> | void;
  onCancel: () => void;
  onTestConnection?: (data: {
    vendor_api_url?: string;
    vendor_account_id?: string;
    vendor_secret?: string;
    api_protocol?: MappingProtocol;
    operation_name?: string;
    endpoint_version?: string;
    runtime_config?: Record<string, unknown>;
  }) => Promise<{ ok: boolean; message?: string }>;
  requireConnectionTest?: boolean;
}

interface MappingListResponse {
  data: Array<{
    mapping_id: number;
    endpoint_name: string;
    endpoint_version: string;
    operation_name: string;
    protocol: MappingProtocol;
    payload_format: MappingPayloadFormat;
    is_product_endpoint: boolean;
    metadata?: Record<string, unknown>;
    transform_schema?: Record<string, unknown>;
  }>;
}

const integrationFamilyOptions: Array<{ value: 'PROMOSTANDARDS' | 'CUSTOM'; content: string }> = [
  { value: 'PROMOSTANDARDS', content: 'PromoStandards' },
  { value: 'CUSTOM', content: 'Custom API' },
];

const protocolOptions: Array<{ value: MappingProtocol; content: string }> = [
  { value: 'SOAP', content: 'SOAP' },
  { value: 'REST', content: 'REST' },
  { value: 'RPC', content: 'RPC' },
  { value: 'XML', content: 'XML' },
  { value: 'JSON', content: 'JSON' },
];

const fetcher = (url: string) => fetch(url).then(res => res.json());

function getDefaultPayloadFormat(protocol: MappingProtocol): MappingPayloadFormat {
  return protocol === 'SOAP' || protocol === 'XML' ? 'XML' : 'JSON';
}

function createEmptyMapping(protocol: MappingProtocol): EndpointMappingDraft {
  return {
    enabled: true,
    endpoint_name: '',
    endpoint_version: '',
    operation_name: '',
    protocol,
    payload_format: getDefaultPayloadFormat(protocol),
    is_product_endpoint: true,
    structure_input: '',
    runtime_config: {},
  };
}

const VendorForm = ({
  initialValues,
  onSubmit,
  onCancel,
  onTestConnection,
  requireConnectionTest = false,
}: VendorFormProps) => {
  const { context } = useSession();
  const [values, setValues] = useState<VendorFormData>(() => ({
    vendor_name: initialValues?.vendor_name ?? '',
    vendor_api_url: initialValues?.vendor_api_url ?? '',
    vendor_account_id: initialValues?.vendor_account_id ?? '',
    vendor_secret: initialValues?.vendor_secret ?? '',
    integration_family: initialValues?.integration_family ?? 'PROMOSTANDARDS',
    api_protocol: initialValues?.api_protocol ?? 'SOAP',
    endpoint_mappings: initialValues?.endpoint_mappings?.length
      ? initialValues.endpoint_mappings
      : [createEmptyMapping(initialValues?.api_protocol ?? 'SOAP')],
    endpoint_mapping_ids: initialValues?.endpoint_mapping_ids ?? [],
    connection_config: initialValues?.connection_config ?? {},
    auto_sync: initialValues?.auto_sync ?? true,
  }));
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [lastTestFingerprint, setLastTestFingerprint] = useState('');

  const shouldLoadPromoDefaults = values.integration_family === 'PROMOSTANDARDS' && !!context;
  const { data: promoSeedMappings } = useSWR<MappingListResponse>(
    shouldLoadPromoDefaults
      ? `/api/etl/mappings?context=${encodeURIComponent(context)}&standard_type=PROMOSTANDARDS&seed=1`
      : null,
    fetcher,
  );

  const connectionFingerprint = [
    values.vendor_api_url ?? '',
    values.vendor_account_id ?? '',
    values.vendor_secret ?? '',
    values.api_protocol ?? '',
  ].join('|');

  const canRequireTest = requireConnectionTest && values.integration_family === 'PROMOSTANDARDS';
  const isConnectionValidForSave = connectionStatus === 'success' && lastTestFingerprint === connectionFingerprint;
  const activeConnectionMessage =
    connectionStatus === 'success' && !isConnectionValidForSave
      ? 'Connection changed. Please run test again.'
      : connectionMessage;
  const activeConnectionTone =
    connectionStatus === 'success' && !isConnectionValidForSave ? 'failed' : connectionStatus;
  const hasValidMappings = useMemo(
    () =>
      values.endpoint_mappings.some(
        mapping =>
          mapping.enabled &&
          (mapping.mapping_id ||
            (mapping.endpoint_name && mapping.endpoint_version && mapping.operation_name)),
      ),
    [values.endpoint_mappings],
  );

  const updateMapping = (index: number, updater: (current: EndpointMappingDraft) => EndpointMappingDraft) => {
    setValues(prev => ({
      ...prev,
      endpoint_mappings: prev.endpoint_mappings.map((mapping, i) => (i === index ? updater(mapping) : mapping)),
    }));
  };

  const addMapping = () => {
    setValues(prev => ({
      ...prev,
      endpoint_mappings: [...prev.endpoint_mappings, createEmptyMapping(prev.api_protocol)],
    }));
  };

  const removeMapping = (index: number) => {
    setValues(prev => {
      const next = prev.endpoint_mappings.filter((_, i) => i !== index);
      return {
        ...prev,
        endpoint_mappings: next.length > 0 ? next : [createEmptyMapping(prev.api_protocol)],
      };
    });
  };

  const addPromoDefaults = () => {
    const seeded = promoSeedMappings?.data ?? [];
    if (seeded.length === 0) return;

    setValues(prev => {
      const existingKeys = new Set(
        prev.endpoint_mappings.map(
          mapping => `${mapping.endpoint_name}|${mapping.endpoint_version}|${mapping.operation_name}`,
        ),
      );

      const nextMappings = [...prev.endpoint_mappings];
      seeded.forEach(mapping => {
        const key = `${mapping.endpoint_name}|${mapping.endpoint_version}|${mapping.operation_name}`;
        if (existingKeys.has(key)) return;

        nextMappings.push({
          mapping_id: mapping.mapping_id,
          enabled: true,
          endpoint_name: mapping.endpoint_name,
          endpoint_version: mapping.endpoint_version,
          operation_name: mapping.operation_name,
          protocol: mapping.protocol,
          payload_format: mapping.payload_format,
          is_product_endpoint: mapping.is_product_endpoint,
          structure_input: mapping.payload_format === 'XML' ? '' : '{}',
          transform_schema: mapping.transform_schema ?? {},
          metadata: mapping.metadata ?? {},
          runtime_config: {},
        });
      });

      return {
        ...prev,
        endpoint_mappings: nextMappings,
      };
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canRequireTest && !isConnectionValidForSave) {
      setConnectionStatus('failed');
      setConnectionMessage('Please run Test Connection successfully before saving this vendor.');
      return;
    }

    const payload: VendorFormData = {
      ...values,
      vendor_name: values.vendor_name.trim(),
      vendor_api_url: values.vendor_api_url?.trim() || undefined,
      vendor_account_id: values.vendor_account_id?.trim() || undefined,
      vendor_secret: values.vendor_secret?.trim() || undefined,
      endpoint_mappings: values.endpoint_mappings
        .filter(
          mapping =>
            mapping.enabled &&
            (mapping.mapping_id ||
              (mapping.endpoint_name && mapping.endpoint_version && mapping.operation_name)),
        )
        .map(mapping => ({
          ...mapping,
          endpoint_name: mapping.endpoint_name?.trim(),
          endpoint_version: mapping.endpoint_version?.trim(),
          operation_name: mapping.operation_name?.trim(),
          structure_input: mapping.structure_input?.trim() ?? '',
        })),
      connection_tested: !canRequireTest || isConnectionValidForSave,
    };

    await onSubmit(payload);
  };

  const handleTestConnection = async () => {
    if (!onTestConnection) return;
    if (!values.vendor_api_url) {
      setConnectionStatus('failed');
      setConnectionMessage('Vendor API URL is required to test connection.');
      return;
    }

    const companyDataMapping = values.endpoint_mappings.find(
      mapping => mapping.endpoint_name?.toLowerCase() === 'companydata',
    );

    setConnectionStatus('testing');
    setConnectionMessage('Testing connection...');
    try {
      const result = await onTestConnection({
        vendor_api_url: values.vendor_api_url,
        vendor_account_id: values.vendor_account_id,
        vendor_secret: values.vendor_secret,
        api_protocol: values.api_protocol,
        operation_name: companyDataMapping?.operation_name ?? 'getCompanyData',
        endpoint_version: companyDataMapping?.endpoint_version ?? '1.0.0',
        runtime_config: companyDataMapping?.runtime_config ?? {},
      });
      if (result.ok) {
        setConnectionStatus('success');
        setConnectionMessage(result.message ?? 'Connection successful.');
        setLastTestFingerprint(connectionFingerprint);
      } else {
        setConnectionStatus('failed');
        setConnectionMessage(result.message ?? 'Connection test failed.');
      }
    } catch (error: any) {
      setConnectionStatus('failed');
      setConnectionMessage(error?.message ?? 'Connection test failed.');
    }
  };

  return (
    <section style={panelStyle}>
      <h2 style={{ marginTop: 0 }}>Vendor</h2>
      <form onSubmit={handleSubmit}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Vendor name</span>
          <input
            autoComplete="off"
            required
            value={values.vendor_name}
            onChange={event => setValues(prev => ({ ...prev, vendor_name: event.target.value }))}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Vendor API URL</span>
          <span style={helpTextStyle}>Base URL for the vendor API.</span>
          <input
            autoComplete="url"
            required
            value={values.vendor_api_url ?? ''}
            onChange={event => setValues(prev => ({ ...prev, vendor_api_url: event.target.value }))}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Vendor account ID</span>
          <input
            autoComplete="off"
            value={values.vendor_account_id ?? ''}
            onChange={event => setValues(prev => ({ ...prev, vendor_account_id: event.target.value }))}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Vendor secret</span>
          <input
            autoComplete="new-password"
            type="password"
            value={values.vendor_secret ?? ''}
            onChange={event => setValues(prev => ({ ...prev, vendor_secret: event.target.value }))}
            style={inputStyle}
          />
        </label>

        <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Integration family</span>
            <select
              value={values.integration_family}
              onChange={event =>
                setValues(prev => ({
                  ...prev,
                  integration_family: event.target.value as VendorFormData['integration_family'],
                }))
              }
              style={inputStyle}
            >
              {integrationFamilyOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.content}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>API protocol</span>
            <select
              value={values.api_protocol}
              onChange={event =>
                setValues(prev => ({
                  ...prev,
                  api_protocol: event.target.value as MappingProtocol,
                }))
              }
              style={inputStyle}
            >
              {protocolOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.content}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ ...fieldStyle, marginBottom: '20px' }}>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={connectionStatus === 'testing'}
            style={secondaryButtonStyle}
          >
            {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>
          {activeConnectionMessage && (
            <div
              style={{
                color: activeConnectionTone === 'success' ? '#166534' : '#b91c1c',
                fontSize: '14px',
              }}
            >
              {activeConnectionMessage}
            </div>
          )}
        </div>

        <section style={mappingPanelStyle}>
          <div style={{ alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h3 style={{ margin: 0 }}>Endpoint Mapping Records</h3>
            <div style={{ display: 'flex', gap: '8px' }}>
              {values.integration_family === 'PROMOSTANDARDS' && (
                <button type="button" style={secondaryButtonStyle} onClick={addPromoDefaults}>
                  Add Promo Defaults
                </button>
              )}
              <button type="button" style={secondaryButtonStyle} onClick={addMapping}>
                Add Mapping
              </button>
            </div>
          </div>

          {values.endpoint_mappings.map((mapping, index) => (
            <div key={`${mapping.mapping_id ?? 'new'}-${index}`} style={mappingRowStyle}>
              <div style={mappingRowHeaderStyle}>
                <label style={checkboxLabelStyle}>
                  <input
                    checked={mapping.enabled}
                    type="checkbox"
                    onChange={event => updateMapping(index, current => ({ ...current, enabled: event.target.checked }))}
                  />
                  Enabled
                </label>
                <button type="button" style={textButtonStyle} onClick={() => removeMapping(index)}>
                  Remove
                </button>
              </div>

              <div style={mappingGridStyle}>
                <label style={fieldStyle}>
                  <span style={labelStyle}>Endpoint name</span>
                  <input
                    value={mapping.endpoint_name ?? ''}
                    onChange={event => updateMapping(index, current => ({ ...current, endpoint_name: event.target.value }))}
                    style={inputStyle}
                    required={mapping.enabled}
                  />
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>Endpoint version</span>
                  <input
                    value={mapping.endpoint_version ?? ''}
                    onChange={event => updateMapping(index, current => ({ ...current, endpoint_version: event.target.value }))}
                    style={inputStyle}
                    required={mapping.enabled}
                  />
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>Operation name</span>
                  <input
                    value={mapping.operation_name ?? ''}
                    onChange={event => updateMapping(index, current => ({ ...current, operation_name: event.target.value }))}
                    style={inputStyle}
                    required={mapping.enabled}
                  />
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>Protocol</span>
                  <select
                    value={mapping.protocol ?? values.api_protocol}
                    onChange={event =>
                      updateMapping(index, current => ({
                        ...current,
                        protocol: event.target.value as MappingProtocol,
                        payload_format: getDefaultPayloadFormat(event.target.value as MappingProtocol),
                      }))
                    }
                    style={inputStyle}
                  >
                    {protocolOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.content}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={fieldStyle}>
                  <span style={labelStyle}>Structure format</span>
                  <select
                    value={mapping.payload_format ?? 'JSON'}
                    onChange={event =>
                      updateMapping(index, current => ({
                        ...current,
                        payload_format: event.target.value as MappingPayloadFormat,
                      }))
                    }
                    style={inputStyle}
                  >
                    <option value="JSON">JSON</option>
                    <option value="XML">XML</option>
                  </select>
                </label>

                <label style={{ ...fieldStyle, alignSelf: 'end' }}>
                  <span style={labelStyle}>Product endpoint</span>
                  <label style={checkboxLabelStyle}>
                    <input
                      checked={!!mapping.is_product_endpoint}
                      type="checkbox"
                      onChange={event =>
                        updateMapping(index, current => ({
                          ...current,
                          is_product_endpoint: event.target.checked,
                        }))
                      }
                    />
                    Yes
                  </label>
                </label>
              </div>

              <label style={fieldStyle}>
                <span style={labelStyle}>JSON/XML structure entry</span>
                <textarea
                  rows={6}
                  value={mapping.structure_input ?? ''}
                  onChange={event => updateMapping(index, current => ({ ...current, structure_input: event.target.value }))}
                  style={inputStyle}
                  placeholder={mapping.payload_format === 'XML' ? '<Envelope>...</Envelope>' : '{ "path": "value" }'}
                />
              </label>
            </div>
          ))}
        </section>

        {!hasValidMappings && (
          <div style={{ color: '#b91c1c', fontSize: '14px', marginBottom: '12px' }}>
            Add at least one enabled endpoint mapping before saving.
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!hasValidMappings || (canRequireTest && !isConnectionValidForSave)}
            style={primaryButtonStyle}
          >
            Save vendor
          </button>
        </div>
      </form>
    </section>
  );
};

const panelStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '24px',
};

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginBottom: '16px',
};

const labelStyle: React.CSSProperties = {
  fontWeight: 600,
};

const helpTextStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '14px',
};

const inputStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  padding: '10px 12px',
  width: '100%',
};

const checkboxLabelStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: '8px',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d1d5db',
  borderRadius: '8px',
  cursor: 'pointer',
  padding: '10px 14px',
};

const primaryButtonStyle: React.CSSProperties = {
  background: '#2563eb',
  border: 'none',
  borderRadius: '8px',
  color: '#ffffff',
  cursor: 'pointer',
  padding: '10px 14px',
};

const mappingPanelStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
  marginBottom: '16px',
  padding: '16px',
};

const mappingRowStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: '10px',
  marginBottom: '12px',
  padding: '12px',
};

const mappingRowHeaderStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '10px',
};

const mappingGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: '10px',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
};

const textButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: '#b91c1c',
  cursor: 'pointer',
  padding: 0,
};

export default VendorForm;
