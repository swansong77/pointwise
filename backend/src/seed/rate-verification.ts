/**
 * Category earning rates confirmed against the issuers' own public product pages on 2026-11-26 (docs/rewards-audit.md).
 *
 * Only what a page states is recorded here; nothing comes from memory. A rate the page ties to the issuer's travel portal,
 * a linked account or similar is `conditional` (shown on the card, never used to rank). Rates a page presents as "up to"
 * or limited-time are left out. Cards whose pages could not be read (American Express, Citi Double Cash and Custom Cash,
 * Barclays) are not in this file and stay unverified.
 *
 * Applied by applyRateVerifications (rate-verification.apply.ts): each rate updates the matching reward of the card (same
 * category or merchant, same conditional and rotating flags) or adds it, and stamps it with the date and page.
 */
export const RATES_VERIFIED_ON = '2026-11-26';

export interface VerifiedRate {
  /** category slug, or merchant slug in `merchant` */
  cat?: string;
  merchant?: string;
  mult: number;
  desc: string;
  /** spend cap in dollars per `capPeriod` */
  cap?: number;
  capPeriod?: 'QUARTER' | 'YEAR';
  /** needs a portal, a linked account or similar: never used to rank */
  conditional?: boolean;
  /** a category the member selects or activates (the engine applies it only when selected) */
  rotating?: boolean;
  startsAt?: string;
  endsAt?: string;
}

export interface VerifiedCard {
  slug: string;
  url: string;
  /** the annual fee the page states, in dollars (updated when it differs) */
  feeDollars?: number;
  rates: VerifiedRate[];
  note?: string;
}

const CH = 'https://creditcards.chase.com';
const C1 = 'https://www.capitalone.com/credit-cards';
const BOA = 'https://www.bankofamerica.com/credit-cards/products';
const USB = 'https://www.usbank.com/credit-cards';

export const RATE_VERIFICATIONS: VerifiedCard[] = [
  {
    slug: 'chase-sapphire-preferred',
    url: `${CH}/rewards-credit-cards/sapphire/preferred`,
    feeDollars: 95,
    rates: [
      { cat: 'travel', mult: 5, desc: '5x points on travel purchased through Chase Travel', conditional: true },
      { cat: 'dining', mult: 3, desc: '3x points on dining, including takeout and eligible delivery' },
      { cat: 'gas', mult: 3, desc: '3x points on gas stations and EV charging' },
      { cat: 'streaming', mult: 3, desc: '3x points on top streaming services' },
      { cat: 'groceries', mult: 3, desc: '3x points on online grocery (not Target, Walmart or wholesale clubs)', conditional: true },
      { cat: 'travel', mult: 2, desc: '2x points on all other travel' },
      { cat: 'everything-else', mult: 1, desc: '1x points on all other purchases' },
    ],
    note: 'Limited-time Lyft and Peloton offers are not stored.',
  },
  {
    slug: 'chase-sapphire-reserve',
    url: `${CH}/rewards-credit-cards/sapphire/reserve`,
    feeDollars: 795,
    rates: [
      { cat: 'travel', mult: 8, desc: '8x points on all purchases through Chase Travel', conditional: true },
      { cat: 'airlines', mult: 4, desc: '4x points on flights booked directly with the airline' },
      { cat: 'hotels', mult: 4, desc: '4x points on hotels booked directly with the hotel' },
      { cat: 'dining', mult: 3, desc: '3x points on dining worldwide' },
      { cat: 'everything-else', mult: 1, desc: '1x points on all other purchases' },
    ],
  },
  {
    slug: 'chase-freedom-unlimited',
    url: `${CH}/cash-back-credit-cards/freedom/unlimited`,
    feeDollars: 0,
    rates: [
      { cat: 'travel', mult: 5, desc: '5% on travel purchased through Chase Travel', conditional: true },
      { cat: 'dining', mult: 3, desc: '3% on dining at restaurants, including takeout and eligible delivery' },
      { cat: 'drugstores', mult: 3, desc: '3% on drugstore purchases' },
      { cat: 'everything-else', mult: 1.5, desc: '1.5% on all other purchases' },
    ],
  },
  {
    slug: 'chase-freedom-flex',
    url: `${CH}/cash-back-credit-cards/freedom/flex`,
    feeDollars: 0,
    rates: [
      { cat: 'travel', mult: 5, desc: '5% on travel purchased through Chase Travel', conditional: true },
      { cat: 'dining', mult: 3, desc: '3% on dining at restaurants, including takeout and eligible delivery' },
      { cat: 'drugstores', mult: 3, desc: '3% on drugstore purchases' },
      { cat: 'everything-else', mult: 1, desc: '1% on all other purchases' },
    ],
    note: 'The 5% categories change every quarter; they come from seed/rotating-calendar.ts.',
  },
  {
    slug: 'chase-ink-business-cash',
    url: `${CH}/business-credit-cards/ink/cash`,
    feeDollars: 0,
    rates: [
      { cat: 'phone-internet', mult: 5, desc: '5% on internet, cable and phone services and office supply stores (combined $25,000 a year)', cap: 25000, capPeriod: 'YEAR' },
      { cat: 'gas', mult: 2, desc: '2% at gas stations (combined $25,000 a year with restaurants)', cap: 25000, capPeriod: 'YEAR' },
      { cat: 'dining', mult: 2, desc: '2% at restaurants (combined $25,000 a year with gas stations)', cap: 25000, capPeriod: 'YEAR' },
      { cat: 'everything-else', mult: 1, desc: '1% on all other purchases' },
    ],
  },
  {
    slug: 'chase-ink-business-unlimited',
    url: `${CH}/business-credit-cards/ink/unlimited`,
    feeDollars: 0,
    rates: [{ cat: 'everything-else', mult: 1.5, desc: '1.5% on every purchase' }],
  },
  {
    slug: 'chase-ink-business-preferred',
    url: `${CH}/business-credit-cards/ink/business-preferred`,
    feeDollars: 95,
    rates: [
      { cat: 'travel', mult: 3, desc: '3x points on travel (combined $150,000 a year with shipping, advertising and internet, cable and phone)', cap: 150000, capPeriod: 'YEAR' },
      { cat: 'phone-internet', mult: 3, desc: '3x points on internet, cable and phone services (combined $150,000 a year)', cap: 150000, capPeriod: 'YEAR' },
      { cat: 'everything-else', mult: 1, desc: '1 point per $1 on all other purchases' },
    ],
  },
  {
    slug: 'chase-united-explorer',
    url: `${CH}/travel-credit-cards/united/united-explorer`,
    feeDollars: 150,
    rates: [
      { merchant: 'united-airlines', mult: 3, desc: '3x miles on United purchases with the card (MileagePlus earns more on flights: 9x in total)' },
      { cat: 'hotels', mult: 2, desc: '2x miles on hotel stays booked with the hotel' },
      { cat: 'dining', mult: 2, desc: '2x miles on dining, including eligible delivery' },
      { cat: 'everything-else', mult: 1, desc: '1 mile per $1 on all other purchases' },
    ],
    note: 'The annual fee is $0 for the first year, then $150.',
  },
  {
    slug: 'chase-ihg-one-rewards-premier',
    url: `${CH}/travel-credit-cards/ihg-rewards-club/premier`,
    feeDollars: 150,
    rates: [
      { merchant: 'ihg', mult: 10, desc: '10 points per $1 at participating IHG hotels' },
      { cat: 'dining', mult: 5, desc: '5x points on dining, including takeout and eligible delivery' },
      { cat: 'groceries', mult: 5, desc: '5x points at grocery stores' },
      { cat: 'gas', mult: 5, desc: '5x points at gas stations' },
      { cat: 'airlines', mult: 5, desc: '5x points on airline tickets bought directly from the airline' },
      { cat: 'car-rental', mult: 5, desc: '5x points at car rental agencies' },
      { cat: 'travel', mult: 5, desc: '5x points on other travel purchases through December 31, 2026, then 3x', endsAt: '2026-12-31' },
      { cat: 'everything-else', mult: 3, desc: '3 points per $1 on all other purchases' },
    ],
  },
  {
    slug: 'chase-marriott-bonvoy-boundless',
    url: `${CH}/travel-credit-cards/marriott-bonvoy/boundless`,
    feeDollars: 95,
    rates: [
      { merchant: 'marriott', mult: 6, desc: '6x points at hotels participating in Marriott Bonvoy' },
      { cat: 'groceries', mult: 3, desc: '3x points at grocery stores (first $6,000 a year, combined with gas and dining)', cap: 6000, capPeriod: 'YEAR' },
      { cat: 'gas', mult: 3, desc: '3x points at gas stations (first $6,000 a year, combined)', cap: 6000, capPeriod: 'YEAR' },
      { cat: 'dining', mult: 3, desc: '3x points at restaurants (first $6,000 a year, combined)', cap: 6000, capPeriod: 'YEAR' },
      { cat: 'everything-else', mult: 2, desc: '2x points on all other purchases' },
    ],
  },
  {
    slug: 'chase-prime-visa',
    url: `${CH}/cash-back-credit-cards/amazon-prime-rewards`,
    feeDollars: 0,
    rates: [
      { merchant: 'amazon', mult: 5, desc: '5% back at Amazon.com and Whole Foods Market with an eligible Prime membership (3% without Prime)' },
      { cat: 'travel', mult: 5, desc: '5% back on Chase Travel purchases', conditional: true },
      { cat: 'gas', mult: 2, desc: '2% back at gas stations' },
      { cat: 'dining', mult: 2, desc: '2% back at restaurants' },
      { cat: 'transit', mult: 2, desc: '2% back on local transit and commuting, including rideshare' },
      { cat: 'everything-else', mult: 1, desc: '1% back on all other purchases' },
    ],
  },
  {
    slug: 'capital-one-venture',
    url: `${C1}/venture/`,
    feeDollars: 95,
    rates: [
      { cat: 'hotels', mult: 5, desc: '5x miles on hotels booked through Capital One Travel', conditional: true },
      { cat: 'car-rental', mult: 5, desc: '5x miles on rental cars booked through Capital One Travel', conditional: true },
      { cat: 'everything-else', mult: 2, desc: '2x miles on every purchase' },
    ],
  },
  {
    slug: 'capital-one-quicksilver',
    url: `${C1}/quicksilver/`,
    feeDollars: 0,
    rates: [
      { cat: 'hotels', mult: 5, desc: '5% on hotels booked through Capital One Travel', conditional: true },
      { cat: 'car-rental', mult: 5, desc: '5% on rental cars booked through Capital One Travel', conditional: true },
      { cat: 'everything-else', mult: 1.5, desc: '1.5% cash back on every purchase' },
    ],
  },
  {
    slug: 'capital-one-savor',
    url: `${C1}/cash-back/savor/`,
    feeDollars: 0,
    rates: [
      { cat: 'dining', mult: 3, desc: '3% cash back on dining' },
      { cat: 'entertainment', mult: 3, desc: '3% cash back on entertainment' },
      { cat: 'groceries', mult: 3, desc: '3% cash back at grocery stores (not superstores like Walmart and Target)' },
      { cat: 'everything-else', mult: 1, desc: '1% cash back on other purchases' },
    ],
    note: 'The category page was read; the 3% on streaming is kept from the curated list and stays unconfirmed.',
  },
  {
    slug: 'citi-strata-premier',
    url: 'https://www.citi.com/credit-cards/citi-strata-premier-credit-card',
    feeDollars: 95,
    rates: [
      { cat: 'hotels', mult: 10, desc: '10 points per $1 on hotels booked on cititravel.com', conditional: true },
      { cat: 'car-rental', mult: 10, desc: '10 points per $1 on car rentals booked on cititravel.com', conditional: true },
      { cat: 'airlines', mult: 3, desc: '3 points per $1 on air travel' },
      { cat: 'hotels', mult: 3, desc: '3 points per $1 on other hotel purchases' },
      { cat: 'dining', mult: 3, desc: '3 points per $1 at restaurants' },
      { cat: 'groceries', mult: 3, desc: '3 points per $1 at supermarkets' },
      { cat: 'gas', mult: 3, desc: '3 points per $1 on gas and EV charging stations' },
      { cat: 'everything-else', mult: 1, desc: '1 point per $1 on all other purchases' },
    ],
  },
  {
    slug: 'citi-costco-anywhere',
    url: 'https://www.citi.com/credit-cards/costco-anywhere-visa-card',
    rates: [
      { cat: 'gas', mult: 4, desc: '4% on eligible gas and EV charging (5% at Costco), on a combined $7,000 a year, then 1%', cap: 7000, capPeriod: 'YEAR' },
      { cat: 'dining', mult: 3, desc: '3% at restaurants' },
      { cat: 'travel', mult: 3, desc: '3% on eligible travel, including Costco Travel' },
      { merchant: 'costco', mult: 2, desc: '2% on all other Costco and Costco.com purchases' },
      { cat: 'everything-else', mult: 1, desc: '1% on all other purchases' },
    ],
    note: 'No annual fee with a paid Costco membership.',
  },
  {
    slug: 'discover-it-miles',
    url: 'https://www.discover.com/credit-cards/travel/',
    feeDollars: 0,
    rates: [{ cat: 'everything-else', mult: 1.5, desc: 'Unlimited 1.5x miles on all purchases' }],
  },
  {
    slug: 'wells-fargo-active-cash',
    url: 'https://creditcards.wellsfargo.com/active-cash-credit-card/',
    feeDollars: 0,
    rates: [{ cat: 'everything-else', mult: 2, desc: 'Unlimited 2% cash rewards on purchases' }],
  },
  {
    slug: 'wells-fargo-autograph',
    url: 'https://creditcards.wellsfargo.com/autograph-visa-credit-card/',
    feeDollars: 0,
    rates: [
      { cat: 'dining', mult: 3, desc: '3x points at restaurants' },
      { cat: 'travel', mult: 3, desc: '3x points on travel (airlines, hotels, car rentals, cruises)' },
      { cat: 'gas', mult: 3, desc: '3x points on gas stations and EV charging' },
      { cat: 'transit', mult: 3, desc: '3x points on transit' },
      { cat: 'streaming', mult: 3, desc: '3x points on popular streaming services' },
      { cat: 'phone-internet', mult: 3, desc: '3x points on phone plans' },
      { cat: 'everything-else', mult: 1, desc: '1x point on other purchases' },
    ],
  },
  {
    slug: 'boa-customized-cash-rewards',
    url: `${BOA}/cash-back-credit-card/`,
    feeDollars: 0,
    rates: [
      ...['gas', 'online-shopping', 'dining', 'travel', 'drugstores', 'home-improvement'].map((cat) => ({ cat, mult: 3, desc: `3% in your chosen category (6% in the first year), first $2,500 a quarter combined with groceries and wholesale clubs`, cap: 2500, capPeriod: 'QUARTER' as const, rotating: true })),
      { cat: 'groceries', mult: 2, desc: '2% at grocery stores (first $2,500 a quarter combined)', cap: 2500, capPeriod: 'QUARTER' },
      { cat: 'wholesale-clubs', mult: 2, desc: '2% at wholesale clubs (first $2,500 a quarter combined)', cap: 2500, capPeriod: 'QUARTER' },
      { cat: 'everything-else', mult: 1, desc: '1% on all other purchases' },
    ],
    note: 'Choose the category on the wallet card; the 6% first-year rate is not stored.',
  },
  {
    slug: 'boa-unlimited-cash-rewards',
    url: `${BOA}/unlimited-cash-back-credit-card/`,
    feeDollars: 0,
    rates: [{ cat: 'everything-else', mult: 1.5, desc: 'Unlimited 1.5% cash back on all purchases' }],
  },
  {
    slug: 'boa-premium-rewards',
    url: `${BOA}/premium-rewards-credit-card/`,
    feeDollars: 95,
    rates: [
      { cat: 'travel', mult: 2, desc: '2 points per $1 on travel purchases' },
      { cat: 'dining', mult: 2, desc: '2 points per $1 on dining purchases' },
      { cat: 'everything-else', mult: 1.5, desc: '1.5 points per $1 on all other purchases' },
    ],
  },
  {
    slug: 'us-bank-altitude-go',
    url: `${USB}/altitude-go-visa-signature-credit-card.html`,
    feeDollars: 0,
    rates: [
      { cat: 'dining', mult: 4, desc: '4x points on dining, takeout and restaurant delivery (first $2,000 a quarter)', cap: 2000, capPeriod: 'QUARTER' },
      { cat: 'groceries', mult: 2, desc: '2x points at grocery stores (not discount stores, supercenters or wholesale clubs)' },
      { cat: 'gas', mult: 2, desc: '2x points at gas stations and EV charging' },
      { cat: 'streaming', mult: 2, desc: '2x points on streaming services' },
      { cat: 'everything-else', mult: 1, desc: '1x point on all other purchases' },
    ],
  },
  {
    slug: 'robinhood-gold-card',
    url: 'https://robinhood.com/creditcard/',
    rates: [{ cat: 'everything-else', mult: 3, desc: '3% cash back on all categories (requires a Robinhood Gold subscription)' }],
    note: 'No annual fee on the card, but an active Robinhood Gold subscription is required.',
  },
];

/**
 * Rates that look wrong and cannot be checked (the issuer page could not be read). They are kept on the card but marked
 * conditional, so they are shown and never used to rank until someone confirms them. Each entry says why.
 */
export interface RateCorrection {
  slug: string;
  cat: string;
  why: string;
}
export const RATE_CORRECTIONS: RateCorrection[] = [
  { slug: 'amex-hilton-business', cat: 'everything-else', why: 'A 5x rate on every purchase (3x after $100,000) looks like a category rate stored as the base; the American Express page could not be read to check it.' },
];
