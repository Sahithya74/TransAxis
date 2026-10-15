---
name: Mission Command Logistics
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#632ecd'
  on-tertiary: '#ffffff'
  tertiary-container: '#7d4ce7'
  on-tertiary-container: '#f6edff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#e9ddff'
  tertiary-fixed-dim: '#d0bcff'
  on-tertiary-fixed: '#23005c'
  on-tertiary-fixed-variant: '#5516be'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 2rem
    fontWeight: '700'
    lineHeight: 2.5rem
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.5rem
    fontWeight: '700'
    lineHeight: 2rem
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 2rem
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.75rem
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.5rem
  body-lg:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '400'
    lineHeight: 1.5rem
  body-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.25rem
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
  label-md:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
  label-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '600'
    lineHeight: 1rem
  data-mono:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '500'
    lineHeight: 1.125rem
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-desktop: 1.5rem
  margin: 1rem
  margin-desktop: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system targets logistics controllers, fleet operations directors, and dispatch dispatchers who operate in high-tempo, data-critical environments. The visual language balances mission-critical utility with modern enterprise refinement. It delivers immediate cognitive clarity over decorative styling, conveying authority, precision, and operational calm under load.

The design movement is **Modern High-Density Enterprise**:
- Deep slate framing elements anchor structural control surfaces (navigation, header telemetry, situational alert bands).
- Canvas areas utilize cool-toned, ultra-clean neutral surfaces to maximize legibility for expansive telemetry tables, route nodes, and density-driven kanban dispatch boards.
- Structural borders are crisp and hairline (1px), establishing clean boundaries without compounding visual noise.
- Status signaling follows a strict, non-negotiable semantic taxonomy: operational health (emerald), operational caution (amber), critical risk/safety (crimson), and predictive routing or automated intelligence (violet).

## Colors

The palette employs a dual-tone environmental model: deep slate chrome for global orientation and an airy, high-contrast cool grey field for operational tasks.

### Functional Roles & Semantic Mapping
- **Primary (`#2563EB` / Active: `#1D4ED8`):** Logistics Blue. Reserved for primary operational actions (e.g., "Dispatch Unit", "Re-route Manifest"), active selection tabs, and critical focus rings.
- **Secondary / Chrome (`#0F172A` / Secondary Tier: `#1E293B`):** Deep Navy/Slate. Enforces spatial authority in sidebars, global command bars, status HUDs, and high-level telemetry bars.
- **Tertiary / Intelligence (`#8B5CF6` / Container: `#F5F3FF`):** Violet. Strictly isolated for predictive analytics, algorithmic dispatch suggestions, automated ETA optimization, and telemetry intelligence.
- **Neutral Surface Hierarchy:**
  - Base App Canvas: `#F8FAFC`
  - Elevated Surface / Data Cards / Table Rows: `#FFFFFF`
  - Subdued Field Fill / Table Headers: `#F1F5F9`
  - Divider Lines / Hairline Outlines: `#E2E8F0`
  - Body Text: `#1E293B`
  - Secondary Metadata & Micro-copy: `#64748B`
- **Telemetry Indicators:**
  - **Healthy / In-Transit (`#10B981` / Dark: `#059669`):** Units on schedule, compliant inspections, healthy sensors.
  - **Warning / Stalled (`#F59E0B` / Dark: `#D97706`):** Approaching HOS limits, maintenance due, weather bottlenecks.
  - **Critical / Grounded (`#EF4444` / Dark: `#DC2626`):** Immediate geofence breach, SOS, cold-chain temperature fault.

## Typography

The typographic system pairs the structural, geometric presence of **Plus Jakarta Sans** for headlines and dashboard module titles with the utilitarian legibility of **Inter** for data layers, tabular logs, and metadata.

### Data Readability Rules
- **Tabular Figures:** All numeric fields (speed, fuel capacity, temperature readings, GPS coordinates, freight profitability figures) must render using tabular lining numbers (`font-variant-numeric: tabular-nums`) to ensure zero-shift vertical scanning.
- **Metadata Hierarchy:** Operational timestamps, vehicle identification numbers (VINs), and container IDs rely on `data-mono` or `label-sm` with upper-case tracking (+0.04em) to ensure immediate distinguishability from narrative driver remarks.

## Layout & Spacing

The layout model uses a fluid-responsive enterprise grid engineered for 1080p, 1440p, and multi-monitor operations rooms, while collapsing into stacked operational streams on mobile devices.

### Grid & Structure
- **Global Shell:** A persistent 260px dark chrome sidebar (`#0F172A`) for deep navigation, collapsible to 64px icon-only rail for dense monitoring workflows.
- **Telemetry Header:** Fixed 56px utility bar containing active system alerts, global manifest quick-find, live driver statuses, and profile routing.
- **Main Viewport:** 12-column fluid grid. Desktop uses `gutter-desktop` (24px) for dashboard KPI cards, live vehicle map integration, and dispatch boards. 
- **Compact Data Density:** Table views and telemetry grids compress inner cell padding using `space-xs` (vertical) and `space-sm` (horizontal) to display 18–25 active fleet records above the fold.

## Elevation & Depth

This system intentionally departs from heavy drop shadows to prevent visual fatigue in continuous 8-to-12-hour operational shifts. Instead, hierarchy is conveyed through **tonal stratification and razor-sharp borders**.

### Structural Elevation Rules
- **Base Canvas (Level 0):** `#F8FAFC`. Zero elevation. Houses background grid lines and auxiliary dashboard containers.
- **Surface Elevation (Level 1):** `#FFFFFF`. Bound by a 1px solid `#E2E8F0` border. Paired with a soft ambient shadow: `0 1px 3px 0 rgba(15, 23, 42, 0.04), 0 1px 2px -1px rgba(15, 23, 42, 0.02)`.
- **Active Card & Inspector Panels (Level 2):** `#FFFFFF`. Hovered data cards and sliding vehicle telemetry sheets employ: `0 4px 6px -1px rgba(15, 23, 42, 0.08), 0 2px 4px -2px rgba(15, 23, 42, 0.04)`.
- **Command Overlays & Modals (Level 3):** `#FFFFFF`. Critical dispatch overrides, emergency re-routing sheets, and route timeline dialogs use: `0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.06)` with a backdrop tint of `#0F172A` at 40% opacity.

## Shapes

The design system adopts a **Soft (0.25rem / 4px base)** shape geometry (`roundedness: 1`). Logistics environments demand optimal space utilization; overly rounded corners waste valuable screen real estate and weaken the precise, data-dense structure required for multi-column tables and dispatch boards.

- **Inputs, Buttons, Cells, and Standard Badges:** 4px border radius (`rounded`).
- **Cards, Modals, and Flyout Drawers:** 8px border radius (`rounded-lg`).
- **Live Status Dots and Avatars:** Pill/Circle (`rounded-full`) exclusively used to denote operational status or human dispatch contacts.

## Components

### Buttons
- **Primary:** Background `#2563EB`, text `#FFFFFF`, 4px radius, 0.875rem font size, medium weight. Height: 36px (compact enterprise standard). Hover: `#1D4ED8`. Active: scale(0.99).
- **Secondary (Outlined):** Background `#FFFFFF`, border 1px solid `#E2E8F0`, text `#1E293B`. Hover: `#F8FAFC`, border `#CBD5E1`.
- **Destructive / Emergency Stop:** Background `#EF4444`, text `#FFFFFF`. Hover: `#DC2626`.
- **Intelligence / Action Assistant:** Background `#8B5CF6`, text `#FFFFFF`. Hover: `#7C3AED`. Used for auto-optimizing loads or route assignments.

### Data Tables (Logistics Core)
- **Header:** Background `#F8FAFC`, height 36px, text `#64748B`, 0.75rem uppercase tracking, bottom border 1px solid `#E2E8F0`.
- **Row:** Height 44px (dense) or 52px (standard), alternating row highlight option, background `#FFFFFF`, bottom border 1px solid `#F1F5F9`. Hover state: `#F8FAFC`.
- **Selected Row:** Background `#EFF6FF` with an active 2px left border in `#2563EB`.

### Status Badges & Chips
- Compact (20px height), 4px border radius, 0.75rem typography, bold status pip (6px circle).
- **Operational / Clear:** Background `#ECFDF5`, text `#065F46`, pip `#10B981`.
- **Transit Stalled / Caution:** Background `#FFFBEB`, text `#92400E`, pip `#F59E0B`.
- **Critical Violation:** Background `#FEF2F2`, text `#991B1B`, pip `#EF4444`.
- **Predictive / AI Re-route:** Background `#F5F3FF`, text `#5B21B6`, pip `#8B5CF6`.

### Form Fields & Inputs
- Height 36px, border 1px solid `#CBD5E1`, background `#FFFFFF`, 4px radius, font size 0.875rem. Focus: border 1px solid `#2563EB` with `0 0 0 2px rgba(37, 99, 235, 0.15)`.
- Monospace variant enabled for inputs involving license plates, VIN codes, and container tracking numbers.

### Dispatch Kanban Cards & Route Timeline Blocks
- **Card Shell:** Background `#FFFFFF`, border 1px solid `#E2E8F0`, 8px radius.
- **Top Bar:** Visual route origin-destination tag (e.g., `ORD -> DFW`) with a direct gross margin or fuel efficiency index pinned to the top-right corner.
- **Status Spine:** Left-aligned 3px colored accent strip denoting route condition (green, amber, red).