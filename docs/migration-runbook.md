# Moving PointWise to another server

Everything lives in Postgres, so a move is: prepare the new server, rehearse, freeze the old one, take a final backup, restore on the new one, verify, switch the address. Nothing on the old server is changed by a move, so you can always go back.

## 0. What changes with the new address
| Setting | Why | Where |
|---|---|---|
| `APP_URL`, `NEXTAUTH_URL`, `CORS_ORIGINS`, `API_INTERNAL_URL` | links in emails, the web app's address | environment |
| `NEXT_PUBLIC_API_URL` | baked into the web image at build time | rebuild the frontend image |
| `DATABASE_URL`, `REDIS_URL` | the new database and Redis | environment |
| `TOKEN_ENC_KEY` | may be a new key: backups re-encrypt secrets | environment |
| `JWT_*`, `NEXTAUTH_SECRET`, VAPID keys, `INBOUND_EMAIL_SECRET` | same values keep members signed in and keep push subscriptions | carry in the backup ("Carry environment secrets"), or copy |
| `INBOUND_EMAIL_DOMAIN` | members forward alerts to an address on it; changing it breaks their forwarding | environment |
| Google and Microsoft sign-in redirect addresses | mailbox connect | the provider consoles |
| `PLAID_WEBHOOK_URL` | bank-link updates | the provider console |
| The extension's server address | members re-enter it | the extension popup |
Admin, Backup & Migration, Migration shows this list for the running server (values of secrets are never shown).

## 1. Prepare the new server
Install the **same PointWise version** (the restore refuses a different database version). Set `TOKEN_ENC_KEY` (32+ characters), `DATABASE_URL`, `REDIS_URL`, `SEED_DEMO_USERS=false`, `BACKUP_PASSPHRASE` if you want nightly backups. Start it once so it applies the migrations. Run `node dist/cli/pointwise-admin.js preflight` (or Admin, Migration, This server's checks).

## 2. Rehearse (changes nothing)
`bash docker/migrate/rehearse.sh` backs up the running system, creates a new empty database in the same Postgres, starts the backend image against it with a **different** `TOKEN_ENC_KEY`, applies migrations, restores, runs the verification and drops the database. It prints `REHEARSAL VERIFIED` when every check passes. For a real second machine, do the same by hand: copy a backup there, `verify`, `restore --yes`, `verify-restored`, and look around.

## 3. Freeze the old server
Admin, Migration, Turn on maintenance mode (or `node dist/cli/pointwise-admin.js maintenance on "moving servers"`). Members see a notice; administrators can still sign in; health checks stay up.

## 4. Final backup
Create a backup with the passphrase, tick "Carry environment secrets" if you want sessions and push subscriptions to survive, download it, and copy it to the new server.

## 5. Restore on the new server
`PW_PASSPHRASE='…' bash docker/restore.sh <file>` (or `restore <file> --yes --write-env .env.migrated` to also write the carried secrets to a mode-600 file you move into the new environment and delete). The restore verifies first, restores in one transaction and rolls back on any mismatch.

## 6. Verify
`node dist/cli/pointwise-admin.js verify-restored` or Admin, Migration, Run verification: every reference points at a row, one secret of each kind decrypts with the new key, an administrator exists. Sign in, open a few pages.

## 7. Switch
Point the address (DNS) at the new server; update the sign-in redirect addresses, the bank-link webhook and the inbound email provider; ask members to re-sync their mailboxes and update the extension address.

## 8. Roll back, or finish
To roll back: point the address back and turn maintenance mode off on the old server (it was not changed). When you are sure, retire the old server and keep the final backup somewhere safe.

## If something goes wrong
- *"database version … this server is on …"*: run the PointWise version that made the backup, restore, then upgrade.
- *"the passphrase is wrong, or the file is damaged"*: check the passphrase; run `verify` on the original copy; recopy the file (compare sizes).
- *a secret does not decrypt after restore*: the backup had to leave that secret out (it could not be decrypted on the old server); the warning is in the restore output. Reconnect that bank link, mailbox or offer login.
- *a restore was rolled back*: nothing changed; the message names the model and the difference.
