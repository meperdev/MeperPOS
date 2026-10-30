---
name: unslop-ui
description: >-
  Comprehensive design-engineering skill for diagnosing and eliminating "AI slop"
  in user interfaces. Activate this skill whenever the user asks to "unslop",
  polish, refine, de-AI, or elevate a UI, dashboard, landing page, form, table,
  or component, or when reviewing/building frontend interfaces that look generic,
  over-styled, purple-biased, or AI-generated.
---

# Unslop UI: The Complete Design-Engineering Protocol

AI-generated interfaces suffer from a recognizable cluster of visual and structural habits—"AI slop"—characterized by purple/indigo neon gradients, arbitrary spacing off the grid, misaligned keylines, emoji clutter, excited punctuation, `ALL CAPS` label overuse, pill-badge overload, and low-signal "toy" charts.

When this skill is activated, execute the **4-Stage Execution Loop** below and enforce all **12 Unslop Protocols** across every surface of the UI.

---

## 0. The 4-Stage Execution Loop

Whenever you are asked to unslop an existing UI or build a slop-free interface:

1. **Stage 1 — Audit & Diagnose**: Scan the target code/screenshots against the **Quick-Scan Diagnostic Matrix** (Section 1). List the exact violations found before writing code.
2. **Stage 2 — Token & Grid Lock**: Replace arbitrary colors, shadows, radii, and spacing with the **Canonical Unslop Design Tokens** (Section 2).
3. **Stage 3 — Structural & Component Refactor**: Apply Protocols 1–12 systematically (spatial grid → surface neutralization → keyline alignment → typography/case detox → emoji/copy purge → component & chart elevation).
4. **Stage 4 — Visual & Optical Verification**: Verify that every left edge shares a unified vertical rail, all numbers use `tabular-nums`, no decorative emojis remain, and contrast hierarchy is driven by surface luminance + `1px` hairline borders rather than neon glow.

---

## 1. Quick-Scan Diagnostic Matrix ("Spot the Slop")

Use this reference table to immediately identify AI-generated patterns and their required engineering fixes:

| Category | AI Slop Symptom (Before) | Craft-Grade Standard (After) |
| :--- | :--- | :--- |
| **Vertical Rhythm** | Arbitrary gaps (`22px`, `30px`, `42px`, `25px`, `36px`), bloated padding (`p-8` everywhere). | Strict **4px/8px spatial grid** (`4, 8, 12, 16, 24, 32, 48px`). Intentional density (`16px–24px` card padding). |
| **Horizontal Alignment** | Logo at `26px`, nav items at `18px`, search text floating, ragged left edges. | Single **unified vertical keyline rail** (`16px` or `24px`) shared by logo, inputs, section headers, and nav items. |
| **Color Palette** | Indigo/violet/purple bias (`#6366f1`, `#8b5cf6`), blue-tinted dark mode (`#121326`), neon radial blobs. | **True carbon/obsidian neutrals** (`#09090B`, `#111113`, `#161618`) in dark mode; warm/cool alabaster (`#FAFAFA`, `#FFFFFF`) in light mode. |
| **Borders & Depth** | Glowing colored borders, heavy blurred drop shadows (`shadow-2xl shadow-purple-500/20`), `backdrop-blur` everywhere. | Crisp **`1px solid` hairline borders** (`rgba(255,255,255,0.07)` dark / `#E4E4E7` light). Subtle luminance stepping. |
| **Typography & Case** | `UPPERCASE` tracking-wide labels (`PAID THIS MONTH`, `NAVIGATION`), proportional numbers that jitter. | Quiet **`Sentence case`** (`Paid this month`, `Navigation`), `tabular-nums` on every number, tight display tracking (`-0.025em`). |
| **Copy & Branding** | `EmberAI [PRO]`, `Welcome back, Damir! 👋`, `+12%!!`, `+4.2% this month!!`, `Acme Corp`, `Lorem ipsum`. | Clean brand (`Ember`), contextual header (`October 2026`), sober delta (`+12% vs last month`), domain-realistic data. |
| **Icons & Emojis** | Emojis as UI icons (`🔥`, `✅`, `🆕`, `👥`, `👑`, `🚀`, `✨`), icons trapped in 20%-opacity colored circles. | **Zero decorative emojis**. Consistent `14px–16px` monochrome `1.5px`-stroke vector icons or `6px` semantic status dots. |
| **Badges & Counters** | Saturated pill badges on every row (`bg-indigo-600 text-white rounded-full px-3`). | Plain right-aligned tabular numbers (`text-zinc-500`) for counts; `6px` colored dots for status/tiers. |
| **Data Visualization** | Thick rounded purple bar charts with no Y-axis, no gridlines, and fake sine-wave heights. | High-signal charts: explicit Y-axis scale (`20k–120k`), `1px` dashed/hairline gridlines, zero-baseline, thin `1.5px` strokes. |
| **Decorative Assets** | Cartoon SVG clipart, flat emoji credit cards, generic unDraw illustrations. | Typographic restraint or realistic, monochrome/depth-lit hardware and UI renders. |
| **Micro-Interactions** | `hover:scale-105 transition-all duration-500`, bouncing buttons, glowing hover rings. | Instant/crisp `120ms–150ms ease-out` background/border color shifts; zero layout-shifting scale transforms on cards. |

---

## 2. Canonical Unslop Design Tokens (Vanilla CSS & Tailwind)

Always anchor refactors in a disciplined token system before touching individual components.

### Vanilla CSS Variables (`:root` & `[data-theme="dark"]`)

```css
:root {
  /* Light Mode Surfaces — Crisp Alabaster & Zinc */
  --bg-canvas: #FAFAFA;
  --bg-surface: #FFFFFF;
  --bg-elevated: #F4F4F5;
  --bg-interactive-hover: rgba(0, 0, 0, 0.04);
  --bg-interactive-active: rgba(0, 0, 0, 0.07);

  /* Hairline Borders */
  --border-subtle: #E4E4E7;
  --border-strong: #D4D4D8;
  --border-focus: #18181B;

  /* Text Hierarchy */
  --text-primary: #09090B;
  --text-secondary: #52525B;
  --text-muted: #71717A;

  /* Semantic Status (Subdued, Non-Neon) */
  --status-success: #16A34A;
  --status-warning: #D97706;
  --status-danger: #DC2626;

  /* Strict 4px/8px Spatial Scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Restrained Radii */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Geist Mono', monospace;
}

[data-theme="dark"], .dark {
  /* Dark Mode Surfaces — True Carbon/Obsidian (Zero Purple/Blue Tint) */
  --bg-canvas: #09090B;
  --bg-surface: #111113;
  --bg-elevated: #18181B;
  --bg-interactive-hover: rgba(255, 255, 255, 0.04);
  --bg-interactive-active: rgba(255, 255, 255, 0.08);

  /* Hairline Borders — Luminance-based, never glowing */
  --border-subtle: rgba(255, 255, 255, 0.07);
  --border-strong: rgba(255, 255, 255, 0.14);
  --border-focus: rgba(255, 255, 255, 0.28);

  /* Text Hierarchy */
  --text-primary: #F4F4F5;
  --text-secondary: #A1A1AA;
  --text-muted: #71717A;

  /* Semantic Status (Calibrated for Dark Surfaces) */
  --status-success: #22C55E;
  --status-warning: #F59E0B;
  --status-danger: #EF4444;
}
```

### Tailwind CSS Equivalent Mapping

| Role | Slop Classes (Ban) | Unslop Classes (Enforce) |
| :--- | :--- | :--- |
| **App Canvas (Dark)** | `bg-slate-900`, `bg-indigo-950`, `bg-[#121324]` | `bg-[#09090B]` or `bg-zinc-950` |
| **Card Surface (Dark)** | `bg-slate-800/60 backdrop-blur-xl shadow-2xl` | `bg-[#111113]` or `bg-zinc-900/90` |
| **Card Border (Dark)** | `border-2 border-purple-500/40 shadow-purple-500/10` | `border border-white/[0.07]` |
| **Primary Text** | `text-white font-extrabold` | `text-zinc-100 font-medium` |
| **Section / Metric Label** | `text-xs font-bold uppercase tracking-widest text-indigo-400` | `text-[13px] font-normal text-zinc-400` (Sentence case) |
| **Active Nav Item** | `bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg` | `bg-white/[0.08] text-zinc-100 font-medium` |
| **Metric Number** | `text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r...` | `text-3xl font-semibold tracking-tight text-zinc-100 tabular-nums` |

---

## 3. The 12 Unslop Protocols (Detailed Rules & Code Examples)

### Protocol 1: Strict 4px/8px Spatial Grid & Density Calibration
AI models frequently invent arbitrary pixel spacings (`margin-bottom: 22px`, `gap: 30px`, `padding: 42px`, `margin-top: 25px`) and default to oversized, puffy containers.
- **Rule 1.1**: Snap every margin, padding, and gap to the **4px/8px grid** (`4, 8, 12, 16, 20, 24, 32, 40, 48px`). Only use `2px` or `6px` for micro-optical adjustments inside badges or inline icon gaps.
- **Rule 1.2**: Calibrate component heights for professional tool density:
  - Sidebar navigation rows: `32px–36px` height (`h-8` or `h-9`), `8px–12px` horizontal padding, `4px` (`gap-1`) vertical stack gap.
  - Search and text inputs: `32px–36px` height (`h-8` or `h-9`), `13px–14px` font size.
  - Section-to-section sidebar spacing: `24px` (`mb-6`) between groups, `8px` (`mb-2`) between group header and first item.
- **Rule 1.3**: Eliminate double-padding traps (e.g., `p-8` outer wrapper + `p-8` inner grid + `p-8` card). Use `16px–24px` (`p-4` to `p-6`) for dashboard panels and `12px–16px` (`gap-3` to `gap-4`) between bento cards.

#### Before & After: Sidebar Rhythm & Sizing
```html
<!-- ❌ AI SLOP: Arbitrary spacing (22px, 30px, 42px), bloated 48px nav rows, neon purple active state -->
<aside class="w-72 bg-[#131426] p-[26px]">
  <div class="mb-[22px] flex items-center gap-3">
    <div class="h-9 w-9 rounded-xl bg-purple-600 shadow-lg shadow-purple-500/50"></div>
    <span class="text-xl font-extrabold text-white">EmberAI</span>
    <span class="rounded-full bg-indigo-500/30 border border-indigo-400 px-2.5 py-0.5 text-xs font-bold text-indigo-200">PRO</span>
  </div>
  <div class="mb-[30px]">
    <input class="h-[42px] w-full rounded-xl bg-indigo-950/60 border border-indigo-500/30 px-4 text-sm text-white" placeholder="🔍 Search anything..." />
  </div>
  <div class="mb-[14px] text-xs font-bold uppercase tracking-widest text-indigo-300/70">NAVIGATION</div>
  <nav class="space-y-2.5 mb-[42px]">
    <a class="flex h-[42px] items-center gap-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 text-white font-semibold shadow-md">
      <span>🏠</span> Overview
    </a>
  </nav>
</aside>

<!-- ✅ UNSLOPPED: Strict 4px/8px grid (16px/24px/32px), unified keyline, 36px rows, obsidian neutral -->
<aside class="w-60 bg-[#09090B] border-r border-white/[0.07] p-4 select-none">
  <!-- Header: 16px bottom margin, aligned to left keyline -->
  <div class="mb-4 flex h-8 items-center justify-between px-2">
    <div class="flex items-center gap-2">
      <svg class="h-4 w-4 text-zinc-100" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L2 5v6l6 4 6-4V5L8 1z"/></svg>
      <span class="text-sm font-semibold tracking-tight text-zinc-100">Ember</span>
    </div>
  </div>

  <!-- Search: 32px height, 24px bottom margin -->
  <div class="mb-6">
    <div class="flex h-8 items-center justify-between rounded-md bg-white/[0.04] border border-white/[0.07] px-2.5 text-[13px] text-zinc-400">
      <span class="flex items-center gap-2">
        <svg class="h-3.5 w-3.5 text-zinc-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M21 21l-5.2-5.2m2.2-5.8a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <span>Search</span>
      </span>
      <kbd class="text-[11px] font-mono text-zinc-500">⌘K</kbd>
    </div>
  </div>

  <!-- Section Header: Sentence case, 8px bottom margin, aligned with nav item text/icon rail -->
  <div class="mb-2 px-2 text-[12px] font-normal text-zinc-500">Navigation</div>
  <nav class="space-y-1 mb-6">
    <a class="flex h-8 items-center gap-2.5 rounded-md bg-white/[0.08] px-2 text-[13px] font-medium text-zinc-100">
      <svg class="h-4 w-4 text-zinc-100" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
      <span>Overview</span>
    </a>
    <a class="flex h-8 items-center justify-between rounded-md px-2 text-[13px] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200 transition-colors duration-150">
      <span class="flex items-center gap-2.5">
        <svg class="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>
        <span>Inbox</span>
      </span>
      <span class="text-[12px] text-zinc-500 tabular-nums">12</span>
    </a>
  </nav>
</aside>
```

---

### Protocol 2: Unified Keylines & Optical Alignment
In AI-built UIs, every child block chooses its own horizontal inset—for example, the brand logo sits at `26px` from the left edge, the search box sits at `18px`, the `NAVIGATION` header sits at `18px`, and the nav item icons sit at `30px` because of inner button padding.
- **Rule 2.1 (The Single Left Keyline Rail)**: Draw an imaginary vertical line down the left edge of every column/panel. The left edge of the **Logo icon**, the **Search icon/input**, the **Section label (`Navigation`)**, and the **Nav item icons** must align on the exact same X-coordinate (or the container edges of interactive elements must align while their inner icons share a second inner keyline within `8px`).
- **Rule 2.2 (Main Content Keyline)**: In the main viewport, the breadcrumb (`Overview`), the page heading (`October 2026`), and the left border of the first metric card must fall on the exact same vertical rail.
- **Rule 2.3 (Right Keyline Rail)**: Right-aligned elements in lists/sidebars (keyboard shortcuts `⌘K`, inbox counts `12`, plan user counts `18`, `64`, `210`) must share a single right vertical keyline and use `tabular-nums`.

```css
/* ✅ Vanilla CSS Keyline Enforcement */
.sidebar {
  --sidebar-rail: 16px;
  --item-inset: 8px;
  padding: var(--sidebar-rail);
}

/* Both section headers and nav links share the exact inner inset so icons & labels line up */
.sidebar-section-label,
.sidebar-nav-link {
  padding-inline: var(--item-inset);
}
```

---

### Protocol 3: De-Purpling, Glow Removal & True Neutral Surfaces
LLMs heavily over-index on Tailwind's `indigo-500`, `violet-600`, and `purple-500` palette, paired with `backdrop-blur`, radial glow blobs, and tinted dark backgrounds (`#111328`).
- **Rule 3.1**: Strip all purple/indigo/violet gradients, glowing borders, and blurred neon blobs unless the user's explicit brand guidelines require purple.
- **Rule 3.2**: Use **true neutral carbon/obsidian** (`#09090B` canvas, `#111113` card surface, `#18181B` elevated/hover) in dark mode. Never tint dark mode backgrounds with saturated blue or purple.
- **Rule 3.3**: Separate surfaces using **luminance stepping + `1px solid` hairline borders** (`rgba(255,255,255,0.07)` in dark mode, `#E4E4E7` in light mode). Avoid `box-shadow` in dark mode except on floating menus/modals.
- **Rule 3.4**: If a subtle top-edge highlight is desired on dark cards, use `box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.05)` instead of outer neon glow.

---

### Protocol 4: Typography, Casing & Numeric Discipline
AI UIs shout at the user by combining `UPPERCASE` labels, bold weights everywhere, and unformatted numbers.
- **Rule 4.1 (Sentence Case Default)**: Convert `ALL CAPS` labels (`PAID THIS MONTH`, `REVENUE`, `NAVIGATION`, `PLANS`, `OVERDUE`) to calm **Sentence case** (`Paid this month`, `Revenue`, `Navigation`, `Plans`, `Overdue`) in `12px–13px` regular/medium weight (`color: var(--text-muted)`). Reserve uppercase strictly for 2–3 character abbreviations (`USD`, `API`, `SLA`, `⌘K`) or chart axis micro-ticks if needed.
- **Rule 4.2 (Tabular Numerals Everywhere)**: Apply `font-variant-numeric: tabular-nums` (Tailwind `tabular-nums`) to every KPI value, currency figure, percentage delta, badge count, table cell, and timer.
- **Rule 4.3 (Hierarchy via Contrast, Not Weight Inflation)**: Never use `font-black` (`900`) or `font-extrabold` (`800`) in application UI. Use `500` (`font-medium`) or `600` (`font-semibold`) with tight tracking (`letter-spacing: -0.025em`) for large figures (`$48,210`), and `400` (`font-normal`) for labels.
- **Rule 4.4 (Two-Tone Contextual Headings)**: Instead of a bold, oversized greeting (`Welcome back, Damir!`), pair a primary temporal/domain noun in primary text with its qualifier in muted text:
  ```html
  <h1 class="text-2xl font-medium tracking-tight text-zinc-100">
    October <span class="text-zinc-500 font-normal">2026</span>
  </h1>
  ```

---

### Protocol 5: Emoji Purge, Copywriting Detox & Authentic Data
Nothing exposes an AI-built UI faster than emojis in chrome, exclamation marks in metrics, and cliché placeholder text.
- **Rule 5.1 (Strict Emoji Ban)**: Delete all emojis from navigation items, KPI deltas, section headers, buttons, empty states, and feature cards (`🔥 +12%!!`, `✅ +4.2% this month!!`, `🏠 Overview`, `👑 Enterprise`, `👋`).
- **Rule 5.2 (Zero Exclamation Marks)**: System UI and analytics must never use `!` or `!!`.
  - ❌ `🔥 +12%!!` → ✅ `<span class="text-emerald-500">+12%</span> <span class="text-zinc-500">vs last month</span>`
  - ❌ `✅ +4.2% this month!!` → ✅ `<span class="text-emerald-500">4.2% ↑</span> <span class="text-zinc-500">vs September</span>`
- **Rule 5.3 (Kill "AI" & "PRO" Brand Slop)**: Unless specifically requested, remove tacked-on `AI` suffixes (`EmberAI` → `Ember`) and glowing `PRO` / `BETA` / `NEW ✨` pills next to the logo.
- **Rule 5.4 (Ban Generic Placeholders)**: Never use `John Doe`, `Jane Smith`, `Acme Corp`, `user@example.com`, `Lorem ipsum`, or sequential `$12,345.67` numbers. Use realistic domain copy, plausible non-round numbers (`$48,210`, `$124,860.40`), and specific comparative timeframes (`vs September`, `3 fewer`).

---

### Protocol 6: Badges, Pills & Status Indicator Restraint
AI UIs wrap every number and category in a bright rounded pill badge, creating a "Christmas tree" effect down the right side of sidebars and tables.
- **Rule 6.1 (Count De-escalation)**: Sidebar and tab counters (`Inbox 12`, `Enterprise 18`, `Business 64`, `Pro 210`, `Starter 480`, `Free 1.2k`) must **not** sit inside colored pills with people emojis (`18 👤`). Render them as plain, right-aligned `12px` muted tabular text (`text-zinc-500 tabular-nums`).
- **Rule 6.2 (6px Status Dots over Heavy Icons)**: For categorical tiers, environments, or statuses (e.g., `Enterprise`, `Business`, `Pro`, `Starter`, `Free`), replace emojis (`👑`, `💼`, `⚡`, `🌱`, `🎁`) with a clean `6px` (`h-1.5 w-1.5 rounded-full`) semantic dot aligned to the left icon center.

#### Before & After: Sidebar Plans List
```html
<!-- ❌ AI SLOP: Emojis + saturated purple pill badges with user icons -->
<div class="text-xs font-bold uppercase text-indigo-300 mb-3">🗂️ PLANS</div>
<ul class="space-y-3">
  <li class="flex items-center justify-between text-white">
    <span>👑 Enterprise</span>
    <span class="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-bold">18 👤</span>
  </li>
  <li class="flex items-center justify-between text-white">
    <span>⚡ Pro</span>
    <span class="rounded-full bg-purple-600 px-2.5 py-0.5 text-xs font-bold">210 👤</span>
  </li>
</ul>

<!-- ✅ UNSLOPPED: Sentence case label, 6px semantic dots, quiet tabular counters -->
<div class="mb-2 px-2 text-[12px] text-zinc-500">Plans</div>
<ul class="space-y-1">
  <li class="flex h-7 items-center justify-between px-2 text-[13px] text-zinc-300">
    <span class="flex items-center gap-2.5">
      <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
      <span>Enterprise</span>
    </span>
    <span class="font-mono text-[12px] text-zinc-500 tabular-nums">18</span>
  </li>
  <li class="flex h-7 items-center justify-between px-2 text-[13px] text-zinc-300">
    <span class="flex items-center gap-2.5">
      <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
      <span>Pro</span>
    </span>
    <span class="font-mono text-[12px] text-zinc-500 tabular-nums">210</span>
  </li>
</ul>
```

---

### Protocol 7: Iconography Discipline
- **Rule 7.1**: Use a single vector icon family (e.g., Lucide, Phosphor, Geist, or custom `1.5px` stroke SVGs) at `14px–16px` (`h-4 w-4`).
- **Rule 7.2**: Default icon color must be one step quieter than its adjacent label (`text-zinc-500` when label is `text-zinc-400`; `text-zinc-100` only when active).
- **Rule 7.3 (Ban the "Icon in a Colored Box" Trope)**: AI generators constantly place a `24px` colored icon inside a `48x48` rounded square with `bg-indigo-500/10 text-indigo-400` on every card and feature block. Remove the wrapper box; either render the bare `16px` monochrome icon inline with the title, or omit the icon entirely if the label ("Paid this month", "Revenue") is self-explanatory.

---

### Protocol 8: Data Visualization & Chart Craft
When asked for a chart, AI defaults to thick, pill-shaped vertical bars (`border-radius: 9999px`) with purple gradients, arbitrary heights, no Y-axis scale, and no reference lines.
- **Rule 8.1 (Always Include Quantitative Context)**: Every chart must have:
  - Explicit Y-axis tick labels (`0`, `20k`, `40k`, `60k`, `80k`, `100k`, `120k`, `140k`) in `11px` muted `tabular-nums`.
  - Explicit X-axis temporal labels (`Aug`, `Sep`, `Oct`, `Nov`, `Dec`, `Jan`) aligned cleanly to ticks.
  - Subtle `1px` horizontal gridlines (`rgba(255,255,255,0.04)` or dashed `stroke-dasharray="2 2"`), with a slightly clearer zero-baseline (`rgba(255,255,255,0.12)`).
- **Rule 8.2 (Line, Area & Stream Precision)**:
  - Use `1.5px` stroke widths for data series—never thick `4px–6px` neon tubes.
  - If using multi-series comparison (e.g., positive revenue by tier above a zero baseline vs. negative churn/refunds in muted grey curves below the baseline, as seen in `unslop.mp4` 00:07–00:09), use distinct semantic hues (`#F59E0B`, `#3B82F6`, `#EC4899`, `#10B981`) for active series and subdued zinc (`rgba(255,255,255,0.2)`) for baseline/outflow comparison series.
  - If using bar charts, use sharp or micro-rounded corners (`rx="2"` or `rounded-t-[2px]`), never `rounded-full` capsules.

#### Before & After: Metric Card & Chart Structure (Vanilla CSS + SVG)
```html
<!-- ✅ UNSLOPPED: High-Signal Revenue Panel with Y-Axis, Hairline Grid & Multi-Series SVG Curves -->
<section class="rounded-xl bg-[#111113] border border-white/[0.07] p-5">
  <div class="mb-6">
    <div class="text-[13px] text-zinc-400 mb-1">Revenue</div>
    <div class="text-3xl font-semibold tracking-tight text-zinc-100 tabular-nums mb-1.5">$124,860.40</div>
    <div class="text-[12px] tabular-nums">
      <span class="text-emerald-400">4.2% ↑</span>
      <span class="text-zinc-500 ml-1">vs September</span>
    </div>
  </div>

  <!-- Chart Container with Y-Axis & Hairline Grid -->
  <div class=" grid grid-cols-[36px_1fr] gap-3 items-center">
    <div class="flex flex-col justify-between h-44 text-[11px] font-mono text-zinc-600 tabular-nums text-right pr-1">
      <span>140k</span><span>120k</span><span>100k</span><span>80k</span><span>60k</span><span>40k</span><span>20k</span><span>0</span>
    </div>
    <div class="relative h-44 w-full border-b border-white/[0.08]">
      <!-- Subtle SVG Multi-Series Curves (1.5px stroke, zero neon glow) -->
      <svg class="w-full h-full overflow-visible" viewBox="0 0 500 180" preserveAspectRatio="none">
        <!-- Gridlines -->
        <g stroke="rgba(255,255,255,0.04)" stroke-width="1">
          <line x1="0" y1="20" x2="500" y2="20" />
          <line x1="0" y1="60" x2="500" y2="60" />
          <line x1="0" y1="100" x2="500" y2="100" />
          <line x1="0" y1="140" x2="500" y2="140" />
        </g>
        <!-- Positive Series -->
        <path d="M0,140 C80,140 140,20 210,20 C280,20 350,140 500,140" fill="none" stroke="#EAB308" stroke-width="1.5"/>
        <path d="M0,140 C85,140 145,45 215,45 C285,45 355,140 500,140" fill="none" stroke="#3B82F6" stroke-width="1.5"/>
        <path d="M0,140 C90,140 150,70 220,70 C290,70 360,140 500,140" fill="none" stroke="#EC4899" stroke-width="1.5"/>
        <!-- Negative/Outflow Comparison Series (Muted Zinc) -->
        <path d="M120,140 C190,140 240,175 310,175 C380,175 430,140 490,140" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.2"/>
      </svg>
    </div>
  </div>
</section>
```

---

### Protocol 9: Decorative Assets & Skeuomorphic Restraint
In `unslop.mp4` (00:06 → 00:07), the yellow cartoon credit card SVG (`💳`) in the "Paid this month" card is replaced by a dark, matte, monochrome dual-card render with subtle specular edge lighting (`.... 4421`).
- **Rule 9.1**: Never use flat yellow/blue emoji-style vector clipart (`💳`, `📊`, `🚀`) as card illustrations.
- **Rule 9.2**: Either let clean typography and whitespace carry the card alone, or construct a restrained, monochrome CSS/SVG micro-artifact that matches the surface palette (`#18181B` gradient, `1px` specular border `rgba(255,255,255,0.12)`, muted monospace digits `.... 4421`).

---

### Protocol 10: Landing Pages & Marketing Sites (Anti-Slop Rules)
When unslopping a marketing or SaaS landing page, eliminate these 6 signature AI tropes:
1. **The Glowing Pill Banner**: Replace `✨ Introducing SuperAI 2.0 — Read the announcement →` in a glowing purple border with either no badge or a flat, subtle `1px` neutral border badge with a `6px` dot.
2. **Gradient Text Headlines**: Ban `bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent`. Use solid high-contrast primary text (`#F4F4F5` or `#09090B`), or a subtle vertical luminance fade (`from-white to-zinc-400`).
3. **The 3-Column Icon-in-Box Feature Grid**: Replace symmetric 3-card grids where each card has a Lucide icon in a colored circle + 3-word title + 2-line generic blurb with asymmetric **bento grids**, interactive **product UI previews**, or **technical specification tables**.
4. **The 3-Card Pricing Table with Popped Middle Card**: Do not scale up the middle "Pro" card (`scale-105 border-purple-500 shadow-2xl`). Keep all pricing tiers on a flat shared baseline grid separated by `1px` borders, differentiating the recommended tier via a subtle surface shift (`bg-zinc-900` vs `bg-zinc-950`) and a high-contrast primary button (`bg-zinc-100 text-zinc-950`).
5. **Fake Social Proof**: Remove `"Trusted by 10,000+ innovative teams worldwide"` and 5-star yellow emoji testimonial grids.
6. **Button Discipline**: Limit every viewport to **one primary high-contrast CTA** (`bg-zinc-100 text-zinc-950 hover:bg-white` in dark mode; `bg-zinc-900 text-white` in light mode) and **one quiet secondary CTA** (`border border-white/10 text-zinc-300`). Ban `rounded-full` neon gradient buttons in B2B/SaaS interfaces; use `rounded-md` (`6px`) or `rounded-lg` (`8px`).

---

### Protocol 11: Tables, Forms, Modals & Empty States
Every functional view in an application must follow strict alignment and density rules:

#### Data Tables
- **Right-Align All Numbers**: Columns containing currency, percentages, counts, durations, or dates must be right-aligned (`text-right tabular-nums`), including their `<th>` header.
- **Kill Zebra Striping & Pill Overload**: Do not alternate row backgrounds with heavy contrast or wrap every status cell in a bright pill. Use `1px` horizontal row dividers (`border-b border-white/[0.05]`), `36px–40px` compact row heights, and `6px` status dots + plain text for status columns.

#### Forms & Settings
- **Consistent Control Geometry**: Inputs, selects, and buttons in the same row must share the exact same height (`36px` / `h-9`) and border radius (`6px` / `rounded-md`).
- **Focus Rings**: Replace default `3px` glowing blue/purple browser outlines with a crisp `1px` border darkening/brightening (`focus:border-zinc-400 focus:outline-none` or `focus-visible:ring-1 focus-visible:ring-zinc-400`).
- **Settings Layouts**: Use a two-column split layout (left column: `14px` section title + `13px` muted description; right column: form card) separated by `1px` horizontal dividers rather than stacking 10 full-width cards.

#### Empty, Loading & Error States
- **Empty States**: Never show a sad emoji (`😢`, `📭`) or exclamation mark (`No projects found!!`). Show a quiet `13px` muted label (`No active projects`) and a compact `h-8` secondary action button (`New project`).
- **Loading States**: Use subtle monochrome shimmer skeletons (`bg-white/[0.04]`) matching the exact geometry of the loaded rows—never a giant centered purple spinning ring.

---

### Protocol 12: Micro-Interactions & Motion Restraint
- **Ban Card Scaling**: Never apply `hover:scale-105` or `hover:-translate-y-2` to dashboard cards, table rows, or pricing tiers.
- **Crisp Timing**: Interactive state transitions (`background-color`, `border-color`, `color`, `opacity`) must run at **`120ms–150ms cubic-bezier(0.16, 1, 0.3, 1)`** (or `ease-out`). Avoid `transition-all duration-300` or `duration-500`, which makes interfaces feel sluggish and floaty.

---

## 4. Complete Verification Checklist (Run Before Completing Task)

Before declaring any UI "unslopped", verify every item below:

- [ ] **Grid Check**: Are all spacings, paddings, and heights multiples of `4px` or `8px`? Are there zero arbitrary values like `22px`, `25px`, `30px`, or `42px`?
- [ ] **Keyline Check**: Do the sidebar logo, search box, section labels, and nav items share an exact left vertical alignment rail? Do main content breadcrumbs, headings, and cards share an exact left vertical rail?
- [ ] **Color & Surface Check**: Are all unsolicited purple/indigo/violet gradients, neon glows, and blue-tinted dark backgrounds replaced with true carbon/obsidian (`#09090B` / `#111113`) or clean alabaster (`#FAFAFA` / `#FFFFFF`) and `1px` hairline borders?
- [ ] **Typography & Case Check**: Are `ALL CAPS` section/metric labels converted to `Sentence case`? Do all numbers, prices, deltas, and counts have `tabular-nums` applied?
- [ ] **Emoji & Copy Check**: Have 100% of decorative emojis (`🔥`, `✅`, `🏠`, `👑`, `👋`, `🚀`, `✨`) and exclamation marks (`!`, `!!`) been removed? Are fake `AI`/`PRO` badges and cheesy greetings replaced with sober, contextual copy?
- [ ] **Badge & Icon Check**: Are sidebar/table counters plain muted tabular numbers instead of colored pills? Are categorical lists using `6px` semantic dots or uniform `16px` monochrome stroke icons?
- [ ] **Chart & Asset Check**: Do all charts include an explicit Y-axis scale, subtle gridlines, and thin `1.5px` strokes instead of thick rounded purple bars? Are cartoon clipart SVGs removed or replaced with high-craft monochrome renders?

