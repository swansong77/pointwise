# Guide 6: Getting started with PointWise (for your household)

For the people who **use** PointWise, not the person who installed it. No technical knowledge needed.

PointWise keeps all your household's credit cards, spending, benefits and loyalty points in one place, tells you which card to use, and reminds you before credits, offers and points expire. Your data stays on your own server.

**Time:** about 20 minutes for the first setup; after that, a few minutes a month.

## Read this first: what is automatic, and what is not

PointWise never signs in to your bank, card issuer or airline account for you, and never asks for those passwords. That is deliberate: it keeps your accounts safe. So "automatic" here means *you set it up once, then the data arrives by itself*, using things the banks already send you.

| What you want in PointWise | The automatic way | One-time effort | Needs the server owner? |
|---|---|---|---|
| **Your cards** | Upload one spreadsheet (a CSV) of all your cards | 10 minutes to fill in | no |
| Card **open dates** (for 5/24 and fee timing) | Upload your free credit reports | 10 minutes | no |
| **Spending and transactions** | Drop your monthly statements (PDF or CSV) in all at once | 5 minutes a month | no |
| | Forward each card's "transaction alert" e-mails to a private PointWise address | 5 minutes per card | **yes**, mail forwarding must be set up on the server |
| | Connect a mailbox so PointWise reads card e-mails by itself | 5 minutes per mailbox | partly (see below) |
| | Bank connection | not in the free setup | yes, and it is a paid service |
| **Loyalty points, status, certificates** | Connect a mailbox: program e-mails ("your balance is…", "miles will expire") are read by themselves | same mailbox as above | partly |
| | Upload a program's PDF statement | 2 minutes per statement | no |
| | The browser extension: on your click it reads the program page you are looking at | 10 minutes once, then one click per capture | no |
| **Offers** (card-linked deals) | The offers browser extension: one click reads your issuer's offers page | 10 minutes once | no |
| Cards and loyalty accounts only | Type it in | seconds each | no |

Start with **cards, then statements, then loyalty**. That alone gives you most of the value.

> **Honest limits.** The readers for statements, e-mails and loyalty pages are built from common layouts and have not been checked against every bank or program. After any import, glance at what was read before you rely on it. PointWise shows a preview before saving and keeps a record of what it did.

## Step 1: Sign in and set up your household

1. Open the address the server owner gave you and **sign up** (a password of at least 10 characters, with a letter and a non-letter), or sign in if they already made your account.
2. Open **Household**.

**How a household works.** One person, the *account owner*, holds the household. Everyone else in the family is a **member inside that account**: a spouse, a partner, children, parents. Every member has a name and a role. By default the account owner enters and looks at everything, per person or combined. A member can also be given **their own sign-in** (below).

- **Add members.** In **Household**, add each person with their name and relationship (spouse, partner, child, parent, other). Households with more than one person need the **Pro** plan; on your own server Pro costs nothing (Settings, Subscription, choose Pro).
- **Children** can only be *authorized users* on a card, never the main cardholder.
- **Give a member their own sign-in.** In **Household**, open the member's panel, **Own sign-in**, **Invite … to sign in**. PointWise shows a one-time link (valid 7 days, works once; it is also e-mailed if mail is set up and the member has an address on file). Send it to them by any channel. They open it, choose their own e-mail and password, and land on **My view**: their own cards, credits and benefits, points and recent spending. They cannot see anyone else's data unless you choose **Their own, plus the household overview** for them, which is read only. You can change that, or **Remove sign-in**, at any time; a removed member is signed out at once and their cards and data stay. The account owner cannot invite themselves.
- **Their own sign-in is not a separate account.** The cards, points and spending still belong to the household, so household totals, 5/24 and best-card advice keep working. A person who signs up on their own gets a completely separate account that shares nothing.
- **5/24 is personal.** Chase's 5/24 rule counts each person's own applications, so PointWise tracks it per member, never as a household total.

## Step 2: Add the cards

You have three ways. The spreadsheet is the quickest for a whole household.

### A. Upload a spreadsheet (recommended for many cards)

1. Open **Import**. Under **1. Upload a spreadsheet or CSV**, choose **Download CSV template**.
2. Open it in Excel, Numbers or Google Sheets. One row per card. Keep the header row:

   | Column | What to put |
   |---|---|
   | Owner | whose card it is: the household member's name as you entered it in Household |
   | Card | the card's name, for example "Sapphire Preferred" |
   | Last digits | the last 4 digits (5 for American Express). This is how statements and e-mails find the right card later, so fill it in. |
   | Issuer | the bank |
   | Annual fee | a number, for example 95 |
   | Open date | the day or month you opened it, `2025-03-14` or `2025-03` |
   | Status | Open or Closed |
   | Type | Personal or Business |
   | Credit limit | optional |
   | Authorized user | `yes` if the person is an authorized user on someone else's account, else `no` |
   | Notes | anything |

3. Save as CSV, upload it, choose **Preview import**, check the preview (matches, new cards, problems), then confirm. Nothing is saved before you confirm.

If you already have a benefits tracking spreadsheet, you can upload that directly. The preview shows what it understood.

### B. Add one card by hand

**Wallet**, **Add a card**, pick the card from the catalog, set the opening date, the annual-fee date and whose it is. Good for a card you open later. The free plan holds 5 cards; Pro (free on your own server) is unlimited.

### C. Get the open dates from credit reports

Open dates drive the 5/24 count and the annual-fee reminders. You can get all three bureaus' reports free from **annualcreditreport.com**.

1. For each person, open the report page that lists accounts with their *Date opened*, and print it to PDF (browser, Print, Save as PDF).
2. **Import**, **Credit reports**: choose the person, upload up to three PDFs (one per bureau), review the proposed matches, confirm. PointWise sets open dates, closed dates and authorized-user status on the cards you already added.

Credit report details are kept private to your account and are never sent to any outside service.

## Step 3: Bring in spending and transactions

Open **Spending**. At the top is **Automatic import**, which lists each card and how it gets its transactions. The goal is for every card to say *Alert emails* or *Bank connection* instead of *Not automated*. Pick the method that suits you:

### Method 1: drop all your statements at once (works for everyone)

Each month, download the statements from your cards' websites (PDF is fine) and drop them all together.

1. **Spending**, **Import all your statements**: drag in up to 24 files (PDF or CSV, any cards, any people).
2. PointWise matches each file to the right card by the last digits printed on it, then shows a preview. Nothing is saved yet.
3. Check, then **Import**.

Tips: use the PDF straight from the card's website (a scanned or photographed page has no text and cannot be read); a password-protected PDF must be downloaded again without a password; a file over 10 MB or 40 pages is refused. If a layout is not read, use the CSV export from the same website, or **Review one statement before importing** to inspect it row by row.

Statements are only needed once a month. Transactions in them also **update your benefits automatically**: a purchase or statement credit that matches a benefit (for example a travel credit) marks it used.

### Method 2: forward card alert e-mails (fully automatic, per purchase)

Every card issuer can e-mail you for each transaction. PointWise can read those alerts.

> This needs the server owner to have set up mail forwarding. On the **Spending** page, the **Forward card alerts** box says **"isn't set up on this server"** if they have not; then use method 1 or 3.

1. In **Spending**, **Forward card alerts**, copy your private PointWise address (it looks like `u-…@your-domain`).
2. In each card's website or app, turn on **alerts for every transaction** (and statement credits).
3. In your own mailbox (Gmail, Outlook, …) add a **forwarding rule** that sends those issuer alerts to the PointWise address. Gmail first sends a confirmation message to that address; PointWise shows the confirmation code on the same panel so you can enter it.
4. A card then shows **Alert emails** as soon as one alert has arrived.

What PointWise keeps from each alert: the amount, merchant, card digits and date. It does not keep the e-mail itself. Alerts it cannot match to exactly one card appear under **Which card?** and you pick the right one once.

### Everyone in the household can have their own mail and alerts

If a member has their own sign-in (Step 1), they get **Mail & alerts** in their own menu: their own private forwarding address and their own mailboxes (up to 3). What arrives there updates **only their own cards and points**. That also solves a real problem: if two people have a card ending in the same four digits, or you both hold the same airline program, the household address cannot tell which is which, while each person's own address can.

The account owner can also connect a mailbox **for** a member who has no sign-in: in **Spending**, **Connected mailboxes**, choose *Whose cards and points does this mailbox feed?* and pick the person. In **Household** the owner sees how many mailboxes each person has, when they were last read, and whether anything needs attention, but never the other person's e-mail addresses.

### Method 3: connect a mailbox (PointWise reads it for you)

In **Spending** (or **Loyalty**), **Connected mailboxes**, choose **Connect Gmail** or **Connect Outlook** and sign in with that provider's own screen; or connect any other mailbox with its IMAP details and an **app password** that you create for this purpose and can revoke any time.

- PointWise reads the mailbox **read-only** and only looks at messages from known card issuers and loyalty programs. It never deletes or sends anything. Bodies and attachments are not stored, only the facts it reads.
- **Connect Gmail / Outlook** are greyed out unless the server owner has registered the sign-in with Google or Microsoft. If they are greyed out, use the IMAP form with an app password.
- Card alert e-mails, statement PDFs attached to e-mails, and loyalty program e-mails (Step 4) all arrive this way.

### Method 4: bank connection

Not part of the free setup: connecting directly to banks uses a paid aggregator. If your server owner has turned it on, **Import**, **Connect a bank** signs you in through the aggregator's own window (PointWise never sees your bank password). Otherwise use methods 1 to 3.

There is no form for typing a single transaction by hand. A purchase that never shows up elsewhere arrives with the next statement.

## Step 4: Add loyalty points, status and certificates

Open **Loyalty**. You will see your balances, what expires in the next 30 days, elite status, certificates (free-night awards and so on), and transfer bonuses.

1. **Add a loyalty account** for each program and person: program, member number, current balance. The member number is stored encrypted. Do this once; after that PointWise keeps it current.
2. **Let program e-mails do the updating.** If a mailbox is connected (Step 3, method 3), e-mails such as "your balance is 85,400", "25,000 miles will expire on …", "you reached Gold status" or "you earned a free night award" update the account by themselves: balance, expiry dates, status and certificates. Anything it cannot match to one account is listed, not guessed.
3. **Upload a program statement** (PDF) under **Imports & conflicts**: PointWise reads the balance and activity and checks that the numbers add up.
4. **Use the browser extension** for programs that send little e-mail. It reads the visible text of the account page **only when you click**, never form fields or passwords, and sends it to **your own** server:
   - The server owner or you build and install it once (a developer build for Chrome or Edge: `extension/` in the project, instructions in `docs/loyalty-extension.md`).
   - In PointWise, **Loyalty**, **Imports & conflicts**, **Create extension token** (shown once, lasts 90 days). Paste your server address and the token into the extension.
   - Open the program's own page, choose the program, tick the terms note, press **Capture this page**.
   - Read each program's terms: a few restrict automated tools. The extension acts only on your click and never signs in for you.
5. **Type it in** when nothing else fits. A hand-typed value is trusted least: a later e-mail or statement will correct it, and PointWise will tell you when they disagree.

## Step 5: Offers

If you track card-linked offers, the **offers extension** (`docs/offer-automation-extension.md`) reads your issuer's offers page on your click and brings them into **Offers**. After you approve offers in PointWise it can press the issuer's own "Add" button for exactly the ones you chose. Without it, add offers by hand in **Offers**.

## Step 6: Choose how PointWise talks to you

1. **Settings, Notifications**: pick in-app, e-mail (only if the server owner set up mail) or browser notifications.
2. **Quiet Mode** (Settings): routine updates are held and shown in one daily summary; urgent ones (an expiring credit, a points expiry) still arrive at once. Off by default.
3. **Copilot and Chief of Staff** (optional, off by default): Copilot answers questions and plans from your data; Chief of Staff ranks the things that need doing and shows value at risk. Both work on the server without sending anything to outside AI services. A cloud AI model is used only if the server owner adds one **and** you separately agree in Settings; even then only a masked summary is shared (no names, card numbers or exact amounts), and Settings shows exactly what was sent.

## Your first week and your monthly routine

**First week**

- Day 1: Steps 1 and 2 (household, cards).
- Day 1 or 2: Step 3, method 1 with the last statement for each card. Check **Dashboard** and **Benefits**.
- Within the week: set up forwarding or a mailbox (Step 3), add loyalty accounts (Step 4).
- Mark the benefits you have already used this year, so reminders are accurate.

**Each month (5 minutes)**

1. Drop the new statements (Step 3, method 1) if some cards are not on alerts.
2. Open **Dashboard**: expiring credits, offers and points; the Chief of Staff list if you use it.
3. Spot-check anything marked *needs attention* or *Which card?*.

## When it does not look right

| Symptom | What to do |
|---|---|
| "No accounts were found" on a credit report | paste the text of the accounts list into the box instead of the PDF |
| A statement is "not read" or shows no rows | use the PDF from the card's own website (not a scan), or the CSV export; try **Review one statement** |
| A transaction landed on the wrong card | the card's last digits are missing or duplicated in your card list: fix them in **Wallet** |
| A card still says **Not automated** | no alert has arrived yet (forwarding takes the next purchase), or the forwarding rule is not active |
| "Forward card alerts isn't set up on this server" | ask the server owner; meanwhile use statement drops or a connected mailbox |
| A loyalty value changed by itself | a better source (an e-mail or statement) corrected a hand-typed number. The history under **Imports & conflicts** shows what changed and why. |
| A member's link says it is not valid | it expired (7 days), was already used, or was replaced by a newer one. Make a new invitation in Household. |

## Your data and privacy

- Everything is stored on **your own server**, not a company's cloud.
- You can **export** your data and **delete** your account in **Settings, Privacy & data**.
- PointWise never asks for, stores or uses your bank, issuer or program passwords.
- Statement files, e-mail bodies and loyalty page text are read, turned into plain facts, and thrown away.
- Raw card data is never sent to an outside AI service.

## Next

Server owners: [Guide 2](02-self-host-install.md) (install) and [Guide 3](03-automated-deployment.md) (updates and backups). To turn on alert forwarding, the server owner follows `docs/auto-capture.md` (it needs a domain and a free inbound-mail service).
