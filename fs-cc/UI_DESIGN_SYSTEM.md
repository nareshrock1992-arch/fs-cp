# UI_DESIGN_SYSTEM.md — fs-cc Design System

Branch: `feature/ui-modernization`

---

## 1. Color Tokens

### Primary Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `brand` | `#2563EB` | Primary interactive elements, active nav, CTAs |
| `brand-dim` | `#1E4FB5` | Hover state for brand elements |
| `brand-light` | `#60A5FA` | Brand text on dark backgrounds |

### Surface Palette (Dark Mode)

| Token | Hex | Usage |
|-------|-----|-------|
| `panel-bg` | `#060B17` | Page background |
| `panel-surface` | `#0B1220` | Card / panel background |
| `panel-raised` | `#111B2E` | Table headers, elevated inputs |
| `panel-border` | `#1C2A42` | All borders |
| `panel-accent` | `#1E3A6E` | Active sidebar item bg |

### Surface Palette (Light Mode)

| Token | CSS Value | Usage |
|-------|-----------|-------|
| `panel-bg` | `#F0F4F8` | Page background |
| `panel-surface` | `#FFFFFF` | Card background |
| `panel-raised` | `#F8FAFC` | Table headers |
| `panel-border` | `#E2E8F0` | Borders |
| `panel-accent` | `#EFF6FF` | Accent highlights |

### Status / Semantic Colors

| Token | Hex | Status |
|-------|-----|--------|
| `lamp-available` | `#27C98A` | Available / success / answered |
| `lamp-break` | `#4C8EF5` | On Break / info / in-call |
| `lamp-live` | `#F5A623` | Waiting / warning / ringing |
| `lamp-alert` | `#EF4444` | Error / abandoned / disconnected |
| `lamp-loggedout` | `#4C5A78` | Logged Out / inactive |

### Typography Colors

| Token | Dark | Light |
|-------|------|-------|
| `ink` | `#E8ECF6` | `#0F172A` |
| `ink-dim` | `#8B99B8` | `#475569` |
| `ink-faint` | `#4C5A78` | `#94A3B8` |

---

## 2. Typography

| Role | Font | Weight | Size | Class Pattern |
|------|------|--------|------|---------------|
| Page title | IBM Plex Sans Condensed | 700 | 18px | `font-display text-lg font-bold` |
| Page subtitle | Inter | 400 | 13px | `text-sm text-ink-dim` |
| Section title | Inter | 600 | 12px uppercase | `text-[11px] font-semibold uppercase tracking-widest` |
| Card title | Inter | 600 | 14px | `text-sm font-semibold` |
| Body | Inter | 400 | 14px | `text-sm` |
| Secondary text | Inter | 400 | 13px | `text-sm text-ink-dim` |
| Table header | Inter | 600 | 11px uppercase | `text-[11px] font-semibold uppercase tracking-wider text-ink-faint` |
| Table cell | Inter | 400 | 13px | `text-sm text-ink` |
| KPI number | IBM Plex Mono | 700 | 28–36px | `font-mono font-bold text-2xl tnum` |
| KPI label | Inter | 500 | 10px uppercase | `text-[10px] font-medium uppercase tracking-widest text-ink-faint` |
| Status label | Inter | 600 | 11px | `text-xs font-semibold` |
| Badge text | Inter | 600 | 11px | `text-[11px] font-semibold` |

---

## 3. Spacing

Use Tailwind's default 4px scale. Standard patterns:

- **Page padding**: `p-6` (24px)
- **Card padding**: `p-5` (20px) for content, `px-5 py-4` for card headers
- **Table cell padding**: `px-4 py-3`
- **Section gap**: `gap-4` (16px) between cards, `gap-6` (24px) between sections
- **Inline gap**: `gap-2` (8px) for icon + label pairs
- **Form field gap**: `space-y-4` (16px)

---

## 4. Border Radius

| Context | Value | Tailwind |
|---------|-------|---------|
| Cards / Panels | 12px | `rounded-xl` |
| Buttons | 8px | `rounded-lg` |
| Inputs | 8px | `rounded-lg` |
| Badges / Pills | 999px | `rounded-full` |
| KPI icon circles | 10px | `rounded-xl` |
| Small badges | 6px | `rounded-md` |

---

## 5. Shadows

| Context | Token |
|---------|-------|
| Cards | `shadow-card` (`0 2px 8px rgba(0,0,0,0.18)`) |
| Elevated modals | `shadow-xl` |
| KPI accent | Per-tone shadow (`shadow-lamp-green` etc.) |

---

## 6. Status Badge Specification

Every status indicator uses a colored dot + label. Never rely on color alone (text label always present).

| Status | Dot Color | Text Color | Background |
|--------|-----------|------------|-----------|
| Available | `lamp-available` (green) | `lamp-available` | `lamp-available/10` |
| On Break | `lamp-break` (blue) | `lamp-break` | `lamp-break/10` |
| Logged Out | `lamp-loggedout` (slate) | `ink-dim` | `panel-raised` |
| Waiting / Ringing | `lamp-live` (amber) | `lamp-live` | `lamp-live/10` |
| In Call | `lamp-break` (blue) | `lamp-break` | `lamp-break/10` |
| Abandoned / Error | `lamp-alert` (red) | `lamp-alert` | `lamp-alert/10` |

---

## 7. Icon Usage (lucide-react)

| Context | Icon | Size |
|---------|------|------|
| Sidebar: Dashboard | `LayoutDashboard` | 18 |
| Sidebar: Live Calls | `PhoneCall` | 18 |
| Sidebar: Queue Stats | `Activity` | 18 |
| Sidebar: Agents | `Users` | 18 |
| Sidebar: Queues | `Layers` | 18 |
| Sidebar: Reports | `BarChart3` | 18 |
| Sidebar: Users | `ShieldCheck` | 18 |
| KPI: Active Call | `PhoneCall` | 20 |
| KPI: Waiting | `Clock` | 20 |
| KPI: Agents | `Headphones` | 20 |
| KPI: Queue | `Users` | 20 |
| KPI: Abandoned | `PhoneOff` | 20 |
| KPI: Reports | `TrendingUp` | 20 |
| KPI: Service Level | `BarChart3` | 20 |
| KPI: Talk Time | `Timer` | 20 |
| Caller waiting | `PhoneIncoming` | 20 |
| Caller in call | `PhoneCall` | 20 |
| Call missed | `PhoneMissed` | 20 |
| Agent | `Headphones` | 20 |
| Agent avatar | `UserRound` | 20 |
| Queue | `UsersRound` | 20 |
| ESL connected | `Wifi` | 16 |
| ESL disconnected | `WifiOff` | 16 |
| On Break | `Coffee` | 16 |
| Log Out | `LogOut` | 16 |
| Search | `Search` | 16 |
| Edit | `Pencil` | 16 |
| Delete | `Trash2` | 16 |
| Add | `Plus` | 16 |
| PIN | `KeyRound` | 16 |
| Settings | `Settings` | 16 |
| Permissions | `ShieldCheck` | 16 |
| Theme dark | `Moon` | 16 |
| Theme light | `Sun` | 16 |
| Empty: no calls | `PhoneOff` | 40 |
| Empty: no agents | `Users` | 40 |
| Empty: no queues | `Layers` | 40 |
| Empty: no data | `BarChart3` | 40 |

---

## 8. Component Specifications

### Card

```
bg-panel-surface border border-panel-border rounded-xl shadow-card
```

Variants:
- Standard: `p-5`
- With header: `<header px-5 py-4 border-b border-panel-border>` + `<body p-5>`
- Compact: `p-4`

### KPI Card

```
bg-panel-surface border border-panel-border rounded-xl p-5 shadow-card
```

Layout: icon circle (left) + number + label (center) + optional accent line.

Icon circle: `w-10 h-10 rounded-xl flex items-center justify-center` with per-tone bg/color.

KPI number: `font-mono font-bold text-2xl tnum`

### Button — Primary

```
bg-brand hover:bg-brand-dim text-white font-semibold text-sm
rounded-lg px-4 py-2 transition-colors flex items-center gap-2
```

### Button — Secondary

```
border border-panel-border dark:bg-panel-raised bg-gray-50 text-ink-dim
hover:text-ink hover:border-brand/50 font-medium text-sm
rounded-lg px-4 py-2 transition-colors flex items-center gap-2
```

### Button — Danger

```
border border-lamp-alert/30 text-lamp-alert hover:bg-lamp-alert/10
font-medium text-sm rounded-lg px-4 py-2 transition-colors
```

### Input

```
w-full rounded-lg border border-panel-border dark:bg-panel-raised bg-gray-50
px-3 py-2 text-sm text-ink placeholder-ink-faint
focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60
transition-colors
```

### Table Header Cell

```
px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider
text-ink-faint bg-panel-raised
```

### Table Body Row

```
border-b border-panel-border/60 last:border-0
hover:bg-panel-raised/50 transition-colors
```

### Badge — Status

```
inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold
```

### Empty State

```
flex flex-col items-center justify-center py-16 text-center gap-3
```
Icon: 40px, `text-ink-faint`
Heading: `text-sm font-semibold text-ink-dim`
Body: `text-sm text-ink-faint max-w-xs`

### Loading Skeleton

```
animate-pulse bg-panel-raised rounded-lg
```

---

## 9. Sidebar Specification

```
w-60 flex-shrink-0 flex flex-col
bg-panel-surface border-r border-panel-border
```

Brand header:
```
px-5 py-5 border-b border-panel-border
Logo (Radio icon) + "Switchboard" bold + "CC Admin" caption
```

Nav item inactive:
```
flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg
text-ink-faint hover:text-ink-dim hover:bg-panel-raised
transition-colors text-sm font-medium
```

Nav item active:
```
flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg
bg-brand/15 border border-brand/25 text-brand-light
text-sm font-semibold
```

---

## 10. Topbar Specification

```
h-16 px-6 border-b border-panel-border bg-panel-surface
flex items-center justify-between sticky top-0 z-10
```

Left: Page title `font-display text-base font-bold text-ink` + subtitle `text-xs text-ink-faint`

Right (left to right): ESL badge | live clock | theme toggle | divider | admin avatar + name + chevron dropdown

---

## 11. Connection Status (ESL Badge)

Must always show REAL data from `esl:status` socket event.

Connected:
```
inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
bg-lamp-available/15 text-lamp-available border border-lamp-available/25
```

Disconnected:
```
inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
bg-lamp-alert/15 text-lamp-alert border border-lamp-alert/25
animate-pulse
```
