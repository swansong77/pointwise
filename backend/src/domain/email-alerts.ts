/**
 * Card transaction alert emails → transactions (pure, deterministic — alerts are card data and are
 * never sent to an AI provider).
 *
 * Users turn on "every transaction" alerts at their card issuers and forward them (a Gmail / Outlook
 * filter) to their private Pointwise address. Issuers word alerts differently; the parser looks for
 * the pieces every alert has: an amount, a merchant, the card's last digits and usually a date.
 *   "You made a $23.45 transaction with UBER *TRIP on November 2, 2026 … ending in 1234"   (Chase-style)
 *   "Merchant: UBER TRIP  Amount: $23.45  Card ending: 31007"                             (key/value)
 *   "A $23.45 transaction was made at UBER on card ending in 1234"                         (Citi-style)
 *   "… at UBER, a pending authorization or purchase in the amount of $23.45 … ending in 1234" (Capital One-style)
 */
import { DEFAULT_ISSUER_DOMAINS } from "../catalog-refresh/fetcher";

export const ALERT_SENDER_DOMAINS = [
  ...DEFAULT_ISSUER_DOMAINS,
  "aexp.com",
  "welcome.aexp.com",
  "citicards.com",
  "ealerts.bankofamerica.com",
  "notify.wellsfargo.com",
  "alerts.chase.com",
  "notification.capitalone.com",
  "service.discover.com",
];

export function senderDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.INBOUND_EXTRA_SENDER_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...ALERT_SENDER_DOMAINS, ...extra];
}

export function domainOf(address: string): string {
  return (
    /@([a-z0-9.-]+)>?\s*$/i.exec(address.trim())?.[1] ?? ""
  ).toLowerCase();
}

export function senderAllowed(domain: string, allowed: string[]): boolean {
  return (
    !!domain && allowed.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}

/**
 * Sender authentication from Authentication-Results headers. Only headers stamped by our own
 * receiving service (authserv-id = INBOUND_AUTHSERV_ID) are trusted — anyone can put a fake
 * Authentication-Results header inside a message. DKIM survives forwarding; SPF does not.
 */
export function senderAuth(
  authResults: string[],
  authservId: string | undefined,
  fromDomain: string,
): "pass" | "fail" | "unknown" {
  if (!authservId) return "unknown";
  const ours = authResults.filter((h) =>
    h.trim().toLowerCase().startsWith(authservId.toLowerCase()),
  );
  if (!ours.length) return "unknown";
  const h = ours[0].toLowerCase();
  const aligned = (d: string) =>
    d === fromDomain ||
    fromDomain.endsWith(`.${d}`) ||
    d.endsWith(`.${fromDomain}`);
  const dkim = [
    ...h.matchAll(/dkim=(\w+)[^;]*?header\.(?:d|i)=@?([a-z0-9.-]+)/g),
  ];
  if (dkim.some(([, r, d]) => r === "pass" && aligned(d))) return "pass";
  if (/dmarc=pass/.test(h)) return "pass";
  if (
    /dmarc=fail/.test(h) ||
    dkim.some(([, r, d]) => r === "fail" && aligned(d))
  )
    return "fail";
  return "unknown";
}

/** Gmail's "confirm forwarding" message: show the code / link to the user. */
export function gmailForwardingConfirmation(
  from: string,
  subject: string,
  text: string,
): { code: string | null; url: string | null } | null {
  if (
    !/forwarding-noreply@google\.com/i.test(from) &&
    !/gmail forwarding confirmation/i.test(subject)
  )
    return null;
  const code =
    /\(#(\d{6,12})\)/.exec(subject)?.[1] ??
    /confirmation code:\s*(\d{6,12})/i.exec(text)?.[1] ??
    null;
  const url =
    /(https:\/\/(?:mail-settings\.google\.com|mail\.google\.com)\/[^\s<>"]+)/i.exec(
      text,
    )?.[1] ?? null;
  return { code, url };
}

export interface ParsedAlert {
  amountCents: number;
  merchant: string;
  lastDigits: string | null;
  occurredAt: Date | null;
  credit: boolean;
}

export type AlertResult =
  { kind: "ALERT"; alert: ParsedAlert } | { kind: "IGNORED"; reason: string };

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function parseDate(s: string): Date | null {
  let m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(s);
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
  m =
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(
      s,
    );
  if (m)
    return valid(
      +m[3],
      MONTHS.findIndex((x) => x.startsWith(m![1].toLowerCase())),
      +m[2],
    );
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return valid(+m[1], +m[2] - 1, +m[3]);
  return null;
}
const valid = (y: number, mo: number, d: number) => {
  const x = new Date(Date.UTC(y, mo, d));
  return x.getUTCMonth() === mo && x.getUTCDate() === d ? x : null;
};

const IGNORE = [
  [
    /\bdeclined\b|was not approved|could not be (?:approved|processed)/i,
    "declined",
  ],
  [
    /payment (?:has been |was )?(?:received|posted|scheduled)|thank you for your payment|autopay/i,
    "payment confirmation",
  ],
  [
    /statement is (?:ready|available)|your (?:new |e-?)?statement/i,
    "statement notice (no transactions)",
  ],
] as const;

const CLEAN = (s: string) =>
  s
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function merchantOf(t: string): string | null {
  const patterns = [
    /\b(?:merchant|description|where|merchant name|payee)\s*:\s*([^\n]{2,80}?)(?=\s{2,}|\s+(?:amount|date|card|account|time)\b|\n|$)/i,
    /transaction (?:with|at) ([^\n]{2,80}?)(?=\s+on\s|\s+for\s|\s+has\s|\s+was\s|\.(?:\s|$)|,|\n|$)/i,
    /\bmade at ([^\n]{2,80}?)(?=\s+on\s|\s+for\s|\.(?:\s|$)|,|\n|$)/i,
    /\bat ([A-Z0-9][^\n,]{1,80}?), a (?:pending )?(?:authorization|purchase)/i,
    /\b(?:credit|refund)\b[^\n]{0,40}? from ([^\n]{2,80}?)(?=\s+was\s|\s+on\s|\s+has\s|\.(?:\s|$)|,|\n|$)/i,
    /\b(?:purchase|charge|credit|refund) (?:at|from|with) ([^\n]{2,80}?)(?=\s+on\s|\s+for\s|\s+of\s|\s+in the amount|\.(?:\s|$)|,|\n|$)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const v = CLEAN(m[1]).replace(/^(the merchant |merchant )/i, "");
      if (v && !/^\$|^card\b|^your\b/i.test(v)) return v.slice(0, 120);
    }
  }
  return null;
}

/** Parses the subject + text of an issuer alert. */
export function parseAlert(
  subject: string,
  body: string,
  sentAt: Date | null,
): AlertResult {
  const t = `${subject}\n${body}`;
  for (const [re, reason] of IGNORE)
    if (re.test(t)) return { kind: "IGNORED", reason };
  const amount = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/.exec(
    t,
  );
  if (!amount) return { kind: "IGNORED", reason: "no amount" };
  const cents = Math.round(Number(amount[1].replace(/,/g, "")) * 100);
  if (!cents) return { kind: "IGNORED", reason: "zero amount" };
  const merchant = merchantOf(body) ?? merchantOf(subject);
  if (!merchant) return { kind: "IGNORED", reason: "no merchant" };
  const digits =
    /(?:ending(?: in| with)?|last (?:4|four|5|five)(?: digits)?(?: of)?|card ending|account ending|ending:)\s*[:#]?\s*(?:in\s*)?[x*•.\s()]*(\d{4,5})\b/i.exec(
      t,
    )?.[1] ?? null;
  const dateText =
    /\b(?:on|date[^:]*:|transaction date[^:]*:)\s*([a-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(
      t,
    )?.[1];
  const occurredAt =
    (dateText && parseDate(dateText)) ||
    (sentAt
      ? new Date(
          Date.UTC(
            sentAt.getUTCFullYear(),
            sentAt.getUTCMonth(),
            sentAt.getUTCDate(),
          ),
        )
      : null);
  const credit =
    /\b(statement credit|credit (?:of|for|has been|was) |refund|return(?:ed)?|reversal|credited)\b/i.test(
      t,
    );
  return {
    kind: "ALERT",
    alert: {
      amountCents: cents,
      merchant,
      lastDigits: digits,
      occurredAt,
      credit,
    },
  };
}

/** Inbox address token from envelope / header recipients ("u-abc123@in.example.com" → "u-abc123"). */
export function inboxToken(
  recipients: string[],
  domain: string | null | undefined,
): string | null {
  for (const r of recipients) {
    for (const m of r.matchAll(/([a-z0-9][a-z0-9-]{5,40})@([a-z0-9.-]+)/gi)) {
      if (
        (!domain || m[2].toLowerCase() === domain.toLowerCase()) &&
        /^u-[a-z0-9]{16,}$/i.test(m[1])
      )
        return m[1].toLowerCase();
    }
  }
  return null;
}

/** Last digits printed on a statement ("Account Number: XXXX XXXX XXXX 1234", "Card ending in 31007"). */
export function statementDigits(lines: string[]): string | null {
  const t = lines.slice(0, 120).join("\n");
  return (
    /(?:account (?:number|ending)|card ending|ending in)[:\s]*(?:[x*•\s-]*)(?:\d-)?(\d{4,5})\b/i.exec(
      t,
    )?.[1] ??
    /(?:xxxx[\s-]*){2,3}(\d{4})\b/i.exec(t)?.[1] ??
    null
  );
}
