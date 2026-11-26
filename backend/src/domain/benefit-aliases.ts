/**
 * Merchant alias table for benefit detection (data, not logic). A group says: "when a tracked benefit's
 * name looks like `benefit`, these descriptors belong to it". Statement credits use `credit` patterns
 * (the issuer's own wording); purchases use `aliases` / `patterns`.
 *
 * Wording of the Amex rows follows how issuers describe the credits; descriptors vary by statement
 * format, so every group is matched by several independent signals (see benefit-detect.ts).
 */
export interface AliasGroup {
  key: string;
  /** tracked-benefit names this group applies to */
  benefit: RegExp;
  /** merchant words / phrases (matched on word boundaries after normalization) */
  aliases: string[];
  /** regexes over the normalized descriptor, for variants words cannot express */
  patterns: RegExp[];
  /** regexes over the normalized descriptor of an issuer statement credit */
  credit: RegExp[];
}

export const ALIAS_GROUPS: AliasGroup[] = [
  {
    key: "uber",
    benefit: /\buber\b|rideshare/i,
    aliases: ["uber", "uber trip", "uber eats", "ubereats", "uber one"],
    patterns: [/\buber (eats|trip|one)\b/],
    credit: [/\buber (one )?(cash|credit|monthly)/, /\buber\b.*\bcr(edit)?\b/],
  },
  {
    key: "dining-gold",
    benefit: /dining/i,
    aliases: [
      "shake shack",
      "five guys",
      "grubhub",
      "seamless",
      "cheesecake factory",
      "goldbelly",
      "wine com",
    ],
    patterns: [],
    credit: [/\bdining credit\b/, /\b(grubhub|seamless|shake shack|five guys)\b.*\bcr(edit)?\b/],
  },
  {
    key: "resy",
    benefit: /resy/i,
    aliases: ["resy"],
    patterns: [/\bresy\b/],
    credit: [/\bresy\b.*\b(credit|cr)\b/, /\bresy credit\b/],
  },
  {
    key: "digital-entertainment",
    benefit: /digital entertainment|streaming/i,
    aliases: [
      "disney",
      "hulu",
      "espn",
      "peacock",
      "new york times",
      "audible",
      "siriusxm",
      "paramount",
      "youtube",
      "youtubepremium",
      "netflix",
      "spotify",
    ],
    patterns: [],
    credit: [/\bdigital entertainment\b/],
  },
  {
    key: "airline",
    benefit: /airline/i,
    aliases: ["delta", "united", "american airlines", "southwest", "jetblue", "alaska airlines"],
    patterns: [/\bair ?lines?\b/],
    credit: [/\bairline (fee|incidental)\b/, /\bincidental\b.*\bcredit\b/, /\bair(line)? fee (credit|reimb)/],
  },
  {
    key: "clear",
    benefit: /\bclear\b/i,
    aliases: ["clear", "clearme", "clear plus"],
    patterns: [/\bclear ?(me|plus|secure)\b/],
    credit: [/\bclear\w*\b.*\b(credit|cr)\b/],
  },
  {
    key: "walmart",
    benefit: /walmart/i,
    aliases: ["walmart", "walmart plus"],
    patterns: [/\bwalmart ?\+?\b/, /\bwm ?\+/],
    credit: [/\bwalmart\+?.*\b(credit|cr|membership)\b/],
  },
  {
    key: "hotel",
    benefit: /hotel|fine hotels|fhr|the hotel collection/i,
    aliases: ["hilton", "marriott", "hyatt", "ihg", "fine hotels resorts", "amextravel", "amex travel"],
    patterns: [/\bfine hotels\b/, /\bamex ?travel\b/],
    credit: [/\bhotel credit\b/, /\bfine hotels\b.*\bcredit\b/, /\bhotel collection\b/],
  },
  {
    key: "saks",
    benefit: /saks/i,
    aliases: ["saks", "saks fifth avenue", "saks fifth ave"],
    patterns: [/\bsaks\b/],
    credit: [/\bsaks\b.*\b(credit|cr)\b/],
  },
  {
    key: "equinox",
    benefit: /equinox/i,
    aliases: ["equinox", "soulcycle"],
    patterns: [/\bequinox\b/],
    credit: [/\bequinox\b.*\b(credit|cr)\b/],
  },
  {
    key: "global-entry",
    benefit: /global entry|precheck|tsa|trusted traveler/i,
    aliases: ["global entry", "tsa", "cbp", "nexus", "precheck"],
    patterns: [/\bglobal entry\b/, /\bcbp\b/, /\btsa ?pre/],
    credit: [/\b(global entry|tsa|cbp)\b.*\b(credit|cr|reimb\w*)\b/],
  },
  {
    key: "lululemon",
    benefit: /lululemon/i,
    aliases: ["lululemon"],
    patterns: [/\blululemon\b/],
    credit: [/\blululemon\b.*\b(credit|cr)\b/],
  },
];

/** Any Amex-style statement credit descriptor (used to classify a negative line as a credit). */
export const ISSUER_CREDIT_RES: RegExp[] = ALIAS_GROUPS.flatMap((g) => g.credit);
