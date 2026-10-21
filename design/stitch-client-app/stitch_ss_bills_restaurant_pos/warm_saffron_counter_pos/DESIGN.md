---
name: Warm Saffron Counter POS
colors:
  surface: '#faf9f6'
  surface-dim: '#dbdad7'
  surface-bright: '#faf9f6'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f0'
  surface-container: '#efeeeb'
  surface-container-high: '#e9e8e5'
  surface-container-highest: '#e3e2df'
  on-surface: '#1a1c1a'
  on-surface-variant: '#584239'
  inverse-surface: '#2f312f'
  inverse-on-surface: '#f2f1ee'
  outline: '#8c7167'
  outline-variant: '#e0c0b4'
  surface-tint: '#a43d00'
  primary: '#a03b00'
  on-primary: '#ffffff'
  primary-container: '#c64f0e'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb597'
  secondary: '#615e5b'
  on-secondary: '#ffffff'
  secondary-container: '#e4dedb'
  on-secondary-container: '#65625f'
  tertiary: '#006b31'
  on-tertiary: '#ffffff'
  tertiary-container: '#128641'
  on-tertiary-container: '#f7fff3'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbcd'
  primary-fixed-dim: '#ffb597'
  on-primary-fixed: '#360f00'
  on-primary-fixed-variant: '#7d2d00'
  secondary-fixed: '#e7e1de'
  secondary-fixed-dim: '#cbc5c2'
  on-secondary-fixed: '#1d1b19'
  on-secondary-fixed-variant: '#494644'
  tertiary-fixed: '#90f9a6'
  tertiary-fixed-dim: '#74dc8c'
  on-tertiary-fixed: '#00210b'
  on-tertiary-fixed-variant: '#005224'
  background: '#faf9f6'
  on-background: '#1a1c1a'
  surface-variant: '#e3e2df'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '800'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '700'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  price-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.02em
  price-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  price-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '700'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-sm: 0.75rem
  gutter-lg: 1.25rem
  margin: 1rem
  margin-desktop: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system targets high-velocity Indian culinary spaces—ranging from high-volume casual dining restaurants and cafes to busy counter-service QSRs. The UI balances the warmth, richness, and hospitality of Indian food culture with the unyielding speed, legibility, and technical precision demanded by restaurant billing operators, cashiers, and managers during peak rush hours.

The aesthetic blends **Modern Tactile Warmth** with **Systematic Utility**. Instead of cold, antiseptic gray POS interfaces or chaotic neon ticketing screens, this design relies on a grounded, warm stone canvas accented by rich saffron spice tones. It reduces eye fatigue under harsh billing counter lights while delivering instantaneous visual recognition for fast keyboard, barcode, and touch-screen inputs.

Key attributes:
- **Warm & Hospitable:** Saffron, cardamom, and toasted stone nuances reinforce culinary care.
- **Decisive & High-Velocity:** Dense data layouts, high-contrast totals, instantaneous touch targets, and unambiguous primary triggers.
- **Culturally Attuned:** Native FSSAI dietary badges (Veg/Non-Veg) and explicit Indian Rupee (₹) formatting baked deeply into the component patterns.

## Colors

The palette is engineered for prolonged operational comfort, extreme transactional clarity, and rapid item scanning under varying counter lighting conditions.

- **Primary (`#D95D1E` - Rich Saffron / Masala Orange):** The signature command color. Applied to critical conversion flows: final settlement ("Settle & Pay"), active table selection, and key positive confirmations. It commands focus without triggering red-flag alarm states.
- **Secondary (`#1E1C1A` - Deep Warm Charcoal):** Delivers near-black contrast without harshness. Used for structural containers, active segmented states, primary typography, and receipt preview headings.
- **Tertiary (`#168843` - FSSAI Veg Emerald):** Grounded statutory food safety green. Exclusively anchored for pure vegetarian indicators, successful payment verifications, and kitchen order delivery confirmations.
- **Neutral Canvas (`#F8F7F4` - Warm Stone Off-White):** Suppresses glare from high-brightness POS desktop monitors. Complemented by `#FFFFFF` for lifted actionable tiles, `#E6E2DB` for boundary definition, and `#6A6660` for metadata.

### Domain-Specific Status Tokens
- **FSSAI Non-Veg:** `#BC3228` (Warm Brick Crimson)
- **Active Terminal / Online Sync:** `#10B981` (Mint Emerald)
- **Hold Bill / Running KOT:** `#F59E0B` (Turmeric Amber)
- **Void / Discount / Destructive:** `#DC2626` (Pure Crimson)

## Typography

The typography centers exclusively around **Plus Jakarta Sans**, utilizing its geometric clarity, tall x-height, and contemporary humanist character.

- **Tabular Figures (`tnum`):** Enforce `font-variant-numeric: tabular-nums` across all numeric displays, receipt line tables, and financial tallies. Digits must align vertically without shifting during dynamic recalculations.
- **Currency Glyphs:** The Indian Rupee symbol (`₹`) is rendered alongside prices without baseline drift. When rendering `price-hero`, scale the `₹` glyph slightly (90% font-size) with equal stroke weight to balance high numbers.
- **Hierarchy Rules:** Catalog item titles must not exceed `body-md` (Medium weight) to prevent multi-line grid imbalance. Prices always utilize `price-md` or `price-lg` with Bold or ExtraBold weights.

## Layout & Spacing

The POS workspace utilizes a **split-pane fluid operational grid** configured specifically for 1080p touch monitors, all-in-one POS terminals, and widescreen counter setups.

### Pane Segmentation
1. **Left Navigation / Utility Rail (Fixed 72px):** Slim rail for cash drawer controls, quick reports, floor plan toggle, and sync status.
2. **Center Item Matrix / Floor View (Flexible, min 58% width):** Responsive item grid wrapping dynamically with fixed minimum tile widths of `140px` and minimum heights of `100px`.
3. **Right Persistent Ticket Pane (Fixed 380px to 440px):** Unbroken vertical bill summary, cart ledger, modifier attachments, and transactional CTA dock.

### Touch & Dense Counter Rhythm
- **Minimum Target Rule:** Every clickable or touchable trigger must strictly fulfill a `44px × 44px` physical hit box.
- Compact views (table lists, order logs) maintain a `space-sm` gap between items to prevent mis-taps under greasy or wet kitchen counter usage.

## Elevation & Depth

This design system avoids extreme flat minimalism and floaty blurred glassmorphism. It uses **Tactile Surface Elevation** pairing warm-toned boundaries with soft ambient contact shadows.

- **Level 0 (App Shell Canvas):** Ground level in `#F8F7F4`. Completely flat.
- **Level 1 (Catalog Tiles & Inactive Panels):** Background `#FFFFFF`, outline `1px solid #E6E2DB`, shadow `0 1px 3px rgba(30, 28, 26, 0.04), 0 1px 2px rgba(30, 28, 26, 0.02)`.
- **Level 2 (Active Table, Cart Summary Panel, Selected Tile):** Background `#FFFFFF`, outline `1px solid #D5CEBE`, shadow `0 4px 12px -2px rgba(30, 28, 26, 0.08), 0 2px 6px -1px rgba(30, 28, 26, 0.04)`.
- **Level 3 (Payment Sheet, Customer Selector Modals):** Background `#FFFFFF`, shadow `0 16px 32px -4px rgba(30, 28, 26, 0.16), 0 4px 12px -2px rgba(30, 28, 26, 0.06)`.
- **Level 4 (Floating Kitchen Push Notification / Alert Bar):** Background `#1E1C1A`, shadow `0 20px 40px rgba(0, 0, 0, 0.22)`.

## Shapes

The roundedness level is strictly set to **2 (Rounded)**:
- Baseline components (inputs, buttons, table slots, stepper handles) take `0.5rem` (8px).
- Catalog cards and invoice panels utilize `rounded-lg` at `1rem` (16px) to maintain a modern, friendly presence.
- Modals, slide-out customer cards, and payment drawers apply `rounded-xl` at `1.5rem` (24px).
- Filter chips, table state chips, and dietary badges use fully round pill structures (`rounded-full` / 9999px).

## Components

### 1. FSSAI Dietary Badges
- **Veg Indicator:** A crisp white 16px square bordered with `1.5px solid #168843` containing a centered, filled green circle of 8px diameter.
- **Non-Veg Indicator:** A crisp white 16px square bordered with `1.5px solid #BC3228` containing a centered, filled crimson triangle (or circle) of 8px dimension.
- Position: Anchored at the top-left or top-right of every food catalog card with `space-xs` offset.

### 2. Action Buttons & Operational Triggers
- **Primary Settlement ("Pay ₹..."):** Minimum 52px height. Full-width within right ticket pane. Rich Saffron `#D95D1E` background, pure white bold text (`label-lg`), subtle inner top highlight. Hover: `#C34F17`.
- **Kitchen Order Token ("Print KOT" / "Send KOT"):** Minimum 44px height. `#1E1C1A` charcoal background, white text (`label-md`). Immediate feedback animation upon click.
- **Holding Action ("Hold"):** Turmeric Amber outline (`#F59E0B`) with tinted surface `#FEF3C7`, dark amber text.
- **Destructive ("Void" / "Cancel Item"):** Ghost style with `#BC3228` text, transitioning to red surface on active press.

### 3. Numeric Steppers (+ / -)
- Built as tactile linked pills or rounded squares with minimum 44px touch footprint per trigger.
- Decrement (`-`) and Increment (`+`) buttons framed in `#F4F2EE` with dark charcoal glyphs. Quantity count sits centered in tabular bold digits.
- At quantity 1, the decrement icon transitions to a trash icon to signify direct item removal.

### 4. Food Item / Catalog Cards
- Pure white `#FFFFFF` surface with `1px solid #E6E2DB`.
- Displays item name (`headline-sm`, max 2 lines), price (`price-md`), dietary badge, and hot-key shortcut badge (e.g., `[F1]`) in top corner.
- Tap/Click feedback: Scales to `0.98` with border transition to `#D95D1E` for 150ms.

### 5. Category Pills & Filter Chips
- Height: 38px–44px. Pill-shaped (`rounded-full`).
- Inactive: `#FFFFFF` surface, `#6A6660` text, subtle `#E6E2DB` border.
- Active: Filled Deep Charcoal `#1E1C1A` with pure white text and an attached numeric count badge in Saffron `#D95D1E`.

### 6. Bill Ledger Table
- Dense, zero-horizontal-padding table structure inside the right pane.
- Alternating subtle rows or clean dividers (`#F4F2EE`).
- Column format: Item Name & Modifiers (flex-grow), Quantity Stepper (100px fixed), Line Total (80px fixed, right-aligned tabular numerals).
- Bottom calculation dock: Subtotal, CGST, SGST, Service Charge, and Grand Total (`price-hero`).