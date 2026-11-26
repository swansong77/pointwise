import { Prisma } from '@prisma/client';
import { ALWAYS_DROP, columnsOf, DATA_RULES, foreignKeys, idOf, importableColumns, insertOrder, ModelMeta, registryProblems, scopeWhere, SECRET_COLUMNS, userModels } from '../../../src/domain/data-registry';

const models = Prisma.dmmf.datamodel.models as unknown as ModelMeta[];

describe('data registry against the real schema', () => {
  it('classifies every model exactly once and lists every secret column', () => {
    expect(registryProblems(models)).toEqual([]);
  });

  it('flags a model that is missing, unknown, or a secret that is not listed', () => {
    const fake: ModelMeta[] = [{ name: 'Thing', fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true, isRequired: true }, { name: 'tokenEnc', kind: 'scalar', type: 'String', isRequired: true }] }];
    const p = registryProblems(fake, { Other: { cls: 'SYSTEM' } }, {});
    expect(p).toEqual(expect.arrayContaining(['model Thing is not classified in DATA_RULES', 'DATA_RULES lists Other, which is not in the schema', 'Thing.tokenEnc looks like a secret but is not in SECRET_COLUMNS']));
    const p2 = registryProblems(fake, { Thing: { cls: 'USER', natural: ['nope'], refs: { x: 'Nowhere' } } }, { Thing: ['gone'] });
    expect(p2.join('|')).toMatch(/SECRET_COLUMNS lists Thing.gone/);
    expect(p2.join('|')).toMatch(/names unknown column nope/);
    expect(p2.join('|')).toMatch(/Thing is USER and importable but has no scope/);
  });

  it('every scope path is a real chain of relations ending in a column', () => {
    const by = new Map(models.map((m) => [m.name, m]));
    const bad: string[] = [];
    for (const [name, rule] of Object.entries(DATA_RULES)) {
      if (!rule.scope) continue;
      const parts = rule.scope.split('.');
      let cur: ModelMeta | undefined = by.get(name);
      for (const rel of parts.slice(0, -1)) {
        const f: ModelMeta['fields'][number] | undefined = cur?.fields.find((x) => x.name === rel && x.kind === 'object');
        if (!f) {
          bad.push(`${name}.${rule.scope}: ${rel} is not a relation`);
          cur = undefined;
          break;
        }
        cur = by.get(f.type);
      }
      if (cur && !cur.fields.some((x) => x.name === parts[parts.length - 1] && x.kind !== 'object')) bad.push(`${name}.${rule.scope}: last part is not a column`);
    }
    expect(bad).toEqual([]);
  });

  it('orders every model after the models it points to; only self references are deferred', () => {
    const { order, deferred } = insertOrder(models);
    expect(order).toHaveLength(models.length);
    const pos = new Map(order.map((n, i) => [n, i]));
    const wrong: string[] = [];
    for (const m of models)
      for (const fk of foreignKeys(m)) if (fk.target !== m.name && !(pos.get(fk.target)! < pos.get(m.name)!)) wrong.push(`${m.name} must come after ${fk.target}`);
    expect(wrong).toEqual([]);
    expect(deferred.every((d) => d.model === d.target)).toBe(true);
    expect(deferred.map((d) => `${d.model}.${d.field}`)).toContain('Category.parentId');
    expect(order.indexOf('User')).toBeLessThan(order.indexOf('Wallet'));
    expect(order.indexOf('WalletCard')).toBeLessThan(order.indexOf('UserOffer'));
  });

  it('breaks a cycle at an optional key and refuses one with only required keys', () => {
    const f = (name: string, type: string, from: string, required: boolean): ModelMeta['fields'][number] => ({ name, kind: 'object', type, relationFromFields: [from], isRequired: required });
    const col = (name: string, required: boolean) => ({ name, kind: 'scalar', type: 'String', isRequired: required });
    const id = { name: 'id', kind: 'scalar', type: 'String', isId: true, isRequired: true };
    const a: ModelMeta = { name: 'A', fields: [id, col('bId', false), f('b', 'B', 'bId', false)] };
    const b: ModelMeta = { name: 'B', fields: [id, col('aId', true), f('a', 'A', 'aId', true)] };
    const r = insertOrder([a, b]);
    expect(r.order).toHaveLength(2);
    expect(r.deferred).toEqual([{ model: 'A', field: 'bId', target: 'B' }]);
    expect(r.order.indexOf('A')).toBeLessThan(r.order.indexOf('B'));
    const c: ModelMeta = { name: 'C', fields: [id, col('dId', true), f('d', 'D', 'dId', true)] };
    const d: ModelMeta = { name: 'D', fields: [id, col('cId', true), f('c', 'C', 'cId', true)] };
    expect(() => insertOrder([c, d])).toThrow(/cycle/);
    const self: ModelMeta = { name: 'S', fields: [id, col('pId', true), f('p', 'S', 'pId', true)] };
    expect(() => insertOrder([self])).toThrow(/own table and is required/);
  });

  it('builds nested where clauses from scope paths', () => {
    expect(scopeWhere('userId', 'u1')).toEqual({ userId: 'u1' });
    expect(scopeWhere('walletCard.wallet.userId', 'u1')).toEqual({ walletCard: { wallet: { userId: 'u1' } } });
  });

  it('the member export covers the member data models and never a secret, token or credential column', () => {
    const order = insertOrder(models).order;
    const list = userModels(order);
    for (const m of ['Profile', 'WalletCard', 'UserOffer', 'Transaction', 'LoyaltyAccount', 'OfferAccount', 'EnrollmentRule', 'NotificationPreference', 'AiSettings', 'PlannedPurchase', 'CreditCard']) expect(list).toContain(m);
    for (const m of ['RefreshToken', 'PasswordResetToken', 'PushSubscription', 'AuditLog', 'Issuer']) expect(list).not.toContain(m);
    for (const m of models) {
      const cols = importableColumns(m);
      for (const banned of [...ALWAYS_DROP, ...(SECRET_COLUMNS[m.name] ?? [])]) expect(cols).not.toContain(banned);
      expect(columnsOf(m).map((c) => c.name)).toContain(idOf(m));
    }
    expect(importableColumns(models.find((m) => m.name === 'AiSettings')!)).not.toContain('consentedAt');
    expect(importableColumns(models.find((m) => m.name === 'User')!)).not.toContain('role');
  });
});
