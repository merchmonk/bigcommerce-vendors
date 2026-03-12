import {
  Box,
  Button,
  Checkbox,
  Flex,
  Form,
  FormField,
  H3,
  Input,
  Panel,
  Select,
  Textarea,
  Toggle,
} from '@bigcommerce/big-design';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type { VendorFormData } from '../types';
import type { ApiServiceType, PromoEndpointConfig } from '../lib/vendors';

interface PromoOptionsResponse {
  endpoints: string[];
  versionsByEndpoint: Record<string, string[]>;
}

interface VendorFormProps {
  initialValues?: VendorFormData;
  onSubmit: (data: VendorFormData) => Promise<void> | void;
  onCancel: () => void;
}

const apiServiceTypeOptions: { value: ApiServiceType; content: string }[] = [
  { value: 'SOAP', content: 'SOAP' },
  { value: 'REST', content: 'REST' },
  { value: 'RPC', content: 'RPC' },
  { value: 'XML', content: 'XML' },
  { value: 'JSON', content: 'JSON' },
];

const fetcher = (url: string) => fetch(url).then(res => res.json());

const VendorForm = ({ initialValues, onSubmit, onCancel }: VendorFormProps) => {
  const [values, setValues] = useState<VendorFormData>(() => ({
    vendor_name: initialValues?.vendor_name ?? '',
    vendor_api_url: initialValues?.vendor_api_url ?? '',
    vendor_account_id: initialValues?.vendor_account_id ?? '',
    vendor_secret: initialValues?.vendor_secret ?? '',
    is_promo_standards: initialValues?.is_promo_standards ?? true,
    promo_endpoints: initialValues?.promo_endpoints ?? {},
    format_data: initialValues?.format_data ?? '',
    api_service_type: initialValues?.api_service_type ?? null,
  }));

  const { data: promoOptions } = useSWR<PromoOptionsResponse>('/api/vendors/promo-options', fetcher);

  const endpointStates: Record<string, PromoEndpointConfig> = useMemo(() => {
    const existing = values.promo_endpoints ?? {};
    const result: Record<string, PromoEndpointConfig> = {};
    if (promoOptions) {
      promoOptions.endpoints.forEach(endpoint => {
        const current = existing[endpoint];
        result[endpoint] = current ?? { enabled: false, version: null };
      });
    }
    return result;
  }, [promoOptions, values.promo_endpoints]);

  useEffect(() => {
    if (promoOptions && (!values.promo_endpoints || Object.keys(values.promo_endpoints).length === 0)) {
      setValues(prev => ({
        ...prev,
        promo_endpoints: endpointStates,
      }));
    }
  }, [promoOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (name: keyof VendorFormData, value: any) => {
    setValues(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePromoToggle = (endpoint: string, enabled: boolean) => {
    setValues(prev => ({
      ...prev,
      promo_endpoints: {
        ...(prev.promo_endpoints ?? {}),
        [endpoint]: {
          enabled,
          version: enabled
            ? (prev.promo_endpoints?.[endpoint]?.version ??
                promoOptions?.versionsByEndpoint[endpoint]?.[0] ??
                null)
            : null,
        },
      },
    }));
  };

  const handlePromoVersionChange = (endpoint: string, version: string) => {
    setValues(prev => ({
      ...prev,
      promo_endpoints: {
        ...(prev.promo_endpoints ?? {}),
        [endpoint]: {
          enabled: true,
          version,
        },
      },
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: VendorFormData = {
      ...values,
      vendor_name: values.vendor_name.trim(),
      vendor_api_url: values.vendor_api_url?.trim() || undefined,
      vendor_account_id: values.vendor_account_id?.trim() || undefined,
      vendor_secret: values.vendor_secret?.trim() || undefined,
      promo_endpoints: values.is_promo_standards ? values.promo_endpoints ?? {} : null,
      format_data: values.is_promo_standards ? null : values.format_data ?? '',
      api_service_type: values.is_promo_standards ? null : values.api_service_type ?? null,
    };

    await onSubmit(payload);
  };

  return (
    <Panel header="Vendor">
      <Form onSubmit={handleSubmit}>
        <FormField>
          <Input
            label="Vendor name"
            required
            value={values.vendor_name}
            onChange={event => handleChange('vendor_name', event.target.value)}
          />
        </FormField>

        <FormField>
          <Input
            label="Vendor API URL"
            description="Base URL for the vendor API."
            value={values.vendor_api_url}
            onChange={event => handleChange('vendor_api_url', event.target.value)}
          />
        </FormField>

        <FormField>
          <Input
            label="Vendor account ID"
            value={values.vendor_account_id}
            onChange={event => handleChange('vendor_account_id', event.target.value)}
          />
        </FormField>

        <FormField>
          <Input
            label="Vendor Secret"
            type="password"
            value={values.vendor_secret}
            onChange={event => handleChange('vendor_secret', event.target.value)}
          />
        </FormField>

        <Box marginTop="large" marginBottom="medium">
          <Toggle
            checked={values.is_promo_standards}
            label="Is PromoStandards"
            onChange={() => handleChange('is_promo_standards', !values.is_promo_standards)}
          />
        </Box>

        {values.is_promo_standards ? (
          <Box marginBottom="large">
            <H3>PromoStandards Endpoints</H3>
            {promoOptions &&
              promoOptions.endpoints.map(endpoint => {
                const state = endpointStates[endpoint];
                const versions = promoOptions.versionsByEndpoint[endpoint] ?? [];

                return (
                  <Flex key={endpoint} alignItems="center" marginBottom="small">
                    <Checkbox
                      checked={state?.enabled ?? false}
                      label={endpoint}
                      onChange={event => handlePromoToggle(endpoint, event.target.checked)}
                    />
                    <Box marginLeft="medium" flexGrow={1} maxWidth="200px">
                      <Select
                        disabled={!state?.enabled}
                        label="Version"
                        required={state?.enabled}
                        value={state?.version ?? ''}
                        onOptionChange={option => handlePromoVersionChange(endpoint, option.value as string)}
                        options={versions.map(version => ({ value: version, content: version }))}
                      />
                    </Box>
                  </Flex>
                );
              })}
          </Box>
        ) : (
          <Box marginBottom="large">
            <FormField>
              <Textarea
                label="Format data string"
                rows={5}
                value={values.format_data ?? ''}
                onChange={event => handleChange('format_data', event.target.value)}
              />
            </FormField>
            <FormField>
              <Select
                label="API service type"
                required
                value={values.api_service_type ?? ''}
                onOptionChange={option =>
                  handleChange('api_service_type', option.value as ApiServiceType)
                }
                options={apiServiceTypeOptions}
              />
            </FormField>
          </Box>
        )}

        <Flex justifyContent="flex-end">
          <Button marginRight="small" variant="subtle" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Save vendor
          </Button>
        </Flex>
      </Form>
    </Panel>
  );
};

export default VendorForm;

