import type { NotificationType } from '@prisma/client';

/**
 * Which notifications still go out at once when a member turns on Quiet Mode. Everything else is held and folded into the executive
 * briefing. Typed over the whole enum, so adding a notification type will not compile until someone decides which kind it is.
 *
 * CRITICAL: a deadline or a failure the member must hear about now, or something they asked for (a reminder), or the briefing itself.
 * NORMAL: useful, but the briefing carries it (offers, balances going stale, transfer bonuses, digests).
 */
export type Severity = 'CRITICAL' | 'NORMAL';

export const SEVERITY: Record<NotificationType, Severity> = {
  LOYALTY_STALE: 'NORMAL',
  LOYALTY_EXPIRING: 'CRITICAL',
  BENEFIT_EXPIRING: 'CRITICAL',
  OFFER_EXPIRING: 'NORMAL',
  CARD_RENEWAL: 'CRITICAL',
  BONUS_DEADLINE: 'CRITICAL',
  OFFER_ALERT: 'NORMAL',
  TRANSFER_BONUS: 'NORMAL',
  SYSTEM: 'CRITICAL',
  OFFER_NEW_HIGH_VALUE: 'NORMAL',
  OFFER_AUTO_ENROLLED: 'NORMAL',
  OFFER_ENROLL_FAILED: 'CRITICAL',
  OFFER_SYNC_FAILED: 'CRITICAL',
  OFFER_SAVINGS_DIGEST: 'NORMAL',
  BACKUP_FAILED: 'CRITICAL',
  REMINDER: 'CRITICAL',
  COPILOT: 'CRITICAL',
};

export const isCritical = (t: NotificationType): boolean => SEVERITY[t] === 'CRITICAL';
export const NORMAL_TYPES = (Object.keys(SEVERITY) as NotificationType[]).filter((t) => SEVERITY[t] === 'NORMAL');
