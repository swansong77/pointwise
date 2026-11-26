/**
 * What kind of card email is this? (pure, deterministic). Used to tell the user what a message was even when
 * nothing can be imported from it ("payment due reminder", "offer credit"…). The importable kinds
 * (statements with a PDF, transaction/credit alerts) are parsed by email-alerts.ts and the PDF pipeline.
 */
export type MailKind =
  | 'STATEMENT'
  | 'TRANSACTION_ALERT'
  | 'TRAVEL_CREDIT'
  | 'OFFER_CREDIT'
  | 'ACCOUNT_ALERT'
  | 'PURCHASE_CONFIRMATION'
  | 'OTHER';

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  STATEMENT: 'Statement',
  TRANSACTION_ALERT: 'Transaction alert',
  TRAVEL_CREDIT: 'Travel credit',
  OFFER_CREDIT: 'Offer credit',
  ACCOUNT_ALERT: 'Account alert',
  PURCHASE_CONFIRMATION: 'Purchase confirmation',
  OTHER: 'Other',
};

const RULES: Array<[MailKind, RegExp]> = [
  ['STATEMENT', /\b(e-?statement|statement (is )?(ready|available)|your .{0,30}statement)\b/i],
  ['OFFER_CREDIT', /\b(offer|cash ?back|reward)s?\b.{0,40}\b(credit(ed)?|earned|added|posted)\b|\b(credit(ed)?|earned|added|posted)\b.{0,40}\b(offer|cash ?back)\b/i],
  ['TRAVEL_CREDIT', /\b(airline|hotel|travel|global entry|tsa|clear|uber|saks|resy|walmart\+?|lululemon|equinox|digital entertainment)\b.{0,50}\bcredit\b|\bcredit\b.{0,50}\b(airline|hotel|travel|global entry)\b/i],
  ['TRANSACTION_ALERT', /\b(transaction|purchase|charge|authorization)\b.{0,40}\b(alert|notification|was (made|charged|approved)|exceed)/i],
  ['ACCOUNT_ALERT', /\b(payment (due|received|posted|reminder|scheduled)|balance|credit limit|fraud|security|password|new (card|account)|autopay|sign-?in)\b/i],
  ['PURCHASE_CONFIRMATION', /\b(order|booking|reservation|itinerary|receipt|e-?ticket)\b.{0,30}\b(confirm(ation|ed)?|receipt|details)\b|\byour (order|booking|reservation)\b/i],
];

/** First matching category for a subject line (and the first part of the body). */
export function classifyMail(subject: string, text = ''): MailKind {
  const hay = `${subject}\n${text.slice(0, 600)}`;
  for (const [kind, re] of RULES) if (re.test(subject) || (kind !== 'STATEMENT' && re.test(hay))) return kind;
  return 'OTHER';
}
