# Phase 8 — Functional Analysis

Each feature record cites the static evidence it is based on (type names, models, endpoints, strings). Behavior that could only be confirmed at runtime is marked *inferred*.

## Feature index & traceability

| ID | Feature | Evidence (types / endpoints) | Web MVP? |
|---|---|---|---|
| F01 | Account & authentication | `AuthViewModel`, `LoginView`, `ManualLoginView`, `SignInWithPasskeyButton`, `ManagePasskeysView`, `/auth/login`, `/auth/signon`, `/passkey/*`, `/token/refresh` | ✅ |
| F02 | Card catalog & search | `DBCard`, `SearchCardsView`, `CardSemanticSearch`, `CardLexicalSearch`, `/v1/cards/` | ✅ |
| F03 | Wallet (my cards) management | `DBInventory`, `CardStore`, `MyCardsCardRow`, `CustomizeCard`, `/user/cards/*`, `/inventory/update` | ✅ |
| F04 | Onboarding card setup | `OnboardCardsView`, `OnboardCardsModel`, `/cards/add_multiple` | ✅ |
| F05 | Categories ("Pointers") & best card | `PointersStore`, `PointersView`, `PointersBestCardsView`, `DBPointerCard`, `BestCardStruct`, `WhichCardWizardView` | ✅ |
| F06 | Merchants & subcategories | `PointerMerchantEntity`, `PointerSubcategoryEntity`, `NewMerchantView`, `/merchants/new` | ✅ |
| F07 | Offers tracking (checklist) | `DBOfferInventory`, `OffersStore`, `GroupedOffersView`, `EditOffer`, `/checklist/update*` | ✅ |
| F08 | Custom offers & AI parsing | `AddCustomOfferView`, `OfferAIParseResult`, `/offers/add_custom` | ✅ (no AI in MVP) |
| F09 | Expiring offers & snooze | `ExpiringOffersStore`, `hide_until`, `SnoozeOfferEntityIntent` | ✅ |
| F10 | Offer automation (recurring) | `OfferAutomationMenu`, `auto_favorite/redeem/delete`, `/checklist/update/automation` | Beta |
| F11 | Offer alerts (keywords) | `OfferAlert`, `OfferAlertAddView`, `/offer_alerts/*` | Beta |
| F12 | Offer Sync (bank auto-add) | `OfferSyncCoordinator`, bank JS, `DBOfferSync*`, `/extension/offers/add` | ❌ (replaced by manual/CSV import + extension later) |
| F13 | Nearby stores & location reminders | `LocationManager`, `NearbyLocationOffersView`, `LocationRemindersView`, `PointerLocation`, `LocationTriggerEvent` | ✅ (browser geolocation) |
| F14 | AutoPilot / Live Activities | `Start/StopAutoPilotIntent`, `ShoppingLiveActivityModel` | ❌ (native only) |
| F15 | Dashboard | `DashboardView`, 20+ `DashboardSection*`, `EditDashboardView` | ✅ |
| F16 | Card renewals / annual fees | `CardRenewalsStore`, `UpcomingCardRenewalsView`, `DashboardCardRenewalsSection` | ✅ |
| F17 | Chase 5/24 tracker | `Chase524CardsView`, `Status524`, `cards_524`, `ChaseStatusIntent` | ✅ |
| F18 | Welcome bonus tracking & bonus plans | `CardBonusView`, `DBBonusPlan`, `EditCategoriesView`, `earnedBonus` | ✅ |
| F19 | Reward calculator / card value | `CardValueDetailView`, `DashboardSectionCardValue`, `OfferSavingsDetailView`, `OffersChart` | ✅ |
| F20 | Find a new card (recommendations, Top 10) | `FindNewCard`, `DashboardTop10View`, `Top10`, `SponsoredCardsSection` | ✅ |
| F21 | Household profiles (P2) | `DBUserProfile`, `ProfileStore`, `/profiles/*` | Beta |
| F22 | Notifications / messages | `NotificationMessage`, `MessageListView`, `/notifications/*`, APNs | ✅ (in-app + email) |
| F23 | Subscription (Pro) & paywall | `MasterPaywallView`, `RevenueCat`, `Paywall`, `/purchase/link`, `/manage/link/` | ✅ (Stripe-ready) |
| F24 | Offer streak (gamification) | `OfferStreakStore`, `MediumHeatMapView`, `ContributionDay` | Beta |
| F25 | Ask AI / Siri / Apple Intelligence | `AskAIIntent`, `*Tool`, FoundationModels | Scale |
| F26 | Safari extension (Shopping Pointers) | CPSafariExtension | Scale |
| F27 | Widgets, Watch, CarPlay, AR, Menu bar | WidgetKit, CarPlay, ARKit, MenuBar helper | ❌ native |
| F28 | Sharing (links, Wallet pass, Shared with You) | `pass.cardpointers.com`, `u.cardpointers.com`, `SharedWithYouView` | Scale |
| F29 | Settings (app icon, export, reset, feedback) | `SettingsView`, `AppIconView`, `SendFeedbackView`, `ReportCardErrorView` | ✅ |
| F30 | Admin catalog management | (server-side; not in client) | ✅ (new) |

---

## Feature records

### F01 — Account & authentication
- **Purpose:** Identify the user and sync their wallet across devices.
- **Inputs:** email (+ one-time code), Apple ID credential, passkey assertion.
- **Outputs:** bearer token in Keychain; `User{id, profiles}`.
- **Dependencies:** AuthenticationServices, Keychain, API.
- **UI screens:** `LoginView`, `ManualLoginView`, `OtherLoginOptionsButton`, `ManagePasskeysView`, `SignOutView`.
- **Backend:** `/auth/login`, `/auth/signon`, `/passkey/{challenge,login,signup}`, `/v1/user/token/refresh`, `/v1/user/delete`.
- **Business rules:** passkeys are the default since v4; 401 triggers one serialized refresh, then a retry; sign-out sets `userSignedOut` and keeps the seed catalog.
- **Edge cases:** passkey cancelled (`_canceledPasskeyPrompt`); "existing_credential_ids" on signup; `bad_credential_id` cleanup.
- **Errors:** `KeychainError`; "no token found"; email code invalid (`EmailLoginResponse.code`).

### F02 — Card catalog & search
- **Purpose:** Browse/search 5,000+ cards.
- **Inputs:** text query, country filter (`CountryMenu`), type (personal/business), network.
- **Outputs:** ranked `CardSearchResult` list.
- **Dependencies:** seed DB + `/v1/cards/`; NaturalLanguage embeddings (`CardSemanticSearch`) with lexical fallback (`CardSearchDocument{text, normalizedText, weight, countryCode, bankName}`).
- **Rules:** results weighted by `weight`; country-scoped by user `countryCode`.
- **Edge:** missing card → `NewCardView` (user-defined card) or `ReportCardErrorView`.

### F03 — Wallet management
- **Purpose:** Maintain the set of cards the user holds.
- **Inputs:** card from catalog, nickname, notes, status (`applied|approved|denied|closed`), cardholder (`primary|authorizedUser`), approvedDate, closedDate, annual fee override, network override, color, profile.
- **Outputs:** `DBInventory` rows; reordered list.
- **Backend:** `/cards/add`, `/cards/new`, `/cards/delete`, `/cards/order`, `/inventory/update`, `/inventory/change` (product change keeps history).
- **Rules:** closed/denied cards are excluded from best-card ranking (*inferred*: `CardsFilter`, `CardInventoryStatus`); `original_title/value/color` retained when the user overrides.
- **Edge:** duplicate cards allowed (two of the same card, e.g. P1 & P2); deleting cascades its offers.

### F04 — Onboarding card setup
- Multi-select popular cards (`OnboardCardRow`) → `/cards/add_multiple`. The paywall may show after login (`Paywall.showAfterLogin`), as may Offer Sync onboarding (`showOnboardOfferSync`).

### F05 — Categories & best card ("Pointers")
- **Purpose:** Tell the user which card to use for a category/merchant.
- **Inputs:** category or merchant, the user's wallet, optional location.
- **Outputs:** ordered `PointerCard` list (best first) + related offers.
- **Rules (recovered):**
  1. Candidate cards = user inventory with status approved (not closed).
  2. Rate per card = `points` from the matching `DBPointerCard` (merchant > subcategory > category > "Everywhere Else").
  3. Value = `points × card.value` (¢ per point). Ranked by value desc, ties by `order`.
  4. Rotating/selectable bonuses (`BonusCategoryGroup`, slots 1–3) and active `BonusPlan` categories override the base rate within their dates/spend caps.
  5. User may **pin** a card for a pointer (`pinned_id`, `/pointers/pinned_cards`), which overrides ranking.
  6. Sponsored cards are shown separately (`PointerSponsoredCardRow`), not mixed into the ranking.
- **Edge:** no card earns a bonus → fall back to "Everywhere Else"; currency mismatch (points vs cash) is normalized via `value`.

### F06 — Merchants & subcategories
- Merchants carry web `hosts` (used by the Safari extension) and belong to a category. Users can add merchants (`/merchants/new`, `is_user_added`). Favorites: `/pointers/favorites`.

### F07 — Offers tracking
- **Purpose:** Track card-linked offers ("spend $X get $Y") and credits per card.
- **Inputs:** offer (catalog or custom), card, amount used, redeemed flag, dates.
- **Outputs:** checklist with totals (`OffersTotalSummary`, `OffersSummaryStore`).
- **Rules:** types `cash | quantity`; repeatable offers track `times_used ≤ max_times`; `total_used ≤ total_available`; `is_min` means a minimum-spend offer; `grade` 1–5 quality; sort options `defaultPriority, endDate, redemptionDate, amount, addedDate, alphabetical, grade`; filters standard/personal (targeted).
- **Edge:** expired offers move to "Past"; `is_backfilled` offers come from history; `recurring_key` links monthly/annual credits.
- **Errors:** `BackfillPastOffersError`.

### F08 — Custom offers & AI parsing
- Manual form (`TemplateField`, `OfferTemplate`) or pasted text → `OfferAIParseResult{title, start/end ISO8601, categoryIDs, isSignup, isRepeatable, bonusPoints, bonusCashUSD, spendRequiredUSD, totalPointsPerDollar, discountPercent, discountMaxUSD, url}`. `custom_bonus_type` cash/points; `custom_is_bonus_limited` with limit value.

### F09 — Expiring offers & snooze
- Dashboard section lists offers ending soon; snooze sets `hide_until`; time-sensitive notifications (`CreateOfferExpirationReminderIntent`).

### F10 — Offer automation
- For recurring offers: auto-favorite, auto-redeem, auto-delete when they reappear (`recurring_*_checklists` keys stored per inventory).

### F11 — Offer alerts
- Keyword rules: `keyword_type`, `keywords[]`, `value_type`, `grade_type`, bank filters (Amex, BoA, Chase, Citi, Wells Fargo, US Bank), `auto_favorite`, `is_active`. Generates `NotificationMessage` with `offer_alert_ids`.

### F12 — Offer Sync
- **Purpose:** Log into the user's bank websites on-device and add every available card-linked offer automatically, on a schedule.
- **Inputs:** bank credentials (Keychain), schedule (`OfferSyncSchedule`, weekdays), trigger (manual/background).
- **Outputs:** offers added (`DBOfferSyncHistory.offers_added`), pushed to `/extension/offers/add`.
- **Rules:** credentials never leave the device; card mapping by last digits / external id; history kinds; "continued processing" background task.
- **Web recreation:** ❌. Scraping bank sites from a server would require holding user bank credentials, which is high-risk and conflicts with bank terms. Replacement: manual entry, CSV import, and later a user-run browser extension.

### F13 — Nearby & location reminders
- MapKit POI search → `RichNearbyLocation` matched to merchants → best card. Region reminders (`arrive|depart`) set locally. Hidden stores (`HiddenNearbyStore` with scope).
- Web: browser Geolocation + a places provider (e.g., OpenStreetMap/Overpass or a paid Places API) → merchant matching.

### F15 — Dashboard
Configurable sections (reorder/hide): Best Card Pointers, Nearby, New Offers, Expiring Offers, Card Renewals, Card Value, Offer Savings, Offer Streak, Offer Sync, Account Summary, Shortcuts, Tips, Top 10 Card Offers, Shared With You, Which Card wizard.

### F16 — Card renewals
Upcoming annual fees computed from `approvedDate` anniversary + `fee`; options include "no-fee renewals" toggle (`DashboardCardsNoFeeRenewalsType`).

### F17 — Chase 5/24
Count of personal cards approved in the last 24 months (`Status524{count, date}`), with the date when count drops.

### F18 — Welcome bonus & bonus plans
Track `bonus`, `spend`, `months`, `earnedBonus`; deadline = approvedDate + months.

### F19 — Reward calculator / value
Card value = earnings by category × user spend profile × cpp − fee + credits used. Offer savings totals per period (`OffersChart`).

### F20 — Find a new card
Recommend cards that beat the current wallet for chosen categories; Top 10 list; affiliate/apply links (`affiliate`, `url_mobile`).

### F21 — Profiles (household)
Up to N profiles with nickname/email invite (`is_accepted`); inventory/offers scoped by `profile_uuid`.

### F22 — Notifications
Server messages (new offers, card changes, 5/24 status), local reminders; read/unread; preferences `notificationNewOffers`, `notificationCardChanges`, `notification524Status`, `notificationFavoriteOffersOnly`.

### F23 — Subscription
Monthly, annual (+free trial), lifetime, and tips. Pro gates (*inferred*): Offer Sync, unlimited offers, AutoPilot, profiles. Remote-configurable paywall. Web purchase linking (`ProLinkView`).

### F24 — Offer streak
ISO-week heat map of offer activity per profile.

### F29 — Settings
App icon, dashboard editor, notifications, passkeys, export/email (`MailAttachment`), report problem, FAQ, What's New, reset.

### F30 — Admin (new for web)
CRUD of cards, earnings, categories, merchants, offers; user management; analytics.
