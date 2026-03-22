jest.mock('@aws-sdk/client-secrets-manager', () => {
  const send = jest.fn();

  return {
    GetSecretValueCommand: class GetSecretValueCommand {
      input: unknown;

      constructor(input: unknown) {
        this.input = input;
      }
    },
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send,
    })),
    __mockSend: send,
  };
});

import {
  buildRuntimeDatabaseUrl,
  ensureRuntimeDatabaseUrl,
  resetRuntimeDatabaseUrlCache,
} from '../../lib/runtimeDatabaseUrl';

function createEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe('runtimeDatabaseUrl', () => {
  beforeEach(() => {
    resetRuntimeDatabaseUrlCache();
    const { __mockSend } = jest.requireMock('@aws-sdk/client-secrets-manager') as {
      __mockSend: jest.Mock;
    };
    __mockSend.mockReset();
  });

  it('builds a Prisma-safe database URL from runtime database env vars', async () => {
    const { __mockSend } = jest.requireMock('@aws-sdk/client-secrets-manager') as {
      __mockSend: jest.Mock;
    };
    __mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        password: 'lt*3)l%IWg#ad0LefrK[oVX%rh=m`[6;',
        username: 'clusteradmin',
      }),
    });

    const databaseUrl = await buildRuntimeDatabaseUrl(createEnv({
      AURORA_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
      DATABASE_NAME: 'vendors',
      DATABASE_PROXY_ENDPOINT: 'aurora.proxy.us-east-1.rds.amazonaws.com',
      DATABASE_PROXY_PORT: '5432',
    }));

    expect(databaseUrl).toBe(
      'postgresql://clusteradmin:lt*3)l%25IWg%23ad0LefrK%5BoVX%25rh%3Dm%60%5B6%3B@aurora.proxy.us-east-1.rds.amazonaws.com:5432/vendors?sslmode=no-verify&schema=public',
    );
  });

  it('replaces a tokenized DATABASE_URL with a runtime-built URL', async () => {
    const { __mockSend } = jest.requireMock('@aws-sdk/client-secrets-manager') as {
      __mockSend: jest.Mock;
    };
    __mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        password: 'secret#value',
        username: 'clusteradmin',
      }),
    });

    const env = createEnv({
      AURORA_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
      DATABASE_NAME: 'vendors',
      DATABASE_PROXY_ENDPOINT: 'aurora.proxy.us-east-1.rds.amazonaws.com',
      DATABASE_PROXY_PORT: '5432',
      DATABASE_URL: 'postgresql://${Token[TOKEN.499]}:${Token[TOKEN.500]}@proxy:5432/vendors',
    });

    const databaseUrl = await ensureRuntimeDatabaseUrl(env);

    expect(databaseUrl).toBe(
      'postgresql://clusteradmin:secret%23value@aurora.proxy.us-east-1.rds.amazonaws.com:5432/vendors?sslmode=no-verify&schema=public',
    );
    expect(env.DATABASE_URL).toBe(databaseUrl);
  });

  it('preserves an explicit DATABASE_URL when one is already set', async () => {
    const env = createEnv({
      DATABASE_URL: 'postgresql://existing:secret@localhost:5432/vendors',
      DATABASE_PROXY_ENDPOINT: 'ignored',
    });

    expect(await ensureRuntimeDatabaseUrl(env)).toBe('postgresql://existing:secret@localhost:5432/vendors');
  });

  it('prefers the runtime secret/proxy URL over a localhost DATABASE_URL when AWS runtime env is present', async () => {
    const { __mockSend } = jest.requireMock('@aws-sdk/client-secrets-manager') as {
      __mockSend: jest.Mock;
    };
    __mockSend.mockResolvedValue({
      SecretString: JSON.stringify({
        password: 'secret#value',
        username: 'clusteradmin',
      }),
    });

    const env = createEnv({
      AURORA_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:test',
      DATABASE_NAME: 'vendors',
      DATABASE_PROXY_ENDPOINT: 'aurora.proxy.us-east-1.rds.amazonaws.com',
      DATABASE_PROXY_PORT: '5432',
      DATABASE_URL: 'postgresql://existing:secret@localhost:5432/vendors',
    });

    expect(await ensureRuntimeDatabaseUrl(env)).toBe(
      'postgresql://clusteradmin:secret%23value@aurora.proxy.us-east-1.rds.amazonaws.com:5432/vendors?sslmode=no-verify&schema=public',
    );
  });
});
