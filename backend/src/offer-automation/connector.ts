import { FailureKind } from '../domain/offer-sync-plan';
import { InvItem } from '../domain/offer-snapshot-diff';

/**
 * The connector contract. A connector turns one issuer account into an inventory of offers and (optionally) adds
 * offers. New issuers are added by writing a connector (or a flow definition) and registering it; nothing else changes.
 *
 * Server-side connectors are OFF by default (OFFER_CONNECTORS_ENABLED) and each account must opt in after
 * acknowledging the terms risk. Credentials arrive decrypted only for the length of one call and are never logged.
 */
export interface Credentials {
  username: string;
  password: string;
}

export type LoginResult =
  | { ok: true; session: SessionBlob }
  | { ok: false; needsMfa: true; method: 'SMS' | 'APP' | 'AUTHENTICATOR' | 'PASSKEY'; session: SessionBlob }
  | { ok: false; needsMfa?: false; kind: FailureKind; message: string };

/** What a connector needs to continue talking to the issuer; stored encrypted and never returned by the API. */
export interface SessionBlob {
  token: string;
  expiresAt: string;
  /** set while waiting for an MFA code */
  pendingMfa?: boolean;
  /** remembered-device marker so MFA is not asked every time */
  deviceTrust?: string;
}

export interface InventoryResult {
  items: InvItem[];
  /** card labels the issuer shows for the account, e.g. last four digits (used to link offers to wallet cards) */
  cards: Array<{ cardKey: string; label: string; lastFour: string | null }>;
}

export type EnrollOutcome = 'SUCCESS' | 'ALREADY_ADDED' | 'FAILURE' | 'SESSION_TIMEOUT' | 'MFA_FAILURE' | 'PARTIAL';

export interface EnrollRequest {
  externalId: string;
  cardKey: string;
}

export interface EnrollResponse {
  externalId: string;
  cardKey: string;
  outcome: EnrollOutcome;
  message?: string;
}

export interface ConnectorContext {
  /** the account's label, never a credential */
  accountLabel: string;
  /** public offers page of the issuer (Issuer.offersUrl), when known */
  offersUrl: string | null;
}

export interface OfferConnector {
  id: string;
  /** issuer names this connector serves (matched case-insensitively against Issuer.name and aliases) */
  issuers: string[];
  /** false = built from the generic flow and never checked against the real site */
  verified: boolean;
  canEnroll: boolean;
  login(creds: Credentials, ctx: ConnectorContext, deviceTrust?: string): Promise<LoginResult>;
  submitMfa(session: SessionBlob, code: string, ctx: ConnectorContext): Promise<LoginResult>;
  fetchInventory(session: SessionBlob, ctx: ConnectorContext): Promise<InventoryResult>;
  fetchEnrollments(session: SessionBlob, ctx: ConnectorContext): Promise<Array<{ externalId: string; cardKey: string }>>;
  enroll(session: SessionBlob, req: EnrollRequest, ctx: ConnectorContext): Promise<EnrollResponse>;
  healthCheck(ctx: ConnectorContext): Promise<{ ok: boolean; message: string }>;
}

/** A failure a connector reports; the sync pipeline maps its kind to health, retry and lock. */
export class ConnectorError extends Error {
  constructor(
    public readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}

export const connectorsEnabled = (): boolean => process.env.OFFER_CONNECTORS_ENABLED === 'true';

export class ConnectorRegistry {
  private readonly byId = new Map<string, OfferConnector>();
  register(c: OfferConnector): this {
    this.byId.set(c.id, c);
    return this;
  }
  get(id: string): OfferConnector | undefined {
    return this.byId.get(id);
  }
  /** the connector serving an issuer, or undefined */
  forIssuer(name: string): OfferConnector | undefined {
    const n = name.trim().toLowerCase();
    return [...this.byId.values()].find((c) => c.id !== 'mock' && c.issuers.some((i) => i.toLowerCase() === n));
  }
  list(): Array<{ id: string; issuers: string[]; verified: boolean; canEnroll: boolean }> {
    return [...this.byId.values()].map((c) => ({ id: c.id, issuers: c.issuers, verified: c.verified, canEnroll: c.canEnroll }));
  }
}
