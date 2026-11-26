# Your data: export and import

Settings, Your Data. Download everything you have in PointWise as one file and bring it back here or into another PointWise (for example after the server moves, or to start a new account).

## What the file has
All of your own data and settings: household members, cards (and any cards you created yourself), offers you entered, transactions, statement imports, benefits and their use, spending profile, planned purchases, loyalty accounts, certificates, status, memberships and award trips, offer automation accounts, discovered offers, enrollment mode and rules, notification settings, AI settings, recommendations and history.

**Never in the file:** your email, password, role, plan, bank-link tokens, mailbox passwords, offer-account logins, loyalty and membership numbers, extension and assistant tokens, push subscriptions, your forwarding address. The file lists what you need to reconnect afterwards.

Shared items (a card from the catalog, a merchant, an issuer) are written by name or slug, not by id, so the file works on another server.

## Importing
1. **Preview** shows what would be added, what already exists, and what could not be matched (for example a catalog card this server does not have). Nothing changes.
2. Choose **Add what is missing** (nothing is removed; importing the same file again adds nothing; your notification, AI and offer settings are taken from the file) or **Replace my data with the file** (removes your cards, offers, transactions and settings first; your account, password and plan stay; you must tick that you have a copy and type `REPLACE`).
3. The import is one transaction: if anything is refused, nothing changes.

Not restored by design: bank links and mailboxes (reconnect), offer-account logins (enter again; server-side login stays off until you turn it on), your AI consent (confirm again), your plan.

## Safety
A file can only write into the account that imports it: every ownership field is replaced by yours, only known columns are accepted, roles, password hashes and credentials in a file are ignored, size and row limits apply, and a file from a newer PointWise is refused.
Command line (administrators): `export-user <email> <file>` and `import-user <email> <file> --mode merge|replace [--apply]`.
