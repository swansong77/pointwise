# Rewards audit

Generated 2026-11-26 by `backend/scripts/export-rewards-audit.ts` over the curated list, the issuer listings and the issuer-page checks. It finds gaps, doubtful values and unconfirmed rates; it cannot prove a rate right. Verification means an issuer's own product or listing page was read and states the rate.

## Summary

| | |
|---|---|
| Cards | 251 |
| Every rate confirmed by an issuer page | 111 |
| Some rates confirmed | 3 |
| Nothing confirmed | 137 |
| Errors | 1 |
| Warnings | 62 |
| Notes | 114 |

| Finding | Cards |
|---|---|
| No rate confirmed by an issuer page (`UNVERIFIED`) | 83 |
| No earning rates at all (`NO_REWARDS`) | 54 |
| Combined caps stored per category (`COMBINED_CAP`) | 28 |
| Described as combined, no cap stored (`COMBINED_NO_CAP`) | 7 |
| Very high category multipliers (`HIGH_MULTIPLIER`) | 3 |
| No base rate (`NO_BASE`) | 1 |
| A cap with nothing to fall back to (`CAP_NO_BASE`) | 1 |

## Errors

### No base rate (1)

- `amex-hilton-business`: no base ("everything else") rate

## Warnings

### A cap with nothing to fall back to (1)

- `amex-hilton-business`: everything-else: capped but the card has no base rate to fall back to

### Described as combined, no cap stored (7)

- `boa-business-advantage-customized-cash`: dining: the description says "combined" but no cap is stored
- `bank-of-america-customized-cash-rewards-secured-credit-card`: groceries: the description says "combined" but no cap is stored
- `bank-of-america-customized-cash-rewards-secured-credit-card`: wholesale-clubs: the description says "combined" but no cap is stored
- `truist-enjoy-cash-card`: gas: the description says "combined" but no cap is stored
- `truist-enjoy-cash-card`: groceries: the description says "combined" but no cap is stored
- `truist-enjoy-cash-secured-card`: groceries: the description says "combined" but no cap is stored
- `truist-business-cash-rewards-card`: dining: the description says "combined" but no cap is stored

### No earning rates at all (54)

- `chase-slate`: the card has no earning rates at all, so it ranks last in every category
- `chase-ihg-one-rewards-premier-select-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `chase-sapphire-reserve-for-business`: the card has no earning rates at all, so it ranks last in every category
- `chase-united-business-card`: the card has no earning rates at all, so it ranks last in every category
- `chase-united-club-business-card`: the card has no earning rates at all, so it ranks last in every category
- `chase-southwest-rapid-rewards-performance-business-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `chase-southwest-rapid-rewards-premier-business-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-platinum-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-platinum-secured`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-pottery-barn-key-rewards-visa`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-williams-sonoma-key-rewards-visa`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-west-elm-key-rewards-visa`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-key-rewards-visa`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-cabela-s-club-card`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-bass-pro-shops-club-card`: the card has no earning rates at all, so it ranks last in every category
- `capital-one-bass-pro-shops-and-cabela-s-club-business-card`: the card has no earning rates at all, so it ranks last in every category
- `navy-federal-credit-union-navy-federal-platinum`: the card has no earning rates at all, so it ranks last in every category
- `citi-diamond-preferred-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-strata-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-simplicity-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-at-t-points-plus-card-from-citi`: the card has no earning rates at all, so it ranks last in every category
- `citi-secured-mastercard`: the card has no earning rates at all, so it ranks last in every category
- `citi-my-best-buy-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-macy-s-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-bloomingdale-s-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-the-home-depot-consumer-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-tractor-supply-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-l-l-bean-mastercard`: the card has no earning rates at all, so it ranks last in every category
- `citi-dillard-s-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-the-home-depot-pro-xtra-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-wayfair-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `citi-goodyear-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `wells-fargo-one-key-card`: the card has no earning rates at all, so it ranks last in every category
- `wells-fargo-choice-privileges-mastercard`: the card has no earning rates at all, so it ranks last in every category
- `wells-fargo-choice-privileges-select-mastercard`: the card has no earning rates at all, so it ranks last in every category
- `wells-fargo-reflect-card`: the card has no earning rates at all, so it ranks last in every category
- `u-s-bank-secured-visa-card`: the card has no earning rates at all, so it ranks last in every category
- `bank-of-america-bankamericard-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `bank-of-america-bankamericard-secured-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `synchrony-preferred-mastercard`: the card has no earning rates at all, so it ranks last in every category
- `pnc-spend-wise-visa`: the card has no earning rates at all, so it ranks last in every category
- `pnc-businessoptions-visa-signature`: the card has no earning rates at all, so it ranks last in every category
- `td-bank-td-flexpay-credit-card`: the card has no earning rates at all, so it ranks last in every category
- `truist-future-card`: the card has no earning rates at all, so it ranks last in every category
- `truist-business-card`: the card has no earning rates at all, so it ranks last in every category
- `regions-life-visa`: the card has no earning rates at all, so it ranks last in every category
- `regions-explore-visa`: the card has no earning rates at all, so it ranks last in every category
- `digital-federal-credit-union-dcu-visa-platinum`: the card has no earning rates at all, so it ranks last in every category
- `digital-federal-credit-union-dcu-visa-signature-cash-rewards`: the card has no earning rates at all, so it ranks last in every category
- `digital-federal-credit-union-dcu-visa-platinum-secured`: the card has no earning rates at all, so it ranks last in every category
- `san-diego-county-credit-union-sdccu-visa-platinum-with-fly-miles-plus`: the card has no earning rates at all, so it ranks last in every category
- `san-diego-county-credit-union-sdccu-visa-platinum`: the card has no earning rates at all, so it ranks last in every category
- `san-diego-county-credit-union-sdccu-share-secured-visa-classic`: the card has no earning rates at all, so it ranks last in every category
- `becu-lift-low-rate-visa`: the card has no earning rates at all, so it ranks last in every category

## Confirmed against an issuer page

114 card(s) have at least one rate confirmed:

- `amex-gold` (6 of 6 rates)
- `bank-of-america-air-france-klm-visa-signature-credit-card` (2 of 2 rates)
- `bank-of-america-allways-rewards-visa-card` (2 of 2 rates)
- `bank-of-america-atmos-rewards-ascent-visa-signature-credit-card` (5 of 5 rates)
- `bank-of-america-atmos-rewards-summit-visa-infinite-credit-card` (2 of 2 rates)
- `bank-of-america-customized-cash-rewards-secured-credit-card` (3 of 3 rates)
- `bank-of-america-norwegian-cruise-line-world-mastercard` (3 of 3 rates)
- `bank-of-america-royal-one-plus-visa-signature-credit-card` (6 of 6 rates)
- `bank-of-america-royal-one-visa-signature-credit-card` (3 of 3 rates)
- `barclays-aarp-essential-rewards-mastercard-from-barclays` (3 of 3 rates)
- `barclays-aarp-travel-rewards-mastercard-from-barclays` (5 of 5 rates)
- `barclays-athleta-encore-mastercard` (1 of 1 rates)
- `barclays-banana-republic-encore-mastercard` (1 of 1 rates)
- `barclays-barnes-noble-mastercard` (2 of 2 rates)
- `barclays-breeze-easy-visa-credit-card` (3 of 3 rates)
- `barclays-capital-vacations-world-mastercard` (2 of 2 rates)
- `barclays-carnival-rewards-mastercard` (3 of 3 rates)
- `barclays-emirates-skywards-premium-world-elite-mastercard` (2 of 2 rates)
- `barclays-emirates-skywards-rewards-world-elite-mastercard` (2 of 2 rates)
- `barclays-frontier-airlines-world-mastercard` (2 of 2 rates)
- `barclays-gap-encore-mastercard` (1 of 1 rates)
- `barclays-gm-business-mastercard` (1 of 1 rates)
- `barclays-gm-rewards-mastercard` (1 of 1 rates)
- `barclays-jetblue` (3 of 3 rates)
- `barclays-jetblue-business-card` (2 of 2 rates)
- `barclays-jetblue-plus` (3 of 3 rates)
- `barclays-jetblue-premier-card` (3 of 3 rates)
- `barclays-miles-more-world-elite-mastercard` (2 of 2 rates)
- `barclays-old-navy-encore-mastercard` (1 of 1 rates)
- `barclays-rci-elite-rewards-world-mastercard` (4 of 4 rates)
- `barclays-upromise-world-mastercard` (1 of 1 rates)
- `barclays-wyndham-earner` (4 of 4 rates)
- `barclays-wyndham-earner-business` (2 of 2 rates)
- `barclays-wyndham-earner-plus` (4 of 4 rates)
- `barclays-wyndham-rewards-earner-premier-card` (4 of 4 rates)
- `becu-elevate-rewards-visa-signature` (5 of 5 rates)
- `becu-rise-cash-back-visa-signature` (1 of 1 rates)
- `bilt-blue-card` (1 of 1 rates)
- `bilt-obsidian-card` (2 of 2 rates)
- `bilt-palladium-card` (1 of 1 rates)
- `boa-customized-cash-rewards` (9 of 9 rates)
- `boa-premium-rewards` (3 of 3 rates)
- `boa-unlimited-cash-rewards` (1 of 1 rates)
- `bread-financial-bread-cashback-american-express-credit-card` (1 of 1 rates)
- `bread-financial-bread-rewards-american-express-credit-card` (4 of 4 rates)
- `capital-one-bj-s-one-mastercard` (1 of 1 rates)
- `capital-one-bj-s-one-plus-mastercard` (1 of 1 rates)
- `capital-one-kohl-s-rewards-visa` (3 of 3 rates)
- `capital-one-quicksilver` (3 of 3 rates)
- `capital-one-quicksilver-secured-rewards` (1 of 1 rates)
- `capital-one-rei-co-op-mastercard` (1 of 1 rates)
- `capital-one-savor` (4 of 5 rates)
- `capital-one-savorone-rewards` (4 of 4 rates)
- `capital-one-spark-1-classic` (1 of 1 rates)
- `capital-one-spark-2-cash` (1 of 1 rates)
- `capital-one-t-mobile-visa` (1 of 1 rates)
- `capital-one-venture` (3 of 3 rates)
- `chase-aer-lingus-visa-signature-card` (2 of 2 rates)
- `chase-air-canada-aeroplan-credit-card` (2 of 2 rates)
- `chase-disney-inspire-visa-card` (4 of 4 rates)
- `chase-freedom-flex` (4 of 4 rates)
- `chase-freedom-unlimited` (4 of 4 rates)
- `chase-iberia-visa-signature-card` (2 of 2 rates)
- `chase-ihg-one-rewards-premier` (8 of 8 rates)
- `chase-ink-business-cash` (4 of 4 rates)
- `chase-ink-business-preferred` (3 of 3 rates)
- `chase-ink-business-unlimited` (1 of 1 rates)
- `chase-marriott-bonvoy-boundless` (5 of 5 rates)
- `chase-prime-visa` (6 of 7 rates)
- `chase-sapphire-preferred` (7 of 7 rates)
- `chase-sapphire-reserve` (5 of 5 rates)
- `chase-southwest-rapid-rewards-plus-credit-card` (1 of 1 rates)
- `chase-southwest-rapid-rewards-premier-credit-card` (1 of 1 rates)
- `chase-southwest-rapid-rewards-priority-credit-card` (3 of 3 rates)
- `chase-united-explorer` (4 of 4 rates)
- `citi-costco-anywhere` (5 of 5 rates)
- `citi-strata-premier` (8 of 8 rates)
- `discover-it-balance-transfer` (1 of 1 rates)
- `discover-it-miles` (1 of 1 rates)
- `discover-it-secured-cash-back` (1 of 1 rates)
- `discover-it-student-chrome` (3 of 3 rates)
- `discover-nhl-discover-it` (1 of 1 rates)
- `navy-federal-credit-union-navy-federal-cashrewards-secured` (1 of 1 rates)
- `navy-federal-credit-union-navy-federal-go-biz-rewards` (1 of 1 rates)
- `navy-federal-credit-union-navy-federal-go-rewards` (3 of 3 rates)
- `navy-federal-flagship-rewards` (2 of 3 rates)
- `pnc-cash-rewards-visa` (4 of 4 rates)
- `pnc-cash-rewards-visa-signature-business` (1 of 1 rates)
- `pnc-cash-unlimited-visa` (1 of 1 rates)
- `regions-cash-rewards-visa-signature` (1 of 1 rates)
- `regions-prestige-visa-signature` (5 of 5 rates)
- `robinhood-gold-card` (1 of 1 rates)
- `san-diego-county-credit-union-sdccu-cash-rewards-visa-platinum` (1 of 1 rates)
- `san-diego-county-credit-union-sdccu-visa-signature` (1 of 1 rates)
- `synchrony-plus-world-mastercard` (1 of 1 rates)
- `synchrony-premier-world-mastercard` (1 of 1 rates)
- `td-bank-td-business-solutions-credit-card` (1 of 1 rates)
- `td-bank-td-cash-credit-card` (1 of 1 rates)
- `td-bank-td-cash-secured-credit-card` (1 of 1 rates)
- `td-bank-td-double-up-credit-card` (1 of 1 rates)
- `td-bank-td-first-class-visa-signature-credit-card` (3 of 3 rates)
- `truist-business-cash-rewards-card` (2 of 2 rates)
- `truist-business-premium-card` (1 of 1 rates)
- `truist-business-travel-rewards-card` (4 of 4 rates)
- `truist-enjoy-beyond-card` (5 of 5 rates)
- `truist-enjoy-cash-card` (3 of 3 rates)
- `truist-enjoy-cash-secured-card` (2 of 2 rates)
- `truist-enjoy-travel-card` (4 of 4 rates)
- `u-s-bank-business-essentials-plus-visa-signature-card` (1 of 1 rates)
- `u-s-bank-business-essentials-visa-card` (1 of 1 rates)
- `u-s-bank-smartly-visa-signature-card` (1 of 1 rates)
- `us-bank-altitude-go` (5 of 5 rates)
- `wells-fargo-active-cash` (1 of 1 rates)
- `wells-fargo-autograph` (7 of 7 rates)
