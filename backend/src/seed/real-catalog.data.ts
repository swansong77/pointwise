/**
 * Curated list of real U.S. credit cards (public product facts: name, issuer, network, annual fee,
 * category earning rates). Written by the Pointwise team from general knowledge as of DATA_AS_OF — not
 * copied from any card app or aggregator database. Issuer terms change often: every card is imported
 * as catalogSource SEED and shown as "unverified" until the card-research agent or a registered issuer
 * page confirms it (admin-approved). Welcome offers are deliberately left out — they change every few
 * weeks and come only from verified issuer pages.
 *
 * Earning rates here are those that apply to a whole category anywhere; portal-only, rotating,
 * chosen-category and co-brand merchant rates are listed as features (or merchant rewards).
 * Point values (¢/pt) are Pointwise's own conservative defaults; users can override them.
 */
import { CardNetwork, CardType, CreditBand, IssuerKind } from "@prisma/client";

import {
  MORE_CARDS,
  MORE_CURRENCIES,
  MORE_ISSUERS,
  MORE_MERCHANTS,
  REGISTRY_ONLY_ISSUERS,
} from "./real-catalog.more";

export const DATA_AS_OF = "2026-06-01";

export interface RealIssuer {
  name: string;
  website: string;
  aliases: string[];
  enforcesFive24?: boolean;
  businessReportsToPersonal?: boolean;
  kind?: IssuerKind;
}

export interface RealCurrency {
  code: string;
  name: string;
  centsPerPoint: number;
  householdPooling?: boolean;
}

export interface RealMerchant {
  slug: string;
  name: string;
  category: string;
  hosts: string[];
}

export interface RealCard {
  slug: string;
  name: string;
  issuer: string;
  network: CardNetwork;
  type?: CardType;
  feeDollars: number;
  currency: string;
  foreignTxFee: boolean;
  color: string;
  productFamily?: string;
  recommendedCredit?: CreditBand;
  /** category earning: [category slug, rate, description, cap in dollars per capPeriod?] */
  rewards: Array<[string, number, string, number?, ("QUARTER" | "YEAR")?]>;
  /** co-brand merchant earning: [merchant slug, rate, description] */
  merchantRewards?: Array<[string, number, string]>;
  features: string[];
  popularity: number;
}

export const REAL_ISSUERS: RealIssuer[] = [
  {
    name: "Chase",
    website: "https://www.chase.com",
    aliases: ["JPMorgan Chase", "Chase Bank", "JPMorgan Chase Bank"],
    enforcesFive24: true,
  },
  {
    name: "American Express",
    website: "https://www.americanexpress.com",
    aliases: ["Amex", "AmEx", "AMEX"],
    kind: "CARD_COMPANY",
  },
  {
    name: "Citi",
    website: "https://www.citi.com",
    aliases: ["Citibank", "Citigroup"],
  },
  {
    name: "Capital One",
    website: "https://www.capitalone.com",
    aliases: ["CapOne", "Capital One Bank"],
    businessReportsToPersonal: true,
  },
  {
    name: "Discover",
    website: "https://www.discover.com",
    aliases: ["Discover Bank", "Discover Card"],
    businessReportsToPersonal: true,
    kind: "CARD_COMPANY",
  },
  {
    name: "Wells Fargo",
    website: "https://www.wellsfargo.com",
    aliases: ["WF", "Wells Fargo Bank"],
  },
  {
    name: "Bank of America",
    website: "https://www.bankofamerica.com",
    aliases: ["BofA", "BoA", "Bank of America N.A."],
  },
  {
    name: "U.S. Bank",
    website: "https://www.usbank.com",
    aliases: ["US Bank", "USBank", "U.S. Bancorp"],
  },
];

export const REAL_CURRENCIES: RealCurrency[] = [
  {
    code: "CHASE_UR",
    name: "Chase Ultimate Rewards",
    centsPerPoint: 1.5,
    householdPooling: true,
  },
  {
    code: "AMEX_MR",
    name: "American Express Membership Rewards",
    centsPerPoint: 1.5,
  },
  {
    code: "CITI_TYP",
    name: "Citi ThankYou Points",
    centsPerPoint: 1.4,
    householdPooling: true,
  },
  {
    code: "C1_MILES",
    name: "Capital One Miles",
    centsPerPoint: 1.4,
    householdPooling: true,
  },
  { code: "WF_REWARDS", name: "Wells Fargo Rewards", centsPerPoint: 1.0 },
  { code: "BOA_POINTS", name: "Bank of America Points", centsPerPoint: 1.0 },
  { code: "HYATT_POINTS", name: "World of Hyatt Points", centsPerPoint: 1.7 },
  {
    code: "MARRIOTT_POINTS",
    name: "Marriott Bonvoy Points",
    centsPerPoint: 0.7,
    householdPooling: true,
  },
  {
    code: "HILTON_POINTS",
    name: "Hilton Honors Points",
    centsPerPoint: 0.5,
    householdPooling: true,
  },
  {
    code: "UNITED_MILES",
    name: "United MileagePlus Miles",
    centsPerPoint: 1.2,
  },
  { code: "DELTA_MILES", name: "Delta SkyMiles", centsPerPoint: 1.1 },
];

export const REAL_MERCHANTS: RealMerchant[] = [
  {
    slug: "amazon",
    name: "Amazon",
    category: "online-shopping",
    hosts: ["amazon.com"],
  },
  {
    slug: "whole-foods-market",
    name: "Whole Foods Market",
    category: "groceries",
    hosts: ["wholefoodsmarket.com"],
  },
  {
    slug: "costco",
    name: "Costco",
    category: "wholesale-clubs",
    hosts: ["costco.com"],
  },
  { slug: "hilton", name: "Hilton", category: "hotels", hosts: ["hilton.com"] },
  {
    slug: "marriott",
    name: "Marriott",
    category: "hotels",
    hosts: ["marriott.com"],
  },
  { slug: "hyatt", name: "Hyatt", category: "hotels", hosts: ["hyatt.com"] },
  {
    slug: "united-airlines",
    name: "United Airlines",
    category: "airlines",
    hosts: ["united.com"],
  },
  {
    slug: "delta-air-lines",
    name: "Delta Air Lines",
    category: "airlines",
    hosts: ["delta.com"],
  },
];

const NAVY = "#1e3a5f";
const AMEX_BLUE = "#2671b9";
const GOLD = "#b8860b";
const SILVER = "#9ca3af";
const CITI = "#056dae";
const C1 = "#004977";
const ORANGE = "#e55b13";
const WF = "#b31e30";
const BOA = "#c41230";
const USB = "#0c2074";

export const REAL_CARDS: RealCard[] = [
  // ── Chase ──
  {
    slug: "chase-sapphire-preferred",
    name: "Chase Sapphire Preferred Card",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 95,
    currency: "CHASE_UR",
    foreignTxFee: false,
    color: NAVY,
    productFamily: "Sapphire",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["dining", 3, "3X points on dining"],
      ["streaming", 3, "3X points on select streaming services"],
      ["travel", 2, "2X points on other travel purchases"],
      ["everything-else", 1, "1X points on all other purchases"],
    ],
    features: [
      "5X points on travel booked through Chase Travel",
      "3X points on online grocery purchases (excluding Target, Walmart and wholesale clubs)",
      "Points transfer to airline and hotel partners",
      "No foreign transaction fees",
    ],
    popularity: 100,
  },
  {
    slug: "chase-sapphire-reserve",
    name: "Chase Sapphire Reserve",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 795,
    currency: "CHASE_UR",
    foreignTxFee: false,
    color: "#111827",
    productFamily: "Sapphire",
    recommendedCredit: "EXCELLENT",
    rewards: [
      ["airlines", 4, "4X points on flights booked directly with airlines"],
      ["hotels", 4, "4X points on hotels booked directly"],
      ["dining", 3, "3X points on dining"],
      ["everything-else", 1, "1X points on all other purchases"],
    ],
    features: [
      "8X points on purchases through Chase Travel",
      "Annual travel credit",
      "Airport lounge access",
      "No foreign transaction fees",
    ],
    popularity: 90,
  },
  {
    slug: "chase-freedom-unlimited",
    name: "Chase Freedom Unlimited",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 0,
    currency: "CHASE_UR",
    foreignTxFee: true,
    color: "#2563eb",
    productFamily: "Freedom",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 3, "3% cash back on dining"],
      ["drugstores", 3, "3% cash back at drugstores"],
      ["everything-else", 1.5, "1.5% cash back on all other purchases"],
    ],
    features: [
      "5% cash back on travel booked through Chase Travel",
      "Rewards earned as Ultimate Rewards points",
      "No annual fee",
    ],
    popularity: 95,
  },
  {
    slug: "chase-freedom-flex",
    name: "Chase Freedom Flex",
    issuer: "Chase",
    network: "MASTERCARD",
    feeDollars: 0,
    currency: "CHASE_UR",
    foreignTxFee: true,
    color: "#0ea5e9",
    productFamily: "Freedom",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 3, "3% cash back on dining"],
      ["drugstores", 3, "3% cash back at drugstores"],
      ["everything-else", 1, "1% cash back on all other purchases"],
    ],
    features: [
      "5% cash back in quarterly bonus categories on up to $1,500 combined (activation required)",
      "5% cash back on travel booked through Chase Travel",
      "No annual fee",
    ],
    popularity: 85,
  },
  {
    slug: "chase-ink-business-preferred",
    name: "Ink Business Preferred Credit Card",
    issuer: "Chase",
    network: "VISA",
    type: "BUSINESS",
    feeDollars: 95,
    currency: "CHASE_UR",
    foreignTxFee: false,
    color: "#1f2937",
    productFamily: "Ink",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      [
        "travel",
        3,
        "3X points on travel (combined $150,000 per year)",
        150000,
        "YEAR",
      ],
      [
        "phone-internet",
        3,
        "3X points on internet, cable and phone services (combined $150,000 per year)",
        150000,
        "YEAR",
      ],
      ["everything-else", 1, "1X points on all other purchases"],
    ],
    features: [
      "3X also on shipping and on advertising with social media sites and search engines (combined cap)",
      "Cell phone protection",
      "No foreign transaction fees",
    ],
    popularity: 70,
  },
  {
    slug: "chase-ink-business-cash",
    name: "Ink Business Cash Credit Card",
    issuer: "Chase",
    network: "VISA",
    type: "BUSINESS",
    feeDollars: 0,
    currency: "CHASE_UR",
    foreignTxFee: true,
    color: "#334155",
    productFamily: "Ink",
    recommendedCredit: "GOOD",
    rewards: [
      [
        "phone-internet",
        5,
        "5% cash back on internet, cable and phone services (combined $25,000 per year with office supply stores)",
        25000,
        "YEAR",
      ],
      [
        "gas",
        2,
        "2% cash back at gas stations (combined $25,000 per year with restaurants)",
        25000,
        "YEAR",
      ],
      [
        "dining",
        2,
        "2% cash back at restaurants (combined $25,000 per year with gas)",
        25000,
        "YEAR",
      ],
      ["everything-else", 1, "1% cash back on all other purchases"],
    ],
    features: [
      "5% cash back at office supply stores (combined cap)",
      "Employee cards at no additional cost",
      "No annual fee",
    ],
    popularity: 65,
  },
  {
    slug: "chase-ink-business-unlimited",
    name: "Ink Business Unlimited Credit Card",
    issuer: "Chase",
    network: "VISA",
    type: "BUSINESS",
    feeDollars: 0,
    currency: "CHASE_UR",
    foreignTxFee: true,
    color: "#475569",
    productFamily: "Ink",
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 1.5, "1.5% cash back on every purchase"]],
    features: ["Employee cards at no additional cost", "No annual fee"],
    popularity: 60,
  },
  {
    slug: "chase-prime-visa",
    name: "Prime Visa",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: false,
    color: "#232f3e",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 2, "2% back at restaurants"],
      ["gas", 2, "2% back at gas stations"],
      ["transit", 2, "2% back on local transit and commuting"],
      ["everything-else", 1, "1% back on all other purchases"],
    ],
    merchantRewards: [
      ["amazon", 5, "5% back at Amazon.com with an eligible Prime membership"],
      [
        "whole-foods-market",
        5,
        "5% back at Whole Foods Market with an eligible Prime membership",
      ],
    ],
    features: [
      "Requires an eligible Amazon Prime membership",
      "No annual card fee",
      "No foreign transaction fees",
    ],
    popularity: 80,
  },
  {
    slug: "chase-world-of-hyatt",
    name: "World of Hyatt Credit Card",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 95,
    currency: "HYATT_POINTS",
    foreignTxFee: false,
    color: "#5b3a29",
    productFamily: "Hyatt",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["dining", 2, "2 points per $1 at restaurants"],
      ["airlines", 2, "2 points per $1 on airline tickets purchased directly"],
      ["transit", 2, "2 points per $1 on local transit and commuting"],
      ["everything-else", 1, "1 point per $1 on all other purchases"],
    ],
    merchantRewards: [["hyatt", 4, "4 points per $1 at Hyatt hotels"]],
    features: [
      "Free night award every account anniversary",
      "Elite night credits toward World of Hyatt status",
      "No foreign transaction fees",
    ],
    popularity: 55,
  },
  {
    slug: "chase-marriott-bonvoy-boundless",
    name: "Marriott Bonvoy Boundless Credit Card",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 95,
    currency: "MARRIOTT_POINTS",
    foreignTxFee: false,
    color: "#7c2d12",
    productFamily: "Marriott Chase",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      [
        "groceries",
        3,
        "3X points at grocery stores (combined $6,000 per year with gas and dining)",
        6000,
        "YEAR",
      ],
      ["gas", 3, "3X points on gas (combined $6,000 per year)", 6000, "YEAR"],
      [
        "dining",
        3,
        "3X points on dining (combined $6,000 per year)",
        6000,
        "YEAR",
      ],
      ["everything-else", 2, "2X points on all other purchases"],
    ],
    merchantRewards: [
      [
        "marriott",
        6,
        "Up to 6X points at participating Marriott Bonvoy hotels",
      ],
    ],
    features: [
      "Free night award every account anniversary",
      "Automatic Silver Elite status",
      "No foreign transaction fees",
    ],
    popularity: 50,
  },
  {
    slug: "chase-united-explorer",
    name: "United Explorer Card",
    issuer: "Chase",
    network: "VISA",
    feeDollars: 150,
    currency: "UNITED_MILES",
    foreignTxFee: false,
    color: "#1d4ed8",
    productFamily: "United",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["dining", 2, "2 miles per $1 on dining"],
      ["hotels", 2, "2 miles per $1 on hotel stays"],
      ["everything-else", 1, "1 mile per $1 on all other purchases"],
    ],
    merchantRewards: [
      ["united-airlines", 2, "2 miles per $1 on United purchases"],
    ],
    features: [
      "Free first checked bag on United flights",
      "Priority boarding",
      "No foreign transaction fees",
    ],
    popularity: 45,
  },
  // ── American Express ──
  {
    slug: "amex-platinum",
    name: "The Platinum Card from American Express",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 895,
    currency: "AMEX_MR",
    foreignTxFee: false,
    color: "#9ca3af",
    productFamily: "Amex Platinum",
    recommendedCredit: "EXCELLENT",
    rewards: [
      [
        "airlines",
        5,
        "5X points on flights booked directly with airlines (up to $500,000 per year)",
        500000,
        "YEAR",
      ],
      ["everything-else", 1, "1X points on other purchases"],
    ],
    features: [
      "5X points on prepaid hotels booked with American Express Travel",
      "Airport lounge access (Global Lounge Collection)",
      "Statement credits for travel, dining, entertainment and more (enrollment required)",
      "No foreign transaction fees",
    ],
    popularity: 95,
  },
  {
    slug: "amex-gold",
    name: "American Express Gold Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 325,
    currency: "AMEX_MR",
    foreignTxFee: false,
    color: GOLD,
    productFamily: "Amex Gold",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      [
        "dining",
        4,
        "4X points at restaurants worldwide (up to $50,000 per year)",
        50000,
        "YEAR",
      ],
      [
        "groceries",
        4,
        "4X points at U.S. supermarkets (up to $25,000 per year)",
        25000,
        "YEAR",
      ],
      ["airlines", 3, "3X points on flights booked directly with airlines"],
      ["everything-else", 1, "1X points on other purchases"],
    ],
    features: [
      "Dining and Uber Cash statement credits (enrollment required)",
      "No foreign transaction fees",
    ],
    popularity: 92,
  },
  {
    slug: "amex-green",
    name: "American Express Green Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 150,
    currency: "AMEX_MR",
    foreignTxFee: false,
    color: "#15803d",
    productFamily: "Amex Green",
    recommendedCredit: "GOOD",
    rewards: [
      ["travel", 3, "3X points on travel"],
      ["transit", 3, "3X points on transit"],
      ["dining", 3, "3X points at restaurants worldwide"],
      ["everything-else", 1, "1X points on other purchases"],
    ],
    features: ["No foreign transaction fees"],
    popularity: 40,
  },
  {
    slug: "amex-blue-cash-preferred",
    name: "Blue Cash Preferred Card from American Express",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 95,
    currency: "CASH",
    foreignTxFee: true,
    color: AMEX_BLUE,
    productFamily: "Blue Cash",
    recommendedCredit: "GOOD",
    rewards: [
      [
        "groceries",
        6,
        "6% cash back at U.S. supermarkets (up to $6,000 per year)",
        6000,
        "YEAR",
      ],
      ["streaming", 6, "6% cash back on select U.S. streaming subscriptions"],
      ["transit", 3, "3% cash back on transit"],
      ["gas", 3, "3% cash back at U.S. gas stations"],
      ["everything-else", 1, "1% cash back on other purchases"],
    ],
    features: [
      "Cash back received as Reward Dollars redeemable for statement credits",
    ],
    popularity: 75,
  },
  {
    slug: "amex-blue-cash-everyday",
    name: "Blue Cash Everyday Card from American Express",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: "#60a5fa",
    productFamily: "Blue Cash",
    recommendedCredit: "GOOD",
    rewards: [
      [
        "groceries",
        3,
        "3% cash back at U.S. supermarkets (up to $6,000 per year)",
        6000,
        "YEAR",
      ],
      [
        "online-shopping",
        3,
        "3% cash back on U.S. online retail purchases (up to $6,000 per year)",
        6000,
        "YEAR",
      ],
      [
        "gas",
        3,
        "3% cash back at U.S. gas stations (up to $6,000 per year)",
        6000,
        "YEAR",
      ],
      ["everything-else", 1, "1% cash back on other purchases"],
    ],
    features: ["No annual fee"],
    popularity: 60,
  },
  {
    slug: "amex-blue-business-plus",
    name: "The Blue Business Plus Credit Card from American Express",
    issuer: "American Express",
    network: "AMEX",
    type: "BUSINESS",
    feeDollars: 0,
    currency: "AMEX_MR",
    foreignTxFee: true,
    color: "#1e40af",
    recommendedCredit: "GOOD",
    rewards: [
      [
        "everything-else",
        2,
        "2X points on everyday business purchases (first $50,000 per year, then 1X)",
        50000,
        "YEAR",
      ],
    ],
    features: ["No annual fee"],
    popularity: 50,
  },
  {
    slug: "amex-business-gold",
    name: "American Express Business Gold Card",
    issuer: "American Express",
    network: "AMEX",
    type: "BUSINESS",
    feeDollars: 375,
    currency: "AMEX_MR",
    foreignTxFee: false,
    color: "#a16207",
    recommendedCredit: "VERY_GOOD",
    rewards: [["everything-else", 1, "1X points on other purchases"]],
    features: [
      "4X points in the two eligible categories where the business spends the most each month (up to $150,000 combined per year)",
      "No foreign transaction fees",
    ],
    popularity: 45,
  },
  {
    slug: "amex-business-platinum",
    name: "The Business Platinum Card from American Express",
    issuer: "American Express",
    network: "AMEX",
    type: "BUSINESS",
    feeDollars: 895,
    currency: "AMEX_MR",
    foreignTxFee: false,
    color: "#6b7280",
    recommendedCredit: "EXCELLENT",
    rewards: [["everything-else", 1, "1X points on other purchases"]],
    features: [
      "5X points on flights and prepaid hotels booked with American Express Travel",
      "Extra points on purchases of $5,000 or more and in select business categories",
      "Airport lounge access",
      "No foreign transaction fees",
    ],
    popularity: 40,
  },
  {
    slug: "amex-hilton-honors",
    name: "Hilton Honors American Express Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 0,
    currency: "HILTON_POINTS",
    foreignTxFee: false,
    color: "#0b3d91",
    productFamily: "Hilton Amex",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 5, "5X points at U.S. restaurants"],
      ["groceries", 5, "5X points at U.S. supermarkets"],
      ["gas", 5, "5X points at U.S. gas stations"],
      ["everything-else", 3, "3X points on other purchases"],
    ],
    merchantRewards: [["hilton", 7, "7X points on Hilton purchases"]],
    features: [
      "Complimentary Hilton Honors Silver status",
      "No annual fee",
      "No foreign transaction fees",
    ],
    popularity: 45,
  },
  {
    slug: "amex-hilton-surpass",
    name: "Hilton Honors American Express Surpass Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 150,
    currency: "HILTON_POINTS",
    foreignTxFee: false,
    color: "#1e3a8a",
    productFamily: "Hilton Amex",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["dining", 6, "6X points at U.S. restaurants"],
      ["groceries", 6, "6X points at U.S. supermarkets"],
      ["gas", 6, "6X points at U.S. gas stations"],
      ["online-shopping", 4, "4X points on U.S. online retail purchases"],
      ["everything-else", 3, "3X points on other purchases"],
    ],
    merchantRewards: [["hilton", 12, "12X points on Hilton purchases"]],
    features: [
      "Complimentary Hilton Honors Gold status",
      "No foreign transaction fees",
    ],
    popularity: 40,
  },
  {
    slug: "amex-delta-gold",
    name: "Delta SkyMiles Gold American Express Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 150,
    currency: "DELTA_MILES",
    foreignTxFee: false,
    color: "#9a3412",
    productFamily: "Delta Amex",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 2, "2X miles at restaurants worldwide"],
      ["groceries", 2, "2X miles at U.S. supermarkets"],
      ["everything-else", 1, "1X miles on other purchases"],
    ],
    merchantRewards: [["delta-air-lines", 2, "2X miles on Delta purchases"]],
    features: [
      "First checked bag free on Delta flights",
      "No foreign transaction fees",
    ],
    popularity: 45,
  },
  {
    slug: "amex-marriott-bonvoy-brilliant",
    name: "Marriott Bonvoy Brilliant American Express Card",
    issuer: "American Express",
    network: "AMEX",
    feeDollars: 650,
    currency: "MARRIOTT_POINTS",
    foreignTxFee: false,
    color: "#3f3f46",
    productFamily: "Marriott Amex",
    recommendedCredit: "EXCELLENT",
    rewards: [
      ["dining", 3, "3X points at restaurants worldwide"],
      ["airlines", 3, "3X points on flights booked directly with airlines"],
      ["everything-else", 2, "2X points on other purchases"],
    ],
    merchantRewards: [
      ["marriott", 6, "6X points at participating Marriott Bonvoy hotels"],
    ],
    features: [
      "Annual free night award",
      "Complimentary Marriott Bonvoy Platinum Elite status",
      "No foreign transaction fees",
    ],
    popularity: 30,
  },
  // ── Citi ──
  {
    slug: "citi-double-cash",
    name: "Citi Double Cash Card",
    issuer: "Citi",
    network: "MASTERCARD",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: CITI,
    recommendedCredit: "GOOD",
    rewards: [
      [
        "everything-else",
        2,
        "2% cash back: 1% when you buy plus 1% as you pay",
      ],
    ],
    features: ["No annual fee"],
    popularity: 85,
  },
  {
    slug: "citi-custom-cash",
    name: "Citi Custom Cash Card",
    issuer: "Citi",
    network: "MASTERCARD",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: "#0369a1",
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 1, "1% cash back on other purchases"]],
    features: [
      "5% cash back in your top eligible spend category each billing cycle (up to $500 spent)",
      "No annual fee",
    ],
    popularity: 70,
  },
  {
    slug: "citi-strata-premier",
    name: "Citi Strata Premier Card",
    issuer: "Citi",
    network: "MASTERCARD",
    feeDollars: 95,
    currency: "CITI_TYP",
    foreignTxFee: false,
    color: "#0c4a6e",
    productFamily: "Strata",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["airlines", 3, "3X points on air travel"],
      ["hotels", 3, "3X points on hotels"],
      ["dining", 3, "3X points at restaurants"],
      ["groceries", 3, "3X points at supermarkets"],
      ["gas", 3, "3X points at gas and EV charging stations"],
      ["everything-else", 1, "1X points on all other purchases"],
    ],
    features: [
      "10X points on hotels, car rentals and attractions booked through Citi Travel",
      "Points transfer to airline and hotel partners",
      "No foreign transaction fees",
    ],
    popularity: 60,
  },
  {
    slug: "citi-costco-anywhere",
    name: "Costco Anywhere Visa Card by Citi",
    issuer: "Citi",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: false,
    color: "#005daa",
    recommendedCredit: "GOOD",
    rewards: [
      [
        "gas",
        4,
        "4% cash back on eligible gas and EV charging (up to $7,000 per year, then 1%)",
        7000,
        "YEAR",
      ],
      ["dining", 3, "3% cash back at restaurants"],
      ["travel", 3, "3% cash back on eligible travel"],
      ["everything-else", 1, "1% cash back on all other purchases"],
    ],
    merchantRewards: [["costco", 2, "2% cash back at Costco and Costco.com"]],
    features: [
      "Requires a Costco membership",
      "Cash back paid once a year as a reward certificate",
      "No foreign transaction fees",
    ],
    popularity: 65,
  },
  // ── Capital One ──
  {
    slug: "capital-one-venture-x",
    name: "Capital One Venture X Rewards Credit Card",
    issuer: "Capital One",
    network: "VISA",
    feeDollars: 395,
    currency: "C1_MILES",
    foreignTxFee: false,
    color: "#0f172a",
    productFamily: "Venture",
    recommendedCredit: "EXCELLENT",
    rewards: [["everything-else", 2, "2X miles on every purchase"]],
    features: [
      "10X miles on hotels and rental cars and 5X on flights booked through Capital One Travel",
      "Annual travel credit for Capital One Travel bookings",
      "Airport lounge access",
      "No foreign transaction fees",
    ],
    popularity: 85,
  },
  {
    slug: "capital-one-venture",
    name: "Capital One Venture Rewards Credit Card",
    issuer: "Capital One",
    network: "VISA",
    feeDollars: 95,
    currency: "C1_MILES",
    foreignTxFee: false,
    color: C1,
    productFamily: "Venture",
    recommendedCredit: "VERY_GOOD",
    rewards: [["everything-else", 2, "2X miles on every purchase"]],
    features: [
      "5X miles on hotels and rental cars booked through Capital One Travel",
      "Miles transfer to airline and hotel partners",
      "No foreign transaction fees",
    ],
    popularity: 75,
  },
  {
    slug: "capital-one-savor",
    name: "Capital One Savor Cash Rewards Credit Card",
    issuer: "Capital One",
    network: "MASTERCARD",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: false,
    color: "#b91c1c",
    productFamily: "Savor",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["dining", 3, "3% cash back on dining"],
      ["entertainment", 3, "3% cash back on entertainment"],
      ["streaming", 3, "3% cash back on popular streaming services"],
      [
        "groceries",
        3,
        "3% cash back at grocery stores (excluding superstores like Walmart and Target)",
      ],
      ["everything-else", 1, "1% cash back on all other purchases"],
    ],
    features: ["No annual fee", "No foreign transaction fees"],
    popularity: 70,
  },
  {
    slug: "capital-one-quicksilver",
    name: "Capital One Quicksilver Cash Rewards Credit Card",
    issuer: "Capital One",
    network: "MASTERCARD",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: false,
    color: SILVER,
    productFamily: "Quicksilver",
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 1.5, "1.5% cash back on every purchase"]],
    features: ["No annual fee", "No foreign transaction fees"],
    popularity: 65,
  },
  {
    slug: "capital-one-spark-cash-plus",
    name: "Capital One Spark Cash Plus",
    issuer: "Capital One",
    network: "MASTERCARD",
    type: "BUSINESS",
    feeDollars: 150,
    currency: "CASH",
    foreignTxFee: false,
    color: "#1e293b",
    productFamily: "Spark",
    recommendedCredit: "VERY_GOOD",
    rewards: [["everything-else", 2, "2% cash back on every purchase"]],
    features: [
      "Charge card: balance due in full each month",
      "No foreign transaction fees",
    ],
    popularity: 40,
  },
  // ── Discover ──
  {
    slug: "discover-it-cash-back",
    name: "Discover it Cash Back",
    issuer: "Discover",
    network: "DISCOVER",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: false,
    color: ORANGE,
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 1, "1% cash back on all other purchases"]],
    features: [
      "5% cash back in quarterly categories up to the quarterly maximum (activation required)",
      "Cashback Match for new cardmembers at the end of the first year",
      "No annual fee",
      "No foreign transaction fees",
    ],
    popularity: 75,
  },
  // ── Wells Fargo ──
  {
    slug: "wells-fargo-active-cash",
    name: "Wells Fargo Active Cash Card",
    issuer: "Wells Fargo",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: WF,
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 2, "Unlimited 2% cash rewards on purchases"]],
    features: ["Cell phone protection", "No annual fee"],
    popularity: 75,
  },
  {
    slug: "wells-fargo-autograph",
    name: "Wells Fargo Autograph Card",
    issuer: "Wells Fargo",
    network: "VISA",
    feeDollars: 0,
    currency: "WF_REWARDS",
    foreignTxFee: false,
    color: "#7f1d1d",
    productFamily: "Autograph",
    recommendedCredit: "GOOD",
    rewards: [
      ["dining", 3, "3X points at restaurants"],
      ["travel", 3, "3X points on travel"],
      ["gas", 3, "3X points at gas stations"],
      ["transit", 3, "3X points on transit"],
      ["streaming", 3, "3X points on popular streaming services"],
      ["phone-internet", 3, "3X points on phone plans"],
      ["everything-else", 1, "1X points on other purchases"],
    ],
    features: ["No annual fee", "No foreign transaction fees"],
    popularity: 55,
  },
  // ── Bank of America ──
  {
    slug: "boa-customized-cash-rewards",
    name: "Bank of America Customized Cash Rewards Credit Card",
    issuer: "Bank of America",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: BOA,
    recommendedCredit: "GOOD",
    rewards: [
      [
        "groceries",
        2,
        "2% cash back at grocery stores (combined $2,500 per quarter with the choice category and wholesale clubs)",
        2500,
        "QUARTER",
      ],
      [
        "wholesale-clubs",
        2,
        "2% cash back at wholesale clubs (combined $2,500 per quarter)",
        2500,
        "QUARTER",
      ],
      ["everything-else", 1, "1% cash back on all other purchases"],
    ],
    features: [
      "3% cash back in a category you choose (combined $2,500 per quarter)",
      "Preferred Rewards members can earn more",
      "No annual fee",
    ],
    popularity: 55,
  },
  {
    slug: "boa-unlimited-cash-rewards",
    name: "Bank of America Unlimited Cash Rewards Credit Card",
    issuer: "Bank of America",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: "#991b1b",
    recommendedCredit: "GOOD",
    rewards: [["everything-else", 1.5, "1.5% cash back on all purchases"]],
    features: ["Preferred Rewards members can earn more", "No annual fee"],
    popularity: 45,
  },
  {
    slug: "boa-premium-rewards",
    name: "Bank of America Premium Rewards Credit Card",
    issuer: "Bank of America",
    network: "VISA",
    feeDollars: 95,
    currency: "BOA_POINTS",
    foreignTxFee: false,
    color: "#1f2937",
    recommendedCredit: "VERY_GOOD",
    rewards: [
      ["travel", 2, "2 points per $1 on travel"],
      ["dining", 2, "2 points per $1 on dining"],
      ["everything-else", 1.5, "1.5 points per $1 on all other purchases"],
    ],
    features: [
      "Airline incidental and TSA PreCheck/Global Entry credits",
      "No foreign transaction fees",
    ],
    popularity: 35,
  },
  // ── U.S. Bank ──
  {
    slug: "us-bank-cash-plus",
    name: "U.S. Bank Cash+ Visa Signature Card",
    issuer: "U.S. Bank",
    network: "VISA",
    feeDollars: 0,
    currency: "CASH",
    foreignTxFee: true,
    color: USB,
    recommendedCredit: "GOOD",
    rewards: [
      ["everything-else", 1, "1% cash back on all other eligible purchases"],
    ],
    features: [
      "5% cash back on two categories you choose each quarter (first $2,000 combined)",
      "2% cash back on one everyday category you choose",
      "No annual fee",
    ],
    popularity: 40,
  },
];

// ── the rest of the lineups, co-brand issuers and credit unions (real-catalog.more.ts) ──
REAL_ISSUERS.push(...MORE_ISSUERS);
REAL_CURRENCIES.push(...MORE_CURRENCIES);
REAL_MERCHANTS.push(...MORE_MERCHANTS);
REAL_CARDS.push(...MORE_CARDS);

/** Every institution the catalog should cover: issuers with curated cards plus banks / credit unions the research agent works through. */
export const ISSUER_REGISTRY: RealIssuer[] = [
  ...REAL_ISSUERS,
  ...REGISTRY_ONLY_ISSUERS,
];
