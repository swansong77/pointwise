# Email ingestion — test cases

Code: `mailbox/*`, `domain/mail-classify.ts`, `CaptureService.receiveFromMailbox`. Synthetic messages and a fake IMAP client only.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-MBX-01 | SEC | Mailbox host guard (SSRF) | private / loopback / link-local / CGNAT / IPv6 ULA hosts | assertPublicHost | refused; public accepted; MAILBOX_ALLOW_PRIVATE_HOSTS=true overrides for development | P0 | Critical | ✅ U, INT, CY-INT-02, PW-INT-03 |
| TC-MBX-02 | POS | Headers first | mix of allowed and unrelated senders | IMAP fetchNew | bodies fetched only for allow-listed senders; others never read | P0 | Critical | ✅ U (mailbox.spec) |
| TC-MBX-03 | POS | Cursor | resume, UIDVALIDITY change, empty first sync, batch cap | fetchNew | resumes after last UID; resets on validity change; empty sync remembers mailbox end; "more" flag | P0 | Major | ✅ U |
| TC-MBX-04 | SEC | Credentials | connect | POST /mailboxes | password encrypted at rest and never returned; limit 3; duplicates refused | P0 | Critical | ✅ U, INT |
| TC-MBX-05 | POS | Sync through the capture pipeline | alert, stranger, payment reminder | POST /mailboxes/:id/sync | transaction created from the alert; stranger ignored; reminder labelled; second sync adds nothing (Message-ID) | P0 | Critical | ✅ INT |
| TC-MBX-06 | NEG | Failure keeps the cursor | server error | sync | status ERROR with message; cursor unchanged; next run retries | P0 | Major | ✅ U, INT |
| TC-MBX-07 | POS | Mail classification | subjects | classifyMail | statement, transaction alert, travel/offer credit, account alert, purchase confirmation, other | P1 | Minor | ✅ U |
| TC-MBX-08 | SEC | Ownership | other user | sync / delete | 404 | P0 | Critical | ✅ INT |
| TC-MBX-09 | A11Y | Mailbox panel |  | axe | no serious violations; clear error for a bad server | P1 | Minor | ✅ PW-INT-03 |
| TC-MBX-10 | SEC | OAuth state | consent URL for a user | sealState / openState | encrypted, bound to the user, expires after 10 minutes; forged or altered state rejected | P0 | Critical | ✅ U (oauth.spec), INT |
| TC-MBX-11 | POS | Gmail consent URL and token requests | client id/secret configured | buildAuthUrl, exchangeCode | read-only scope only, offline access + forced consent; PKCE only for Microsoft | P0 | Major | ✅ U |
| TC-MBX-12 | POS | Gmail connector | fake Google | fetchNew | from: query per issuer, raw fetch, cursor advances, page cap and "more", 403 → reconnect, 429 → retry later | P0 | Major | ✅ U |
| TC-MBX-13 | POS | Graph connector | fake Microsoft | fetchNew | oldest first, envelope checked before the MIME is opened, rotated refresh token saved, cursor stops at last read | P0 | Major | ✅ U |
| TC-MBX-14 | POS | Gmail sign-in end to end | fake Google | start → callback → sync → revoked → disconnect | encrypted refresh token, transaction imported, RECONNECT status, grant revoked on disconnect | P0 | Critical | ✅ INT |
| TC-MBX-15 | NEG | Not configured / declined / expired | no client id; access_denied; forged state | start / callback | 400 / redirect with clear reason; nothing created | P0 | Major | ✅ INT |
