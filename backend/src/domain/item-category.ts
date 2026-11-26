/**
 * What an item people plan to buy probably is (pure): "MacBook Pro" → an online/retail electronics purchase, "Hilton stay" → hotels,
 * "international flight" → airlines. A hint, never a fact: the planner uses it only when no merchant was named, and says so.
 * First matching rule wins, so more specific rules come first.
 */
export const ITEM_HINT_VERSION = 'item-category/1';

export interface ItemHint {
  /** spend category slug (see seed/categories.ts) */
  categorySlug: string;
  /** a merchant the item is usually bought from, when one is obvious */
  merchantHint: string | null;
  /** what the item was read as, for display */
  label: string;
  /** 0–1: how sure the reading is */
  confidence: number;
}

const RULES: Array<[RegExp, ItemHint]> = [
  [/\b(iphone|ipad|macbook|mac ?mini|imac|airpods|apple watch|apple tv|vision pro)\b/i, { categorySlug: 'online-shopping', merchantHint: 'Apple', label: 'Apple product', confidence: 0.85 }],
  [/\b(disney|disneyland|disney world|magic kingdom|epcot)\b/i, { categorySlug: 'entertainment', merchantHint: 'Disney', label: 'Disney tickets or stay', confidence: 0.7 }],
  [/\b(international flight|flight|flights|airfare|plane ticket|airline ticket|plane tickets)\b/i, { categorySlug: 'airlines', merchantHint: null, label: 'Flight', confidence: 0.8 }],
  [/\b(cruise|cruises)\b/i, { categorySlug: 'travel', merchantHint: null, label: 'Cruise', confidence: 0.75 }],
  [/\b(car rental|rental car|rent a car)\b/i, { categorySlug: 'car-rental', merchantHint: null, label: 'Car rental', confidence: 0.85 }],
  [/\b(hotel|resort|lodging|airbnb|vacation rental|stay|nights?)\b/i, { categorySlug: 'hotels', merchantHint: null, label: 'Hotel stay', confidence: 0.7 }],
  [/\b(uber|lyft|taxi|rideshare|train ticket|amtrak|subway)\b/i, { categorySlug: 'transit', merchantHint: null, label: 'Transit', confidence: 0.75 }],
  [/\b(appliance|appliances|refrigerator|fridge|washer|dryer|dishwasher|furniture|lumber|hardware|paint|home improvement|flooring|roofing)\b/i, { categorySlug: 'home-improvement', merchantHint: null, label: 'Home improvement', confidence: 0.7 }],
  [/\b(laptop|computer|tv|television|monitor|camera|console|playstation|xbox|electronics|headphones|tablet|phone)\b/i, { categorySlug: 'online-shopping', merchantHint: null, label: 'Electronics', confidence: 0.6 }],
  [/\b(dinner|lunch|brunch|breakfast|restaurant|dining|takeout|take-out|coffee|bar tab)\b/i, { categorySlug: 'dining', merchantHint: null, label: 'Dining', confidence: 0.8 }],
  [/\b(gas|gasoline|fuel|fill ?up)\b/i, { categorySlug: 'gas', merchantHint: null, label: 'Gas', confidence: 0.85 }],
  [/\b(groceries|grocery|supermarket|produce)\b/i, { categorySlug: 'groceries', merchantHint: null, label: 'Groceries', confidence: 0.85 }],
  [/\b(prescription|pharmacy|medicine|vitamins)\b/i, { categorySlug: 'drugstores', merchantHint: null, label: 'Drugstore', confidence: 0.8 }],
  [/\b(streaming|netflix|spotify|subscription)\b/i, { categorySlug: 'streaming', merchantHint: null, label: 'Streaming', confidence: 0.7 }],
  [/\b(phone bill|wireless|internet bill|cable bill)\b/i, { categorySlug: 'phone-internet', merchantHint: null, label: 'Phone or internet', confidence: 0.8 }],
  [/\b(tickets?|concert|movie|show|theater|theatre|sports game)\b/i, { categorySlug: 'entertainment', merchantHint: null, label: 'Entertainment', confidence: 0.65 }],
  [/\b(wholesale|bulk)\b/i, { categorySlug: 'wholesale-clubs', merchantHint: null, label: 'Wholesale club', confidence: 0.6 }],
];

export function hintForItem(item: string | null | undefined): ItemHint | null {
  const text = (item ?? '').trim();
  if (!text) return null;
  for (const [re, hint] of RULES) if (re.test(text)) return { ...hint };
  return null;
}
