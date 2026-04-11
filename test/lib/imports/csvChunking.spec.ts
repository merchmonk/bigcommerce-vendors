import { chunkCsvRows, toCsv } from '@lib/imports/csvChunking';

describe('chunkCsvRows', () => {
  test('keeps every chunk within the byte limit and repeats the header', () => {
    const headers = ['sku', 'name'];
    const rows = [
      { sku: 'SKU-1', name: 'Alpha' },
      { sku: 'SKU-2', name: 'Bravo' },
      { sku: 'SKU-3', name: 'Charlie' },
    ];

    const singleRowBytes = Buffer.byteLength(toCsv([rows[0]], headers), 'utf8');
    const chunks = chunkCsvRows({
      rows,
      headers,
      maxBytes: singleRowBytes + 2,
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.map(chunk => chunk.rows)).toEqual([[rows[0]], [rows[1]], [rows[2]]]);
    expect(chunks.every(chunk => chunk.bytes <= singleRowBytes + 2)).toBe(true);
    expect(chunks.every(chunk => chunk.text.startsWith('"sku","name"\n'))).toBe(true);
  });

  test('emits a header-only chunk when there are no rows', () => {
    const chunks = chunkCsvRows({
      rows: [],
      headers: ['id', 'value'],
      maxBytes: 1024,
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(
      expect.objectContaining({
        index: 1,
        rows: [],
        text: '"id","value"\n',
      }),
    );
  });

  test('throws when a single row cannot fit inside the configured chunk size', () => {
    const headers = ['sku', 'description'];
    const row = { sku: 'SKU-1', description: 'A very long row value' };
    const headerOnlyBytes = Buffer.byteLength(toCsv([], headers), 'utf8');

    expect(() =>
      chunkCsvRows({
        rows: [row],
        headers,
        maxBytes: headerOnlyBytes + 5,
      }),
    ).toThrow('A single CSV row exceeds the configured max chunk size.');
  });
});
