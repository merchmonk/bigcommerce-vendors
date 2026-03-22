import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const TOKEN_MARKER = '${Token[';

interface DatabaseSecret {
  username?: string;
  password?: string;
}

const secretsManagerClient = new SecretsManagerClient({});
let databaseUrlPromise: Promise<string | undefined> | undefined;

function isMissing(value: string | undefined): value is undefined {
  return !value || value.trim().length === 0;
}

function hasCdKPlaceholder(value: string | undefined): boolean {
  return !!value && value.includes(TOKEN_MARKER);
}

function buildDatabaseUrl(input: {
  username: string;
  password: string;
  endpoint: string;
  port?: string;
  databaseName?: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.endpoint}:${input.port ?? '5432'}/${input.databaseName ?? 'vendors'}?sslmode=no-verify&schema=public`;
}

async function loadDatabaseSecret(secretArn: string): Promise<DatabaseSecret> {
  const response = await secretsManagerClient.send(
    new GetSecretValueCommand({
      SecretId: secretArn,
    }),
  );

  if (!response.SecretString) {
    throw new Error(`Secrets Manager secret ${secretArn} did not include a SecretString payload.`);
  }

  const payload = JSON.parse(response.SecretString) as DatabaseSecret;
  if (isMissing(payload.username) || isMissing(payload.password)) {
    throw new Error(`Secrets Manager secret ${secretArn} is missing the expected username/password fields.`);
  }

  return payload;
}

export async function buildRuntimeDatabaseUrl(env: NodeJS.ProcessEnv): Promise<string | null> {
  const secretArn = env.AURORA_SECRET_ARN;
  const endpoint = env.DATABASE_PROXY_ENDPOINT;

  if (!isMissing(secretArn) && !isMissing(endpoint)) {
    const secret = await loadDatabaseSecret(secretArn);
    return buildDatabaseUrl({
      username: secret.username!,
      password: secret.password!,
      endpoint,
      port: env.DATABASE_PROXY_PORT,
      databaseName: env.DATABASE_NAME,
    });
  }

  if (!isMissing(env.DATABASE_URL) && !hasCdKPlaceholder(env.DATABASE_URL)) {
    return env.DATABASE_URL;
  }

  return null;
}

export async function ensureRuntimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (!databaseUrlPromise) {
    databaseUrlPromise = buildRuntimeDatabaseUrl(env).then(databaseUrl => {
      if (databaseUrl) {
        env.DATABASE_URL = databaseUrl;
      }
      return env.DATABASE_URL;
    });
  }

  return databaseUrlPromise;
}

export function resetRuntimeDatabaseUrlCache(): void {
  databaseUrlPromise = undefined;
}
