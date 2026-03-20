import { buildApiBase, requestJson } from './bigcommerceApi';
import { withExecutionLock } from '../vendorExecutionLock';

export interface BigCommercePriceListBulkTierInput {
  quantity_min: number;
  quantity_max?: number;
  price: number;
}

export interface BigCommercePriceListRecordInput {
  variant_id: number;
  price: number;
  sale_price?: number;
  retail_price?: number;
  map_price?: number;
  bulk_pricing_tiers?: BigCommercePriceListBulkTierInput[];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function isRetryablePriceListError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(429|500|502|503|504)/.test(error.message) || /lock unavailable/i.test(error.message);
}

export async function upsertPriceListRecords(input: {
  accessToken: string;
  storeHash: string;
  price_list_id: number;
  records: BigCommercePriceListRecordInput[];
}): Promise<void> {
  if (input.records.length === 0) return;

  const batchSize = Number(process.env.BIGCOMMERCE_PRICE_LIST_BATCH_SIZE ?? 250);
  const maxAttempts = Number(process.env.BIGCOMMERCE_PRICE_LIST_MAX_ATTEMPTS ?? 4);
  const batches = chunk(input.records, Number.isFinite(batchSize) && batchSize > 0 ? batchSize : 250);
  const lockName = `pricelist:${input.storeHash}:${input.price_list_id}`;

  for (const batch of batches) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const lockResult = await withExecutionLock(lockName, async () => {
          await requestJson<Record<string, unknown>>(
            input.accessToken,
            `${buildApiBase(input.storeHash)}/pricelists/${input.price_list_id}/records`,
            {
              method: 'PUT',
              body: JSON.stringify(batch),
            },
            'Failed to upsert BigCommerce price list records',
          );
        });

        if (!lockResult.acquired) {
          throw new Error('Price list write lock unavailable');
        }

        break;
      } catch (error) {
        if (attempt >= maxAttempts || !isRetryablePriceListError(error)) {
          throw error;
        }

        await sleep(250 * 2 ** (attempt - 1));
      }
    }
  }
}
