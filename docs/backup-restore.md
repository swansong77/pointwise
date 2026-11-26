# Backup and restore

PointWise can write an **encrypted backup of the whole system** and restore it, on the same server or a different one. Postgres is the only durable store (no files; Redis holds only queued jobs and rebuilds itself), so a backup is a consistent copy of the database.

## What a backup contains
Every table: members and their data, the card catalog, merchants, loyalty registry, AI and MCP configuration, research, the audit log. Short-lived tables (sessions, notifications, analytics, agent runs, the inbound-email log) are included only when you ask ("Include sessions, notifications and logs").

**Secrets** (bank-link tokens, mailbox passwords, offer-account logins, loyalty and membership numbers, AI provider keys, MCP secrets) are decrypted with the server's `TOKEN_ENC_KEY` while the backup is written and stored **inside the encrypted file**, then re-encrypted with the target server's key on restore. That is what lets a restore work on a server with a different `TOKEN_ENC_KEY`.

Optionally ("Carry environment secrets") the file also carries `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `INTERNAL_API_SECRET`, `NEXTAUTH_SECRET`, `INBOUND_EMAIL_SECRET` and the VAPID keys, so members stay signed in and keep their push subscriptions after a move. The database password, `TOKEN_ENC_KEY` and the backup passphrase are never carried.

## The file
`pointwise-YYYYMMDD-HHMMSS.pwbackup`: newline-delimited JSON (a header, one line per row, an optional environment line, a manifest with a row count and SHA-256 per model), gzip-compressed, then encrypted with AES-256-GCM using a key derived from your passphrase with scrypt. Every frame is authenticated together with the header, its position and a last-frame flag, so a wrong passphrase, a changed byte, a removed, reordered or extra frame, or a truncated file is detected. Files are mode 600.

**The passphrase is the only protection and is never stored. If you lose it the backup cannot be read.** Use at least 12 characters. A backup holds everything a database dump would, so treat the file like the database itself and copy it somewhere else (another disk or machine): the app writes to `BACKUP_DIR` (the `pointwise-backups` volume) and does not copy off the host.

## Making backups
- **In the app:** Admin, Backup & Migration. Choose a passphrase, Create backup.
- **Nightly:** set `BACKUP_PASSPHRASE` (and optionally `BACKUP_KEEP`, default 7, and `BACKUP_INCLUDE_EPHEMERAL`). The job `backup-nightly` runs at 03:30 UTC, keeps the newest `BACKUP_KEEP` files, writes an audit entry and, on failure, notifies the administrators.
- **Command line:** `PW_PASSPHRASE='…' bash docker/backup.sh` writes a backup in the container and copies it to `docker/backups/` (ignored by git).

The backup is one repeatable-read transaction, so it is consistent while the app keeps running.

## Verifying
Admin, Verify (or `node dist/cli/pointwise-admin.js verify <file>`): decrypts the file and checks every frame, every model's row count and checksum, and the database version, without touching the database. Verify a backup after you make it and before you rely on it.

## Restoring
Admin, Restore… (type `RESTORE`), or `PW_PASSPHRASE='…' bash docker/restore.sh <file>`. **A restore replaces all data.** It:
1. verifies the whole file first (a wrong passphrase or damage is found before anything changes);
2. refuses a backup from a different database version (restore on the version that made it, then upgrade);
3. makes a **pre-restore backup** of what is there now (`pre-restore-…`, same passphrase), unless the system is empty;
4. empties every table and fills them in foreign-key order in **one transaction**, re-encrypting secrets with this server's key;
5. checks every model's count and checksum against the manifest and **rolls everything back** on any difference or any row the schema refuses;
6. turns maintenance mode off.

Sessions: JWTs stay valid when the signing secrets are the same (carry them); otherwise members sign in again.

## Member data export and import
See `user-data-export.md`.

## What is not covered
Redis (queued and scheduled jobs; the schedulers re-register themselves, in-flight jobs are lost), the application code and images, and your `.env` (copy it yourself; see `migration-runbook.md`).

## Settings
`BACKUP_DIR` (default `/var/backups/pointwise`), `BACKUP_PASSPHRASE`, `BACKUP_KEEP`, `BACKUP_INCLUDE_EPHEMERAL`, `BACKUP_MAX_MB` (upload limit, default 2048).
