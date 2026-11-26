# Offers browser extension

Folder `extension-offers/` (Manifest V3). Build with `bash extension-offers/build.sh` and load `extension-offers/dist` as an unpacked extension.

## What it does
1. **Capture this page:** reads the visible text of the offers page you have open (never form fields, passwords, cookies or storage) and sends it to your own PointWise server. The server parses it, keeps a hash and the offers, and discards the text.
2. **Enroll selected:** after you approve offers in PointWise, presses the issuer's own Add button for exactly those offers on the open page, then reports what happened so PointWise can confirm it on the next capture.

## Security model
- Runs only when you click; no background activity, no content script on issuer pages.
- Works only on issuer domains (American Express, Chase, Citi, Bank of America, Capital One, Wells Fargo) over https.
- Token: `offers:ingest` scope, 90 days, up to 5 active, revocable, hashed at rest; it can only send offers and read the approved queue.
- The server address must be https (or localhost); the extension asks for permission to contact that address when you first use it.
- Your issuer password is never read, stored or sent.

## Limits
Page matching is by visible text (a button labelled Add inside the block that names the merchant, with exactly one such button). It has not been checked against the real issuer pages, will miss some layouts and refuses when more than one button could match. The issuer's terms may forbid scripted clicks (Chase's do); the popup shows the issuer's note before first use.
