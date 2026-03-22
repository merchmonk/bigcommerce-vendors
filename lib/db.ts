import { Db, SessionProps, StoreData } from '../types';
import prisma from './prisma';

interface StoreConnectionRow {
  access_token: string | null;
  markup_percent: number | null;
  scope: string | null;
  store_hash: string;
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
      where: { user_id: userId },
      create: {
        user_id: userId,
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
    const accessToken = session.access_token?.trim() || undefined;
    const scope = session.scope?.trim() || undefined;
    if (!accessToken && !scope) return;

    const storeHash = parseStoreHash(session);
    if (!storeHash) return;

    const storeData: StoreData = { accessToken, scope, storeHash };
    await prisma.store.upsert({
      where: { store_hash: storeData.storeHash },
      create: {
        store_hash: storeData.storeHash,
        access_token: storeData.accessToken ?? null,
        scope: storeData.scope ?? null,
      },
      update: {
        ...(storeData.accessToken ? { access_token: storeData.accessToken } : {}),
        ...(storeData.scope ? { scope: storeData.scope } : {}),
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
        user_id_store_hash: {
          user_id: userId,
          store_hash: storeHash,
        },
      },
    });

    if (accessToken) {
      if (!existing) {
        await prisma.storeUser.create({
          data: {
            user_id: userId,
            store_hash: storeHash,
            is_admin: true,
          },
        });
      } else if (!existing.is_admin) {
        await prisma.storeUser.update({
          where: {
            user_id_store_hash: {
              user_id: userId,
              store_hash: storeHash,
            },
          },
          data: {
            is_admin: true,
          },
        });
      }
      return;
    }

    if (!existing) {
      const isAdmin = !!owner && parseUserId(owner.id) === userId;
      await prisma.storeUser.create({
        data: {
          user_id: userId,
          store_hash: storeHash,
          is_admin: isAdmin,
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
        user_id: userId,
        store_hash: storeHash,
      },
    });
  },

  async hasStoreUser(storeHash: string, userId: string) {
    if (!storeHash || !userId) return false;
    const parsedUserId = parseUserId(userId);
    if (!parsedUserId) return false;

    const count = await prisma.storeUser.count({
      where: {
        user_id: parsedUserId,
        store_hash: storeHash,
      },
    });
    return count > 0;
  },

  async getStoreToken(storeHash: string) {
    if (!storeHash) return null;

    const store = await prisma.store.findUnique({
      where: { store_hash: storeHash },
      select: {
        access_token: true,
      },
    });

    return store?.access_token ?? null;
  },

  async deleteStore({ store_hash: storeHash }: SessionProps) {
    if (!storeHash) return;
    await prisma.store.deleteMany({
      where: { store_hash: storeHash },
    });
  },
};

export async function getPrimaryStoreConnection(): Promise<StoreData | null> {
  const store = await (prisma.store.findFirst as unknown as (args: unknown) => Promise<StoreConnectionRow | null>)({
    where: {
      access_token: {
        not: null,
      },
    },
    orderBy: {
      id: 'asc',
    },
      select: {
        store_hash: true,
        access_token: true,
        markup_percent: true,
        scope: true,
      },
  });

  if (!store?.store_hash || !store.access_token) {
    return null;
  }

  return {
    storeHash: store.store_hash,
    accessToken: store.access_token,
    markupPercent: store.markup_percent ?? undefined,
    scope: store.scope ?? undefined,
  };
}

export async function getStoreMarkupPercent(storeHash: string): Promise<number | null> {
  if (!storeHash) {
    return null;
  }

  const store = await (prisma.store.findUnique as unknown as (args: unknown) => Promise<Pick<StoreConnectionRow, 'markup_percent'> | null>)({
    where: { store_hash: storeHash },
    select: {
      markup_percent: true,
    },
  });

  return typeof store?.markup_percent === 'number' ? store.markup_percent : null;
}

export default db;
