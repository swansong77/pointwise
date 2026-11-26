import { ConnectorContext, ConnectorError, Credentials, EnrollRequest, EnrollResponse, InventoryResult, LoginResult, OfferConnector, SessionBlob } from './connector';

/**
 * Issuer flows as data. Each describes how a logged-in offers page is reached and read for one issuer. They are
 * built from the generic shape of these sites and have NEVER been run against the real ones (no real accounts are
 * available to the project), so every flow is flagged unverified. A browser runner executes a flow; the runner is an
 * optional add-on that is not installed by default, so without it these connectors report DISABLED instead of
 * guessing. See docs/merchant-offer-automation-review.md for what is known about each issuer.
 */
export interface IssuerFlow {
  id: string;
  issuers: string[];
  /** where the offers live once logged in; the real address comes from Issuer.offersUrl */
  offersProduct: string;
  mfaMethods: Array<'SMS' | 'APP' | 'AUTHENTICATOR' | 'PASSKEY'>;
  /** selectors are placeholders until verified against the real site */
  selectors: { username: string; password: string; submit: string; offerCard: string; offerTitle: string; offerMerchant: string; offerEnd: string; addButton: string; addedBadge: string };
  /** terms note shown to the member before they opt in */
  termsNote: string;
  unverified: true;
}

const GENERIC = { username: 'input[name=username]', password: 'input[type=password]', submit: 'button[type=submit]', offerCard: '[data-offer]', offerTitle: '[data-offer-title]', offerMerchant: '[data-offer-merchant]', offerEnd: '[data-offer-end]', addButton: 'button[data-add]', addedBadge: '[data-added]' };

export const ISSUER_FLOWS: IssuerFlow[] = [
  { id: 'amex', issuers: ['American Express', 'Amex'], offersProduct: 'Amex Offers', mfaMethods: ['SMS', 'APP'], selectors: GENERIC, termsNote: 'American Express website terms were not readable when checked; confirm they allow automated access before enabling.', unverified: true },
  { id: 'chase', issuers: ['Chase', 'JPMorgan Chase'], offersProduct: 'Chase Offers', mfaMethods: ['SMS', 'APP', 'PASSKEY'], selectors: GENERIC, termsNote: 'Chase\'s terms of use list "agents, including AI agents or agentic AI, robots, spiders, scripts" as unauthorized use and require agent traffic to be labelled. Using this connector may breach them.', unverified: true },
  { id: 'citi', issuers: ['Citi', 'Citibank'], offersProduct: 'Citi Merchant Offers', mfaMethods: ['SMS', 'APP'], selectors: GENERIC, termsNote: 'Citi\'s terms were not checked.', unverified: true },
  { id: 'bofa', issuers: ['Bank of America', 'BofA'], offersProduct: 'BankAmeriDeals', mfaMethods: ['SMS', 'APP'], selectors: GENERIC, termsNote: 'Bank of America\'s terms were not checked.', unverified: true },
  { id: 'capital-one', issuers: ['Capital One'], offersProduct: 'Capital One Offers', mfaMethods: ['SMS', 'APP'], selectors: GENERIC, termsNote: 'Capital One\'s website terms had no bot clause when last read, but offers-specific terms were not checked.', unverified: true },
  { id: 'wells-fargo', issuers: ['Wells Fargo'], offersProduct: 'Wells Fargo Merchant Offers', mfaMethods: ['SMS', 'APP'], selectors: GENERIC, termsNote: 'Wells Fargo\'s terms were not checked.', unverified: true },
];

/**
 * A browser session runner: opens a page, types, clicks and reads. Implemented by an optional add-on (for example a
 * headless browser) and injected here. Traffic is labelled, paced and capped by the sync service, not by the runner.
 */
export interface BrowserRunner {
  login(flow: IssuerFlow, creds: Credentials, ctx: ConnectorContext, deviceTrust?: string): Promise<LoginResult>;
  submitMfa(flow: IssuerFlow, session: SessionBlob, code: string, ctx: ConnectorContext): Promise<LoginResult>;
  read(flow: IssuerFlow, session: SessionBlob, ctx: ConnectorContext): Promise<InventoryResult>;
  add(flow: IssuerFlow, session: SessionBlob, req: EnrollRequest, ctx: ConnectorContext): Promise<EnrollResponse>;
}

/** Runs a flow through a browser runner. Without a runner every call reports DISABLED. */
export class FlowConnector implements OfferConnector {
  verified = false;
  canEnroll = true;
  constructor(
    private readonly flow: IssuerFlow,
    private readonly runner: BrowserRunner | null,
  ) {}
  get id() {
    return this.flow.id;
  }
  get issuers() {
    return this.flow.issuers;
  }
  private need(): BrowserRunner {
    if (!this.runner) throw new ConnectorError('DISABLED', 'The browser add-on needed for issuer logins is not installed on this server.');
    return this.runner;
  }
  async login(creds: Credentials, ctx: ConnectorContext, deviceTrust?: string) {
    return this.need().login(this.flow, creds, ctx, deviceTrust);
  }
  async submitMfa(session: SessionBlob, code: string, ctx: ConnectorContext) {
    return this.need().submitMfa(this.flow, session, code, ctx);
  }
  async fetchInventory(session: SessionBlob, ctx: ConnectorContext) {
    return this.need().read(this.flow, session, ctx);
  }
  async fetchEnrollments(session: SessionBlob, ctx: ConnectorContext) {
    const inv = await this.need().read(this.flow, session, ctx);
    return inv.items.filter((i) => i.enrolled).map((i) => ({ externalId: i.externalId, cardKey: i.cardKey }));
  }
  async enroll(session: SessionBlob, req: EnrollRequest, ctx: ConnectorContext) {
    return this.need().add(this.flow, session, req, ctx);
  }
  async healthCheck() {
    return this.runner ? { ok: true, message: 'The browser add-on is installed; the flow is unverified.' } : { ok: false, message: 'The browser add-on is not installed.' };
  }
}
