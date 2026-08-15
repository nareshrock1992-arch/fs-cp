# UI_AUDIT.md — fs-cc Frontend Audit

Generated prior to the UI/UX modernization sprint.  
Branch: `feature/ui-modernization`

---

## 1. Repository Structure

Two independent React + Vite SPAs share a design vocabulary but diverge in implementation quality.

```
fs-cc/
  frontend/          # Admin UI — React + Vite + Tailwind + lucide-react + axios
  agent-desktop/     # Agent Desktop — React + Vite + Tailwind + fetch (no axios, no icon lib)
  backend/           # Node.js / Express (not in scope for UI redesign)
```

---

## 2. Admin UI — `frontend/`

### Pages

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Full-page gradient login form |
| Dashboard | `/` | KPI cards + queue performance + agent roster |
| LiveCalls | `/live` | Real-time call queue view |
| Agents | `/agents` | Agent management table |
| Queues | `/queues` | Queue management + tier assignment |
| QueueStats | `/stats` | Live queue analytics grid |
| Reports | `/reports` | Multi-tab reporting (6 tabs) |
| UserManagement | `/users` | Admin user + permissions management |

### Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| KpiCard | `components/KpiCard.jsx` | Metric tile: icon + value + label + accent stripe |
| Panel | `components/Panel.jsx` | Section card with optional eyebrow/title/action |
| StatusLamp | `components/StatusLamp.jsx` | Colored dot with optional label and glow animation |
| Modal | `components/Modal.jsx` | Overlay dialog, max-w-lg, 70vh scroll |
| FormField | `components/form.jsx` | Label + input wrapper + hint |
| CDRTable | `components/reports/CDRTable.jsx` | Paginated CDR table with CSV export |
| AgentSessionsTab | `components/reports/AgentSessionsTab.jsx` | Agent session summary + detail modal |
| Layout | `components/layout/Layout.jsx` | App shell: sidebar + topbar + main |
| Sidebar | `components/layout/Sidebar.jsx` | Dark nav panel with NavLinks |
| Topbar | `components/layout/Topbar.jsx` | Header: page title + ESL status + clock + avatar |

### API Namespaces (from `src/api/client.js`)

| Namespace | Key Methods |
|-----------|-------------|
| Auth | login |
| Users | list, create, update, remove, resetPassword, updatePermissions |
| Agents | list, get, history, create, update, remove, setStatus, setState, setPin |
| Queues | list, get, create, update, remove, addTier, removeTier |
| Calls | live |
| Stats | dashboard, queues |
| Reports | queuePerformance, agentPerformance, ivrPaths, callVolume, cdr, exportUrl, agentSessions, agentSessionsList, agentActivity, agentActivityDetail, agentStateEvents |

### Socket.IO Events Consumed (admin)

| Event | Consumers |
|-------|-----------|
| `esl:status` | Topbar (connection indicator), LiveCalls (reload trigger) |
| `agent:state` | Dashboard, Agents, QueueStats |
| `agent:status` | Dashboard, Agents, QueueStats |
| `agent:update` | Agents (full reload) |
| `call:enqueued` | Dashboard, LiveCalls, QueueStats, agent-desktop QueueCard |
| `call:bridged` | Dashboard, LiveCalls, QueueStats |
| `call:abandoned` | LiveCalls, QueueStats |
| `call:bridge-end` | LiveCalls, QueueStats |
| `channel:hangup` | LiveCalls, QueueStats |

---

## 3. Agent Desktop — `agent-desktop/`

### Pages

| Page | Description |
|------|-------------|
| Login | Token-styled login with inline SVG |
| Dashboard | Header + StatusControls + PerformanceCard + QueueCards grid |

### Components

| Component | Purpose |
|-----------|---------|
| EslBadge | Green/red connection pill |
| LiveCallPanel | Active call card with border animation |
| PerformanceCard | 4-tile KPI + status chip strip |
| QueueCard | Queue live stats card |
| StatusControls | Three status-change buttons |
| ThemeToggle | Dark/light toggle |

### Socket.IO Events Consumed (agent-desktop)

| Event | Handler |
|-------|---------|
| `connect` | Sync ESL + agent status via REST |
| `esl:status` | Update ESL connection indicator |
| `agent:offering` | Set incoming call state (ringing) |
| `call:bridged` | Advance to talking state |
| `call:bridge-end` | Clear active call |
| `channel:hangup` | Reload active calls |
| `agent:no-answer` | Clear ringing state |
| `agent:status` | Update displayed status (null-guarded ✓) |
| `agent:state` | Update displayed state (null-guarded ✓) |
| `call:enqueued` | Reload queue stats |
| `call:abandoned` | Reload queue stats |

---

## 4. CSS / Theming

### Admin UI (`frontend/`)

- **No CSS custom properties.** All theming uses `dark:` prefix Tailwind variants.
- Light-mode card backgrounds use raw Tailwind: `bg-white`, `bg-gray-50`, `bg-gray-100`.
- Dark-mode card backgrounds use named tokens: `dark:bg-panel-surface`, `dark:bg-panel-raised`.
- Tailwind config defines color tokens as hex strings (not CSS variables).
- Global `body` bg is a hardcoded hex (`#0b0e14`).
- Scrollbar colors are hardcoded hex.
- Default theme is **dark** (class applied on load from localStorage `cc-theme`).

### Agent Desktop (`agent-desktop/`)

- **Full CSS custom property token system** in `index.css`:
  - `:root` = light values; `.dark` = dark values.
  - `--panel-bg`, `--panel-surface`, `--panel-raised`, `--panel-border`, `--panel-accent`.
  - `--ink`, `--ink-dim`, `--ink-faint`, `--lamp-available`, `--lamp-break`, etc.
- Tailwind config references vars via `rgb(var(--token) / <alpha-value>)`.
- Component classes in `@layer components`: `.card`, `.btn`, `.btn-primary`, `.stat-label`, `.stat-value`, `.field-input`.
- Default theme is system-preference-aware.

### Shared Token Palette (both configs)

```js
panel:   { bg:'#060B17', surface:'#0B1220', raised:'#111B2E', border:'#1C2A42', accent:'#1E3A6E' }
ink:     { DEFAULT:'#E8ECF6', dim:'#8B99B8', faint:'#4C5A78' }
lamp:    { live:'#F5A623', available:'#27C98A', break:'#4C8EF5', loggedout:'#4C5A78', alert:'#EF4444' }
brand:   { DEFAULT:'#2563EB', dim:'#1E4FB5', light:'#60A5FA' }
display: 'IBM Plex Sans Condensed'
sans:    'Inter'
mono:    'IBM Plex Mono'
```

---

## 5. Icon Library

| App | Library | Usage |
|-----|---------|-------|
| Admin UI | `lucide-react` | All icons — sidebar, topbar, all pages |
| Agent Desktop | Inline `<svg>` only | No icon library installed |

Agent Desktop icon inconsistency is significant — it means icons in the two apps have completely different visual styles and weights.

---

## 6. Inconsistencies Catalogued

### 6.1 Color / Token Violations

| Location | Issue |
|----------|-------|
| `Sidebar.jsx` | `bg-[#08111E]` — raw hex instead of `bg-panel-surface` |
| `Sidebar.jsx` | `border-[#1C2A42]` — raw hex instead of `border-panel-border` |
| `Login.jsx` (admin) | `bg-gradient-to-br from-slate-100 to-blue-50` — completely off-palette |
| `Login.jsx` (admin) inputs | Doesn't use `inputClass` from `form.jsx` |
| `Login.jsx` (admin) submit | `bg-blue-600` instead of `bg-brand` |
| `UserManagement.jsx` Avatar | `bg-blue-600` instead of `bg-brand` |
| `UserManagement.jsx` RoleBadge | `bg-blue-100 text-blue-700` — no dark mode |
| `UserManagement.jsx` Add User button | Inline `bg-blue-600` instead of `buttonPrimary` |
| `Reports.jsx` active tab | `border-lamp-live` (amber) instead of `border-brand` (blue) |
| `CDRTable.jsx` TH | `bg-gray-50` — no `dark:` prefix |
| `form.jsx` focus ring | `focus:ring-lamp-live/40` (amber) — should be brand blue |
| `KpiCard.jsx` light bg | `bg-green-50`, `bg-amber-50`, `bg-red-50` — hardcoded, not tokens |
| `frontend/index.css` body | `background-color: #0b0e14` — hardcoded hex |
| `frontend/index.css` scrollbar | `#232938`, `#2e3648` — hardcoded hex |

### 6.2 Card Pattern Fragmentation (3 different patterns)

| Pattern | Where Used | Class Differences |
|---------|-----------|-------------------|
| `Panel` component | Agents, Queues, LiveCalls, some Reports tabs | `rounded-lg shadow-card` |
| QueueStats `QueueCard` | QueueStats page only | `rounded-lg shadow-card` (same visually, but duplicated code) |
| Raw `div` | Reports (Queue/Agent tabs), UserManagement | `rounded-xl shadow-md` (different radius + shadow!) |

### 6.3 Table Header Pattern Fragmentation (3 variants)

| Variant | Characteristics |
|---------|----------------|
| No-bg (Panel pages) | No background, `pb-2.5`, `text-[11px] uppercase tracking-widest` |
| With-bg (Reports/Users) | `bg-gray-50 dark:bg-panel-raised px-4 py-3`, `text-[11px]` |
| CDR-specific | `bg-gray-50` (no dark: variant), `px-4 py-3` |

### 6.4 Three Different "Metric Tile" Implementations

| Implementation | File | Props |
|----------------|------|-------|
| `KpiCard` | `components/KpiCard.jsx` | icon, label, value, suffix, sub, tone |
| `LiveKpi` (local) | `pages/LiveCalls.jsx` | label, value, colorClass |
| `Stat` (local) | `pages/QueueStats.jsx` (QueueCard) | label, value, sub, live, color |
| `KpiTile` (local) | `agent-desktop/PerformanceCard.jsx` | label, value |
| `MetricCard` (local) | `components/reports/AgentSessionsTab.jsx` | label, value, sub |

### 6.5 Structural Issues

- **No mobile nav** — sidebar `hidden md:flex`; below 768px there is no navigation at all.
- **Two completely separate auth strategies** — admin uses axios interceptors; agent-desktop uses bare fetch with manual headers.
- **Agent Desktop has no icon library** — all icons are hand-coded SVG paths. Inconsistent stroke weight and style.
- **`Dashboard.jsx` light-mode loading/error states** — plain text `<p>` elements, no visual treatment.
- **Empty state presentation** — inline text only, no icon + descriptive copy pattern.
- **`font-display` token** — defined in admin Tailwind config but absent from agent-desktop config.

---

## 7. Page-by-Page Feature Inventory

### Dashboard (admin)

- **KPIs**: Active Calls, Queued Calls, Agents Available, Calls Today, Calls Abandoned (5 tiles)
- **Queue Performance**: Recharts donut + table with per-queue bars. Data from `Stats.dashboard()`.
- **Agent Roster**: sorted list (Available → Break → Out), idle timer per Available agent.
- **Polling**: 10s interval + socket-triggered reload.
- **Loading state**: plain text `"Loading dashboard…"`.
- **Error state**: Panel with `text-lamp-alert` paragraph.

### Live Calls (admin)

- **KPIs**: Waiting, In Progress, Longest Wait (3 tiles, inline `LiveKpi` component).
- **Waiting table**: Queue, Customer ANI, Wait time.
- **On-Call table**: Queue, Customer, Agent, Extension, Duration.
- **Empty state**: paragraph text inside Panel.
- **Polling**: 5s interval + socket-triggered.
- **Loading**: plain text.
- **Error**: plain `text-lamp-alert` text (not inside Panel).

### Agents (admin)

- **Columns**: Agent, Avaya Ext, Contact, Status, PIN, Actions.
- **Status**: `StatusLamp` + inline `<select>` for permitted users.
- **Search**: text input, client-side filter.
- **Actions**: KeyRound (PIN), Pencil (edit), Trash2 (delete).
- **Modals**: Create/Edit (8 fields), Set PIN (2 password fields).
- **Empty state**: "No agents found." — plain text.

### Queues (admin)

- **Columns**: Queue name + raw name, Strategy, Max Wait, Max Size, Actions.
- **Actions**: Users2 (tiers), Pencil (edit), Trash2 (delete).
- **Modals**: Create/Edit, Tier management (agent list with status lamps).
- **Empty state**: "No queues found." — plain text.

### Queue Stats (admin)

- **Layout**: Responsive grid of `QueueCard` components.
- **Per-card live data**: Waiting, In Call, Agents Available, Longest Wait.
- **Per-card today stats**: Offered, Answered, Answer Rate, Avg Wait, Abandoned, Missed, Abandon Rate.
- **SLA bar**: visual progress bar (threshold: 80% green, 60% amber, below red).
- **Polling**: 8s interval + socket-triggered.

### Reports (admin)

- **Date range**: from/to date inputs + Apply.
- **Tabs**: Volume Trend, Queue Performance, Agent Performance, IVR Paths, CDR Report, Agent Sessions.
- **Volume Trend**: Recharts LineChart (3 series: offered/answered/abandoned). Colors hardcoded.
- **Queue/Agent Perf**: tables in raw `div` cards (not Panel).
- **IVR Paths**: Panel, shows queue destinations.
- **CDR**: `CDRTable` component (paginated, CSV export, disposition filter).
- **Agent Sessions**: `AgentSessionsTab` (summary table + detail modal).
- **Export**: per-tab CSV links.

### User Management (admin)

- **KPIs**: Total Users, Active Users, Admins (3 tiles, raw `div` cards).
- **Table**: User (avatar + name + id), Role badge, Created date, Actions.
- **Actions**: Pencil, Trash2, Key (reset pw), ShieldCheck (permissions).
- **Modals**: Create, Edit, Reset Password, Delete confirm, Permissions.

### Agent Desktop — Dashboard

- **Header**: logo, "Agent Desktop" label, ESL badge, agent pill (name/status/avatar), theme toggle, logout.
- **LiveCallPanel**: animated border card for incoming/active calls.
- **StatusControls**: three status buttons with active state.
- **PerformanceCard**: 4 KPI tiles + status transition chips.
- **My Queues**: grid of `QueueCard` components (same data as admin QueueStats).
- **Footer**: version + copyright.

---

## 8. Redesign Priority Matrix

| Area | Current Quality | Redesign Impact |
|------|----------------|----------------|
| Admin Login | ❌ Off-palette, disconnected | High — first impression |
| Admin Sidebar | ⚠️ Hardcoded hex, no mobile | High — present on every page |
| Admin Dashboard | ⚠️ Functional, light-mode loading gaps | High — landing page |
| Admin Live Calls | ⚠️ Table-only, no visual richness | High — ops-critical view |
| Admin Agents | ✅ Reasonable, minor token violations | Medium |
| Admin Queues | ✅ Reasonable | Medium |
| Admin Queue Stats | ⚠️ Functional but card pattern diverges | Medium |
| Admin Reports | ❌ Three different card patterns, amber tab border | High |
| Admin User Mgmt | ❌ Token violations throughout | Medium |
| Agent Desktop Login | ✅ Token-consistent | Low |
| Agent Desktop Dashboard | ✅ Best token usage in codebase | Medium — polish only |
| Icon consistency | ❌ Two completely different strategies | High — affects both apps |
| Loading/Empty/Error states | ❌ Plain text everywhere | Medium |
| Mobile nav | ❌ Non-existent | Low-medium |
