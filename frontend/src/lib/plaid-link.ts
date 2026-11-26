/**
 * Plaid Link (bank sign-in widget), loaded only when the user connects or repairs a bank. The
 * script URL is Plaid's official, unversioned Link loader (Plaid does not publish pinned builds).
 */
type PlaidHandler = { open(): void; exit(): void; destroy(): void };
type PlaidApi = { create(cfg: { token: string; onSuccess: (publicToken: string) => void; onExit: (err: unknown) => void }): PlaidHandler };
declare global {
  interface Window {
    Plaid?: PlaidApi;
  }
}

export const PLAID_LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

let loading: Promise<PlaidApi> | null = null;

export function loadPlaid(doc: Document = document): Promise<PlaidApi> {
  if (typeof window !== 'undefined' && window.Plaid) return Promise.resolve(window.Plaid);
  loading ??= new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = PLAID_LINK_SRC;
    s.async = true;
    s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new Error('Plaid Link did not load')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Plaid Link could not be loaded'));
    };
    doc.head.appendChild(s);
  });
  return loading;
}

/** Opens Link with a link token; resolves with the public token, or null if the user closed it. */
export async function openPlaidLink(linkToken: string): Promise<string | null> {
  const plaid = await loadPlaid();
  return new Promise((resolve) => {
    const h = plaid.create({
      token: linkToken,
      onSuccess: (publicToken) => {
        h.destroy();
        resolve(publicToken);
      },
      onExit: () => {
        h.destroy();
        resolve(null);
      },
    });
    h.open();
  });
}
