# Browser extension (loyalty capture)

Source: `extension/` (Manifest V3, plain TypeScript, no remote code, no bundler). Decision: ADR-019.

## What it does
On your click, reads the **visible text** of the loyalty page you are viewing and sends it to **your own Pointwise server** with an extension token. The server parses it with the same rules as emails (source "Browser extension", reliability 70), keeps only a hash and the resulting observations, and discards the text. Because parsing is server-side, rules can be improved without republishing the extension.

## What it never does
Run in the background; read form fields, passwords, cookies or storage (inputs, textareas, selects, password fields, scripts and iframes are removed before reading); sign in to anything; send anything to a third party; act on pages outside the chosen program's own domains (the program list is generated from the backend table, so it cannot drift).

## Install (local, unpacked)
1. `bash extension/build.sh` → `extension/dist`.
2. Chrome/Edge: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`.
3. In Pointwise: Loyalty → Imports & conflicts → **Create extension token** (shown once; scope `loyalty:ingest`; expires in 90 days; at most 5 active; revocable).
4. In the extension popup enter your Pointwise address (https, or http for localhost) and the token, open your program's account page, choose the program, tick the terms note, **Capture this page**. The browser asks once for permission to contact your server only.

## Security model
- Token scope `loyalty:ingest` can post snapshots and nothing else (it cannot read your data; user endpoints answer 401); stored hashed; revoke at any time.
- The endpoint (`POST /loyalty/ingest/snapshot`) is rate-limited by the global throttler, size-limited (30,000 characters), validated, and idempotent per page hash.
- Page text is never stored (checked by an integration test).

## Risks you should know
- **Program terms.** Some programs' terms restrict "robots, spiders, scripts" (verified for Chase's site terms; unverified for most others). This extension runs only on your click, reads only the page in front of you and never signs in, but you should read your programs' terms; the popup asks you to confirm that before capturing.
- **Unverified parsing.** The reading rules are generic and untested against real pages; check the result in Pointwise (the audit trail shows exactly what was read and what was done with it).
- Store distribution is not done; this is an unpacked developer build.
