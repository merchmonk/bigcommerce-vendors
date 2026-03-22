import 'dotenv/config';
import prisma from '../lib/prisma';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find(argument => argument.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : undefined;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function deriveStoreHashFromStoreUrl(storeUrl: string): string | undefined {
  try {
    const hostname = new URL(storeUrl).hostname.toLowerCase();
    const match = hostname.match(/^store-([a-z0-9]+)\.mybigcommerce\.com$/);
    return match?.[1];
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const rawStoreHash =
    readArg('storeHash')
    ?? readEnv('BIGCOMMERCE_STORE_HASH')
    ?? (readEnv('STORE_URL') ? deriveStoreHashFromStoreUrl(readEnv('STORE_URL')!) : undefined);
  const rawMarkupPercent = readArg('markupPercent') ?? readEnv('BIGCOMMERCE_MARKUP_PERCENT');

  if (!rawStoreHash) {
    throw new Error(
      'Missing store hash. Pass --storeHash=<hash> or set BIGCOMMERCE_STORE_HASH / STORE_URL.',
    );
  }

  if (!rawMarkupPercent) {
    throw new Error(
      'Missing markup percent. Pass --markupPercent=<number> or set BIGCOMMERCE_MARKUP_PERCENT.',
    );
  }

  const markupPercent = Number(rawMarkupPercent);
  if (!Number.isFinite(markupPercent) || markupPercent < 0) {
    throw new Error(`Invalid markup percent: ${rawMarkupPercent}`);
  }

  await prisma.store.upsert({
    where: { store_hash: rawStoreHash },
    create: {
      store_hash: rawStoreHash,
      markup_percent: markupPercent,
    },
    update: {
      markup_percent: markupPercent,
    },
  });

  process.stdout.write(`Set markup percent for ${rawStoreHash} to ${markupPercent}.\n`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
