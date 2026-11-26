import { PrismaClient } from "@prisma/client";

/**
 * Canonical merchant identities: the names a merchant appears under on statements, its MCC codes, parent
 * company and industry. Hand-written reference data (no third-party dataset). Applied to existing merchants by
 * slug and used to create missing ones. See docs/merchant-offer-platform.md.
 */
export interface MerchantIdentitySeed {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  mcc: string[];
  parent?: string;
  industry: string;
  hosts: string[];
}

const m = (
  slug: string,
  name: string,
  category: string,
  industry: string,
  hosts: string[],
  aliases: string[],
  mcc: string[],
  parent?: string,
): MerchantIdentitySeed => ({ slug, name, category, industry, hosts, aliases, mcc, parent });

export const MERCHANT_IDENTITIES: MerchantIdentitySeed[] = [
  m("amazon", "Amazon", "online-shopping", "Retail", ["amazon.com"], ["AMZN", "AMZN MKTP", "AMZN MKTPLACE", "AMAZON MKTPLACE", "AMAZON MARKETPLACE", "AMZN DIGITAL", "AMAZON DIGITAL", "AMZN PRIME", "AMAZON PRIME", "AMAZON.COM"], ["5942", "5999", "5311", "4816"], "Amazon.com, Inc."),
  m("whole-foods-market", "Whole Foods Market", "groceries", "Grocery", ["wholefoodsmarket.com"], ["WFM", "WHOLEFDS", "WHOLE FOODS"], ["5411"], "Amazon.com, Inc."),
  m("uber", "Uber", "transit", "Rideshare", ["uber.com"], ["UBER TRIP", "UBER*TRIP", "UBR TECHNOLOGIES", "UBER TECHNOLOGIES", "UBER ONE", "UBER* ONE"], ["4121"], "Uber Technologies, Inc."),
  m("uber-eats", "Uber Eats", "dining", "Food delivery", ["ubereats.com"], ["UBER EATS", "UBER*EATS", "UBEREATS"], ["5812", "5814"], "Uber Technologies, Inc."),
  m("lyft", "Lyft", "transit", "Rideshare", ["lyft.com"], ["LYFT RIDE", "LYFT*"], ["4121"], "Lyft, Inc."),
  m("doordash", "DoorDash", "dining", "Food delivery", ["doordash.com"], ["DOORDASH*", "DD *DOORDASH", "DASHPASS"], ["5812", "5814"], "DoorDash, Inc."),
  m("grubhub", "Grubhub", "dining", "Food delivery", ["grubhub.com"], ["GRUBHUB*", "SEAMLESS", "SEAMLESS.COM"], ["5812", "5814"], "Just Eat Takeaway"),
  m("instacart", "Instacart", "groceries", "Grocery delivery", ["instacart.com"], ["INSTACART*", "MAPLEBEAR"], ["5411", "5499"], "Maplebear Inc."),
  m("costco", "Costco", "wholesale-clubs", "Warehouse club", ["costco.com"], ["COSTCO WHSE", "COSTCO WHOLESALE", "COSTCO GAS", "WWW COSTCO COM"], ["5300", "5411", "5541"], "Costco Wholesale Corporation"),
  m("walmart", "Walmart", "groceries", "Retail", ["walmart.com"], ["WAL-MART", "WALMART.COM", "WM SUPERCENTER", "WALMART+", "WALMART PLUS", "WAL MART"], ["5311", "5411", "5310"], "Walmart Inc."),
  m("target", "Target", "online-shopping", "Retail", ["target.com"], ["TARGET T-", "TARGET.COM", "TARGET STORE"], ["5310", "5311", "5411"], "Target Corporation"),
  m("home-depot", "The Home Depot", "home-improvement", "Home improvement", ["homedepot.com"], ["HOME DEPOT", "THE HOME DEPOT", "HOMEDEPOT.COM"], ["5200", "5211"], "The Home Depot, Inc."),
  m("lowes", "Lowe's", "home-improvement", "Home improvement", ["lowes.com"], ["LOWES", "LOWE'S"], ["5200", "5211"], "Lowe's Companies, Inc."),
  m("best-buy", "Best Buy", "online-shopping", "Electronics", ["bestbuy.com"], ["BESTBUY", "BEST BUY", "BBY"], ["5732", "5045"], "Best Buy Co., Inc."),
  m("apple", "Apple", "online-shopping", "Electronics", ["apple.com"], ["APPLE.COM/BILL", "APPLE STORE", "APPLE ONLINE STORE", "ITUNES.COM/BILL", "APPLE SERVICES"], ["5732", "5734", "5818"], "Apple Inc."),
  m("google", "Google", "online-shopping", "Technology", ["google.com"], ["GOOGLE *", "GOOGLE PLAY", "GOOGLE STORE", "GOOGLE ONE", "GOOGLE*YOUTUBE", "GOOGLE YOUTUBE", "YOUTUBEPREMIUM"], ["5734", "5818", "4816"], "Alphabet Inc."),
  m("netflix", "Netflix", "streaming", "Streaming", ["netflix.com"], ["NETFLIX.COM"], ["4899", "5815"], "Netflix, Inc."),
  m("spotify", "Spotify", "streaming", "Streaming", ["spotify.com"], ["SPOTIFY USA", "SPOTIFY AB"], ["5815", "4899"], "Spotify Technology S.A."),
  m("disney", "Disney", "streaming", "Entertainment", ["disneyplus.com", "disney.com"], ["DISNEY PLUS", "DISNEYPLUS", "DISNEY*", "HULU", "ESPN+", "ESPN PLUS", "WALT DISNEY"], ["4899", "7996", "5815"], "The Walt Disney Company"),
  m("paypal", "PayPal", "online-shopping", "Payments", ["paypal.com"], ["PAYPAL *", "PP*"], ["4829", "6012"], "PayPal Holdings, Inc."),
  m("starbucks", "Starbucks", "dining", "Coffee", ["starbucks.com"], ["STARBUCKS STORE", "STARBUCKS CARD"], ["5814"], "Starbucks Corporation"),
  m("mcdonalds", "McDonald's", "dining", "Fast food", ["mcdonalds.com"], ["MCDONALD'S", "MCDONALDS", "MCD"], ["5814"], "McDonald's Corporation"),
  m("chipotle", "Chipotle", "dining", "Fast food", ["chipotle.com"], ["CHIPOTLE ONLINE", "CHIPOTLE MEX GR"], ["5814"], "Chipotle Mexican Grill, Inc."),
  m("walgreens", "Walgreens", "drugstores", "Pharmacy", ["walgreens.com"], ["WALGREENS", "WAG"], ["5912"], "Walgreens Boots Alliance"),
  m("cvs", "CVS", "drugstores", "Pharmacy", ["cvs.com"], ["CVS/PHARMACY", "CVS PHARMACY"], ["5912"], "CVS Health Corporation"),
  m("kroger", "Kroger", "groceries", "Grocery", ["kroger.com"], ["KROGER FUEL", "KROGER #"], ["5411", "5541"], "The Kroger Co."),
  m("safeway", "Safeway", "groceries", "Grocery", ["safeway.com"], ["SAFEWAY #", "SAFEWAY STORE"], ["5411"], "Albertsons Companies"),
  m("shell", "Shell", "gas", "Fuel", ["shell.com"], ["SHELL OIL", "SHELL SERVICE STATION"], ["5541", "5542"], "Shell plc"),
  m("exxon-mobil", "ExxonMobil", "gas", "Fuel", ["exxon.com"], ["EXXON", "MOBIL", "EXXONMOBIL"], ["5541", "5542"], "Exxon Mobil Corporation"),
  m("chevron", "Chevron", "gas", "Fuel", ["chevron.com"], ["CHEVRON", "TEXACO"], ["5541", "5542"], "Chevron Corporation"),
  m("bp", "BP", "gas", "Fuel", ["bp.com"], ["BP#", "BP PRODUCTS", "AMOCO"], ["5541", "5542"], "BP p.l.c."),
  m("hilton", "Hilton", "hotels", "Hotel", ["hilton.com"], ["HILTON HOTELS", "HILTON HHONORS", "HAMPTON INN", "HAMPTON BY HILTON", "DOUBLETREE", "EMBASSY SUITES", "HOMEWOOD SUITES", "HILTON GARDEN INN", "CONRAD", "WALDORF ASTORIA", "CANOPY BY HILTON", "TRU BY HILTON"], ["3503", "3504", "7011"], "Hilton Worldwide Holdings Inc."),
  m("marriott", "Marriott", "hotels", "Hotel", ["marriott.com"], ["MARRIOTT HOTELS", "MARRIOTT INTL", "MARRIOTT BONVOY", "COURTYARD", "RESIDENCE INN", "SHERATON", "WESTIN", "W HOTELS", "RENAISSANCE HOTELS", "FAIRFIELD INN", "SPRINGHILL SUITES", "AC HOTELS", "RITZ-CARLTON", "RITZ CARLTON", "ST REGIS"], ["3501", "3503", "7011"], "Marriott International, Inc."),
  m("hyatt", "Hyatt", "hotels", "Hotel", ["hyatt.com"], ["HYATT HOTELS", "GRAND HYATT", "PARK HYATT", "HYATT REGENCY", "HYATT PLACE", "HYATT HOUSE", "ANDAZ", "WORLD OF HYATT"], ["3501", "3503", "7011"], "Hyatt Hotels Corporation"),
  m("ihg", "IHG", "hotels", "Hotel", ["ihg.com"], ["IHG HOTELS", "HOLIDAY INN", "HOLIDAY INN EXPRESS", "CROWNE PLAZA", "INTERCONTINENTAL", "KIMPTON", "CANDLEWOOD", "STAYBRIDGE SUITES", "HOTEL INDIGO", "IHG ONE REWARDS"], ["3501", "3503", "7011"], "InterContinental Hotels Group"),
  m("wyndham", "Wyndham", "hotels", "Hotel", ["wyndhamhotels.com"], ["WYNDHAM HOTELS", "LA QUINTA", "RAMADA", "DAYS INN", "SUPER 8"], ["3501", "7011"], "Wyndham Hotels & Resorts"),
  m("airbnb", "Airbnb", "travel", "Lodging", ["airbnb.com"], ["AIRBNB*", "AIRBNB INC"], ["7011", "6513"], "Airbnb, Inc."),
  m("expedia", "Expedia", "travel", "Online travel", ["expedia.com"], ["EXPEDIA*", "EXPEDIA INC", "HOTELS.COM", "VRBO", "ORBITZ"], ["4722", "7011"], "Expedia Group, Inc."),
  m("delta-air-lines", "Delta Air Lines", "airlines", "Airline", ["delta.com"], ["DELTA AIR", "DELTA AIRLINES", "DELTA AIR LINES", "DELTA SKYMILES"], ["3058", "4511"], "Delta Air Lines, Inc."),
  m("united-airlines", "United Airlines", "airlines", "Airline", ["united.com"], ["UNITED AIR", "UNITED AIRLINES", "UNITED.COM"], ["3000", "4511"], "United Airlines Holdings, Inc."),
  m("american-airlines", "American Airlines", "airlines", "Airline", ["aa.com"], ["AMERICAN AIR", "AMERICAN AIRLINES", "AMERICAN 001"], ["3001", "4511"], "American Airlines Group Inc."),
  m("southwest-airlines", "Southwest Airlines", "airlines", "Airline", ["southwest.com"], ["SOUTHWEST AIR", "SOUTHWEST AIRLINES", "SWA"], ["3066", "4511"], "Southwest Airlines Co."),
  m("alaska-airlines", "Alaska Airlines", "airlines", "Airline", ["alaskaair.com"], ["ALASKA AIR", "ALASKA AIRLINES", "ALASKA AIR GROUP"], ["3256", "4511"], "Alaska Air Group, Inc."),
  m("jetblue", "JetBlue", "airlines", "Airline", ["jetblue.com"], ["JETBLUE AIRWAYS", "JET BLUE"], ["3351", "4511"], "JetBlue Airways Corporation"),
  m("british-airways", "British Airways", "airlines", "Airline", ["britishairways.com"], ["BRITISH AIRWAYS", "BRIT AIRWAYS"], ["3005", "4511"], "International Airlines Group"),
  m("hertz", "Hertz", "car-rental", "Car rental", ["hertz.com"], ["HERTZ RENT A CAR", "HERTZ CAR"], ["3351", "7512"], "Hertz Global Holdings"),
  m("avis", "Avis", "car-rental", "Car rental", ["avis.com"], ["AVIS RENT A CAR", "AVIS BUDGET", "BUDGET RENT A CAR"], ["3389", "7512"], "Avis Budget Group"),
  m("enterprise", "Enterprise", "car-rental", "Car rental", ["enterprise.com"], ["ENTERPRISE RENT-A-CAR", "ENTERPRISE RENT A CAR", "NATIONAL CAR RENTAL", "ALAMO RENT A CAR"], ["3405", "7512"], "Enterprise Holdings"),
  m("saks-fifth-avenue", "Saks Fifth Avenue", "online-shopping", "Department store", ["saksfifthavenue.com"], ["SAKS FIFTH AVE", "SAKS.COM", "SAKS OFF 5TH", "SAKS #"], ["5311", "5651"], "Saks Global"),
  m("lululemon", "lululemon", "online-shopping", "Apparel", ["lululemon.com"], ["LULULEMON ATHLETICA", "LULULEMON USA"], ["5651", "5691"], "lululemon athletica inc."),
  m("equinox", "Equinox", "entertainment", "Fitness", ["equinox.com"], ["EQUINOX CLUB", "EQUINOX FITNESS", "SOULCYCLE"], ["7997", "7941"], "Equinox Holdings"),
  m("clear", "CLEAR", "travel", "Identity", ["clearme.com"], ["CLEARME", "CLEAR SECURE", "CLEAR PLUS"], ["7399", "7993"], "Clear Secure, Inc."),
  m("resy", "Resy", "dining", "Reservations", ["resy.com"], ["RESY USA", "RESY*"], ["5812", "7399"], "American Express Company"),
  m("opentable", "OpenTable", "dining", "Reservations", ["opentable.com"], ["OPENTABLE*", "OPEN TABLE"], ["5812", "7399"], "Booking Holdings Inc."),
  m("shake-shack", "Shake Shack", "dining", "Fast casual", ["shakeshack.com"], ["SHAKE SHACK"], ["5814"], "Shake Shack Inc."),
  m("five-guys", "Five Guys", "dining", "Fast casual", ["fiveguys.com"], ["FIVE GUYS BURGERS", "FIVE GUYS #"], ["5814"], "Five Guys Enterprises"),
  m("verizon", "Verizon", "phone-internet", "Telecom", ["verizon.com"], ["VERIZON WRLS", "VERIZON WIRELESS", "VZWRLSS", "VZW"], ["4814", "4899"], "Verizon Communications Inc."),
  m("att", "AT&T", "phone-internet", "Telecom", ["att.com"], ["AT&T", "ATT*", "AT&T WIRELESS", "ATT BILL PAYMENT"], ["4814", "4899"], "AT&T Inc."),
  m("t-mobile", "T-Mobile", "phone-internet", "Telecom", ["t-mobile.com"], ["T-MOBILE", "TMOBILE", "TMOBILE*"], ["4814"], "T-Mobile US, Inc."),
  m("comcast", "Xfinity", "phone-internet", "Telecom", ["xfinity.com"], ["COMCAST", "XFINITY", "COMCAST CABLE"], ["4899", "4814"], "Comcast Corporation"),
  m("walmart-plus", "Walmart+", "online-shopping", "Membership", ["walmart.com"], ["WALMART+ MEMBERSHIP", "WALMART PLUS MEMBERSHIP", "WM+"], ["5311"], "Walmart Inc."),
  m("peloton", "Peloton", "entertainment", "Fitness", ["onepeloton.com"], ["PELOTON*", "PELOTON INTERACTIVE"], ["5941", "5655"], "Peloton Interactive, Inc."),
  m("nordstrom", "Nordstrom", "online-shopping", "Department store", ["nordstrom.com"], ["NORDSTROM RACK", "NORDSTROM.COM"], ["5311", "5651"], "Nordstrom, Inc."),
  m("macys", "Macy's", "online-shopping", "Department store", ["macys.com"], ["MACY'S", "MACYS.COM", "MACYS #"], ["5311"], "Macy's, Inc."),
  m("sephora", "Sephora", "online-shopping", "Beauty", ["sephora.com"], ["SEPHORA #", "SEPHORA.COM"], ["5977"], "LVMH"),
];

/** Applies identities to existing merchants by slug and creates the missing ones. Idempotent. */
export async function applyMerchantIdentities(prisma: PrismaClient): Promise<{ updated: number; created: number }> {
  const cats = new Map((await prisma.category.findMany({ select: { id: true, slug: true, isFallback: true } })).map((c) => [c.slug, c.id]));
  const fallback = (await prisma.category.findFirst({ where: { isFallback: true }, select: { id: true } }))?.id;
  let updated = 0;
  let created = 0;
  for (const i of MERCHANT_IDENTITIES) {
    const existing = await prisma.merchant.findUnique({ where: { slug: i.slug } });
    const data = { aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent ?? null, industry: i.industry };
    if (existing) {
      await prisma.merchant.update({ where: { id: existing.id }, data: { ...data, hosts: [...new Set([...existing.hosts, ...i.hosts])] } });
      updated++;
      continue;
    }
    const categoryId = cats.get(i.category) ?? fallback;
    if (!categoryId) continue;
    await prisma.merchant.create({ data: { slug: i.slug, name: i.name, categoryId, hosts: i.hosts, isPopular: true, ...data } });
    created++;
  }
  return { updated, created };
}
