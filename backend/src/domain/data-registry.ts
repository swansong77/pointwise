/**
 * The registry that drives backup, restore, member export and member import. Every Prisma model must appear here
 * exactly once; a unit test compares this table with the schema, so a model added later cannot be silently left
 * out of backups. Pure code (the schema metadata is passed in), so it is unit-tested without a database.
 */

export type ModelClass = 'USER' | 'SYSTEM' | 'EPHEMERAL';

export interface ModelRule {
  /** USER: belongs to one member. SYSTEM: catalog, registry, AI and research configuration. EPHEMERAL: sessions, logs, queues of work. */
  cls: ModelClass;
  /**
   * How a member's rows are found for the member export: the dotted path of relation names ending in the user id column,
   * for example "walletCard.wallet.userId". A model without a scope is not part of the member export.
   */
  scope?: string;
  /** Columns that are never exported or imported (secrets, provider ids, tokens). */
  drop?: string[];
  /** Columns that hold the id of another model without being a declared relation (they are remapped on import). */
  refs?: Record<string, string>;
  /** Columns that identify a row for a merge (a second import of the same file adds nothing). */
  natural?: string[];
  /** The member export lists these rows but an import does not restore them (they need a reconnect). */
  importable?: boolean;
  /** Columns forced to a value on import (for example opt-ins that must be switched on again by the member). */
  force?: Record<string, unknown>;
  /** One row per member that every account already has (settings): an import updates it instead of skipping it. */
  singleton?: boolean;
}

const U = 'userId';

export const DATA_RULES: Record<string, ModelRule> = {
  // ───────── members and identity
  User: { cls: 'USER', scope: 'id', drop: ['passwordHash', 'role', 'email', 'deletedAt'], importable: false },
  OAuthAccount: { cls: 'USER', importable: false },
  PasswordResetToken: { cls: 'EPHEMERAL' },
  RefreshToken: { cls: 'EPHEMERAL' },
  PersonalAccessToken: { cls: 'USER', importable: false },
  Household: { cls: 'USER', scope: 'ownerId', natural: ['name'] },
  Profile: { cls: 'USER', scope: U, natural: ['nickname'] },
  Wallet: { cls: 'USER', scope: U, natural: ['userId'] },
  Subscription: { cls: 'USER', scope: U, drop: ['providerCustomerId', 'providerSubId'], importable: false },
  EmailInbox: { cls: 'USER', importable: false },
  PushSubscription: { cls: 'EPHEMERAL' },

  // ───────── catalog and cards
  Issuer: { cls: 'SYSTEM' },
  RewardCurrency: { cls: 'SYSTEM' },
  // public cards have no owner; a member's own cards (ownerId set) are part of the member export
  CreditCard: { cls: 'USER', scope: 'ownerId', natural: ['slug'] },
  CardFeature: { cls: 'USER', scope: 'card.ownerId' },
  Reward: { cls: 'USER', scope: 'card.ownerId' },
  Category: { cls: 'SYSTEM' },
  Merchant: { cls: 'SYSTEM' },
  Location: { cls: 'SYSTEM' },
  PortalRate: { cls: 'SYSTEM' },
  BenefitCategory: { cls: 'SYSTEM' },
  Benefit: { cls: 'SYSTEM' },
  CardOffer: { cls: 'SYSTEM' },
  CardDataSource: { cls: 'SYSTEM' },
  CardChangeProposal: { cls: 'SYSTEM', refs: { reviewerId: 'User' } },
  CardResearchRun: { cls: 'SYSTEM', refs: { requestedById: 'User' } },
  CardCandidate: { cls: 'SYSTEM', refs: { matchedCardId: 'CreditCard', createdCardId: 'CreditCard', reviewerId: 'User' } },
  // catalog offers have no creator; offers a member entered themselves (createdById set) are part of the member export
  Offer: { cls: 'USER', scope: 'createdById' },

  // ───────── the member's cards, offers and money
  WalletCard: { cls: 'USER', scope: 'wallet.userId', natural: ['cardId', 'lastFour', 'approvedAt'] },
  UserValuation: { cls: 'USER', scope: U, natural: ['currencyId'] },
  CategoryPin: { cls: 'USER', scope: U },
  UserOffer: { cls: 'USER', scope: 'walletCard.wallet.userId', natural: ['walletCardId', 'offerId'] },
  OfferAlert: { cls: 'USER', scope: U },
  Transaction: { cls: 'USER', scope: U, natural: ['walletCardId', 'externalId'] },
  StatementImport: { cls: 'USER', scope: U, natural: ['walletCardId', 'fileSha256'] },
  StatementValidation: { cls: 'USER', scope: 'statementImport.userId' },
  BenefitDetection: { cls: 'USER', scope: 'userBenefit.walletCard.wallet.userId', refs: { transactionId: 'Transaction', usageId: 'BenefitUsage' } },
  UserBenefit: { cls: 'USER', scope: 'walletCard.wallet.userId', natural: ['walletCardId', 'name'] },
  BenefitUsage: { cls: 'USER', scope: 'userBenefit.walletCard.wallet.userId' },
  BenefitNotification: { cls: 'USER', scope: 'userBenefit.walletCard.wallet.userId' },
  CardImportJob: { cls: 'USER', scope: U },
  ImportRow: { cls: 'USER', scope: 'job.userId', refs: { matchedId: 'CreditCard' } },
  BankConnection: { cls: 'USER', scope: U, importable: false },
  CreditReportAccount: { cls: 'USER', scope: U },
  FiveTwentyFourSnapshot: { cls: 'USER', scope: 'profile.userId', natural: ['profileId', 'takenOn'] },
  SpendProfileEntry: { cls: 'USER', scope: U, natural: ['categoryId'] },
  RetentionOfferReport: { cls: 'USER', scope: U },
  PlannedPurchase: { cls: 'USER', scope: U, refs: { merchantId: 'Merchant' } },
  Recommendation: { cls: 'USER', scope: U, refs: { profileId: 'Profile', cardId: 'CreditCard' } },
  RecommendationFactor: { cls: 'USER', scope: 'recommendation.userId' },
  OfferEvent: { cls: 'USER', scope: U },

  // ───────── settings
  NotificationPreference: { cls: 'USER', scope: U, natural: ['userId'], singleton: true },
  AiSettings: { cls: 'USER', scope: U, drop: ['consentedAt', 'cloudShareConsentAt'], natural: ['userId'], singleton: true, refs: { preferredModelId: 'AiModel' } },
  EnrollmentPolicy: { cls: 'USER', scope: U, natural: ['userId'], singleton: true },
  EnrollmentRule: { cls: 'USER', scope: U, refs: { accountId: 'OfferAccount', walletCardId: 'WalletCard' } },

  // ───────── loyalty
  LoyaltyProgram: { cls: 'SYSTEM' },
  TransferPartner: { cls: 'SYSTEM' },
  TransferBonusRecord: { cls: 'SYSTEM' },
  LoyaltyBalance: { cls: 'USER', scope: U },
  LoyaltyAccount: { cls: 'USER', scope: U, natural: ['profileId', 'programId', 'customName'] },
  LoyaltyEvent: { cls: 'USER', scope: U },
  LoyaltyCertificate: { cls: 'USER', scope: U },
  EliteStatus: { cls: 'USER', scope: U },
  Membership: { cls: 'USER', scope: U, refs: { linkedWalletCardId: 'WalletCard' } },
  AwardTrip: { cls: 'USER', scope: U },
  LoyaltyObservation: { cls: 'USER', scope: U, natural: ['userId', 'dedupeKey'] },
  LoyaltySyncRun: { cls: 'USER', scope: U },

  // ───────── offer automation
  OfferAccount: { cls: 'USER', scope: U, drop: ['credentialRef', 'lastError'], force: { automationOptIn: false, optInAckAt: null, syncHealth: 'DISABLED', failedLogins: 0, lockedAt: null, lastLoginAt: null, sessionExpiresAt: null } },
  OfferAccountCard: { cls: 'USER', scope: 'account.userId', natural: ['accountId', 'walletCardId'] },
  OfferSnapshot: { cls: 'USER', scope: 'account.userId', refs: { runId: 'OfferSyncRun' } },
  OfferSnapshotItem: { cls: 'USER', scope: U, refs: { userId: 'User', walletCardId: 'WalletCard', merchantId: 'Merchant', userOfferId: 'UserOffer', ruleId: 'EnrollmentRule' }, natural: ['accountId', 'cardKey', 'externalId'] },
  EnrollmentAttempt: { cls: 'USER', scope: U, refs: { accountId: 'OfferAccount' } },
  OfferSyncRun: { cls: 'USER', scope: U },

  // ───────── mail
  Mailbox: { cls: 'USER', scope: U, importable: false },
  InboundEmail: { cls: 'EPHEMERAL' },

  // ───────── AI
  AiProvider: { cls: 'SYSTEM' },
  AiModel: { cls: 'SYSTEM' },
  AgentProfile: { cls: 'SYSTEM' },
  PromptTemplate: { cls: 'SYSTEM' },
  McpServer: { cls: 'SYSTEM' },
  McpTool: { cls: 'SYSTEM' },
  AiConversation: { cls: 'USER', scope: U },
  AiMessage: { cls: 'USER', scope: 'conversation.userId' },
  AiPendingAction: { cls: 'EPHEMERAL' },
  // what the member asked and saved in the universal search bar; a conversation's short-term memory is not exported
  SearchEntry: { cls: 'USER', scope: U, natural: ['normalized', 'kind'] },
  SearchSession: { cls: 'EPHEMERAL' },
  // reminders the member set; pending ones are part of their data
  Reminder: { cls: 'USER', scope: U, natural: ['title', 'dueAt'] },
  // what AI Mode sent to a model (already redacted), for the member to inspect
  AiDisclosure: { cls: 'USER', scope: U },
  AiUsage: { cls: 'EPHEMERAL' },
  AgentRun: { cls: 'EPHEMERAL' },
  AgentStep: { cls: 'EPHEMERAL' },

  // ───────── operations
  Notification: { cls: 'EPHEMERAL' },
  AnalyticsEvent: { cls: 'EPHEMERAL' },
  AuditLog: { cls: 'SYSTEM' },
  SystemSetting: { cls: 'SYSTEM' },
};

/** Columns that hold a secret encrypted with TOKEN_ENC_KEY. A backup stores them decrypted (inside the encrypted file). */
export const SECRET_COLUMNS: Record<string, string[]> = {
  BankConnection: ['accessTokenEnc'],
  Mailbox: ['secretEnc'],
  OfferAccount: ['credentialEnc', 'sessionEnc', 'deviceTrustEnc'],
  LoyaltyAccount: ['accountNumberEnc'],
  Membership: ['memberNumberEnc'],
  AiProvider: ['apiKeyEnc'],
  McpServer: ['authSecretEnc'],
};

/** Columns that are always stripped from a member export, whatever the model rule says. */
export const ALWAYS_DROP = ['passwordHash', 'tokenHash', 'token', 'p256dh', 'auth', 'endpoint', 'providerCustomerId', 'providerSubId'];

/** How a catalog row is recognised on another server (member import resolves ids through these). */
export const CATALOG_KEYS: Record<string, string[]> = {
  Issuer: ['name'],
  RewardCurrency: ['code'],
  CreditCard: ['slug'],
  Category: ['slug'],
  Merchant: ['slug'],
  BenefitCategory: ['slug'],
  LoyaltyProgram: ['code'],
  Benefit: ['cardId', 'name'],
  AiModel: ['providerId', 'modelId'],
  AiProvider: ['name'],
  Offer: ['title', 'merchantId', 'cardId'],
};

// ───────── schema metadata (passed in so this stays pure)

export interface FieldMeta {
  name: string;
  kind: string;
  type: string;
  isList?: boolean;
  isRequired?: boolean;
  isId?: boolean;
  relationName?: string;
  relationFromFields?: readonly string[];
  relationToFields?: readonly string[];
}
export interface ModelMeta {
  name: string;
  fields: readonly FieldMeta[];
}

/** Scalar (and enum) columns of a model, in schema order. */
export const columnsOf = (m: ModelMeta): FieldMeta[] => m.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');

/** The primary key column. */
export const idOf = (m: ModelMeta): string => m.fields.find((f) => f.isId)?.name ?? 'id';

/** Foreign-key columns (declared relations) with the model they point to and whether they may be null. */
export function foreignKeys(m: ModelMeta): Array<{ field: string; target: string; optional: boolean }> {
  const out: Array<{ field: string; target: string; optional: boolean }> = [];
  for (const f of m.fields) {
    if (f.kind !== 'object' || !f.relationFromFields?.length) continue;
    for (const from of f.relationFromFields) {
      const col = m.fields.find((c) => c.name === from);
      out.push({ field: from, target: f.type, optional: !(col?.isRequired ?? true) });
    }
  }
  return out;
}

/** Problems between the registry and the schema (empty when they agree). */
export function registryProblems(models: readonly ModelMeta[], rules = DATA_RULES, secrets = SECRET_COLUMNS): string[] {
  const out: string[] = [];
  const names = new Set(models.map((m) => m.name));
  for (const m of models) if (!rules[m.name]) out.push(`model ${m.name} is not classified in DATA_RULES`);
  for (const k of Object.keys(rules)) if (!names.has(k)) out.push(`DATA_RULES lists ${k}, which is not in the schema`);
  for (const m of models) {
    const enc = m.fields.filter((f) => f.kind === 'scalar' && f.name.endsWith('Enc')).map((f) => f.name);
    const listed = secrets[m.name] ?? [];
    for (const c of enc) if (!listed.includes(c)) out.push(`${m.name}.${c} looks like a secret but is not in SECRET_COLUMNS`);
    for (const c of listed) if (!enc.includes(c)) out.push(`SECRET_COLUMNS lists ${m.name}.${c}, which is not a column`);
    const r = rules[m.name];
    if (!r) continue;
    for (const c of [...(r.drop ?? []), ...Object.keys(r.refs ?? {}), ...(r.natural ?? [])]) if (!m.fields.some((f) => f.name === c)) out.push(`${m.name} rule names unknown column ${c}`);
    for (const t of Object.values(r.refs ?? {})) if (!names.has(t)) out.push(`${m.name} ref targets unknown model ${t}`);
    if (r.cls === 'USER' && r.scope === undefined && r.importable !== false) out.push(`${m.name} is USER and importable but has no scope`);
  }
  for (const [model, cols] of Object.entries(CATALOG_KEYS)) {
    const m = models.find((x) => x.name === model);
    if (!m) out.push(`CATALOG_KEYS lists unknown model ${model}`);
    else for (const c of cols) if (!m.fields.some((f) => f.name === c)) out.push(`CATALOG_KEYS ${model} names unknown column ${c}`);
  }
  return out;
}

export interface OrderResult {
  /** models in an order where every parent comes before its children */
  order: string[];
  /** foreign keys that point back (cycles): inserted as null first, then filled in */
  deferred: Array<{ model: string; field: string; target: string }>;
}

/**
 * Orders models so a restore can insert parents before children. A cycle is broken at an optional foreign key (the
 * column is inserted as null and filled in afterwards); a cycle with no optional key throws. Self references count as cycles.
 */
export function insertOrder(models: readonly ModelMeta[], rules?: Record<string, ModelRule>): OrderResult {
  const names = models.map((m) => m.name);
  // with rules, the columns that hold another model's id without being a declared relation also count as edges (a member import needs them)
  const fks = new Map(models.map((m) => [m.name, [...foreignKeys(m), ...Object.entries(rules?.[m.name]?.refs ?? {}).filter(([f, t]) => !foreignKeys(m).some((k) => k.field === f) && t !== 'User' && t !== m.name).map(([field, target]) => ({ field, target, optional: true }))]]));
  const deferred: OrderResult['deferred'] = [];
  const skip = new Set<string>();
  for (const m of models) for (const fk of fks.get(m.name)!) if (fk.target === m.name) {
    if (!fk.optional) throw new Error(`${m.name}.${fk.field} refers to its own table and is required`);
    deferred.push({ model: m.name, field: fk.field, target: fk.target });
    skip.add(`${m.name}.${fk.field}`);
  }
  const placed: string[] = [];
  const done = new Set<string>();
  const remaining = new Set(names);
  while (remaining.size) {
    const ready = [...remaining].filter((n) => (fks.get(n) ?? []).every((fk) => skip.has(`${n}.${fk.field}`) || fk.target === n || done.has(fk.target)));
    if (ready.length) {
      for (const n of ready.sort()) {
        placed.push(n);
        done.add(n);
        remaining.delete(n);
      }
      continue;
    }
    // a cycle: defer one optional foreign key between the models that are left
    let broke = false;
    for (const n of [...remaining].sort()) {
      const fk = (fks.get(n) ?? []).find((f) => f.optional && !skip.has(`${n}.${f.field}`) && remaining.has(f.target));
      if (fk) {
        deferred.push({ model: n, field: fk.field, target: fk.target });
        skip.add(`${n}.${fk.field}`);
        broke = true;
        break;
      }
    }
    if (!broke) throw new Error(`cannot order models: required foreign keys form a cycle among ${[...remaining].join(', ')}`);
  }
  return { order: placed, deferred };
}

/** Where clause for a member's rows, from a scope path such as "walletCard.wallet.userId". */
export function scopeWhere(scope: string, userId: string): Record<string, unknown> {
  const parts = scope.split('.');
  const leaf = parts.pop()!;
  let where: Record<string, unknown> = { [leaf]: userId };
  for (const rel of parts.reverse()) where = { [rel]: where };
  return where;
}

/** Models that make up a member export, in restore order. */
export const userModels = (order: string[], rules = DATA_RULES): string[] => order.filter((m) => rules[m]?.cls === 'USER' && rules[m]?.scope !== undefined);

/** Columns of a row that may be written on import: scalar columns minus the dropped, always-stripped and secret ones. */
export function importableColumns(m: ModelMeta, rules = DATA_RULES, secrets = SECRET_COLUMNS): string[] {
  const r = rules[m.name];
  const banned = new Set([...(r?.drop ?? []), ...ALWAYS_DROP, ...(secrets[m.name] ?? [])]);
  return columnsOf(m).map((c) => c.name).filter((c) => !banned.has(c));
}
