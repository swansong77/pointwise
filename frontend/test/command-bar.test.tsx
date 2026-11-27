import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/components/command-bar';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const SUGGEST = {
  q: 'hilton',
  understood: { intent: 'OFFER_SEARCH', confidence: 0.9, title: 'Hilton offers' },
  tookMs: 3,
  suggestions: [
    { type: 'QUERY', id: 'ask', label: 'hilton', sublabel: 'Hilton offers — press Enter', kind: 'Ask', query: 'hilton' },
    { type: 'ENTITY', id: 'MERCHANT:1', label: 'Hilton', kind: 'Merchant', href: '/merchants/hilton' },
  ],
};
const EXAMPLES = { q: '', understood: null, tookMs: 1, suggestions: [{ type: 'EXAMPLE', id: 'e1', label: "What's expiring?", query: "What's expiring?" }] };
const ANSWER = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  answer: {
    intent: 'EXPIRATION_REVIEW',
    kind: 'QUESTION',
    title: 'What is expiring',
    summary: '2 items expire this month, $150 at stake.',
    sections: [{ heading: null, lines: ['2 items expire this month, $150 at stake.', '• Hilton offer — Alex, ends 2026-11-29, $100: Use it'] }],
    reasoning: ['The Hilton offer ends first.'],
    evidence: ['Offers: from your expiring offers data'],
    warnings: [],
    confidence: 82,
    actions: [{ type: 'OPEN', label: 'Open expirations', href: '/offers/expirations' }],
    related: [{ type: 'OFFER', id: 'o1', title: 'Hilton: $100 back', subtitle: 'Alex · Amex', href: '/wallet/w1' }],
    followUps: ['Show all Hilton offers'],
    understood: [{ type: 'when', label: 'this month' }],
    unanswered: false,
  },
  slots: { intent: 'EXPIRATION_REVIEW' },
  usedFollowUp: false,
  cached: false,
  tookMs: 12,
};

let calls: Array<{ url: string; body?: string; method?: string }> = [];
let saved = false;
beforeEach(() => {
  push.mockReset();
  calls = [];
  saved = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined, method: init?.method });
      const u = String(url);
      if (u.includes('/search/saved/check'))
        return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify({ saved: saved ? { id: 'e1' } : null }) } as Response;
      if (u.includes('/search/saved') && init?.method === 'POST') {
        saved = true;
        return { ok: true, status: 201, statusText: 'Created', text: async () => JSON.stringify({ id: 'e1', kind: 'SAVED' }) } as Response;
      }
      if (u.includes('/search/entries/') && init?.method === 'DELETE') {
        saved = false;
        return { ok: true, status: 204, statusText: 'No Content', text: async () => '' } as Response;
      }
      const data = u.includes('/search/ask') ? ANSWER : u.includes('q=hilton') ? SUGGEST : EXAMPLES;
      return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = (props: Partial<{ open: boolean; onClose: () => void }> = {}) => {
  const onClose = props.onClose ?? vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <CommandBar open={props.open ?? true} onClose={onClose} isAdmin={false} />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
};

describe('CommandBar', () => {
  it('renders nothing while closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is an accessible modal dialog with a labelled combobox, focused on open', async () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Search and ask PointWise' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const input = screen.getByRole('combobox', { name: 'Search or ask a question' });
    expect(input).toHaveAttribute('aria-controls', 'command-list');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await waitFor(() => expect(input).toHaveFocus());
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('shows example questions first, and asks one when it is clicked', async () => {
    setup();
    const opt = await screen.findByRole('option', { name: /What’s expiring\?|What's expiring\?/ });
    fireEvent.click(opt);
    expect(await screen.findByTestId('search-answer')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/search/ask') && JSON.parse(c.body!).q === "What's expiring?")).toBe(true);
  });

  it('suggests as you type, moves with the arrow keys and opens a result with Enter', async () => {
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hilton' } });
    await screen.findByRole('option', { name: /Merchant/ });
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=hilton'))).toBe(true));
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // the question
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // the merchant
    expect(input.getAttribute('aria-activedescendant')).toBe('command-opt-1');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/merchants/hilton');
  });

  it('Enter with nothing highlighted asks the question and shows summary, why, related, actions and follow-ups', async () => {
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'what offers expire this month' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const summary = await screen.findByTestId('search-summary');
    expect(summary).toHaveTextContent('2 items expire this month, $150 at stake.');
    expect(screen.getByText(/Confidence High \(82%\)/)).toBeInTheDocument();
    expect(screen.getByTestId('search-reasoning')).toHaveTextContent('The Hilton offer ends first.');
    expect(screen.getByTestId('search-related')).toHaveTextContent('Hilton: $100 back');
    expect(screen.getByRole('link', { name: 'Open expirations' })).toHaveAttribute('href', '/offers/expirations');
    expect(screen.getByTestId('search-evidence')).toBeInTheDocument();
    // a follow-up is asked with what the conversation remembers
    fireEvent.click(screen.getByRole('button', { name: 'Show all Hilton offers' }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes('/search/ask'))).toHaveLength(2));
    const second = calls.filter((c) => c.url.includes('/search/ask'))[1];
    // the server remembers the conversation, so the browser sends its id rather than the details
    expect(JSON.parse(second.body!)).toEqual({ q: 'Show all Hilton offers', sessionId: '11111111-1111-4111-8111-111111111111' });
  });

  it('saves and un-saves an answer with the star', async () => {
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'what offers expire this month' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const star = await screen.findByTestId('search-save');
    await waitFor(() => expect(star).not.toBeDisabled());
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/search/saved') && c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.includes('/search/saved') && c.method === 'POST')!.body!)).toEqual({ query: 'what offers expire this month' });
    await waitFor(() => expect(screen.getByTestId('search-save')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByTestId('search-save'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/search/entries/e1') && c.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('search-save')).toHaveAttribute('aria-pressed', 'false'));
  });

  it('asks a question handed in from elsewhere as soon as it opens', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CommandBar open onClose={vi.fn()} isAdmin={false} seed={{ q: 'Show all Hilton offers', nonce: 1 }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('search-answer')).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.url.includes('/search/ask'))!.body!)).toEqual({ q: 'Show all Hilton offers' });
  });

  it('links to the search history', () => {
    setup();
    expect(screen.getByRole('link', { name: 'Search history' })).toHaveAttribute('href', '/search');
  });

  it('Escape clears first and closes second; the Esc button closes', async () => {
    const { onClose } = setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hilton' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Escape works even when focus has fallen to the page', () => {
    const { onClose } = setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'hilton' } });
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the dialog', async () => {
    setup();
    const input = screen.getByRole('combobox');
    const last = screen.getByRole('link', { name: 'Search history' }); // the last control in the dialog
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' }); // the last focusable control wraps to the first
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  describe('actions offered with an answer', () => {
    const REMINDER = {
      type: 'CALL',
      id: 'r1',
      kind: 'REMINDER',
      label: 'Remind me on 2026-11-26: Hilton offer',
      method: 'POST',
      path: '/reminders',
      body: { title: 'Hilton offer ends 2026-11-29', dueAt: '2026-11-27T14:00:00.000Z', link: '/offers/expirations' },
      confirm: null,
      success: 'Reminder set.',
    };
    const ACTIVATE = {
      type: 'CALL',
      id: 'a1',
      kind: 'ACTIVATE',
      label: 'Mark Hilton offer activated',
      method: 'POST',
      path: '/offers/intel/activation/22222222-2222-4222-8222-222222222222',
      body: { status: 'ACTIVATED' },
      confirm: 'Only do this after you have activated it on the issuer’s website.',
      success: 'Marked as activated.',
    };
    const withCalls = (calls_: unknown[]) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          calls.push({ url: String(url), body: init?.body as string | undefined, method: init?.method });
          const body = String(url).includes('/search/ask')
            ? { ...ANSWER, answer: { ...ANSWER.answer, calls: calls_ } }
            : String(url).includes('/search/saved/check')
              ? { saved: null }
              : EXAMPLES;
          return {
            ok: true,
            status: init?.method === 'POST' && !String(url).includes('/search/') ? 201 : 200,
            statusText: 'OK',
            text: async () => JSON.stringify(body),
          } as Response;
        }),
      );
    };
    const askIt = async () => {
      setup();
      const input = screen.getByRole('combobox');
      fireEvent.change(input, { target: { value: 'whats expiring' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await screen.findByTestId('search-calls');
    };

    it('a one-click action runs at once and reports the result', async () => {
      withCalls([REMINDER]);
      await askIt();
      fireEvent.click(screen.getByRole('button', { name: /Remind me on/ }));
      expect(await screen.findByTestId('call-result')).toHaveTextContent('Reminder set.');
      const sent = calls.find((c) => c.url.endsWith('/reminders'));
      expect(sent?.method).toBe('POST');
      expect(JSON.parse(sent!.body!)).toMatchObject({ link: '/offers/expirations' });
    });

    it('a change that matters waits for a confirmation, and Cancel sends nothing', async () => {
      withCalls([ACTIVATE]);
      await askIt();
      fireEvent.click(screen.getByRole('button', { name: 'Mark Hilton offer activated' }));
      const box = await screen.findByTestId('call-confirm');
      expect(box).toHaveTextContent('issuer’s website');
      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus();
      expect(calls.some((c) => c.url.includes('/offers/intel/activation'))).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByTestId('call-confirm')).toBeNull();
      expect(calls.some((c) => c.url.includes('/offers/intel/activation'))).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Mark Hilton offer activated' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
      expect(await screen.findByTestId('call-result')).toHaveTextContent('Marked as activated.');
      expect(calls.some((c) => c.url.includes('/offers/intel/activation/22222222'))).toBe(true);
    });

    it('refuses a path that is not on the allow-list, whatever the server said', async () => {
      withCalls([{ ...REMINDER, id: 'x', label: 'Do it', path: '/auth/logout' }]);
      await askIt();
      fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
      expect(await screen.findByTestId('call-result')).toHaveTextContent('not allowed');
      expect(calls.some((c) => c.url.includes('/auth/logout'))).toBe(false);
    });

    it('shows the error when the change fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          const u = String(url);
          if (u.endsWith('/reminders'))
            return { ok: false, status: 400, statusText: 'Bad Request', text: async () => JSON.stringify({ message: 'That date has already passed' }) } as Response;
          const body = u.includes('/search/ask') ? { ...ANSWER, answer: { ...ANSWER.answer, calls: [REMINDER] } } : u.includes('saved/check') ? { saved: null } : EXAMPLES;
          void init;
          return { ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(body) } as Response;
        }),
      );
      await askIt();
      fireEvent.click(screen.getByRole('button', { name: /Remind me on/ }));
      expect(await screen.findByTestId('call-result')).toHaveTextContent(/already passed/);
    });
  });

  it('says when it could not read a question, and offers the assistant', async () => {
    const unanswered = {
      ...ANSWER,
      answer: {
        ...ANSWER.answer,
        unanswered: true,
        summary: 'I could not tell what you want.',
        confidence: 0,
        actions: [],
        related: [],
        reasoning: [],
        evidence: [],
        followUps: ['How many points do I have?'],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(String(url).includes('/search/ask') ? unanswered : EXAMPLES) }) as Response,
      ),
    );
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'purple monkey' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('I could not tell what you want.')).toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Ask the assistant' })).toHaveAttribute('href', '/assistant?q=purple%20monkey');
  });

  it('shows a clear message when the server fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/search/ask')
          ? ({ ok: false, status: 500, statusText: 'Server Error', text: async () => JSON.stringify({ message: 'Boom' }) } as Response)
          : ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(EXAMPLES) } as Response),
      ),
    );
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'anything' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});
