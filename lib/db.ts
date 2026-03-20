import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Db, SessionProps, StoreData } from '../types';
import { seedPromoStandardsMappings } from './etl/promostandardsSeed';
import prisma from './prisma';

const execFileAsync = promisify(execFile);
const PRISMA_SCHEMA_PATH = path.join(process.cwd(), 'prisma', 'schema.prisma');
const PRISMA_CLI_PATH = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');

function getLambdaSafeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: process.env.HOME || '/tmp',
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/.cache',
    npm_config_cache: process.env.npm_config_cache || '/tmp/.npm',
    PRISMA_HIDE_UPDATE_MESSAGE: 'true',
    PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
  };
}

function parseStoreHash(session: SessionProps): string {
  const contextString = session.context ?? session.sub ?? '';
  return contextString.split('/')[1] ?? '';
}

function parseUserId(value: unknown): number | null {
  const userId = Number(value);
  return Number.isFinite(userId) ? userId : null;
}

const db: Db = {
  async setUser({ user }: SessionProps) {
    if (!user) return;
    const userId = parseUserId(user.id);
    if (!userId) return;

    await prisma.user.upsert({
      where: { userId },
      create: {
        userId,
        email: user.email,
        username: user.username ?? null,
      },
      update: {
        email: user.email,
        username: user.username ?? null,
      },
    });
  },

  async setStore(session: SessionProps) {
    const { access_token: accessToken, scope } = session;
    if (!accessToken || !scope) return;

    const storeHash = parseStoreHash(session);
    if (!storeHash) return;

    const storeData: StoreData = { accessToken, scope, storeHash };
    await prisma.store.upsert({
      where: { storeHash: storeData.storeHash },
      create: {
        storeHash: storeData.storeHash,
        accessToken: storeData.accessToken ?? null,
        scope: storeData.scope ?? null,
      },
      update: {
        accessToken: storeData.accessToken ?? null,
        scope: storeData.scope ?? null,
      },
    });
  },

  async setStoreUser(session: SessionProps) {
    const { access_token: accessToken, owner } = session;
    const userId = parseUserId(session.user?.id);
    if (!userId) return;

    const storeHash = parseStoreHash(session);
    if (!storeHash) return;

    const existing = await prisma.storeUser.findUnique({
      where: {
        userId_storeHash: {
          userId,
          storeHash,
        },
      },
    });

    if (accessToken) {
      if (!existing) {
        await prisma.storeUser.create({
          data: {
            userId,
            storeHash,
            isAdmin: true,
          },
        });
      } else if (!existing.isAdmin) {
        await prisma.storeUser.update({
          where: {
            userId_storeHash: {
              userId,
              storeHash,
            },
          },
          data: {
            isAdmin: true,
          },
        });
      }
      return;
    }

    if (!existing) {
      const isAdmin = !!owner && parseUserId(owner.id) === userId;
      await prisma.storeUser.create({
        data: {
          userId,
          storeHash,
          isAdmin,
        },
      });
    }
  },

  async deleteUser({ context, user, sub }: SessionProps) {
    const userId = parseUserId(user?.id);
    if (!userId) return;

    const storeHash = (context ?? sub ?? '').split('/')[1] ?? '';
    if (!storeHash) return;

    await prisma.storeUser.deleteMany({
      where: {
        userId,
        storeHash,
      },
    });
  },

  async hasStoreUser(storeHash: string, userId: string) {
    if (!storeHash || !userId) return false;
    const parsedUserId = parseUserId(userId);
    if (!parsedUserId) return false;

    const count = await prisma.storeUser.count({
      where: {
        userId: parsedUserId,
        storeHash,
      },
    });
    return count > 0;
  },

  async getStoreToken(storeHash: string) {
    if (!storeHash) return null;

    const store = await prisma.store.findUnique({
      where: { storeHash },
      select: {
        accessToken: true,
      },
    });

    return store?.accessToken ?? null;
  },

  async deleteStore({ store_hash: storeHash }: SessionProps) {
    if (!storeHash) return;
    await prisma.store.deleteMany({
      where: { storeHash },
    });
  },
};

export async function runMigrations(options?: { seed?: boolean }): Promise<void> {
  await execFileAsync(process.execPath, [PRISMA_CLI_PATH, 'migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH], {
    cwd: process.cwd(),
    env: getLambdaSafeEnv(),
  });

  if (options?.seed) {
    await seedPromoStandardsMappings();
  }
}

export async function getPrimaryStoreConnection(): Promise<StoreData | null> {
  const store = await prisma.store.findFirst({
    orderBy: {
      id: 'asc',
    },
    select: {
      storeHash: true,
      accessToken: true,
      scope: true,
    },
  });

  if (!store?.storeHash || !store.accessToken) {
    return null;
  }

  return {
    storeHash: store.storeHash,
    accessToken: store.accessToken,
    scope: store.scope ?? undefined,
  };
}

export default db;
