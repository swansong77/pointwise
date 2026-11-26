/**
 * Offer-alert emails: which issuer a sender domain belongs to. The mail itself is read by the same offer parser as a
 * pasted list; only issuers the member keeps an "Offer Emails" account for are processed.
 */
const DOMAINS: Array<[string, string[]]> = [
  ['American Express', ['americanexpress.com', 'welcome.americanexpress.com', 'email.americanexpress.com', 'aexp.com']],
  ['Chase', ['chase.com', 'e.chase.com', 'alertsp.chase.com']],
  ['Citi', ['citi.com', 'info6.citi.com', 'accountonline.com']],
  ['Bank of America', ['bankofamerica.com', 'emailbankofamerica.com', 'ealerts.bankofamerica.com']],
  ['Capital One', ['capitalone.com', 'email.capitalone.com', 'notification.capitalone.com']],
  ['Wells Fargo', ['wellsfargo.com', 'notify.wellsfargo.com', 'email.wellsfargo.com']],
];

/** The issuer a sender domain (or subdomain) belongs to, or null. */
export function issuerNameForDomain(domain: string): string | null {
  const d = domain.trim().toLowerCase();
  if (!d) return null;
  for (const [name, list] of DOMAINS) if (list.some((x) => d === x || d.endsWith(`.${x}`))) return name;
  return null;
}
