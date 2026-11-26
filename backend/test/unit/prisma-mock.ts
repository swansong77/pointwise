/**
 * Minimal deep mock of PrismaClient: prisma.<model>.<method> are jest.fn()s created on demand.
 * $transaction accepts either an array of promises or an async callback receiving the same mock.
 */
export type PrismaMock = Record<string, any> & { $transaction: jest.Mock };

export function createPrismaMock(): PrismaMock {
  const models: Record<string, Record<string, jest.Mock>> = {};
  const target: Record<string, any> = {};
  const proxy: PrismaMock = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop === 'then') return undefined;
      models[prop] ??= new Proxy({} as Record<string, jest.Mock>, {
        get(m, method: string) {
          m[method] ??= jest.fn();
          return m[method];
        },
      });
      return models[prop];
    },
  }) as PrismaMock;
  target.$transaction = jest.fn(async (arg: unknown) => {
    if (typeof arg === 'function') return (arg as (tx: PrismaMock) => unknown)(proxy);
    return Promise.all(arg as Promise<unknown>[]);
  });
  target.$queryRaw = jest.fn();
  target.$executeRaw = jest.fn();
  return proxy;
}

export const configMock = (values: Record<string, string> = {}) => {
  const all: Record<string, string> = {
    JWT_ACCESS_SECRET: 'unit-test-access-secret-0123456789abcdef',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL_DAYS: '30',
    INTERNAL_API_SECRET: 'internal-secret-for-tests',
    APP_URL: 'http://localhost:3000',
    ...values,
  };
  return {
    get: jest.fn((k: string) => all[k]),
    getOrThrow: jest.fn((k: string) => {
      if (!(k in all)) throw new Error(`missing ${k}`);
      return all[k];
    }),
  };
};
