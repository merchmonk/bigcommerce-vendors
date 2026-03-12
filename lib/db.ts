import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Pool } from 'pg';
import { Db, StoreData } from '../types';
import { SessionProps } from '../types';

const {
  DATABASE_URL: envDatabaseUrl,
  AURORA_SECRET_ARN,
  DATABASE_PROXY_ENDPOINT,
  DATABASE_PROXY_PORT = '5432',
} = process.env;

let poolInstance: Pool | null = null;

/**
 * Resolve DB connection string: use DATABASE_URL if set; otherwise fetch from Secrets Manager
 * and build URL using RDS Proxy endpoint (AURORA_SECRET_ARN + DATABASE_PROXY_ENDPOINT).
 */
async function getConnectionString(): Promise<string> {
  if (envDatabaseUrl) {
    return envDatabaseUrl;
  }
  if (AURORA_SECRET_ARN && DATABASE_PROXY_ENDPOINT) {
    const client = new SecretsManagerClient({});
    const res = await client.send(
      new GetSecretValueCommand({ SecretId: AURORA_SECRET_ARN })
    );
    const secret = JSON.parse(res.SecretString ?? '{}') as {
      username?: string;
      password?: string;
      dbname?: string;
      engine?: string;
    };
    const username = secret.username ?? '';
    const password = encodeURIComponent(secret.password ?? '');
    const dbname = secret.dbname ?? 'postgres';
    return `postgresql://${username}:${password}@${DATABASE_PROXY_ENDPOINT}:${DATABASE_PROXY_PORT}/${dbname}`;
  }
  throw new Error(
    'Database config: set DATABASE_URL or both AURORA_SECRET_ARN and DATABASE_PROXY_ENDPOINT'
  );
}

async function getPool(): Promise<Pool> {
  if (poolInstance) {
    return poolInstance;
  }
  const connectionString = await getConnectionString();
  poolInstance = new Pool({ connectionString });
  return poolInstance;
}

async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const p = await getPool();
  const result = await p.query<T>(text, params);
  return result.rows;
}

const db: Db = {
  async setUser({ user }: SessionProps) {
    if (!user) return;

    const { email, id, username } = user;

    await query(
      `
            INSERT INTO users (userId, email, username)
            VALUES ($1, $2, $3)
            ON CONFLICT (userId)
            DO UPDATE SET email = EXCLUDED.email, username = EXCLUDED.username
            `,
      [id, email, username ?? null],
    );
  },

  async setStore(session: SessionProps) {
    const { access_token: accessToken, context, scope } = session;
    if (!accessToken || !scope) return;

    const storeHash = context?.split('/')[1] || '';
    if (!storeHash) return;

    const storeData: StoreData = { accessToken, scope, storeHash };

    await query(
      `
            INSERT INTO stores (storeHash, accessToken, scope)
            VALUES ($1, $2, $3)
            ON CONFLICT (storeHash)
            DO UPDATE SET accessToken = EXCLUDED.accessToken, scope = EXCLUDED.scope
            `,
      [storeData.storeHash, storeData.accessToken ?? null, storeData.scope ?? null],
    );
  },

  async setStoreUser(session: SessionProps) {
    const {
      access_token: accessToken,
      context,
      owner,
      sub,
      user: { id: userId },
    } = session;

    if (!userId) return;

    const contextString = context ?? sub;
    const storeHash = contextString?.split('/')[1] || '';
    if (!storeHash) return;

    const values = [String(userId), storeHash];
    const storeUsers = await query<{ isadmin: boolean }>(
      'SELECT * FROM storeUsers WHERE userId = $1 AND storeHash = $2 LIMIT 1',
      values,
    );
    const existing = storeUsers[0];

    if (accessToken) {
      // Installing/updating app: ensure store owner is admin
      if (!existing) {
        await query(
          'INSERT INTO storeUsers (isAdmin, storeHash, userId) VALUES ($1, $2, $3)',
          [true, storeHash, userId],
        );
      } else if (!existing.isadmin) {
        await query(
          'UPDATE storeUsers SET isAdmin = TRUE WHERE userId = $1 AND storeHash = $2',
          values,
        );
      }
    } else {
      // Non-owner users added here for multi-user apps
      if (!existing) {
        const isAdmin = owner && owner.id === userId;
        await query(
          'INSERT INTO storeUsers (isAdmin, storeHash, userId) VALUES ($1, $2, $3)',
          [!!isAdmin, storeHash, userId],
        );
      }
    }
  },

  async deleteUser({ context, user, sub }: SessionProps) {
    const contextString = context ?? sub;
    const storeHash = contextString?.split('/')[1] || '';
    if (!storeHash || !user?.id) return;

    await query('DELETE FROM storeUsers WHERE userId = $1 AND storeHash = $2', [
      String(user.id),
      storeHash,
    ]);
  },

  async hasStoreUser(storeHash: string, userId: string) {
    if (!storeHash || !userId) return false;

    const results = await query(
      'SELECT 1 FROM storeUsers WHERE userId = $1 AND storeHash = $2 LIMIT 1',
      [userId, storeHash],
    );

    return results.length > 0;
  },

  async getStoreToken(storeHash: string) {
    if (!storeHash) return null;

    const results = await query<{ accesstoken: string }>(
      'SELECT accessToken FROM stores WHERE storeHash = $1',
      [storeHash],
    );

    return results.length ? results[0].accesstoken : null;
  },

  async deleteStore({ store_hash: storeHash }: SessionProps) {
    if (!storeHash) return;
    await query('DELETE FROM stores WHERE storeHash = $1', [storeHash]);
  },
};

export { getPool };
export default db;
