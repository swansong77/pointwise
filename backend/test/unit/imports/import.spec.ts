import { relationshipFor } from '../../../src/portfolio/imports';
import {
  canonicalIssuer,
  cardsForBenefit,
  categorizeBenefit,
  findHeader,
  FullCardNumberError,
  matchCatalog,
  matchExisting,
  parseBenefitsSheet,
  parseCardsSheet,
  SUMMARY_CARD_RE,
  parseLastDigits,
  parseMoney,
  parseOpenDate,
  parseOwnerSplit,
  parseWorkbook,
  parseCsv,
  CSV_TEMPLATE,
  tokenSimilarity,
} from '../../../src/domain/import';
import { trackerSheets } from '../../fixtures/tracker';

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('cell parsers', () => {
  it('parseMoney', () => {
    expect(parseMoney(695)).toBe(69500);
    expect(parseMoney('$1,234.50')).toBe(123450);
    expect(parseMoney('(65)')).toBe(-6500);
    expect(parseMoney('-65')).toBe(-6500);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(true)).toBeNull();
  });

  it('parseLastDigits keeps 4–5 digits and refuses full card numbers', () => {
    expect(parseLastDigits(41007)).toBe('41007');
    expect(parseLastDigits('x1234')).toBe('1234');
    expect(parseLastDigits(123)).toBe('0123');
    expect(parseLastDigits('')).toBeNull();
    expect(parseLastDigits('n/a')).toBeNull();
    expect(() => parseLastDigits('4111 1111 1111 1111')).toThrow(FullCardNumberError);
  });

  it.each([
    ['2025-03-14', '2025-03-14', 'DAY'],
    ['3/14/2025', '2025-03-14', 'DAY'],
    ['3/14/25', '2025-03-14', 'DAY'],
    ['2024-07', '2024-07-01', 'MONTH'],
    ['07/2024', '2024-07-01', 'MONTH'],
    ['Jul 2024', '2024-07-01', 'MONTH'],
    ['September 2024', '2024-09-01', 'MONTH'],
  ])('parseOpenDate(%s)', (input, out, precision) => {
    expect(parseOpenDate(input)).toEqual({ date: new Date(`${out}T00:00:00Z`), precision });
  });

  it('parseOpenDate handles Date objects, Excel serials and garbage', () => {
    expect(parseOpenDate(new Date('2023-01-05T15:00:00Z'))).toEqual({ date: new Date('2023-01-05T00:00:00Z'), precision: 'DAY' });
    expect(iso(parseOpenDate(45366)?.date ?? null)).toBe('2024-03-15');
    expect(parseOpenDate(12)).toBeNull();
    expect(parseOpenDate(new Date('x'))).toBeNull();
    expect(parseOpenDate('2025-02-30')).toBeNull();
    expect(parseOpenDate('Foo 2024')).toBeNull();
    expect(parseOpenDate('sometime')).toBeNull();
    expect(parseOpenDate(null)).toBeNull();
  });

  it('parseOwnerSplit', () => {
    expect(parseOwnerSplit('1 / 0', ['Me', 'Spouse'])).toEqual({ Me: 1, Spouse: 0 });
    expect(parseOwnerSplit('2', ['Me', 'Spouse'])).toEqual({ Me: 2 });
    expect(parseOwnerSplit('a / b', ['Me'])).toBeNull();
    expect(parseOwnerSplit('1 / 0', [])).toBeNull();
    expect(parseOwnerSplit(null, ['Me'])).toBeNull();
  });

  it('categorizeBenefit', () => {
    expect(categorizeBenefit('Free night certificate')).toEqual({ categorySlug: 'free-night', kind: 'CERTIFICATE' });
    expect(categorizeBenefit('Global Entry / TSA PreCheck').categorySlug).toBe('trusted-traveler');
    expect(categorizeBenefit('CLEAR Plus credit').categorySlug).toBe('clear');
    expect(categorizeBenefit('Priority Pass lounge access').kind).toBe('ACCESS');
    expect(categorizeBenefit('Uber Cash').categorySlug).toBe('rideshare');
    expect(categorizeBenefit('Airline incidental fee credit').categorySlug).toBe('airline');
    expect(categorizeBenefit('Hotel credit').categorySlug).toBe('hotel');
    expect(categorizeBenefit('Resy credit').categorySlug).toBe('dining');
    expect(categorizeBenefit('Digital entertainment credit').categorySlug).toBe('entertainment');
    expect(categorizeBenefit('Walmart+ membership').kind).toBe('MEMBERSHIP');
    expect(categorizeBenefit('Saks credit').categorySlug).toBe('shopping');
    expect(categorizeBenefit('Something else')).toEqual({ categorySlug: 'other', kind: 'CREDIT' });
  });
});

describe('header detection', () => {
  it('finds headers below a summary block, by name not position', () => {
    const rows = [['Total', 5], [], ['Notes', 'Card', 'Last 4']];
    expect(findHeader(rows, ['card'], ['lastDigits', 'notes'])).toEqual({ row: 2, cols: { card: 1, lastDigits: 2, notes: 0 } });
  });
  it('returns null when required columns are missing', () => {
    expect(findHeader([['a', 'b']], ['card'], [])).toBeNull();
  });
});

describe('parseWorkbook on the synthetic tracker', () => {
  const wb = parseWorkbook(trackerSheets());

  it('reads every sheet and the owner list', () => {
    expect(wb.sheetsRead.sort()).toEqual(['Benefits', 'Cards']);
    expect(wb.owners).toEqual(['Me', 'Spouse']);
  });

  it('maps card rows', () => {
    const plat = wb.cards[0];
    expect(plat).toMatchObject({ owner: 'Me', cardName: 'Metro Platinum', lastDigits: '41007', issuer: 'Amex', annualFeeCents: 69500, closed: false, isAuthorizedUser: false });
    expect(iso(plat.openedAt)).toBe('2025-03-14');
    const reserve = wb.cards[1];
    expect(reserve.openDatePrecision).toBe('MONTH');
  });

  it('detects authorized-user, closed and duplicate cards', () => {
    expect(wb.cards.find((c) => c.lastDigits === '5678')?.isAuthorizedUser).toBe(true);
    expect(wb.cards.find((c) => c.cardName === 'Old Cash Card')?.closed).toBe(true);
    const dup = wb.cards.filter((c) => c.lastDigits === '41007');
    expect(dup.map((d) => d.duplicateOfRow)).toEqual([null, 2]);
  });

  it('reports full card numbers and bad dates without storing them', () => {
    const bad = wb.cards.find((c) => c.cardName === 'Bad Row Card');
    expect(bad?.lastDigits).toBeNull();
    expect(wb.issues.some((i) => i.severity === 'ERROR' && /full card number/.test(i.message))).toBe(true);
    expect(wb.issues.some((i) => /unrecognised open date/.test(i.message))).toBe(true);
  });

  it('maps benefits with periods, per-period amounts and owner split', () => {
    const hotel = wb.benefits.find((b) => b.name === 'Hotel credit');
    expect(hotel).toMatchObject({ period: 'SEMIANNUAL', amountPerPeriodCents: 30000, annualValueCents: 60000, usedCents: 30000, owners: { Me: 1, Spouse: 0 }, categorySlug: 'hotel' });
    expect(wb.benefits.find((b) => b.name === 'Streaming credit')).toMatchObject({ period: 'MONTHLY', amountPerPeriodCents: 2000 });
    expect(wb.benefits.find((b) => b.name === 'Travel credit')).toMatchObject({ period: 'ANNUAL', basis: 'CARDMEMBER_YEAR' });
    expect(wb.benefits.find((b) => /Global Entry/.test(b.name))).toMatchObject({ period: 'MULTI_YEAR', periodMonths: 48, amountPerPeriodCents: 12000 });
  });

  it('skips benefits without a value and adds missing cards with a warning', () => {
    expect(wb.benefits.find((b) => b.name === 'Mystery credit')).toBeUndefined();
    expect(wb.issues.some((i) => /no annual value/.test(i.message))).toBe(true);
  });

  it('attaches benefits to the right owners', () => {
    const travel = wb.benefits.find((b) => b.name === 'Travel credit')!;
    expect(cardsForBenefit(travel, wb.cards).map((c) => c.owner)).toEqual(['Me', 'Spouse']);
    const fnc = wb.benefits.find((b) => b.name === 'Free night certificate')!;
    expect(cardsForBenefit(fnc, wb.cards).map((c) => c.owner)).toEqual(['Spouse']);
    const hotel = wb.benefits.find((b) => b.name === 'Hotel credit')!;
    expect(cardsForBenefit(hotel, wb.cards)).toHaveLength(1); // duplicate row ignored
    expect(cardsForBenefit({ ...hotel, owners: null }, wb.cards)).toHaveLength(1);
  });

  it('creates a card row for benefits whose card is not on the card list', () => {
    const sheets = trackerSheets();
    sheets[0].rows.push(['Ghost Card', 'Ghost credit', 1, 50, 50, 0, 50, '', 'Annual', '', '', 'Citi', '0 / 1']);
    const parsed = parseWorkbook(sheets);
    expect(parsed.cards.find((c) => c.cardName === 'Ghost Card')).toMatchObject({ owner: 'Spouse', issuer: 'Citi' });
    const noSplit = trackerSheets();
    noSplit[0].rows.push(['Ghost Card', 'Ghost credit', 1, 50, 50, 0, 50, '', 'Annual', '', '', '', '']);
    expect(parseWorkbook(noSplit).cards.find((c) => c.cardName === 'Ghost Card')?.owner).toBe('Me');
  });

  it('errors when no sheet has a Card column', () => {
    const r = parseWorkbook([{ name: 'Junk', rows: [['hello']] }]);
    expect(r.issues).toEqual([{ sheet: '*', row: 0, message: 'no sheet with a "Card" column was found', severity: 'ERROR' }]);
  });
});

describe('generic CSV-like card lists', () => {
  it('accepts alternative headers, AU markers, business types, limits and skips totals', () => {
    const r = parseCardsSheet({
      name: 'csv',
      rows: [
        ['Cardholder', 'Card Name', 'Last 4', 'Bank', 'AF', 'Opened', 'Type', 'Credit Limit', 'Authorized User'],
        ['Alex (AU)', 'Everyday Cash', '1111', 'Citibank', '$0', '1/2/2026', 'Personal', '$5,000', ''],
        ['Sam', 'Biz Card', '2222', 'Capital One', 0, '2026-01-01', 'Business', '', 'no'],
        ['Kid', 'Teen Card', '3333', 'Chase', 0, '', '', '', 'yes'],
        ['', 'Business Rewards', '', '', '', '', '', '', ''],
        ['Total', '', '', '', '', '', '', '', ''],
        ['', '', '', '', '', '', '', '', ''],
      ],
    })!;
    expect(r.cards).toHaveLength(4);
    expect(r.cards[0]).toMatchObject({ owner: 'Alex', isAuthorizedUser: true, creditLimitCents: 500000, isBusiness: false, annualFeeCents: 0 });
    expect(r.cards[1]).toMatchObject({ isBusiness: true, isAuthorizedUser: false });
    expect(r.cards[2]).toMatchObject({ isAuthorizedUser: true, openedAt: null });
    expect(r.cards[3]).toMatchObject({ owner: 'Me', isBusiness: true });
  });
  it('rejects sheets that only have a Card column', () => {
    expect(parseCardsSheet({ name: 'x', rows: [['Card'], ['A']] })).toBeNull();
  });
  it('benefit sheet without a header returns null', () => {
    expect(parseBenefitsSheet({ name: 'x', rows: [['nope']] }, [])).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF, BOM and a trailing line without newline', () => {
    expect(parseCsv('﻿a,"b,c","say ""hi"""\r\n1,2,3\n4,,"x\ny"')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
      ['4', '', 'x\ny'],
    ]);
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });
  it('enforces the row cap', () => {
    expect(() => parseCsv('a\nb\nc\n', 2)).toThrow(/more than 2 rows/);
  });
  it('the downloadable template parses into cards', () => {
    const r = parseCardsSheet({ name: 'csv', rows: parseCsv(CSV_TEMPLATE) })!;
    expect(r.cards).toHaveLength(2);
    expect(r.cards[1]).toMatchObject({ isAuthorizedUser: true, openDatePrecision: 'MONTH' });
  });
});

describe('matching', () => {
  it('canonical issuer names', () => {
    expect(canonicalIssuer('AMEX')).toBe('american express');
    expect(canonicalIssuer('JPMorgan Chase')).toBe('chase');
    expect(canonicalIssuer('Some Bank')).toBe('some bank');
  });
  it('token similarity', () => {
    expect(tokenSimilarity('Metro Platinum', 'metro platinum card')).toBeCloseTo(0.667, 2);
    expect(tokenSimilarity('', 'x')).toBe(0);
  });
  it('matchCatalog prefers same-issuer products above the threshold', () => {
    const catalog = [
      { id: 'a', name: 'Metro Platinum Card', issuerName: 'American Express' },
      { id: 'b', name: 'Metro Gold Card', issuerName: 'American Express' },
    ];
    expect(matchCatalog('Metro Platinum', 'Amex', catalog)).toEqual({ id: 'a', score: 1.2 });
    expect(matchCatalog('Completely Different', null, catalog)).toBeNull();
    expect(matchCatalog('x', null, [])).toBeNull();
  });
  it('matchCatalog reads Amex as American Express, ignores filler words, and does not take a different product with a shared word', () => {
    const catalog = [
      { id: 'gold', name: 'American Express Gold Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'bgold', name: 'American Express Business Gold Card', issuerName: 'American Express', type: 'BUSINESS' },
      { id: 'dgold', name: 'Delta SkyMiles Gold American Express Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'plat', name: 'American Express Platinum Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'green', name: 'American Express Green Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'hh', name: 'Hilton Honors American Express Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'hhs', name: 'Hilton Honors American Express Surpass Card', issuerName: 'American Express', type: 'PERSONAL' },
      { id: 'bce', name: 'Blue Cash Everyday Card from American Express', issuerName: 'American Express', type: 'PERSONAL' },
    ];
    const id = (n: string, biz: boolean | null = null) => matchCatalog(n, 'American Express', catalog, 0.5, biz)?.id ?? null;
    expect(id('Amex Gold')).toBe('gold');
    expect(id('Amex Platinum')).toBe('plat');
    expect(id('Amex Classic Green')).toBe('green');
    expect(id('Hilton Honors (no fee)')).toBe('hh');
    expect(id('Hilton Honors Surpass')).toBe('hhs');
    expect(id('Amex EveryDay')).toBeNull(); // a different product from Blue Cash Everyday
    expect(id('Amex Gold', true)).toBe('bgold');
    expect(id('Amex card ...11003 (type unknown)')).toBeNull();
  });
  it('matchExisting by last digits + issuer, by digits + name, or by owner + name', () => {
    const existing = [
      { id: 'w1', cardName: 'Metro Platinum', issuer: 'American Express', lastDigits: '41007', owner: 'Me' },
      { id: 'w2', cardName: 'Harbor Reserve', issuer: 'Chase', lastDigits: null, owner: 'Spouse' },
    ];
    expect(matchExisting({ cardName: 'Platinum', issuer: 'Amex', lastDigits: '41007', owner: 'Me' }, existing)?.id).toBe('w1');
    expect(matchExisting({ cardName: 'Metro Platinum', issuer: null, lastDigits: '41007', owner: 'Me' }, existing)?.id).toBe('w1');
    expect(matchExisting({ cardName: 'Harbor Reserve', issuer: 'Chase', lastDigits: '5678', owner: 'Spouse' }, existing)?.id).toBe('w2');
    expect(matchExisting({ cardName: 'Harbor Reserve', issuer: 'Chase', lastDigits: null, owner: 'Me' }, existing)).toBeNull();
    expect(matchExisting({ cardName: 'Other', issuer: 'Citi', lastDigits: '41007', owner: 'Me' }, existing)).toBeNull();
  });
});

describe('totals block under the card list (v5 layout)', () => {
  const HEADER = ['Owner', 'Card', 'Last digits', 'Issuer', 'Annual fee', 'Credit value', 'Credits minus fee', 'Notes', 'Active Status', 'Type', 'Opened', 'Report match'];
  const sheet = {
    name: 'Cards',
    rows: [
      HEADER,
      ['Me', 'Example Gold', '1001', 'Example Bank', 250, 400, 150, '', 'Active', 'Personal', '2024-03-01', 'Confirmed'],
      ['Spouse', 'Example Biz', '2002', 'Example Bank', 95, 0, -95, '', 'Active', 'Business', '2025-01-15', 'Confirmed'],
      ['Total', '2 active cards', null, null, 345, 400, 55, 'Totals count Active cards'],
      ['Me', '1 active cards', null, null, 250, 400, 150],
      ['Spouse', '1 active cards', null, null, 95, 0, -95],
      ['Personal', '1 active cards', null, null, 250, 400, 150],
      ['Business', '1 active cards', null, null, 95, 0, -95],
    ],
  };
  it('reads the real cards and ignores every totals row, so no Total / Personal / Business cardholder or card appears', () => {
    const r = parseCardsSheet(sheet)!;
    expect(r.cards.map((c) => [c.owner, c.cardName])).toEqual([
      ['Me', 'Example Gold'],
      ['Spouse', 'Example Biz'],
    ]);
    expect(r.cards.map((c) => c.isBusiness)).toEqual([false, true]);
    expect(new Set(r.cards.map((c) => c.owner))).toEqual(new Set(['Me', 'Spouse']));
  });
  it('a card whose name merely contains "cards" is kept', () => {
    const r = parseCardsSheet({ name: 'Cards', rows: [HEADER, ['Me', '5 Cards Rewards Visa', '1234', 'X', 0, 0, 0, '', 'Active', 'Personal', '2024-01-01', '']] })!;
    expect(r.cards).toHaveLength(1);
    expect(SUMMARY_CARD_RE.test('52 active cards')).toBe(true);
    expect(SUMMARY_CARD_RE.test('7 cards')).toBe(true);
  });
  it('relationship comes from whole words ("Personal" is not a child)', () => {
    expect(relationshipFor('Personal')).toBe('OTHER');
    expect(relationshipFor('Business')).toBe('OTHER');
    expect(relationshipFor('Total')).toBe('OTHER');
    expect(relationshipFor('Spouse')).toBe('SPOUSE');
    expect(relationshipFor('My wife')).toBe('SPOUSE');
    expect(relationshipFor('Partner')).toBe('PARTNER');
    expect(relationshipFor('Son')).toBe('CHILD');
    expect(relationshipFor('Kids')).toBe('CHILD');
    expect(relationshipFor('Jason')).toBe('OTHER');
  });

  it('status decides closed: Deleted is closed; "Closed to new applicants" in notes is not', () => {
    const rows = [
      HEADER,
      ['Me', 'Card A', '1111', 'X', 150, 0, 0, 'Closed to new applicants July 2026', 'Active', 'Personal', '2024-01-01', ''],
      ['Me', 'Card B', '2222', 'X', 95, 0, 0, '', 'Deleted', 'Personal', '2024-01-01', ''],
      ['Me', 'Card C', '3333', 'X', 95, 0, 0, 'Product changed to Card D', 'Active', 'Personal', '2024-01-01', ''],
      ['Me', 'Card E', '4444', 'X', 95, 0, 0, 'Account closed in 2025', 'Active', 'Personal', '2024-01-01', ''],
    ];
    const r = parseCardsSheet({ name: 'Cards', rows })!;
    expect(r.cards.map((c) => [c.cardName, c.closed])).toEqual([['Card A', false], ['Card B', true], ['Card C', true], ['Card E', true]]);
  });
});

describe('catalog matching respects personal vs business', () => {
  const catalog = [
    { id: 'p', name: 'Capital One Venture X Rewards Credit Card', issuerName: 'Capital One', type: 'PERSONAL' },
    { id: 'b', name: 'Capital One Venture X Business', issuerName: 'Capital One', type: 'BUSINESS' },
    { id: 'bc', name: 'Blue Cash Everyday Card from American Express', issuerName: 'American Express', type: 'PERSONAL' },
    { id: 'bb', name: 'The American Express Blue Business Cash Card', issuerName: 'American Express', type: 'BUSINESS' },
  ];
  it('a personal row never matches the business card, and a business row never matches the personal one', () => {
    expect(matchCatalog('Capital One Venture X', 'Capital One', catalog, 0.5, false)?.id).toBe('p');
    expect(matchCatalog('Capital One Venture X', 'Capital One', catalog, 0.5, true)?.id).toBe('b');
    expect(matchCatalog('Amex Blue Cash (additional card)', 'Amex', catalog, 0.5, false)?.id).toBe('bc');
    expect(matchCatalog('Amex Blue Business Cash', 'Amex', catalog, 0.5, true)?.id).toBe('bb');
  });
  it('without a type the old name-and-issuer behaviour is unchanged', () => {
    expect(matchCatalog('Capital One Venture X Business', 'Capital One', catalog)?.id).toBe('b');
  });
  it('a type mismatch alone does not create a match below the threshold', () => {
    expect(matchCatalog('Unrelated Card', 'Capital One', catalog, 0.5, false)).toBeNull();
  });
  it('"Chase Freedom" lands on the original Freedom, not Unlimited, Flex or Rise', () => {
    const freedom = [
      { id: 'unl', name: 'Chase Freedom Unlimited', issuerName: 'Chase', type: 'PERSONAL' },
      { id: 'flex', name: 'Chase Freedom Flex', issuerName: 'Chase', type: 'PERSONAL' },
      { id: 'rise', name: 'Chase Freedom Rise', issuerName: 'Chase', type: 'PERSONAL' },
      { id: 'orig', name: 'Chase Freedom', issuerName: 'Chase', type: 'PERSONAL' },
    ];
    expect(matchCatalog('Chase Freedom', 'Chase', freedom, 0.5, false)?.id).toBe('orig');
    expect(matchCatalog('Chase Freedom Flex', 'Chase', freedom, 0.5, false)?.id).toBe('flex');
    // without the original in the catalog, a bare "Freedom" is ambiguous and must not silently become Unlimited
    expect(matchCatalog('Chase Freedom', 'Chase', freedom.slice(0, 3), 0.5, false)?.id).not.toBe('unl');
  });
});
