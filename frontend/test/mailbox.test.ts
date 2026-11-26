import { describe, expect, it } from 'vitest';
import { KIND_LABEL, MAILBOX_PRESETS, oauthBanner, syncLabel } from '../src/lib/mailbox';

describe('mailbox helpers', () => {
  it('describes the sync state', () => {
    expect(syncLabel({ lastStatus: null, lastSyncAt: null, lastError: null })).toBe('Not synced yet');
    expect(syncLabel({ lastStatus: 'OK', lastSyncAt: '2026-11-25T00:00:00Z', lastError: null })).toBe('Synced');
    expect(syncLabel({ lastStatus: 'ERROR', lastSyncAt: '2026-11-25T00:00:00Z', lastError: 'bad login' })).toBe('Last sync failed: bad login');
  });
  it('offers common providers with an app-password hint, ending with a generic IMAP entry', () => {
    expect(MAILBOX_PRESETS.map((p) => p.id)).toEqual(['gmail', 'outlook', 'yahoo', 'icloud', 'other']);
    expect(MAILBOX_PRESETS.every((p) => p.hint.length > 10)).toBe(true);
    expect(MAILBOX_PRESETS[0].host).toBe('imap.gmail.com');
  });
  it('explains a revoked grant and labels the kinds', () => {
    expect(syncLabel({ lastStatus: 'RECONNECT', lastSyncAt: '2026-11-25T00:00:00Z', lastError: 'x' })).toMatch(/Reconnect needed/);
    expect(KIND_LABEL).toEqual({ IMAP: 'IMAP', GMAIL: 'Gmail', GRAPH: 'Outlook' });
  });
  it('reads the result of the provider sign-in from the URL', () => {
    expect(oauthBanner('?mailbox=connected')?.tone).toBe('ok');
    expect(oauthBanner('?mailbox=error&reason=You%20declined%20access.')).toEqual({ tone: 'error', text: 'You declined access.' });
    expect(oauthBanner('?mailbox=error')?.text).toMatch(/could not be connected/);
    expect(oauthBanner('')).toBeNull();
  });
});
