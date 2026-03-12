import fs from 'fs';
import path from 'path';

export interface PromoOptions {
  endpoints: string[];
  versionsByEndpoint: Record<string, string[]>;
}

let cachedOptions: PromoOptions | null = null;

function parseServiceVersionFile(filePath: string): PromoOptions {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const versionsByEndpoint: Record<string, Set<string>> = {};

  for (const line of lines) {
    const [service, version] = line.split(/\s*\t+\s*|\s{2,}/).map(part => part.trim());
    if (!service || service === 'Service' || !version || version === 'Version') {
      continue;
    }
    if (!versionsByEndpoint[service]) {
      versionsByEndpoint[service] = new Set<string>();
    }
    versionsByEndpoint[service].add(version);
  }

  const endpoints = Object.keys(versionsByEndpoint).sort();
  const resultVersions: Record<string, string[]> = {};
  for (const endpoint of endpoints) {
    resultVersions[endpoint] = Array.from(versionsByEndpoint[endpoint]).sort();
  }

  return { endpoints, versionsByEndpoint: resultVersions };
}

export function getPromoOptions(): PromoOptions {
  if (cachedOptions) {
    return cachedOptions;
  }

  const filePath = path.join(process.cwd(), 'ServiceVersion');
  cachedOptions = parseServiceVersionFile(filePath);
  return cachedOptions;
}

