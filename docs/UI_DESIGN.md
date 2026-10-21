# SS Bills — UI/UX Design (Stitch AI prompts)

**Last updated:** 2026-10-21
**Status:** Restaurant app design **chosen and built** (Warm Saffron Counter, D-014). The Stitch
export is in `design/stitch-client-app/`, and its design system is in
`design/stitch-client-app/stitch_ss_bills_restaurant_pos/warm_saffron_counter_pos/DESIGN.md`.
The Vendor Admin Portal design has not been generated yet.

## Chosen design → built screens

| Stitch screen (folder in `design/stitch-client-app/…/`) | Route in `app/src/app/` |
|---|---|
| `spice_garden_terminal_login` | `/` (`page.tsx`) |
| `ss_bills_first_launch_license_activation` | `/activate` |
| `ss_bills_pos_counter_billing_1` / `_2` | `/billing` |
| `ss_bills_settle_payment_modal` | `/billing` (`components/payment-modal.tsx`) |
| `ss_bills_bill_complete_thermal_receipt` | `/billing/complete` (`components/receipt.tsx`) |
| `ss_bills_table_floor_management` | `/tables` |
| `ss_bills_bill_history_audit_log` | `/history` (drawer + cancel dialog) |
| `ss_bills_admin_dashboard_metrics` | `/dashboard` |
| `ss_bills_business_reports_sales_analytics` | `/reports` |
| `ss_bills_menu_catalog_management` | `/menu` |
| `ss_bills_admin_settings_receipt_gst` | `/settings/receipt`, `/settings/tax` |
| `ss_bills_settings_staff_roles` | `/settings/staff` |
| `ss_bills_settings_backup_restore` | `/settings/backup` |
| `ss_bills_settings_license_sync` | `/settings/license` |
| (not in export) | `/settings` (restaurant profile), held-bills drawer, table picker |

Design tokens (colors, type scale, elevation) are in `app/src/app/globals.css`. Shared
components are in `app/src/components/ui.tsx`. Chart colors for Cash/UPI/Card were checked with a
colorblind-safety validator: UPI `#c64f0e`, Cash `#00927f`, Card `#b8860b`.

## Deviations from the Stitch export

Stitch invented features that are **not in the PRD**. Following AGENTS.md (no scope changes
without the owner), they were left out (D-015). Any of them can be added back if the owner agrees:

| Left out | Why |
|---|---|
| WhatsApp / SMS / email bill sharing | Removed from scope (D-004) |
| Discounts (in the permissions matrix) | Excluded (D-005) |
| Extra roles: Captain, Floor Lead, Supervisor override, RFID cards | Only Admin and Cashier (D-008) |
| UPI QR display, VPA, UTR entry, card terminal (EDC) integration | MVP only records the payment method (P-2) |
| Cash tendered / change calculator and quick-cash presets | Not in PRD. **Good candidate to add** |
| Table merge / split / transfer, multiple dining areas | Not in PRD |
| Swiggy / Zomato orders, rider handover, kitchen order statuses | Non-goal (online ordering) |
| Shifts, cash float, till handover, Z-report | Not in PRD |
| Guest counts / covers per table | Not in PRD |
| Item photos, POS hotkeys per item, "egg only" type, kitchen routing stations | Not in PRD |
| Kitchen display, customer display, hardware peripherals panel | Not in PRD |
| Bulk CSV import, CSV/Excel export, Tally sync | Not in PRD |
| ".lic" offline key file, 14-day free trial on activation | Licensing model undecided (O-5) |
| "Transfer license" and "Deactivate" buttons in the app | Done by the vendor in the Portal (V-8) |

Other adjustments:
- The open bill shows "New bill / Number on payment" instead of a bill number, because numbers are assigned only on payment (TRD §3).
- The service-charge line appears only when it's enabled (B-9).
- Cancelling a bill is Admin-only. Cashiers see a note instead of a PIN-override prompt.

## How to use these prompts in Stitch

Stitch works best when you build **one screen per prompt**, all inside the same project
so the style stays consistent.

1. Choose a **style direction** below (A, B, or C).
2. Start a new Stitch project. Paste **Prompt 1 (Base)**, with the chosen style block
   pasted in where it says `[STYLE BLOCK]`. This generates the main billing screen.
3. Paste the screen prompts (2–11) one at a time, in the same project.
4. To get variations, repeat steps 1–3 in a **separate project per style**, or use
   Stitch's variants option on the Billing screen first and compare.
5. Compare the Billing screen across styles first. It's the screen used 95% of the time.

Tip: if Stitch drifts from the style, add at the start of a prompt
"Keep the exact same design system, colors, and components as the previous screens."

---

## Prompt 1 (Base + main Billing screen)

```
Design a desktop point-of-sale billing app called "SS Bills" for Indian restaurants.
Screen size: 1440x900 landscape, used on a billing counter PC with mouse and
occasionally touch, so all click targets are at least 44px tall.

Design goals: catchy but simple and professional. Confident, modern, and warm, like a
premium product made for restaurant owners. Avoid a plain admin-template look, and
avoid anything childish, neon, Gen-Z, or overly playful. Prefer visible, tappable
controls (tiles, segmented controls, chips, toggles, steppers) over dropdown menus.
Use dropdowns only where a list is genuinely long. Use clear visual hierarchy, generous
spacing, rounded cards (12–16px radius), subtle shadows, and one strong accent color.
Large, bold numerals for money. Currency is Indian Rupees (₹) with Indian number
formatting (₹1,24,500).

[STYLE BLOCK]

App shell: a slim left navigation rail with icons and labels for: Billing, Tables,
History, Dashboard, Reports, Menu, Settings. At the bottom of the rail: logged-in staff
name with a role badge (Admin or Cashier), an online/offline status dot labelled
"Offline – billing works normally" when offline, and a lock/logout button.

Main screen: BILLING. Three zones:
1. Category strip: horizontal pill chips with item counts (All, Starters, Main Course,
   Breads, Rice & Biryani, South Indian, Beverages, Desserts).
2. Item grid (center): a large search bar on top ("Search items or type code…"), then
   a grid of item tiles. Each tile shows the item name, short code, price, a small veg
   (green) / non-veg (red) dot, and a quantity badge when the item is already in the bill.
   Unavailable items appear greyed out with an "Unavailable" tag and can't be clicked.
   Example items: Paneer Butter Masala ₹260, Butter Naan ₹50, Veg Biryani ₹220,
   Chicken Biryani ₹280, Masala Dosa ₹120, Filter Coffee ₹40, Gulab Jamun ₹80,
   Fresh Lime Soda ₹90.
3. Current bill panel (right, about 400px wide): at the top, a segmented control for
   order type (Dine-in / Takeaway / Delivery) and a table selector chip ("Table T4",
   click to change). Then the list of bill items with + / – quantity steppers, a line
   total, and a remove icon. Then the summary: Subtotal, Service charge (shown only when
   enabled), CGST 2.5%, SGST 2.5%, Round off, and a large GRAND TOTAL. At the bottom,
   three actions: "Hold" (secondary), "KOT" (secondary, prints a kitchen ticket), and a
   large primary "Pay ₹1,034" button.

Also show a small "Held bills" indicator in the top bar with a count badge (e.g. 3),
which opens the list of open table bills.
```

---

## Style blocks (pick one per variation)

### Style A: "Warm Counter" (recommended starting point)
```
Visual style: warm and inviting. Background warm off-white (#FAF7F2), surfaces white,
text deep charcoal (#1F2328). Primary accent saffron orange (#E8730C) used for the
primary button, active states, and selected tiles; secondary accent deep teal (#0F5E5C)
for highlights and charts. Font: "Plus Jakarta Sans" or "Manrope", with bold headings
and tabular numerals for prices. Item tiles have a soft colored top border matching
their category. Subtle food-friendly feel without any illustrations of food.
```

### Style B: "Midnight Pro"
```
Visual style: a sleek dark interface for long shifts. Background deep navy-slate
(#0F172A), surfaces slightly lighter (#1E293B), text near-white (#F1F5F9) with muted
grey secondary text. Primary accent emerald (#10B981) for primary actions and money
totals; secondary accent amber (#F59E0B) for warnings and held bills. Font: "Inter" or
"Sora", with tabular numerals. Very subtle glow on the primary button only. Calm and
premium, not gamer-style.
```

### Style C: "Fresh & Crisp"
```
Visual style: bright, airy, and clean. Background very light cool grey (#F5F7FA),
surfaces white, text slate (#1E293B). Primary accent rich indigo-violet (#4F46E5) for
primary actions; supporting accent mint (#14B8A6) for success states and paid badges.
Font: "DM Sans" or "Outfit", with tabular numerals. Light, layered cards with a soft
gradient wash in the header area only. The current bill panel uses a slightly tinted
background to stand apart.
```

Optional Style D, to try a bolder layout with any palette: add
`"Make the current bill panel dark (near-black) while the rest of the app stays light,
like a receipt glowing on a counter."`

---

## Screen prompts (paste one at a time in the same project)

### Prompt 2: Login (staff PIN)
```
Using the same design system, design the LOGIN screen. Restaurant name and logo at the
top ("Spice Garden – powered by SS Bills"). A row of staff profile cards (avatar
initials, name, role badge Admin/Cashier) to pick who is logging in. After selecting,
a large numeric PIN pad (4–6 dots for entered digits) with big tappable keys, a
backspace key, and a clear key. Show current date and time. Clean and welcoming.
```

### Prompt 3: Tables view
```
Using the same design system, design the TABLES screen: a grid of table cards (T1–T16)
showing status by color and label: Free, Occupied (held bill with running amount and
time since opened, e.g. "₹860 · 42 min"), and Bill printed (awaiting payment). Filter
chips at the top: All / Free / Occupied. Clicking a table opens its bill on the Billing
screen. Include a legend for the status colors. Also show a "Takeaway & Delivery" lane
of held non-table orders.
```

### Prompt 4: Payment
```
Using the same design system, design the PAYMENT step as a large centered modal over the
Billing screen. Top: bill number preview, table, and a large GRAND TOTAL (₹1,034).
Middle: three big selectable tiles with icons for payment method: Cash, UPI, Card.
Exactly one is selected, with a clear selected state. Bottom: "Back" and a large primary
"Confirm & Print" button, plus a secondary "Confirm & Save PDF" option.
```

### Prompt 5: Bill printed / receipt preview
```
Using the same design system, design the BILL COMPLETE screen. Left: a realistic preview
of an 80mm thermal receipt (monospace text) with restaurant name, address, GSTIN, FSSAI
number, bill no "SSB/2026-27/000123", date/time, table and order type, item lines with
qty × price, Subtotal, CGST 2.5%, SGST 2.5%, Round off, TOTAL, payment method, and a
thank-you footer. Right: a success state ("Bill saved & printed") with actions:
Reprint, Save PDF, and a large primary "New Bill" button. A paper-width toggle
(58mm / 80mm) above the preview.
```

### Prompt 6: Bill history
```
Using the same design system, design the BILL HISTORY screen. Top: a search bar
(bill no, table, amount), a date-range picker, status chips (All / Paid / Cancelled),
and payment chips (Cash / UPI / Card). Main: a clean table of bills with bill no,
date & time, order type, table, items count, payment method badge, amount, and status
badge. Cancelled bills appear muted with a strikethrough amount. Selecting a row opens
a right-side detail drawer showing the full bill, with buttons: Reprint (marked
DUPLICATE) and "Cancel bill" (Admin only, destructive style). Show the cancel
confirmation dialog, which requires a reason.
```

### Prompt 7: Dashboard
```
Using the same design system, design the DASHBOARD (Admin). Top row of four KPI cards
with big numbers: Today's Sales (₹48,250), Bills Today (126), Average Bill (₹383), and
Cancelled (2). Below: a sales-by-hour bar chart for today; a payment split donut
(Cash / UPI / Card with amounts); a "Best-selling items today" ranked list with
quantity bars; and a "Held bills right now" mini list. Include a greeting with the
date. Visually rich but uncluttered.
```

### Prompt 8: Reports
```
Using the same design system, design the REPORTS screen (Admin). Report type as a row of
large tabs/cards: Sales, Payments, Best-selling items, Tax summary. A date-range control
with quick chips (Today, Yesterday, This week, This month, Custom). Show the Sales report:
a trend line chart of daily sales across the range, summary cards (total sales, total
bills, total GST collected, average bill), and a day-by-day table below. Include a
"Print report" button.
```

### Prompt 9: Menu management
```
Using the same design system, design the MENU MANAGEMENT screen (Admin). Left column:
category list with item counts, drag handles for reordering, and "+ Add category".
Main area: items of the selected category as rows or cards with name, short code,
veg/non-veg dot, price, and an Available/Unavailable toggle switch, plus edit and delete
icons. Top: a search bar and a primary "+ Add item" button. Show the Add/Edit item panel
as a right-side drawer with fields: name, short code, category (as selectable chips),
price (₹), veg/non-veg segmented control, an availability toggle, and Save/Cancel.
```

### Prompt 10: Settings
```
Using the same design system, design the SETTINGS screen (Admin) with a vertical
section list on the left: Restaurant Profile, GST & Tax, Receipt, Staff & Roles,
Backup & Restore, License. Show the "Receipt" section: fields for header text, footer
text, a "show logo" toggle, and a paper width segmented control (58mm / 80mm), with a
LIVE receipt preview on the right that updates as you type. Also briefly design the
"GST & Tax" section: GST rate as selectable chips (0%, 5%, 12%, 18%, Custom), a
"Prices include tax" toggle, an HSN/SAC code field, and a "Service charge" toggle
(off by default) with a percentage field and a note "Must be optional for customers".
```

### Prompt 11: Staff, Backup, and License (settings sub-screens)
```
Using the same design system, design three Settings sub-sections:
1. STAFF & ROLES: staff cards with name, role badge (Admin/Cashier), active toggle,
   "Reset PIN", and "+ Add staff". Show a small permissions summary comparing what Admin
   and Cashier can do.
2. BACKUP & RESTORE: last backup time, a large "Back up now" button, a choice of
   destination (folder / USB drive), an auto daily backup toggle, a list of recent
   backups with a "Restore" action, and a warning confirmation.
3. LICENSE: license status card (Active, plan, valid until date), last sync time,
   "Sync now" button, and an offline grace-period notice ("Offline for 2 days – please
   connect within 5 days").
Also design a first-launch LICENSE ACTIVATION screen: a welcome message, a license key
input formatted in groups (XXXX-XXXX-XXXX-XXXX), and an "Activate" button.
```

---

## Vendor Admin Portal ("SS Bills Console")

A **separate web app** used only by us (the SS Bills vendor) to manage client
restaurants and licenses (PRD §5.8). Generate it in its **own Stitch project**, using the
same style block as the chosen restaurant app so the brand stays consistent.

### Prompt V1: Base + Overview dashboard
```
Design a web admin console called "SS Bills Console" for the company that sells SS Bills
restaurant billing software. Only the vendor's own team uses it, to manage client
restaurants and their software licenses. Screen size 1440x900, but it must also work
well on a phone, because the owner will check it on mobile.

Design goals: catchy but simple and professional, like a modern SaaS control panel.
Avoid a plain admin-template look, and avoid anything childish or neon. Prefer chips,
segmented controls, toggles, and clear action buttons over dropdowns. Rounded cards,
subtle shadows, one strong accent color, and large bold numbers for key metrics.
Currency is ₹ with Indian number formatting.

[STYLE BLOCK]

Layout: left sidebar with Overview, Clients, Licenses, Sales Insights, Activity Log,
Settings. Top bar with global search ("Search restaurant, city, license key…"),
notifications bell with count, and an admin profile menu.

Screen: OVERVIEW.
- KPI cards: Total Clients (48), Active Licenses (42), Expiring in 30 days (5, amber),
  Suspended (1, red), Offline > 7 days (3, grey).
- "Needs attention" list: restaurants expiring soon, not synced recently, or suspended,
  each with a quick action (Renew, View, Contact).
- A chart of combined daily sales reported by all clients over the last 30 days.
- "Top clients by sales this month" ranked list.
- "Recent activity" feed (e.g. "Spice Garden activated on new PC", "License renewed",
  "Hotel Annapurna suspended").
```

### Prompt V2: Clients list
```
Using the same design system, design the CLIENTS screen. Filter chips at the top:
All / Active / Expiring soon / Suspended / Offline, plus a plan filter (Monthly /
Yearly / Lifetime) and a city search. A primary "+ Add client" button.
Main: a rich table of restaurants with name and city, owner contact, plan badge,
license status badge (Active green, Expiring amber, Suspended red, Expired grey),
expiry date, last sync time ("2 h ago", turns red when older than 7 days), today's
sales, and a row actions menu (View, Renew, Suspend). On mobile, rows become cards.
```

### Prompt V3: Client detail
```
Using the same design system, design the CLIENT DETAIL page for one restaurant
("Spice Garden, Hyderabad").
Header: restaurant name, status badge, plan, and primary actions: "Renew / Extend",
"Suspend license" (destructive), and "Edit".
Left column cards:
- Profile: owner name, phone, email, address, GSTIN, onboarding date.
- License: license key (masked, with copy and reveal), plan, valid until, bound
  machine ID with a "Reset device binding" action (for when they change PC), last
  check-in time, app version.
Right/main area:
- Sales summary from their daily uploads: a range toggle (7 days / 30 days / 12 months),
  sales trend chart, cards for total sales, bills count, average bill, and a payment
  split (Cash / UPI / Card).
- Daily summary table: date, sales, bills, cancelled, tax, top item.
- License history timeline: created, activated, renewed, suspended, reactivated, device
  reset, each with date and which admin did it.
Show the "Suspend license" confirmation dialog: requires a reason, explains "The
restaurant's app will stop creating new bills at its next sync. Their existing data
stays on their PC", and has a red confirm button. Also show the opposite
"Reactivate" state.
```

### Prompt V4: Add client / issue license
```
Using the same design system, design the ADD CLIENT flow as a clean 3-step wizard:
1) Restaurant details (name, owner, phone, email, city, address, GSTIN).
2) Plan & license: plan as selectable cards (Monthly, Yearly, Lifetime) with price
   placeholders, a start date, an auto-calculated expiry, and a notes field.
3) Done: shows the generated license key in large monospace (XXXX-XXXX-XXXX-XXXX),
   with "Copy key" and "Share via WhatsApp/Email" buttons, and setup instructions for
   the restaurant.
```

### Prompt V5: Licenses and renewals
```
Using the same design system, design the LICENSES screen focused on renewals.
Tabs: Expiring soon / Expired / Suspended / All. Each license row shows restaurant,
plan, expiry with a countdown ("in 6 days"), and amount due, with quick actions:
Renew (opens a small panel to pick a new period and see the new expiry date), Suspend,
Reactivate. A summary strip at the top: renewals due this month and their total value.
```

### Prompt V6: Sales insights + Activity log + Login
```
Using the same design system, design three screens:
1. SALES INSIGHTS: combined sales across all clients with a date-range control, a
   chart, a comparison of clients (bar chart), and a table of clients with sales,
   bills, and growth vs the previous period.
2. ACTIVITY LOG: a filterable audit list of every admin and license event (who, what,
   when, restaurant), with filter chips by event type.
3. LOGIN: a centered sign-in card for vendor admins (email, password, "Sign in"),
   with an optional one-time code step, and SS Bills Console branding.
```

---

## Vendor console: chosen design and what was built

Stitch export: `design/stitch-vendor-portal/` (same Warm Saffron design system, `design.md`). Built in `portal/`.

| Stitch screen | Route in `portal/src/app/` |
|---|---|
| `auth_login_ss_bills_console` | `/login` |
| `overview_ss_bills_console` | `/(console)` (overview) |
| `clients_ss_bills_console` | `/clients` |
| `spice_garden_hyderabad_client_detail_ss_bills_console` | `/clients/view?id=` |
| `add_client_ss_bills_console` | `/clients/new` |
| `licenses_ss_bills_console` | `/licenses` |
| `sales_insights_ss_bills_console` | `/insights` |
| `activity_log_ss_bills_console` | `/activity` |
| (no Stitch screen) | `/settings` (plans, team, security) |

### Vendor console: deviations from the Stitch export

Left out because they are not in the PRD (D-030). Any can be added if the owner agrees:

| Left out | Why |
|---|---|
| Razorpay payment links, webhook status, auto-debit, "retry queued" | No payment gateway yet; payments are recorded by hand (D-027) |
| WhatsApp / email dispatch of invoices, payment reminders, "batch payment reminder" | Not in PRD. The new-client screen offers *Copy welcome message* and *Email it* instead |
| GST tax invoices, MRR / ARR / collection-rate KPIs, receivables | No invoicing module. The renewal strip shows a pipeline estimate instead |
| Multiple outlets per restaurant, outlet photos, map and "geographic cloud routing" | One restaurant = one license with N terminals |
| Hardware diagnostics, "ping hardware", "force fleet sync", batch license sync, OTA patch broadcast, DB engine / latency panel | Not in PRD |
| Regional roles (Regional Lead, Support Tier 2), passkeys, "remember session 30 days", terminal-ID badge on login | Two roles only (D-025) |
| Cryptographic ledger (SHA-256 / Merkle hash, signer key IDs) on the audit log | The log is append-only (database trigger) but not hash-chained |
| Export audit log, notifications bell, draft autosave / import CSV on onboarding, "print handover slip" | Not in PRD |
| Plan feature matrices (KOT screen, WhatsApp bills, "24 months of updates") | Plans differ only by price, duration and terminals |
| Field-onboarding support contact card | Not applicable |

Added beyond the design: a **Settings** screen (plans and prices, vendor team, security), a **support** role, CSV export of
clients and sales, and a **demo mode**.

## Checklist: screens a selected design must cover

- [ ] Login (staff picker + PIN)
- [ ] Billing (categories, search, item grid, bill panel, order type, table, hold, KOT, pay)
- [ ] Held bills list
- [ ] Tables view
- [ ] Payment modal
- [ ] Bill complete / receipt preview
- [ ] Bill history + detail drawer + cancel dialog
- [ ] Dashboard
- [ ] Reports
- [ ] Menu management + add/edit item drawer
- [ ] Settings: profile, GST & tax, receipt, staff & roles, backup, license
- [ ] License activation (first launch)
- [ ] Offline indicator state

**Vendor Admin Portal (separate Stitch project)**
- [x] Login
- [x] Overview dashboard
- [x] Clients list
- [x] Client detail + suspend/reactivate dialog + reset device binding
- [x] Add client / issue license wizard
- [x] Licenses and renewals
- [x] Sales insights
- [x] Activity log
- [x] Settings (added)

## Notes for implementation

- Stitch exports HTML + Tailwind. That maps directly onto the planned React +
  Tailwind stack (TRD §2). Treat the export as a visual reference, not production code.
- Sample names, prices, and amounts in the prompts are placeholders.
