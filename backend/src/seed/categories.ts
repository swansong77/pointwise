/** Spend categories shared by the demo catalog and the real-card catalog. */
export const CATEGORIES: Array<
  [slug: string, name: string, icon: string, fallback?: boolean]
> = [
  ["dining", "Dining", "utensils"],
  ["groceries", "Groceries", "shopping-cart"],
  ["gas", "Gas", "fuel"],
  ["travel", "Travel", "plane"],
  ["airlines", "Airlines", "plane-takeoff"],
  ["hotels", "Hotels", "bed"],
  ["car-rental", "Car Rental", "car"],
  ["transit", "Transit & Rideshare", "train"],
  ["online-shopping", "Online Shopping", "monitor"],
  ["drugstores", "Drugstores", "pill"],
  ["streaming", "Streaming", "tv"],
  ["entertainment", "Entertainment", "film"],
  ["home-improvement", "Home Improvement", "hammer"],
  ["wholesale-clubs", "Wholesale Clubs", "warehouse"],
  ["phone-internet", "Phone & Internet", "phone"],
  ["everything-else", "Everything Else", "star", true],
];
