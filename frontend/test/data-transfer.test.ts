import { describe, expect, it } from 'vitest';
import { checkTone, formatBytes, hasFailure, ImportReport, MIGRATION_STEPS, passphraseProblem, reportRows, reportSummary, sectionLabel } from '@/lib/data-transfer';

const report = (o: Partial<ImportReport> = {}): ImportReport => ({ mode: 'merge', dryRun: true, created: { WalletCard: 2, Transaction: 40, Profile: 1 }, updated: { NotificationPreference: 1 }, duplicates: { Profile: 1 }, unmapped: { UserOffer: 3 }, notRestored: [], warnings: [], totals: { created: 43, duplicates: 1, unmapped: 3 }, ...o });

describe('data transfer helpers', () => {
  it('gives parts of the data friendly names and falls back to readable ones', () => {
    expect(sectionLabel('WalletCard')).toBe('Cards');
    expect(sectionLabel('OfferSnapshotItem')).toBe('Discovered offers');
    expect(sectionLabel('SomethingNew')).toBe('Something New');
  });

  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.00 GB');
  });

  it('lists the preview rows, biggest first, leaving out empty ones', () => {
    const rows = reportRows(report());
    expect(rows.map((r) => r.model)).toEqual(['Transaction', 'WalletCard', 'Profile', 'NotificationPreference', 'UserOffer']);
    expect(rows[0]).toMatchObject({ label: 'Transactions', created: 40 });
    expect(reportRows(report({ created: {}, updated: {}, duplicates: {}, unmapped: {} }))).toEqual([]);
  });

  it('summarises a preview and a finished import in plain words', () => {
    expect(reportSummary(report())).toBe("Preview: would add 43 item(s), 1 already exist and would be skipped, 3 could not be matched to this server's catalog.");
    expect(reportSummary(report({ dryRun: false, totals: { created: 5, duplicates: 0, unmapped: 0 } }))).toBe('added 5 item(s).');
  });

  it('applies the same passphrase rules as the server', () => {
    expect(passphraseProblem('short')).toMatch(/12/);
    expect(passphraseProblem('aaaaaaaaaaaaaaaa')).toMatch(/repeated/);
    expect(passphraseProblem('a decent passphrase')).toBeNull();
  });

  it('colours checks and spots a failure', () => {
    expect([checkTone('ok'), checkTone('warn'), checkTone('fail')]).toEqual(['green', 'amber', 'red']);
    expect(hasFailure([{ id: 'a', label: 'a', status: 'ok', detail: '' }])).toBe(false);
    expect(hasFailure([{ id: 'a', label: 'a', status: 'fail', detail: '' }])).toBe(true);
  });

  it('describes the migration in an order that ends with a way back', () => {
    expect(MIGRATION_STEPS.map((s) => s.id)).toEqual(['prep', 'rehearse', 'freeze', 'bundle', 'restore', 'verify', 'switch', 'rollback']);
    expect(MIGRATION_STEPS.find((s) => s.id === 'freeze')!.where).toBe('old server');
  });
});
