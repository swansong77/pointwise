# Spend tracking & automatic benefit tracking — test cases (Phase H)

Code under test: `backend/src/domain/spend.ts`, `backend/src/spend/**`, `backend/src/portfolio/connections.ts` (transactions sync), `/spending`, `/benefits` auto-tracking. Fixtures: Chase-/Amex-style statement CSVs built in the tests with current-month dates.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-SP-01 | POS | Statement preview | Gold card, Chase-style CSV | POST /spending/statements/preview | sign negative detected; 5 rows; kinds; merchant + category; benefit per row; nothing saved | P0 | Major | ✅ INT, U, PW-SP-01 |
| TC-SP-02 | POS | Import updates benefits | same | POST /spending/statements | ride $10 EXPECTED → credit CONFIRMED; coffee $6.50 + $3.50 EXPECTED (cap); bonus spend +purchases | P0 | Critical | ✅ INT, PW-SP-01, CY-SP-01 |
| TC-SP-03 | NEG | Duplicate statement | imported | import again | 0 imported, 5 duplicates, no benefit updates | P0 | Major | ✅ INT, U |
| TC-SP-04 | POS | Statement layouts | Chase / Amex with preamble / debit+credit / no payments | parseStatement | columns found; sign detected or overridden; identical rows distinct | P1 | Major | ✅ U |
| TC-SP-05 | POS | Suggested and custom rules | rideshare, dining, Uber Cash, CLEAR, trusted traveler | suggestRules; PUT auto-tracking | suggestions; custom rules applied + rescan; reset; invalid → 400; off → no updates | P1 | Major | ✅ U, INT, PW-SP-01 |
| TC-SP-06 | POS | Dismiss a wrong match | auto usage | dismiss; rescan | DISMISSED, amount 0, not re-created; manual usage → 400 | P1 | Major | ✅ INT, PW-SP-01 |
| TC-SP-07 | POS | Statement credit confirms expected usage | expected $6.50 | manual CREDIT "DINING CREDIT" $10 | $6.50 confirmed + $3.50 recorded (cap) | P0 | Major | ✅ INT, CY-SP-01 |
| TC-SP-08 | POS | Delete a transaction | ride usage | DELETE /transactions/:id | usage removed; bonus spend adjusted | P1 | Major | ✅ INT |
| TC-SP-09 | SEC | Ownership and upload validation | other user | upload, dismiss, rules, list; .pdf; no file; bad header; unknown category | 404 / [] ; 400 | P0 | Critical | ✅ INT |
| TC-SP-10 | POS | Bank transactions | Plaid sandbox | sync | posted transactions imported per card; pending skipped; removed deleted; cursor saved; failure does not break account sync | P1 | Major | ✅ U |
| TC-SP-11 | POS | Matching rules | benefits | matchBenefit | merchant word beats category; credit by longest word; payments/refunds/fees never; "clear" ≠ "nuclear" | P0 | Major | ✅ U |
| TC-SP-12 | A11Y | Spending and benefits pages | — | axe | no serious/critical violations | P2 | Minor | ✅ PW-SP-01, PW-SMK |
| TC-SP-13 | POS | PDF statement import | Gold card; synthetic PDF (credits section, purchases) | preview; import; import again | format pdf; payment/credit/purchases; benefits expected → confirmed; source PDF; re-import 0 new; account line not a transaction | P0 | Critical | ✅ INT, PW-SP-02 |
| TC-SP-14 | POS | PDF layouts, years and signs | Chase / Amex / Capital One / BofA-style lines | parseStatementPdf | dates (incl. Dec on Jan statement), CR / minus / parentheses / section credits, reference + account columns removed, summary lines skipped | P0 | Major | ✅ U |
| TC-SP-15 | SEC | Untrusted PDF handling | broken, scanned, letter, >40 pages, slow | extract / preview | clear 400 messages; child process killed on timeout; nothing stored | P0 | Critical | ✅ U, INT |
| TC-AC-01 | POS | Forwarded alert → transaction + benefit | card ··4321, Chase-style alert (DKIM pass) | POST /inbound/email | PROCESSED; source EMAIL; Rideshare EXPECTED $10; same Message-ID again → DUPLICATE | P0 | Critical | ✅ INT, PW-CAP-01 |
| TC-AC-02 | SEC | Inbound endpoint protection | no / wrong secret; unknown or paused address | POST | 401 / 401; accepted false | P0 | Critical | ✅ INT |
| TC-AC-03 | SEC | Sender checks | non-issuer sender; DKIM fail from our receiver; forged Authentication-Results | receive | REJECTED; forged header ignored (unknown) | P0 | Critical | ✅ INT, U |
| TC-AC-04 | POS | Gmail forwarding confirmation | Gmail confirmation email | receive; GET /capture/status | code and link shown | P1 | Major | ✅ INT, U |
| TC-AC-05 | POS | Unknown card → assign and remember digits | alert ending 7777, card without digits | assign remember | PROCESSED; card lastFour 7777; next alert matched directly; other user 404; second assign 400 | P1 | Major | ✅ INT |
| TC-AC-06 | POS | Statement PDF attached to an email | alerted Uber + statement with Uber and FreshCart | receive | 1 new, 1 merged with the alert (source PDF, benefit kept) | P0 | Major | ✅ INT |
| TC-AC-07 | POS | Alert wording and ignore rules | Chase / key-value / Citi / Capital One / credit / refund; decline, payment, statement notice | parseAlert | fields extracted; ignored with reason | P0 | Major | ✅ U |
| TC-AC-08 | SEC | Plaid webhook verification | ES256 key pair | webhook valid / forged / stale / HS256 / body mismatch / malformed | sync triggered; ITEM_LOGIN_REQUIRED → needs sign-in; LOGIN_REPAIRED clears; others 403 | P0 | Critical | ✅ U |
| TC-AC-09 | POS | Re-link a bank | connection needs sign-in | relink-token; relinked | update-mode link token with access token; flag cleared and sync | P1 | Major | ✅ U |
| TC-AC-10 | POS | Automation status and inbox controls | cards with / without digits | status; pause; rotate; discard | via EMAIL / MANUAL with hints; paused → not accepted; old address stops; discard own item only | P1 | Major | ✅ INT, PW-CAP-01 |
| TC-AC-11 | POS | Plaid Link loader | — | loadPlaid / openPlaidLink | official script loaded once; public token or null on exit | P2 | Minor | ✅ U (frontend) |
| TC-AC-12 | POS | Bulk drop matches each statement to its card | cards ending 4321 and 9876; PDF showing 4321, CSV named …9876…, CSV without digits, non-statement file | drop all | PDF → card 4321, CSV → card 9876 (matched by digits), others NEEDS_CARD; totals | P0 | Major | ✅ INT, PW-SP-03 |
| TC-AC-13 | POS | Choose the card for unmatched files | NEEDS_CARD file | pick card; send again | imported with matchedBy choice; another user's card → ERROR, nothing stored | P1 | Major | ✅ INT, PW-SP-03 |
| TC-AC-14 | NEG | The same statement file is never imported twice | files already imported | drop again (any channel) | ALREADY_IMPORTED; no new transactions; only hash + period stored, never the file | P0 | Major | ✅ INT |
| TC-AC-15 | POS | Statement rows already synced from the bank are not double counted | BANK transaction $25.99; statement row $25.99 a day later | import statement | 1 new, 1 duplicate; one $25.99 transaction | P0 | Critical | ✅ INT |
| TC-AC-16 | POS | Statement coverage and Statement due | card with a statement; new card without feed | status | statements through <date>; new card flagged Statement due; ≤ 24 files, empty → 400, unauthenticated → 401 | P1 | Minor | ✅ INT, PW-SP-03 |
