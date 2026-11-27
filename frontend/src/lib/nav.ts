export interface NavItem {
  href: string;
  label: string;
  icon: string;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/chief-of-staff', label: 'Chief of Staff', icon: '🏛️' },
  { href: '/copilot', label: 'Copilot', icon: '🧭' },
  { href: '/assistant', label: 'Assistant', icon: '✨' },
  { href: '/search', label: 'Search History', icon: '🔎' },
  { href: '/wallet', label: 'Wallet', icon: '💳' },
  { href: '/portfolio', label: 'Portfolio', icon: '📊' },
  { href: '/benefits', label: 'Benefits', icon: '🎁' },
  { href: '/benefits/audit', label: 'Benefit Audit', icon: '🔎' },
  { href: '/benefits/reconciliation', label: 'Reconcile', icon: '⚖️' },
  { href: '/spending', label: 'Spending', icon: '🧾' },
  { href: '/five24', label: '5/24', icon: '⏳' },
  { href: '/next-card', label: 'Next Card', icon: '🧭' },
  { href: '/travel', label: 'Travel', icon: '✈️' },
  { href: '/household', label: 'Household', icon: '👪' },
  { href: '/import', label: 'Import', icon: '📥' },
  { href: '/offers', label: 'Offers', icon: '🏷️' },
  { href: '/offers/inventory', label: 'Offer Inventory', icon: '🗂️' },
  { href: '/offers/expirations', label: 'Expirations', icon: '⏰' },
  { href: '/offers/savings', label: 'Savings', icon: '💰' },
  { href: '/cashback', label: 'Cash-back sites', icon: '🛍️' },
  { href: '/offers/household', label: 'Household Offers', icon: '👪' },
  { href: '/offers/automation', label: 'Offer Automation', icon: '🤖' },
  { href: '/offers/market', label: 'Offer Market', icon: '📈' },
  { href: '/offers/intel', label: 'Offer Intelligence', icon: '🎯' },
  { href: '/offers/plan', label: 'Plan a Purchase', icon: '🧭' },
  { href: '/loyalty', label: 'Loyalty Assets', icon: '✈️' },
  { href: '/nearby', label: 'Nearby', icon: '📍' },
  { href: '/merchants', label: 'Merchants', icon: '🏪' },
  { href: '/brands', label: 'Brand Logos', icon: '🖼️' },
  { href: '/calculator', label: 'Calculator', icon: '🧮' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Admin', icon: '🛠️' },
  { href: '/admin/ai', label: 'AI & MCP', icon: '🤖' },
  { href: '/admin/catalog', label: 'Card Data', icon: '🗂️' },
  { href: '/admin/cashback', label: 'Cash-back sites', icon: '🛍️' },
  { href: '/admin/ops', label: 'Operations', icon: '🩺' },
  { href: '/admin/backup', label: 'Backup & Migration', icon: '💾' },
];

/** What a household member's own sign-in sees. The household overview is added only when the owner shares it. */
export const MEMBER_NAV: NavItem[] = [
  { href: '/my', label: 'My view', icon: '🏠' },
  { href: '/my/briefings', label: 'Briefings', icon: '🗞️' },
  { href: '/my/notifications', label: 'Notifications', icon: '🔔' },
  { href: '/my/mail', label: 'Mail & alerts', icon: '📬' },
  { href: '/my/settings', label: 'Settings', icon: '⚙️' },
];
export const MEMBER_HOUSEHOLD_NAV: NavItem = { href: '/my/household', label: 'Household', icon: '👪' };
