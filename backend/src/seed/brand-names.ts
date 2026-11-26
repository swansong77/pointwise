import { ISSUER_REGISTRY, REAL_CURRENCIES, REAL_MERCHANTS } from './real-catalog.data';
import { MERCHANT_IDENTITIES } from './merchant-identities';
import { REGISTRY_CURRENCIES, REGISTRY_PROGRAMS } from './loyalty-registry';
import { LISTING_CURRENCIES, VERIFIED_LISTINGS } from './verified-listings';

export interface CatalogNames {
  issuers: string[];
  merchants: string[];
  programs: Array<{ code: string; name: string; kind: string }>;
  currencies: Array<{ code: string; name: string }>;
  networks: string[];
}

const uniq = <T>(xs: T[], key: (x: T) => string): T[] => [...new Map(xs.map((x) => [key(x), x])).values()];
const sort = <T>(xs: T[], key: (x: T) => string): T[] => [...xs].sort((a, b) => key(a).localeCompare(key(b)));

/** Every name of a bank, merchant, program, currency and network that the real catalog and registries can put on a page. */
export function catalogNames(): CatalogNames {
  const issuers = [...ISSUER_REGISTRY.map((i) => i.name), ...VERIFIED_LISTINGS.map((l) => l.issuer)];
  const merchants = [...REAL_MERCHANTS.map((m) => m.name), ...MERCHANT_IDENTITIES.map((m) => m.name)];
  const currencies = [...REAL_CURRENCIES, ...REGISTRY_CURRENCIES, ...LISTING_CURRENCIES].map((c) => ({ code: c.code, name: c.name }));
  return {
    issuers: sort(uniq(issuers, (n) => n), (n) => n),
    merchants: sort(uniq(merchants, (n) => n), (n) => n),
    programs: sort(REGISTRY_PROGRAMS.map((p) => ({ code: p.code, name: p.name, kind: p.kind })), (p) => p.code),
    currencies: sort(uniq(currencies, (c) => c.code), (c) => c.code),
    networks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
  };
}
