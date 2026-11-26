/**
 * Public issuer pages the daily job may read for the quarter's categories (explicit user override of the no-issuer-automation
 * rule, scoped to rotating categories: public pages only, no login, robots.txt honoured, allow-listed domains, one request
 * per host per interval, never more than once a day per source, and only when the quarter is missing).
 * Turn it off with ROTATING_AUTO_FETCH=false.
 */
export interface RotatingSource {
  cards: string[];
  url: string;
  /** set when the page cannot be read automatically: the job skips it and says why in the admin status */
  unreadable?: string;
}

export const ROTATING_SOURCES: RotatingSource[] = [
  { cards: ['chase-freedom-flex'], url: 'https://creditcards.chase.com/cash-back-credit-cards/freedom/flex' },
  {
    cards: ['discover-it-cash-back'],
    url: 'https://www.discover.com/credit-cards/cash-back/cashback-calendar.html',
    unreadable: 'checked 2026-11-26: the calendar is loaded by script and the page text states only "5% on up to $1,500 each quarter" without the categories; add each quarter by admin import',
  },
];
