import { conflictText, ReportAccount, reportRowFor } from '@/lib/credit-report';

const account: ReportAccount = {
  creditorName: 'JPMCB CARD',
  issuer: 'Chase',
  accountType: 'Credit card',
  openedOn: '2019-03-15',
  precision: 'DAY',
  status: 'OPEN',
  closedOn: null,
  lastDigits: '4321',
  creditLimitCents: 1200000,
  isAuthorizedUser: false,
  alreadyImported: false,
  match: { walletCardId: 'wc1', name: 'Sapphire', by: 'last digits', currentOpenDate: null, dateCheck: 'MISSING' },
  suggested: 'LINK',
  note: null,
};

describe('reportRowFor', () => {
  it('sends only accepted fields and the user choice', () => {
    expect(reportRowFor(account, { action: 'LINK', walletCardId: 'wc1', overwrite: true })).toEqual({
      creditorName: 'JPMCB CARD',
      issuer: 'Chase',
      accountType: 'Credit card',
      openedOn: '2019-03-15',
      precision: 'DAY',
      status: 'OPEN',
      closedOn: null,
      lastDigits: '4321',
      creditLimitCents: 1200000,
      isAuthorizedUser: false,
      action: 'LINK',
      walletCardId: 'wc1',
      overwrite: true,
    });
    const add = reportRowFor(account, { action: 'ADD', walletCardId: 'wc1', overwrite: true });
    expect(add).toMatchObject({ action: 'ADD' });
    expect(add).not.toHaveProperty('walletCardId');
    expect(add).not.toHaveProperty('overwrite');
    expect(reportRowFor(account, undefined).action).toBe('SKIP');
  });
});


describe('three bureaus', () => {
  it('passes the reporting bureaus through and describes date conflicts', () => {
    expect(reportRowFor({ ...account, bureaus: ['TRANSUNION', 'EXPERIAN'] }, { action: 'ADD' })).toMatchObject({ action: 'ADD', bureaus: ['TRANSUNION', 'EXPERIAN'] });
    expect(reportRowFor({ ...account, bureaus: [] }, { action: 'ADD' })).not.toHaveProperty('bureaus');
    expect(conflictText({ TRANSUNION: '2025-04-02', EXPERIAN: '2025-05-02' })).toBe('TransUnion 2025-04-02 · Experian 2025-05-02');
    expect(conflictText(null)).toBeNull();
  });
});
