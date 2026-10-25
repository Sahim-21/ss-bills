# Plan pricing: where it lives and what a change does

Reviewed 2026-10-25. **No final prices are decided** (open question O-5). The numbers below are the placeholders the database was seeded with.

## Where prices are stored

| What | Where | Notes |
|---|---|---|
| The price of each plan | table `plans`, column `price_paise` | Integer paise, **before GST**. Seeded in `supabase/migrations/20261021000001_core.sql` |
| GST on SS Bills' own invoices | table `settings`, key `gst_bp` | 1800 = 18.00% |
| Terminals per plan | `plans.max_devices` | All 1 since migration 8 (D-042) |
| What a client actually paid | table `payments` | `subtotal_paise`, `gst_paise`, `total_paise` are **copied in at the time of payment** |

Seeded placeholders (not decisions): Monthly Standard ₹2,499 per 30 days; Yearly Pro ₹24,999 per 365 days; Lifetime POS ₹59,999 once. All before 18% GST.

## Who can change them

Only a **super admin**, in the console under Settings, which calls `vendor_update_plan` (migration 2). It checks the caller and MFA, rejects negative prices, and writes an audit event. Nobody else, and nothing in the restaurant app, can change a price. No code deploy is needed.

## How a change affects existing clients

- **Past payments: never change.** Each payment row holds its own amounts, so old receipts and reports stay exactly as they were.
- **Licences already running: nothing changes.** The licence stores its plan and expiry date, not a price. Raising the price does not shorten or end anything.
- **The next payment you record uses the plan's price at that moment.** A client renewing after a price rise is charged the new price, including a client who paid the old price last time. There is no "price locked for existing clients" feature.
- **Console numbers move.** The "expected renewals" figure on Insights is computed from the current `price_paise`, so it changes immediately when you edit a price.
- **An agreed special price** can be entered as an override amount when recording a payment (GST is treated as inside it). That one payment keeps the override, the plan price is untouched.
- **Changing `max_devices` on a plan** affects only licences created afterwards. Existing licences keep their own limit.

## Before setting the real prices, decide

1. Whether existing clients should keep their old price on renewal (would need a new feature: a per-licence price).
2. Whether lifetime means "the life of the product" in your terms (see Task 8, terms).
3. Whether prices are shown to clients with or without GST.
