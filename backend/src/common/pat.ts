import { createHash } from 'crypto';

/** Personal access tokens: the prefix every token starts with, and the hash that is stored instead of the token. */
export const PAT_PREFIX = 'pw_pat_';
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
