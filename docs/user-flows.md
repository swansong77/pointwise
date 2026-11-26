# Phase 9 — User Flow Analysis

Flows reconstructed from SwiftUI view names, store names, App Intents and endpoints. Screen names in `code` are recovered type names.

## 1. Onboarding

```mermaid
flowchart TD
  A[Launch] --> B{Token in Keychain?}
  B -- yes --> D[DashboardView]
  B -- no --> L[LoginView]
  L --> P[Sign in with Passkey]
  L --> AP[Sign in with Apple]
  L --> E[ManualLoginView: email → code]
  P & AP & E --> I[GET /v1/install + /me + /wallet]
  I --> C{Has cards?}
  C -- no --> O[OnboardCardsView: pick popular cards]
  O --> M[POST /cards/add_multiple]
  M --> PW{Paywall.showAfterLogin?}
  C -- yes --> PW
  PW -- yes --> PAY[MasterPaywallView]
  PW -- no --> OS{showOnboardOfferSync?}
  PAY --> OS
  OS -- yes --> AL[AfterLoginBankSyncOnboardingView]
  OS -- no --> D
  AL --> D
```

## 2. Card setup

```mermaid
flowchart LR
  W[My Cards] --> ADD[AddCardMenu]
  ADD --> S[SearchCardsView]
  ADD --> N[NewCardView: custom card]
  ADD --> CAM[CameraView: photo → Vision text recognition]
  S --> SEL[Select card] --> DET[NewCardsDetail: status, approved date, cardholder, profile]
  DET --> API[POST /cards/add] --> INV[(DBInventory)]
  INV --> CUS[CustomizeCard: nickname, color, notes, fee]
  INV --> BON[CardBonusView: welcome bonus progress]
  INV --> CAT[EditCategoriesView: choose rotating categories]
  INV --> PC[ProductChangeView → /inventory/change]
```

## 3. Offer discovery & tracking

```mermaid
flowchart TD
  OF[Offers tab: GroupedOffersView] --> F[InAppFiltersView: card, profile, type, sort]
  OF --> N[DashboardNewOffersSection / TopNewOffersView]
  OF --> X[DashboardExpiringOffersSection]
  N --> ADD[add_existing → card]
  OF --> R[OfferPreviewRow]
  R --> ED[EditOffer]
  ED --> U1[mark redeemed / amount used]
  ED --> U2[favorite]
  ED --> U3[snooze hide_until]
  ED --> U4[automation auto_* ]
  U1 & U2 & U3 & U4 --> Q[OfferChangeSaveQueue → /checklist/update*]
  OF --> C[AddCustomOfferView → AI parse → /offers/add_custom]
  OF --> AL[OfferAlertListView → OfferAlertAddView → /offer_alerts/addedit]
```

## 4. Best card at a place (rewards usage)

```mermaid
sequenceDiagram
  actor U as User
  participant App
  participant Loc as LocationManager/MapKit
  participant PS as PointersStore
  U->>App: open "Nearby" / ask Siri "CardPointers here"
  App->>Loc: current location → nearby POIs
  Loc-->>App: RichNearbyLocation[] (name, category)
  App->>PS: match POI → merchant/category
  PS-->>App: ranked cards (points × value) + offers at merchant
  App-->>U: "Use Amex Gold: 4X (8¢/$)" + "Offer: $10 off $50"
```

## 5. Rewards tracking

```mermaid
flowchart LR
  D[Dashboard] --> CV[Card Value section → CardValueDetailView]
  D --> OS[Offer Savings → OfferSavingsDetailView + OffersChart]
  D --> ST[Offer Streak → OfferStreakDetailView heat map]
  D --> RN[Card Renewals → UpcomingCardRenewalsView]
  D --> C524[Chase 5/24 → Chase524CardsView]
```

## 6. Location services

```mermaid
stateDiagram-v2
  [*] --> NotDetermined
  NotDetermined --> WhenInUse: user allows
  NotDetermined --> Denied: user denies
  Denied --> DeniedInstructions
  WhenInUse --> Nearby: NearbyLocationOffersView
  WhenInUse --> Always: enable reminders/AutoPilot
  Always --> Reminders: LocationRemindersView (arrive/depart region triggers)
  Always --> AutoPilot: Live Activity updates per store
```

## 7. Notifications

```mermaid
flowchart TD
  SRV[Server: new offers / card changes / 5-24 / alerts] -->|APNs| PUSH[Push]
  LOCAL[Local: expiring offer, location reminder, sync complete] --> PUSH
  PUSH --> TAP[Tap → deep link cardpointers://… or /open/offers/]
  APP[MessageListView] -->|GET /notifications?since=| SRV
  APP -->|POST /notifications/read| SRV
  SET[CustomizeNotifications] --> PREF[new offers / card changes / 5-24 / favorites only]
```

## 8. Subscriptions

```mermaid
flowchart TD
  G[Gated feature tapped / GateOffer] --> PW[MasterPaywallView]
  PW --> PL{Plan}
  PL --> MO[Monthly] & AN[Annual + trial TrialTimelineView] & LT[Lifetime]
  MO & AN & LT --> RC[RevenueCat purchase → StoreKit]
  RC --> ENT[Entitlement active → WalletStore.isPaidSubscriber]
  PW --> RS[Restore purchases]
  PW --> LINK[ProLinkView: link web purchase → /purchase/link]
  SET[ProSettingsView] --> MAN[/manage/link/ → manage subscription]
  PW --> TIP[TipJarView: tiny…humongous tips]
```

## 9. Account management

```mermaid
flowchart LR
  S[SettingsView] --> PK[ManagePasskeysView: list/add/delete]
  S --> PR[Profiles: NewProfileView / EditProfileView → /profiles/*]
  S --> NT[Notifications]
  S --> IC[AppIconView]
  S --> DB[EditDashboardView]
  S --> FB[SendFeedbackView / ReportProblemEmail]
  S --> SO[SignOutView]
  S --> DEL[Delete account → /v1/user/delete]
```

## 10. Web-app equivalents (traceability)

| Native flow | Web route |
|---|---|
| LoginView / ManualLoginView | `/login`, `/signup` |
| DashboardView | `/dashboard` |
| My Cards / SearchCardsView | `/wallet`, `/wallet/add` |
| Offers | `/offers` |
| Nearby | `/nearby` |
| Merchant/Pointer detail | `/merchants/[id]`, `/categories/[id]` |
| CardValueDetailView | `/calculator` |
| SettingsView | `/settings` |
| (server-side) | `/admin` |
