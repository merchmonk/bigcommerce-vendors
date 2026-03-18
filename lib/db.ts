import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Db, SessionProps, StoreData } from '../types';
import prisma from './prisma';

const execFileAsync = promisify(execFile);

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
  await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: process.env,
  });

  if (options?.seed) {
    await execFileAsync('npx', ['prisma', 'db', 'seed'], {
      cwd: process.cwd(),
      env: process.env,
    });
  }
}

export default db;
