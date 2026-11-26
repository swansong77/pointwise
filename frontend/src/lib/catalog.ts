import { money } from './format';

/** Display a proposed catalog field value (cents → $, booleans → Yes/No). */
export function formatFieldValue(field: string, v: unknown): string {
  if (v == null) return '—';
  if (field.endsWith('Cents') && typeof v === 'number') return money(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString('en-US');
  return String(v);
}

export interface VerificationInfo {
  catalogSource?: string;
  dataAsOf?: string | null;
  lastVerifiedAt?: string | null;
  /** ISSUER_LISTING: name, type, fee and headline rates from the issuer's all-cards page; PRODUCT_PAGE: the card's own page */
  verifiedScope?: string | null;
}

const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Badge for catalog data quality: curated facts not yet confirmed by an issuer page, or verified cards (none for demo/admin cards). */
export function verificationBadge(c: VerificationInfo): { label: string; tone: 'green' | 'amber'; title: string } | null {
  if (c.catalogSource === 'DEMO') return null;
  if (c.lastVerifiedAt && c.verifiedScope === 'ISSUER_LISTING')
    return {
      label: `On issuer site · ${monthYear(c.lastVerifiedAt)}`,
      tone: 'green',
      title: "Name, personal/business, annual fee and headline earning checked on the issuer's card listing — see the product page for full terms",
    };
  if (c.lastVerifiedAt) return { label: `Verified ${monthYear(c.lastVerifiedAt)}`, tone: 'green', title: 'Facts confirmed against the issuer product page' };
  if (c.catalogSource === 'SEED' || c.catalogSource === 'RESEARCH')
    return {
      label: c.dataAsOf ? `Unverified · as of ${monthYear(c.dataAsOf)}` : 'Unverified',
      tone: 'amber',
      title: 'Not yet confirmed against the issuer product page — check terms with the issuer',
    };
  return null;
}

export interface ResearchFact {
  field: string;
  value: unknown;
  evidence: string;
  verified: boolean;
}
export interface ResearchReward {
  category: string;
  rate: number;
  description: string;
  evidence: string;
  verified: boolean;
}

export function verificationTone(v: string): 'green' | 'amber' | 'red' {
  return v === 'VERIFIED' ? 'green' : v === 'PARTIAL' ? 'amber' : 'red';
}

export const EVIDENCE_FROM: Record<string, string> = {
  POINTWISE: 'checked on the page Pointwise fetched',
  AGENT: 'checked on the page the agent fetched (issuer blocks Pointwise)',
  NONE: 'page could not be loaded — nothing checked',
};
