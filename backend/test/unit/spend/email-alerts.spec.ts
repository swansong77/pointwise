import {
  domainOf,
  gmailForwardingConfirmation,
  inboxToken,
  parseAlert,
  senderAllowed,
  senderAuth,
  senderDomains,
  statementDigits,
} from "../../../src/domain/email-alerts";

/** Forwarded card alert emails: issuer wording, ignore rules, sender checks, forwarding confirmation. Synthetic texts. */
const SENT = new Date("2026-11-03T15:00:00Z");
const ok = (subject: string, body: string) => {
  const r = parseAlert(subject, body, SENT);
  if (r.kind !== "ALERT") throw new Error(`not an alert: ${r.reason}`);
  return {
    ...r.alert,
    occurredAt: r.alert.occurredAt?.toISOString().slice(0, 10),
  };
};

describe("parseAlert", () => {
  it("reads the common issuer wordings", () => {
    expect(
      ok(
        "Your $23.45 transaction with UBER *TRIP",
        "You made a $23.45 transaction with UBER *TRIP on November 2, 2026 at 8:14 PM ET. Account ending in (...1234)",
      ),
    ).toEqual({
      amountCents: 2345,
      merchant: "UBER *TRIP",
      lastDigits: "1234",
      occurredAt: "2026-11-02",
      credit: false,
    });
    expect(
      ok(
        "Large purchase approved",
        "Merchant: UBER TRIP\nAmount: $1,023.45\nDate: 11/02/2026\nCard ending: 31007",
      ),
    ).toMatchObject({
      amountCents: 102345,
      merchant: "UBER TRIP",
      lastDigits: "31007",
    });
    expect(
      ok(
        "Transaction alert",
        "A $6.50 transaction was made at SQ *BEAN STREET COFFEE on card ending in 4321.",
      ),
    ).toMatchObject({
      merchant: "SQ *BEAN STREET COFFEE",
      lastDigits: "4321",
      occurredAt: "2026-11-03",
    });
    expect(
      ok(
        "A new transaction was charged",
        "As requested, we are notifying you that on November 02, 2026, at LYFT *RIDE, a pending authorization or purchase in the amount of $18.00 was placed or charged on your card ending in 9876.",
      ),
    ).toMatchObject({
      amountCents: 1800,
      merchant: "LYFT *RIDE",
      lastDigits: "9876",
    });
  });
  it("credits and refunds are marked", () => {
    expect(
      ok(
        "You received a credit",
        "A statement credit of $10.00 from UBER CASH was credited to your card ending in 1234 on 11/05/2026.",
      ),
    ).toMatchObject({
      amountCents: 1000,
      merchant: "UBER CASH",
      credit: true,
      occurredAt: "2026-11-05",
    });
    expect(
      ok(
        "Refund",
        "A refund of $25.99 from AMAZON.COM was posted to your card ending in 1234.",
      ),
    ).toMatchObject({ credit: true, merchant: "AMAZON.COM" });
  });
  it("ignores declines, payments, statement notices and mail without an amount or merchant", () => {
    expect(
      parseAlert(
        "Transaction declined",
        "A $5.00 purchase at X was declined.",
        SENT,
      ),
    ).toEqual({ kind: "IGNORED", reason: "declined" });
    expect(
      parseAlert(
        "Payment received",
        "Thank you for your payment of $500.00.",
        SENT,
      ),
    ).toEqual({ kind: "IGNORED", reason: "payment confirmation" });
    expect(
      parseAlert(
        "Your statement is ready",
        "Your new statement is available online.",
        SENT,
      ),
    ).toEqual({
      kind: "IGNORED",
      reason: "statement notice (no transactions)",
    });
    expect(
      parseAlert("New offers for you", "Earn more with our card.", SENT),
    ).toEqual({ kind: "IGNORED", reason: "no amount" });
    expect(parseAlert("Balance", "Your balance is $1,000.00.", SENT)).toEqual({
      kind: "IGNORED",
      reason: "no merchant",
    });
    expect(parseAlert("x", "A $0.00 transaction with X", SENT)).toEqual({
      kind: "IGNORED",
      reason: "zero amount",
    });
  });
});

describe("senders and authentication", () => {
  it("issuer allow-list (plus configured extras)", () => {
    expect(domainOf("Chase <no.reply.alerts@chase.com>")).toBe("chase.com");
    expect(senderAllowed("alerts.chase.com", senderDomains({}))).toBe(true);
    expect(senderAllowed("welcome.aexp.com", senderDomains({}))).toBe(true);
    expect(senderAllowed("chase.com.evil.example", senderDomains({}))).toBe(
      false,
    );
    expect(
      senderAllowed(
        "bank.example",
        senderDomains({
          INBOUND_EXTRA_SENDER_DOMAINS: "bank.example",
        } as NodeJS.ProcessEnv),
      ),
    ).toBe(true);
    expect(senderAllowed("", senderDomains({}))).toBe(false);
  });
  it("trusts only our own receiving service's Authentication-Results", () => {
    expect(
      senderAuth(
        ["mx.pw.test; dkim=pass header.d=chase.com; spf=fail"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("pass");
    expect(
      senderAuth(
        ["mx.pw.test; dkim=pass header.d=e.chase.com"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("pass");
    expect(
      senderAuth(
        ["mx.pw.test; dkim=fail header.d=chase.com; dmarc=fail"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("fail");
    expect(
      senderAuth(
        ["mx.pw.test; dkim=pass header.d=evil.example"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("unknown");
    expect(
      senderAuth(
        ["forged.example; dkim=pass header.d=chase.com"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("unknown");
    expect(
      senderAuth(
        ["mx.pw.test; dkim=pass header.d=chase.com"],
        undefined,
        "chase.com",
      ),
    ).toBe("unknown");
    expect(
      senderAuth(
        ["mx.pw.test; dmarc=pass header.from=chase.com"],
        "mx.pw.test",
        "chase.com",
      ),
    ).toBe("pass");
  });
  it("Gmail forwarding confirmation, inbox token, statement digits", () => {
    expect(
      gmailForwardingConfirmation(
        "Gmail Team <forwarding-noreply@google.com>",
        "(#123456789) Gmail Forwarding Confirmation - Receive Mail from jo@gmail.com",
        "click https://mail-settings.google.com/mail/vf-abc here",
      ),
    ).toEqual({
      code: "123456789",
      url: "https://mail-settings.google.com/mail/vf-abc",
    });
    expect(gmailForwardingConfirmation("a@chase.com", "Alert", "x")).toBeNull();
    expect(
      inboxToken(
        ["Jo <jo@gmail.com>", "u-0123456789abcdef0123@in.pw.test"],
        "in.pw.test",
      ),
    ).toBe("u-0123456789abcdef0123");
    expect(
      inboxToken(["u-0123456789abcdef0123@other.example"], "in.pw.test"),
    ).toBeNull();
    expect(inboxToken(["short@in.pw.test"], "in.pw.test")).toBeNull();
    expect(
      statementDigits(["Fixture Bank", "Account Number: XXXX XXXX XXXX 4321"]),
    ).toBe("4321");
    expect(statementDigits(["Card ending in 31007"])).toBe("31007");
    expect(statementDigits(["nothing"])).toBeNull();
  });
});
