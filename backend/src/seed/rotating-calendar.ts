import type { RotatingEntry } from '../domain/rotating-calendar';

/**
 * Quarterly categories as the issuers announce them. Only quarters a person has read on the issuer's own page are listed;
 * the app never fetches an issuer page by itself. Add the next quarter here (or POST it to /admin/rotating-categories) when
 * the issuer announces it, usually a few weeks before the quarter starts. The daily job applies what is listed.
 */
export const ROTATING_CALENDAR: RotatingEntry[] = [
  {
    cards: ['chase-freedom-flex', 'chase-freedom'],
    quarter: '2026-Q4',
    capDollars: 1500,
    sourceUrl: 'https://creditcards.chase.com/cash-back-credit-cards/freedom/flex',
    checkedOn: '2026-11-26',
    categories: [
      { cat: 'groceries', mult: 5, desc: '5% on grocery stores (not Walmart or Target), on up to $1,500 a quarter once activated' },
      { cat: 'dining', mult: 5, desc: '5% on dining, on up to $1,500 a quarter once activated' },
    ],
  },
];
