import { INBOUND_STATUS_LABEL, VIA_LABEL, viaTone } from '@/lib/spend';
import { loadPlaid, openPlaidLink, PLAID_LINK_SRC } from '@/lib/plaid-link';
import { batchBySize, mergeBulk, KIND_LABEL, kindTone, parseList, txAmount, usageBadge } from '@/lib/spend';

describe('spend helpers', () => {
  it('amounts carry the direction of the transaction', () => {
    expect(txAmount('PURCHASE', 2345)).toBe('$23.45');
    expect(txAmount('FEE', 32500)).toBe('$325');
    expect(txAmount('CREDIT', 1000)).toBe('−$10');
    expect(txAmount('PAYMENT', 50000)).toBe('−$500');
    expect(KIND_LABEL.CREDIT).toBe('Statement credit');
    expect(kindTone('CREDIT')).toBe('green');
    expect(kindTone('FEE')).toBe('red');
    expect(kindTone('PAYMENT')).toBe('slate');
  });
  it('usage badges: manual none, expected amber, posted green', () => {
    expect(usageBadge({ source: 'MANUAL', status: 'CONFIRMED' })).toBeNull();
    expect(usageBadge({})).toBeNull();
    expect(usageBadge({ source: 'AUTO_PURCHASE', status: 'EXPECTED' })).toEqual({ label: 'auto · credit expected', tone: 'amber' });
    expect(usageBadge({ source: 'AUTO_CREDIT', status: 'CONFIRMED' })?.tone).toBe('green');
  });
  it('comma lists', () => {
    expect(parseList(' uber, Lyft ,, uber ')).toEqual(['uber', 'lyft']);
    expect(parseList('')).toEqual([]);
  });
});

describe('automatic import helpers', () => {
  it('labels and tones', () => {
    expect(VIA_LABEL.EMAIL).toBe('Alert emails');
    expect(viaTone('BANK')).toBe('green');
    expect(viaTone('MANUAL')).toBe('amber');
    expect(viaTone('BANK', true)).toBe('red');
    expect(INBOUND_STATUS_LABEL.NEEDS_CARD).toBe('which card?');
  });
  it('Plaid Link is loaded on demand from the official script and resolves with the public token', async () => {
    const p = loadPlaid();
    const script = document.head.querySelector(`script[src="${PLAID_LINK_SRC}"]`) as HTMLScriptElement;
    expect(script).not.toBeNull();
    let cfg: { onSuccess: (t: string) => void; onExit: (e: unknown) => void } | null = null;
    const handler = { open: vi.fn(() => cfg!.onSuccess('public-sandbox-1')), exit: vi.fn(), destroy: vi.fn() };
    window.Plaid = { create: (c) => ((cfg = c), handler) };
    script.onload?.(new Event('load'));
    await p;
    await expect(openPlaidLink('link-1')).resolves.toBe('public-sandbox-1');
    handler.open.mockImplementation(() => cfg!.onExit(null));
    await expect(openPlaidLink('link-2')).resolves.toBeNull();
    expect(handler.destroy).toHaveBeenCalledTimes(2);
  });
});

describe('pickStatementFiles', () => {
  it('keeps PDF / CSV files, drops other types and repeated names, and caps the batch', async () => {
    const { pickStatementFiles } = await import('@/lib/spend');
    const r = pickStatementFiles([{ name: 'a.pdf' }, { name: 'b.CSV' }, { name: 'c.png' }, { name: 'a.pdf' }]);
    expect(r.files.map((f) => f.name)).toEqual(['a.pdf', 'b.CSV']);
    expect(r.skipped).toEqual(['c.png', 'a.pdf']);
    const many = pickStatementFiles(Array.from({ length: 30 }, (_, i) => ({ name: `s${i}.pdf` })));
    expect(many.files).toHaveLength(24);
    expect(many.skipped).toHaveLength(6);
  });
});

describe('bulk upload batching', () => {
  const f = (n: number, size: number) => ({ name: `f${n}`, size });
  it('keeps every batch under the byte limit and preserves order', () => {
    const files = [1, 2, 3, 4, 5, 6, 7].map((n) => f(n, 1.3 * 1024 * 1024));
    const b = batchBySize(files, 6 * 1024 * 1024);
    expect(b.map((g) => g.length)).toEqual([4, 3]);
    expect(b.flat().map((x) => x.name)).toEqual(files.map((x) => x.name));
    expect(b.every((g) => g.reduce((a, x) => a + x.size, 0) <= 6 * 1024 * 1024)).toBe(true);
  });
  it('an oversized file goes alone; nothing yields no batches; count is capped', () => {
    expect(batchBySize([f(1, 100), f(2, 9e6), f(3, 100)], 6e6).map((g) => g.length)).toEqual([1, 1, 1]);
    expect(batchBySize([])).toEqual([]);
    expect(batchBySize([f(1, 1), f(2, 1), f(3, 1)], 1e9, 2).map((g) => g.length)).toEqual([2, 1]);
  });
  it('merges batch results with recounted totals', () => {
    const r = mergeBulk([
      { files: [{ file: 'a', status: 'IMPORTED', imported: 3 }], totals: { imported: 1, alreadyImported: 0, needsCard: 0, errors: 0, transactions: 3 } },
      { files: [{ file: 'b', status: 'NEEDS_CARD' }, { file: 'c', status: 'ALREADY_IMPORTED' }], totals: { imported: 0, alreadyImported: 1, needsCard: 1, errors: 0, transactions: 0 } },
    ]);
    expect(r.files.map((x) => x.file)).toEqual(['a', 'b', 'c']);
    expect(r.totals).toEqual({ imported: 1, alreadyImported: 1, needsCard: 1, errors: 0, transactions: 3 });
  });
});
