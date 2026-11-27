import { PrismaClient } from "@prisma/client";

/**
 * The shopping sites PointWise knows about at the start. Names and home pages only: no rate is assumed, and nothing here is a promise about
 * what a site pays. The administrator can edit or add sites (Admin, Cash-back sites). A site already in the list is left exactly as it is,
 * so the administrator's changes are never overwritten by a re-seed.
 *
 * storeUrlTemplate is where a merchant's PUBLIC store page lives ({host} = the merchant's web address, {slug} = its short name); it is
 * used only if the administrator allows automatic reading for that site. Only patterns that were seen to work are filled in.
 */
export const CASHBACK_SITES: Array<{ code: string; name: string; kind: "CASHBACK" | "POINTS"; homeUrl: string; storeUrlTemplate?: string; pointCents?: number; notes?: string }> = [
  { code: "rakuten", name: "Rakuten", kind: "CASHBACK", homeUrl: "https://www.rakuten.com", storeUrlTemplate: "https://www.rakuten.com/{host}" },
  { code: "topcashback", name: "TopCashback", kind: "CASHBACK", homeUrl: "https://www.topcashback.com", storeUrlTemplate: "https://www.topcashback.com/{slug}/" },
  { code: "befrugal", name: "BeFrugal", kind: "CASHBACK", homeUrl: "https://www.befrugal.com" },
  { code: "mrrebates", name: "Mr. Rebates", kind: "CASHBACK", homeUrl: "https://www.mrrebates.com" },
  { code: "extrabux", name: "Extrabux", kind: "CASHBACK", homeUrl: "https://www.extrabux.com" },
  { code: "capitalone-shopping", name: "Capital One Shopping", kind: "CASHBACK", homeUrl: "https://capitaloneshopping.com", notes: "Pays in credits; check how they can be used." },
  { code: "shopback", name: "ShopBack", kind: "CASHBACK", homeUrl: "https://www.shopback.com" },
  { code: "retailmenot", name: "RetailMeNot", kind: "CASHBACK", homeUrl: "https://www.retailmenot.com" },
  { code: "couponfollow", name: "CouponFollow", kind: "CASHBACK", homeUrl: "https://couponfollow.com" },
  { code: "rebatesme", name: "RebatesMe", kind: "CASHBACK", homeUrl: "https://www.rebatesme.com" },
  { code: "inboxdollars", name: "InboxDollars", kind: "CASHBACK", homeUrl: "https://www.inboxdollars.com" },
  { code: "goodshop", name: "Goodshop", kind: "CASHBACK", homeUrl: "https://www.goodshop.com", notes: "Gives to a cause you choose." },
  { code: "mypoints", name: "MyPoints", kind: "POINTS", homeUrl: "https://www.mypoints.com", pointCents: 0.5, notes: "Assumes one point is worth about half a cent; edit if yours differs." },
  { code: "upromise", name: "Upromise", kind: "CASHBACK", homeUrl: "https://www.upromise.com", notes: "Pays into a college-savings account." },
  { code: "swagbucks", name: "Swagbucks", kind: "POINTS", homeUrl: "https://www.swagbucks.com", pointCents: 1, notes: "Assumes one point is worth about one cent; edit if yours differs." },
  { code: "aadvantage-eshopping", name: "AAdvantage eShopping", kind: "POINTS", homeUrl: "https://www.aadvantageeshopping.com", notes: "Pays miles. Set what a mile is worth to you." },
  { code: "united-shopping", name: "United MileagePlus Shopping", kind: "POINTS", homeUrl: "https://shopping.mileageplus.com", notes: "Pays miles. Set what a mile is worth to you." },
  { code: "delta-shopping", name: "Delta SkyMiles Shopping", kind: "POINTS", homeUrl: "https://shopping.delta.com", notes: "Pays miles. Set what a mile is worth to you." },
  { code: "southwest-shopping", name: "Southwest Rapid Rewards Shopping", kind: "POINTS", homeUrl: "https://www.rapidrewardsshopping.com", notes: "Pays points. Set what a point is worth to you." },
];

export async function seedCashbackSites(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const s of CASHBACK_SITES) {
    const exists = await prisma.cashbackSite.findUnique({ where: { code: s.code }, select: { id: true } });
    if (exists) continue;
    await prisma.cashbackSite.create({ data: { code: s.code, name: s.name, kind: s.kind, homeUrl: s.homeUrl, storeUrlTemplate: s.storeUrlTemplate ?? null, pointCents: s.pointCents ?? null, notes: s.notes ?? null } });
    created++;
  }
  return created;
}
