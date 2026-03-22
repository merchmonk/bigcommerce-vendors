import 'dotenv/config';
import prisma from '../lib/prisma';

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
  const storeHash =
    readEnv('BIGCOMMERCE_STORE_HASH')
    ?? (readEnv('STORE_URL') ? deriveStoreHashFromStoreUrl(readEnv('STORE_URL')!) : undefined);
  const accessToken = readEnv('BIGCOMMERCE_ACCESS_TOKEN');
  const scope = readEnv('BIGCOMMERCE_SCOPE') ?? readEnv('BIGCOMMERCE_SCOPES');

  if (!storeHash) {
    throw new Error(
      'Missing BigCommerce store hash. Set BIGCOMMERCE_STORE_HASH or a STORE_URL like https://store-<hash>.mybigcommerce.com/.',
    );
  }

  if (!accessToken) {
    throw new Error(
      'Missing BIGCOMMERCE_ACCESS_TOKEN. App CLIENT_ID/CLIENT_SECRET are not enough for background sync; you must seed the store OAuth access token.',
    );
  }

  await prisma.store.upsert({
    where: { store_hash: storeHash },
    create: {
      store_hash: storeHash,
      access_token: accessToken,
      scope: scope ?? null,
    },
    update: {
      access_token: accessToken,
      ...(scope ? { scope } : {}),
    },
  });

  // Keep output minimal but explicit so operators know what was written.
  process.stdout.write(`Bootstrapped store connection for ${storeHash}.\n`);
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
