import { ChatMessage } from './types';

/**
 * Privacy boundary between PointWise and AI providers (policy set by the product owner):
 * an AI provider never receives the user's card data.
 *
 * - Tools are classified. PUBLIC tools (card catalog) may return results to the model.
 *   USER tools (wallet, benefits, 5/24, household, values, offers) and write tools run on the
 *   server and their results go straight to the user; the model never sees them.
 * - A turn that touched user data is stored as `private` and is never replayed to a model.
 * - Card-number-like digit runs and email addresses are removed from what the user typed before
 *   it is sent to a model.
 */

const CARD_NUMBER = /\b\d(?:[ -]?\d){11,18}\b/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function redactForModel(text: string): string {
  return text.replace(CARD_NUMBER, '[number removed]').replace(EMAIL, '[email removed]');
}

/** What may be replayed to a model: no private turns; user text redacted; starts with a user turn. */
export function modelHistory(messages: ChatMessage[]): ChatMessage[] {
  const out = messages
    .filter((m) => !m.private)
    .map((m) => (m.role === 'user' ? { ...m, text: redactForModel(m.text) } : m));
  const first = out.findIndex((m) => m.role === 'user');
  return first < 0 ? [] : out.slice(first);
}

// ───────────── provider locality (ADR-004) ─────────────

export type StepPrivacy = 'PUBLIC' | 'USER';

/**
 * A provider is local when the model runs on the user's own machine: Ollama (and the offline mock).
 * Gateways that may forward to cloud models — OpenClaw, OpenRouter, any OpenAI-compatible endpoint —
 * are NOT local, even on a loopback address, because PointWise cannot see where they send the text.
 */
export function isLocalProvider(kind: string): boolean {
  return kind === 'OLLAMA' || kind === 'MOCK';
}

/** USER-data text may go only to a local provider; PUBLIC text may go anywhere. */
export function mayReceive(privacy: StepPrivacy, providerKind: string): boolean {
  return privacy === 'PUBLIC' || isLocalProvider(providerKind);
}
