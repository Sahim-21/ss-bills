# Terms of Service and Privacy Notice: DRAFT

Drafted 2026-10-25 (Task 8). **This is a working draft, not legal advice.** It is written to match what the software actually does (section 1 is checked against the code). Anything in **[OWNER: …]** is a business decision or a fact only the owner knows. Have a lawyer familiar with Indian law review it before the first customer, in particular against the Digital Personal Data Protection Act, 2023, the Information Technology Act, 2000, and GST record-keeping rules. Nothing here is published anywhere yet.

## 1. What the software really does with data (verified against the code)

| Where | What | Why | Who can see it |
|---|---|---|---|
| **The restaurant's PC only** (SQLite) | Every bill, item, payment mode, customer name/phone typed on a bill, staff names and PIN hashes, printers, held bills | Billing | The restaurant. SS Bills never receives it |
| **Sent on activation** | Licence key, a PC identifier (derived from the PC, not the user's name), the PC's name (e.g. "COUNTER-1"), app version | To bind the licence to one PC | SS Bills staff in the console |
| **Sent on each check-in** (start, each login, hourly) | Licence key, PC identifier, app version, and the **daily summaries** below | Licence status and sales overview | SS Bills staff |
| **Daily summary** (one row per day) | Date, total sales, number of bills, cancelled bills, cash / UPI / card totals, tax total, the **name and quantity of the best-selling item**. No customer data, no bill lines | Vendor insights, support | SS Bills staff |
| **Cloud copy of menu and settings** (newest 10 copies kept) | Restaurant name, tagline, address, phone, GSTIN, FSSAI, receipt header/footer, GST settings, categories, menu items and prices, table names. **Never** bills, customers, staff, PINs, printers or licence data | Restore the menu on a new PC | Only a PC activated for that licence (the console never displays menus) |
| **Held by SS Bills about the client** | Restaurant name, owner name, phone, email, city, address, GSTIN, notes, plan, expiry, payments recorded by hand (amount, method, reference), an **append-only audit log** of licence actions | Run the business, invoice, support | SS Bills staff with MFA |
| **Network details** | The caller's IP address is seen when the app contacts the server and is used only for short-lived abuse limits (counters are deleted after about a day). It is not stored with the client record. Supabase and Cloudflare, as providers, may keep their own technical logs | Prevent abuse | Providers |
| **Local backups** | Copies of the restaurant's database made on its own PC | Safety | The restaurant |

Not collected: no analytics, advertising or tracking in the apps; no card numbers (payments to SS Bills are recorded by hand, D-026); no location. The console website uses only the sign-in session needed to log vendor staff in.

Processors (subject to confirming exact products and regions): Supabase (database and functions) **[OWNER: region chosen when the project was created; confirm]**, Cloudflare (hosting the console), GitHub (source code only, no client data).

## 2. Privacy Notice (draft)

**[OWNER: legal name, address, contact email for privacy requests, grievance contact]** ("SS Bills", "we") makes the SS Bills billing software.

**Your restaurant's billing data stays on your PC.** Bills, customers' details typed on bills, staff and PINs are stored only on the computer you install SS Bills on. We do not receive them and cannot read them. If the PC is lost or its disk fails, we cannot recover them; keep your own backups.

**What we do receive.** (a) Details you give us to set up your account: restaurant name, owner name, phone, email, city, address, GSTIN. (b) When the app runs: your licence key, a PC identifier, the PC's name and app version. (c) Daily sales totals: date, total sales, number of bills, cancelled bills, totals by cash/UPI/card, tax, and your best-selling item. (d) A copy of your restaurant profile, receipt text, tax settings, menu, prices and table names, kept so we can restore your menu on a new PC. This copy does not include bills, customer details, staff or PINs.

**Why.** To activate and protect your licence, to show you and us how the account is doing, to give support, to invoice you, to restore your menu, and to prevent misuse.

**Who sees it.** Our authorised staff, using a console protected by password and a second step. Our service providers host it for us (above). We do not sell it or use it for advertising. **[OWNER: confirm; add any sharing you intend, e.g. with payment or accounting providers, or when legally required.]**

**How long.** Account and payment records: **[OWNER: e.g. 8 years, to meet tax and accounting rules]**. Daily totals: **[OWNER]**. Menu copies: only the newest 10 are kept, and they are removed **[OWNER: how long after the account ends]**. Audit log entries are permanent by design, because they protect both of us.

**Your choices.** You can ask to see, correct or delete the data we hold about you, and to withdraw consent, by writing to **[OWNER: email]**. We will respond within **[OWNER: days]**. Some records (invoices, payments, the audit log) must be kept by law and cannot be deleted. Your PC's billing data is yours and is deleted by removing it from your PC.

**Security.** Access to our systems needs a password and a second step; licence answers are digitally signed; the database allows no direct public access. No system is perfectly secure. If a breach affecting you occurs we will tell you **[OWNER: timeframe]**.

**Staff and customers on your bills.** You decide what customer and staff details to type into SS Bills, and you are responsible for having the right to hold them. We do not receive them.

**Children.** The service is for businesses and is not directed at children.

**Changes and contact.** We will post changes with a new date. Contact: **[OWNER]**. **[OWNER/LAWYER: add grievance officer details if required.]**

## 3. Terms of Service (draft)

1. **The licence.** We grant you a non-exclusive, non-transferable right to use SS Bills on **one (1) PC** per licence, for your own restaurant business (D-042). Using it on more PCs needs a licence for each. The plan (monthly, yearly or lifetime) and its end date are shown in the app.
2. **Activation and the internet.** The app activates once online and checks in when it can. Billing keeps working offline. If it cannot check in for **7 days**, or the licence is suspended or expired (after any grace period **[OWNER: confirm grace on expiry]**), **creating new bills is paused** until it checks in or you renew. History, reports and backups remain available.
3. **Fees.** Prices are as agreed or listed at purchase, plus GST at the prevailing rate. **[OWNER: payment terms, how renewals are priced for existing clients (see docs/PRICING.md), refund policy, what "lifetime" means (the lifetime of the product version, support period, or a stated number of years).]**
4. **Suspension.** We may suspend a licence for non-payment, use beyond the licence, sharing the key, tampering with the software or its licence checks, or unlawful use. We will tell you why. **[OWNER: notice period and reactivation terms.]**
5. **Your data and backups.** Your billing data lives on your PC. You are responsible for keeping backups and for the accuracy of your bills, tax rates and GST filings. The app helps with backups but does not replace your duty to keep records.
6. **Your obligations.** Keep your key and PINs confidential, do not copy, resell, reverse-engineer or bypass the licence, and use SS Bills lawfully.
7. **Support and updates.** **[OWNER: hours, channel, response targets; whether updates are included in each plan.]** Updates are installed only when the app is closed.
8. **No guarantee of uninterrupted service.** The licence and menu-copy services may be unavailable at times. The app is designed to keep billing offline.
9. **Tax and legal compliance.** SS Bills is a tool. You are responsible for the correct tax treatment of each sale and for statutory filings. Receipt formats are provided as a convenience.
10. **Liability.** To the extent permitted by law, we are not liable for indirect or consequential loss, lost profit, or loss of data stored on your PC, and our total liability is limited to the fees you paid in the previous **[OWNER: 12]** months. **[LAWYER: confirm enforceability.]**
11. **Ending.** You may stop at any time; fees already paid are **[OWNER: refundable or not]**. On ending, new billing stops at expiry; your data stays on your PC.
12. **Changes.** We may update these terms with notice; continuing to use the software after the notice period means you accept them.
13. **Governing law and disputes.** Laws of India; courts at **[OWNER: city]**.

## 4. Questions only the owner can answer

1. Legal entity name, registered address, contact and grievance email.
2. Retention periods (accounts, payments, summaries, menu copies after the account ends).
3. Grace after expiry, refund policy, renewal pricing for existing clients, and what "lifetime" means.
4. Support promise and hours.
5. Supabase region and whether you want a data-processing agreement with the providers.
6. Whether the first clients sign the terms. A tick box at activation is not built: the app does not yet show or record acceptance. Adding it would be a scope change to agree first.
7. Whether to publish the notice on a public web page. It would need its own hosting; the console is private.
