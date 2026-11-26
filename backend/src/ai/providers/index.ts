import { decryptSecret } from '../../common/crypto';
import { LlmProvider, ProviderKind } from '../types';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';

export interface ProviderRow {
  id: string;
  kind: ProviderKind;
  baseUrl: string | null;
  apiVersion: string | null;
  apiKeyEnc: string | null;
  apiKeyEnv: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

/** The provider's API key: database (encrypted) first, then the configured environment variable. */
export function resolveApiKey(p: Pick<ProviderRow, 'apiKeyEnc' | 'apiKeyEnv'>, env = process.env): string | null {
  if (p.apiKeyEnc) return decryptSecret(p.apiKeyEnc);
  if (p.apiKeyEnv && env[p.apiKeyEnv]) return env[p.apiKeyEnv] as string;
  return null;
}

/** Whether the provider can be called at all (enabled, configured, mock allowed). */
export function isUsable(p: ProviderRow, env = process.env): boolean {
  if (p.status !== 'ACTIVE') return false;
  if (p.kind === 'MOCK') return env.AI_ENABLE_MOCK === 'true';
  if (p.kind === 'OLLAMA') return true;
  if (p.kind === 'OPENAI_COMPATIBLE' && !p.baseUrl) return false;
  if (p.kind === 'AZURE_OPENAI' && !p.baseUrl) return false;
  try {
    return !!resolveApiKey(p, env);
  } catch {
    return false;
  }
}

export type ProviderFactory = (p: ProviderRow) => LlmProvider;

export const defaultProviderFactory: ProviderFactory = (p) => {
  const key = p.kind === 'MOCK' || p.kind === 'OLLAMA' ? null : resolveApiKey(p);
  switch (p.kind) {
    case 'ANTHROPIC':
      return new AnthropicProvider({ apiKey: key as string, baseUrl: p.baseUrl });
    case 'GEMINI':
      return new GeminiProvider({ apiKey: key as string });
    case 'MOCK':
      return new MockProvider();
    default:
      return new OpenAiProvider(p.kind, { apiKey: key, baseUrl: p.baseUrl, apiVersion: p.apiVersion });
  }
};
