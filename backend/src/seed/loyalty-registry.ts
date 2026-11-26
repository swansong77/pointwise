import { PrismaClient } from "@prisma/client";

/**
 * Loyalty program registry: airline, hotel and other programs, bank reward currencies, their expiration policies
 * and the bank → program transfer routes. Hand-written reference data with NO claim of verification: every policy
 * is stored as policyVerified=false, source "general knowledge", and the app shows the confidence that implies.
 * Members can override the expiry date per account, and admins can correct a program. Valuations (¢ per point)
 * are planning estimates, not published prices.
 */
type Kind = "AIRLINE" | "HOTEL" | "SHOPPING" | "DINING" | "CRUISE" | "RENTAL_CAR" | "CASINO" | "RETAIL" | "OTHER";
type Policy = "NEVER" | "ACTIVITY" | "FIXED" | "WHILE_CARD_OPEN" | "UNKNOWN";

export interface RegistryProgram {
  code: string;
  name: string;
  kind: Kind;
  cpp: number;
  policy: Policy;
  months?: number;
  resets?: string[];
  note?: string;
  transferable?: boolean;
}

const ANY = ["EARN", "CARD_SPEND", "PORTAL", "DINING", "PARTNER", "PURCHASE", "TRANSFER"];
const HOTEL_ANY = ["STAY", "EARN", "CARD_SPEND", "PORTAL", "PARTNER", "PURCHASE", "TRANSFER"];
const SOURCE = "General knowledge (2026-11); not verified against the program's current terms. Confirm before relying on it.";

export const REGISTRY_PROGRAMS: RegistryProgram[] = [
  // airlines
  { code: "AA_AADVANTAGE", name: "American Airlines AAdvantage", kind: "AIRLINE", cpp: 1.5, policy: "ACTIVITY", months: 18, resets: ANY },
  { code: "UA_MILEAGEPLUS", name: "United MileagePlus", kind: "AIRLINE", cpp: 1.3, policy: "NEVER" },
  { code: "DL_SKYMILES", name: "Delta SkyMiles", kind: "AIRLINE", cpp: 1.2, policy: "NEVER" },
  { code: "WN_RAPIDREWARDS", name: "Southwest Rapid Rewards", kind: "AIRLINE", cpp: 1.4, policy: "NEVER" },
  { code: "AS_MILEAGEPLAN", name: "Alaska Mileage Plan", kind: "AIRLINE", cpp: 1.5, policy: "NEVER" },
  { code: "B6_TRUEBLUE", name: "JetBlue TrueBlue", kind: "AIRLINE", cpp: 1.3, policy: "UNKNOWN" },
  { code: "AC_AEROPLAN", name: "Air Canada Aeroplan", kind: "AIRLINE", cpp: 1.5, policy: "ACTIVITY", months: 12, resets: ANY },
  { code: "BA_AVIOS", name: "British Airways Executive Club", kind: "AIRLINE", cpp: 1.4, policy: "ACTIVITY", months: 36, resets: ANY },
  { code: "VS_FLYINGCLUB", name: "Virgin Atlantic Flying Club", kind: "AIRLINE", cpp: 1.4, policy: "ACTIVITY", months: 36, resets: ANY },
  { code: "EK_SKYWARDS", name: "Emirates Skywards", kind: "AIRLINE", cpp: 1.0, policy: "UNKNOWN" },
  { code: "SQ_KRISFLYER", name: "Singapore KrisFlyer", kind: "AIRLINE", cpp: 1.5, policy: "UNKNOWN" },
  { code: "AF_FLYINGBLUE", name: "Flying Blue (Air France-KLM)", kind: "AIRLINE", cpp: 1.3, policy: "ACTIVITY", months: 24, resets: ANY },
  { code: "QR_PRIVILEGE", name: "Qatar Privilege Club", kind: "AIRLINE", cpp: 1.3, policy: "UNKNOWN" },
  { code: "EY_GUEST", name: "Etihad Guest", kind: "AIRLINE", cpp: 1.2, policy: "UNKNOWN" },
  { code: "HA_HAWAIIANMILES", name: "HawaiianMiles", kind: "AIRLINE", cpp: 1.0, policy: "UNKNOWN" },
  // hotels
  { code: "MAR_BONVOY", name: "Marriott Bonvoy", kind: "HOTEL", cpp: 0.8, policy: "ACTIVITY", months: 24, resets: HOTEL_ANY },
  { code: "HH_HONORS", name: "Hilton Honors", kind: "HOTEL", cpp: 0.5, policy: "ACTIVITY", months: 15, resets: HOTEL_ANY },
  { code: "WOH_HYATT", name: "World of Hyatt", kind: "HOTEL", cpp: 1.7, policy: "ACTIVITY", months: 24, resets: HOTEL_ANY },
  { code: "IHG_ONE", name: "IHG One Rewards", kind: "HOTEL", cpp: 0.6, policy: "ACTIVITY", months: 12, resets: HOTEL_ANY },
  { code: "WYN_REWARDS", name: "Wyndham Rewards", kind: "HOTEL", cpp: 1.1, policy: "UNKNOWN" },
  { code: "CHOICE_PRIV", name: "Choice Privileges", kind: "HOTEL", cpp: 0.6, policy: "UNKNOWN" },
  { code: "BW_REWARDS", name: "Best Western Rewards", kind: "HOTEL", cpp: 0.6, policy: "UNKNOWN" },
  { code: "ACCOR_ALL", name: "Accor Live Limitless", kind: "HOTEL", cpp: 2.0, policy: "UNKNOWN" },
  // miscellaneous
  { code: "RAKUTEN", name: "Rakuten", kind: "SHOPPING", cpp: 1.0, policy: "UNKNOWN", note: "Cash back; paid out quarterly." },
  { code: "SHOP_PORTAL", name: "Shopping portal (other)", kind: "SHOPPING", cpp: 1.0, policy: "UNKNOWN" },
  { code: "DINING_PROGRAM", name: "Dining rewards program (other)", kind: "DINING", cpp: 1.0, policy: "UNKNOWN" },
  { code: "CRUISE_PROGRAM", name: "Cruise loyalty program (other)", kind: "CRUISE", cpp: 1.0, policy: "UNKNOWN" },
  { code: "RENTAL_PROGRAM", name: "Rental car program (other)", kind: "RENTAL_CAR", cpp: 1.0, policy: "UNKNOWN" },
  { code: "CASINO_PROGRAM", name: "Casino rewards (other)", kind: "CASINO", cpp: 1.0, policy: "UNKNOWN" },
  { code: "RETAIL_REWARDS", name: "Retail rewards (other)", kind: "RETAIL", cpp: 1.0, policy: "UNKNOWN" },
];

export interface RegistryCurrency {
  code: string;
  name: string;
  cpp: number;
  policy: Policy;
  note?: string;
  /** create it when the real catalog did not */
  create?: boolean;
}

export const REGISTRY_CURRENCIES: RegistryCurrency[] = [
  { code: "AMEX_MR", name: "American Express Membership Rewards", cpp: 1.5, policy: "WHILE_CARD_OPEN" },
  { code: "CHASE_UR", name: "Chase Ultimate Rewards", cpp: 1.5, policy: "WHILE_CARD_OPEN" },
  { code: "C1_MILES", name: "Capital One Miles", cpp: 1.4, policy: "WHILE_CARD_OPEN" },
  { code: "CITI_TYP", name: "Citi ThankYou Rewards", cpp: 1.4, policy: "WHILE_CARD_OPEN" },
  { code: "BILT_POINTS", name: "Bilt Rewards", cpp: 1.5, policy: "UNKNOWN", create: true },
  { code: "WF_REWARDS", name: "Wells Fargo Rewards", cpp: 1.0, policy: "UNKNOWN" },
  { code: "BOA_POINTS", name: "Bank of America Rewards", cpp: 1.0, policy: "UNKNOWN" },
  { code: "USB_REWARDS", name: "US Bank Rewards", cpp: 1.0, policy: "UNKNOWN", create: true },
];

/** [bank currency, program, ratioFrom, ratioTo] — routes and ratios from general knowledge; confirm in the bank's portal. */
export const REGISTRY_TRANSFERS: Array<[string, string, number, number]> = [
  ["AMEX_MR", "HH_HONORS", 1, 2],
  ["AMEX_MR", "MAR_BONVOY", 1, 1],
  ["AMEX_MR", "DL_SKYMILES", 1, 1],
  ["AMEX_MR", "BA_AVIOS", 1, 1],
  ["AMEX_MR", "AC_AEROPLAN", 1, 1],
  ["AMEX_MR", "AF_FLYINGBLUE", 1, 1],
  ["AMEX_MR", "SQ_KRISFLYER", 1, 1],
  ["AMEX_MR", "VS_FLYINGCLUB", 1, 1],
  ["AMEX_MR", "EY_GUEST", 1, 1],
  ["AMEX_MR", "QR_PRIVILEGE", 1, 1],
  ["CHASE_UR", "WOH_HYATT", 1, 1],
  ["CHASE_UR", "UA_MILEAGEPLUS", 1, 1],
  ["CHASE_UR", "WN_RAPIDREWARDS", 1, 1],
  ["CHASE_UR", "MAR_BONVOY", 1, 1],
  ["CHASE_UR", "IHG_ONE", 1, 1],
  ["CHASE_UR", "BA_AVIOS", 1, 1],
  ["CHASE_UR", "AC_AEROPLAN", 1, 1],
  ["CHASE_UR", "AF_FLYINGBLUE", 1, 1],
  ["CHASE_UR", "SQ_KRISFLYER", 1, 1],
  ["CHASE_UR", "VS_FLYINGCLUB", 1, 1],
  ["CHASE_UR", "EK_SKYWARDS", 1, 1],
  ["CHASE_UR", "B6_TRUEBLUE", 1, 1],
  ["C1_MILES", "AC_AEROPLAN", 1, 1],
  ["C1_MILES", "BA_AVIOS", 1, 1],
  ["C1_MILES", "AF_FLYINGBLUE", 1, 1],
  ["C1_MILES", "SQ_KRISFLYER", 1, 1],
  ["C1_MILES", "QR_PRIVILEGE", 1, 1],
  ["C1_MILES", "EY_GUEST", 1, 1],
  ["C1_MILES", "EK_SKYWARDS", 1, 1],
  ["C1_MILES", "VS_FLYINGCLUB", 1, 1],
  ["C1_MILES", "WYN_REWARDS", 1, 1],
  ["C1_MILES", "CHOICE_PRIV", 1, 1],
  ["C1_MILES", "ACCOR_ALL", 2, 1],
  ["CITI_TYP", "SQ_KRISFLYER", 1, 1],
  ["CITI_TYP", "QR_PRIVILEGE", 1, 1],
  ["CITI_TYP", "VS_FLYINGCLUB", 1, 1],
  ["CITI_TYP", "AF_FLYINGBLUE", 1, 1],
  ["CITI_TYP", "EY_GUEST", 1, 1],
  ["CITI_TYP", "EK_SKYWARDS", 1, 1],
  ["CITI_TYP", "B6_TRUEBLUE", 1, 1],
  ["CITI_TYP", "WYN_REWARDS", 1, 1],
  ["BILT_POINTS", "WOH_HYATT", 1, 1],
  ["BILT_POINTS", "UA_MILEAGEPLUS", 1, 1],
  ["BILT_POINTS", "AA_AADVANTAGE", 1, 1],
  ["BILT_POINTS", "AC_AEROPLAN", 1, 1],
  ["BILT_POINTS", "IHG_ONE", 1, 1],
  ["BILT_POINTS", "HH_HONORS", 1, 1],
  ["BILT_POINTS", "MAR_BONVOY", 1, 1],
  ["BILT_POINTS", "AS_MILEAGEPLAN", 1, 1],
  ["BILT_POINTS", "AF_FLYINGBLUE", 1, 1],
  ["BILT_POINTS", "VS_FLYINGCLUB", 1, 1],
  ["BILT_POINTS", "EK_SKYWARDS", 1, 1],
];

export const TRANSFER_NOTE = "Ratio from general knowledge; confirm in the bank's transfer portal.";

/** Idempotent. Never overwrites a program, currency or route an admin has edited. */
export async function applyLoyaltyRegistry(prisma: PrismaClient): Promise<{ programs: number; currencies: number; transfers: number }> {
  const out = { programs: 0, currencies: 0, transfers: 0 };
  const policy = (p: { policy: Policy; months?: number; resets?: string[]; note?: string }) => ({
    policyType: p.policy,
    policyMonths: p.months ?? null,
    resetConditions: p.resets ?? [],
    policyNote: p.note ?? null,
    policySource: SOURCE,
    policyVerified: false,
  });
  const programIds = new Map<string, string>();
  for (const p of REGISTRY_PROGRAMS) {
    const existing = await prisma.loyaltyProgram.findUnique({ where: { code: p.code } });
    if (existing) {
      programIds.set(p.code, existing.id);
      continue;
    }
    const row = await prisma.loyaltyProgram.create({ data: { code: p.code, name: p.name, kind: p.kind, centsPerPoint: p.cpp, transferable: !!p.transferable, ...policy(p) } });
    programIds.set(p.code, row.id);
    out.programs++;
  }
  const currencyIds = new Map<string, string>();
  for (const c of REGISTRY_CURRENCIES) {
    let row = await prisma.rewardCurrency.findUnique({ where: { code: c.code } });
    if (!row && c.create) {
      row = await prisma.rewardCurrency.create({ data: { code: c.code, name: c.name, centsPerPoint: c.cpp, householdPooling: false, ...policy(c) } });
      out.currencies++;
    } else if (row && row.policyType === "UNKNOWN" && !row.policyVerified && c.policy !== "UNKNOWN") {
      await prisma.rewardCurrency.update({ where: { id: row.id }, data: policy(c) });
    }
    if (row) currencyIds.set(c.code, row.id);
  }
  for (const [cur, prog, from, to] of REGISTRY_TRANSFERS) {
    const currencyId = currencyIds.get(cur);
    const programId = programIds.get(prog);
    if (!currencyId || !programId) continue;
    const exists = await prisma.transferPartner.findUnique({ where: { currencyId_programId: { currencyId, programId } } });
    if (exists) continue;
    await prisma.transferPartner.create({ data: { currencyId, programId, ratioFrom: from, ratioTo: to, transferDays: 0, bonusPercent: 0, notes: TRANSFER_NOTE } });
    out.transfers++;
  }
  return out;
}
