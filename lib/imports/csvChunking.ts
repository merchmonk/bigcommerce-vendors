function quoteCsv(value: string | number | undefined): string {
  const raw = value === undefined ? '' : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function buildCsvLine(
  headers: string[],
  row: Record<string, string | number | undefined>,
): string {
  return `${headers.map(header => quoteCsv(row[header])).join(',')}\n`;
}

export function toCsv(
  rows: Array<Record<string, string | number | undefined>>,
  explicitHeaders?: string[],
): string {
  const headers = explicitHeaders ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
  if (headers.length === 0) {
    return '';
  }

  const headerLine = `${headers.map(header => quoteCsv(header)).join(',')}\n`;
  return `${headerLine}${rows.map(row => buildCsvLine(headers, row)).join('')}`;
}

export interface CsvChunk {
  index: number;
  rows: Array<Record<string, string | number | undefined>>;
  text: string;
  bytes: number;
}

export interface ChunkCsvRowsInput {
  rows: Array<Record<string, string | number | undefined>>;
  headers: string[];
  maxBytes: number;
}

export function chunkCsvRows(input: ChunkCsvRowsInput): CsvChunk[] {
  const { rows, headers, maxBytes } = input;
  if (headers.length === 0) {
    return [];
  }

  const headerLine = `${headers.map(header => quoteCsv(header)).join(',')}\n`;
  const headerBytes = Buffer.byteLength(headerLine, 'utf8');

  if (headerBytes > maxBytes) {
    throw new Error(`CSV header exceeds max chunk size of ${maxBytes} bytes.`);
  }

  const chunks: CsvChunk[] = [];
  let currentRows: Array<Record<string, string | number | undefined>> = [];
  let currentLines = headerLine;
  let currentBytes = headerBytes;

  const flushChunk = () => {
    chunks.push({
      index: chunks.length + 1,
      rows: currentRows,
      text: currentLines,
      bytes: currentBytes,
    });
    currentRows = [];
    currentLines = headerLine;
    currentBytes = headerBytes;
  };

  for (const row of rows) {
    const rowLine = buildCsvLine(headers, row);
    const rowBytes = Buffer.byteLength(rowLine, 'utf8');

    if (headerBytes + rowBytes > maxBytes) {
      throw new Error('A single CSV row exceeds the configured max chunk size.');
    }

    if (currentBytes + rowBytes > maxBytes && currentRows.length > 0) {
      flushChunk();
    }

    currentRows.push(row);
    currentLines += rowLine;
    currentBytes += rowBytes;
  }

  if (currentRows.length > 0 || rows.length === 0) {
    flushChunk();
  }

  return chunks;
}
