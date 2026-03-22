import { PrismaClient } from '@prisma/client';
import { ensureRuntimeDatabaseUrl } from './runtimeDatabaseUrl';

const globalForPrisma = globalThis as unknown as {
  prismaClientPromise: Promise<PrismaClient> | undefined;
  prisma: PrismaClient | undefined;
};

class LazyPrismaOperation<T> implements PromiseLike<T> {
  constructor(
    private readonly factory: (client: PrismaClient) => PromiseLike<T>,
  ) {}

  createRaw(client: PrismaClient): PromiseLike<T> {
    return this.factory(client);
  }

  private toPromise(): Promise<T> {
    return getPrismaClient().then(client => Promise.resolve(this.createRaw(client)));
  }

  execute(client: PrismaClient): Promise<T> {
    return Promise.resolve(this.createRaw(client));
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.toPromise().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.toPromise().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.toPromise().finally(onfinally ?? undefined);
  }
}

async function createPrismaClient(): Promise<PrismaClient> {
  const databaseUrl = await ensureRuntimeDatabaseUrl();
  const prisma = new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  globalForPrisma.prisma = prisma;
  return prisma;
}

export async function getPrismaClient(): Promise<PrismaClient> {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  if (!globalForPrisma.prismaClientPromise) {
    globalForPrisma.prismaClientPromise = createPrismaClient();
  }

  return globalForPrisma.prismaClientPromise;
}

function createDelegateProxy(delegateName: string) {
  return new Proxy(
    {},
    {
      get(_target, propertyKey) {
        if (typeof propertyKey !== 'string') {
          return undefined;
        }

        return (...args: unknown[]) =>
          new LazyPrismaOperation(client => (client as never as Record<string, Record<string, (...methodArgs: unknown[]) => PromiseLike<unknown>>>)[delegateName][propertyKey](...args));
      },
    },
  );
}

function createPrismaProxy(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_target, propertyKey) {
        if (typeof propertyKey !== 'string') {
          return undefined;
        }

        if (propertyKey === '$transaction') {
          return (input: unknown, options?: unknown) =>
            new LazyPrismaOperation(async client => {
              if (typeof input === 'function') {
                return client.$transaction(input as never, options as never);
              }

              if (Array.isArray(input)) {
                const operations = input.map(item =>
                  item instanceof LazyPrismaOperation ? item.createRaw(client) : item,
                );
                return client.$transaction(operations as never, options as never);
              }

              return client.$transaction(input as never, options as never);
            });
        }

        if (propertyKey.startsWith('$')) {
          return (...args: unknown[]) =>
            new LazyPrismaOperation(client => (client as never as Record<string, (...methodArgs: unknown[]) => PromiseLike<unknown>>)[propertyKey](...args));
        }

        return createDelegateProxy(propertyKey);
      },
    },
  ) as PrismaClient;
}

export const prisma = createPrismaProxy();

export default prisma;
