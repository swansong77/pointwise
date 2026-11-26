# Pointwise logo

An original mark made for this project: a bold white **P** on an indigo rounded square, with a gold dot as the P's full stop: the "point". It uses the app's existing brand colours (indigo `#6366f1 → #3730a3`, gold `#fbbf24`). The wordmark is **Point** (medium) + **wise** (extra-bold, brand indigo).

| File | Use |
|---|---|
| `frontend/public/logo/pointwise-mark.svg` | the mark alone (source of every icon) |
| `frontend/public/logo/pointwise-logo.svg` | mark + wordmark (README, documents); the wordmark is live text, so it needs a sans-serif font installed |
| `frontend/src/app/icon.svg`, `apple-icon.png` | browser tab icon, iOS home-screen icon |
| `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | install icons (web app manifest, `src/app/manifest.ts`) and push-notification icon |
| `extension/icons/icon-{16,32,48,128}.png` | browser extension |

Regenerate the PNGs after changing the mark: `cd frontend && node scripts/make-icons.mjs`.

In the app: `src/components/logo.tsx` (`Logo`, `LogoMark`) is used in the header, the sign-in / sign-up pages and the landing page. Keep clear space of at least half the mark's width around it, do not recolour the mark, and use the `light` tone only on a dark indigo background.

This logo is not derived from any other product's artwork or branding.
