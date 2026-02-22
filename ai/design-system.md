# A11y Garden — Design System Reference

> **Purpose:** Feed this file to an AI agent when building a sister site that should
> share the same "garden" aesthetic. It captures every visual convention — colors,
> typography, icons, component patterns, animations, and accessibility practices —
> so a new project can match A11y Garden out of the box.

---

## 1. Design Philosophy

- **Theme:** Calm, organic, garden-inspired. The UI metaphor treats pages as
  "garden beds," scans as "planting seeds," and results as things that "grow" or
  need "tending."
- **Tone words:** Warm, earthy, encouraging, nurturing. Never harsh or clinical.
- **Aesthetic:** Muted natural palette with emerald green accents. Soft rounded
  corners (12–20 px). Generous whitespace. Subtle texture via leaf-shaped
  radial-gradient patterns. Light/dark mode with full WCAG AA contrast compliance.

---

## 2. Color Tokens (CSS Custom Properties)

All colors are defined as CSS custom properties on `:root` (light) and `.dark`
(dark). Every foreground/background combination passes **WCAG AA** (4.5:1 for
normal text).

### 2.1 Core Palette

| Token                  | Light                          | Dark                           | Usage                            |
| ---------------------- | ------------------------------ | ------------------------------ | -------------------------------- |
| `--bg-primary`         | `#f7f6f3`                      | `#171717`                      | Page background                  |
| `--bg-secondary`       | `#efede8`                      | `#1e1e1e`                      | Cards, nav, secondary surfaces   |
| `--bg-tertiary`        | `#e5e2db`                      | `#2a2a2a`                      | Hover states, code blocks        |
| `--bg-nav`             | `rgba(247, 246, 243, 0.88)`    | `rgba(23, 23, 23, 0.88)`      | Navbar (translucent + blur)      |
| `--text-primary`       | `#1a1a1a`                      | `#f0ede6`                      | Headings, body text              |
| `--text-secondary`     | `#4b5441`                      | `#a8b89e`                      | Descriptions, secondary copy     |
| `--text-muted`         | `#516247`                      | `#909f86`                      | Timestamps, hints, captions      |
| `--border-color`       | `#d4d1c7`                      | `#2f2f2f`                      | Card borders, dividers           |

### 2.2 Accent (Emerald Green)

| Token                  | Light                          | Dark                           |
| ---------------------- | ------------------------------ | ------------------------------ |
| `--accent`             | `#036B4A`                      | `#34d399`                      |
| `--accent-hover`       | `#065f46`                      | `#6ee7b7`                      |
| `--accent-bg`          | `rgba(4, 120, 87, 0.08)`      | `rgba(52, 211, 153, 0.10)`    |
| `--accent-border`      | `rgba(4, 120, 87, 0.25)`      | `rgba(52, 211, 153, 0.20)`    |
| `--accent-glow`        | `rgba(4, 120, 87, 0.10)`      | `rgba(52, 211, 153, 0.12)`    |

### 2.3 Button Surfaces

| Token                  | Light          | Dark           |
| ---------------------- | -------------- | -------------- |
| `--btn-primary-bg`     | `#036B4A`      | `#059669`      |
| `--btn-primary-hover`  | `#065f46`      | `#047857`      |
| `--btn-primary-text`   | `#ffffff`      | `#ffffff`      |

### 2.4 Severity Colors

Used for violation counts, banners, and status indicators.

| Token (base)             | Light      | Dark       | Meaning   |
| ------------------------ | ---------- | ---------- | --------- |
| `--severity-critical`    | `#dc2626`  | `#ef4444`  | Critical  |
| `--severity-serious`     | `#c2410c`  | `#f97316`  | Serious   |
| `--severity-moderate`    | `#8a5300`  | `#eab308`  | Moderate  |
| `--severity-minor`       | `#1d4ed8`  | `#3b82f6`  | Minor     |

Each severity also has `-bg` (8–12 % opacity tint) and `-border` (25 % opacity
tint) variants for card backgrounds, e.g. `--severity-critical-bg`,
`--severity-critical-border`.

### 2.5 Grade Colors

| Token        | Light      | Dark       |
| ------------ | ---------- | ---------- |
| `--grade-a`  | `#036B4A`  | `#34d399`  |
| `--grade-b`  | `#1d4ed8`  | `#60a5fa`  |
| `--grade-c`  | `#8a5300`  | `#fbbf24`  |
| `--grade-d`  | `#c2410c`  | `#fb923c`  |
| `--grade-f`  | `#dc2626`  | `#f87171`  |

### 2.6 Surfaces & Effects

| Token                    | Light      | Dark       | Usage                        |
| ------------------------ | ---------- | ---------- | ---------------------------- |
| `--scrollbar-track`      | `#e5e2db`  | `#1e1e1e`  | Scrollbar track              |
| `--scrollbar-thumb`      | `#b5b0a6`  | `#3a3a3a`  | Scrollbar thumb              |
| `--scrollbar-thumb-hover`| `#8a847a`  | `#4a4a4a`  | Scrollbar thumb hover        |
| `--skeleton-base`        | `#e5e2db`  | `#1e1e1e`  | Skeleton loading base        |
| `--skeleton-shine`       | `#efede8`  | `#2a2a2a`  | Skeleton shimmer highlight   |
| `--pattern-color`        | `rgba(4,120,87,0.06)` | `rgba(52,211,153,0.04)` | Leaf pattern fill |
| `--leaf-pattern-opacity` | `0.04`     | `0.03`     | Background leaf overlay      |

### 2.7 Page Gradients

| Token               | Light      | Dark       |
| -------------------- | ---------- | ---------- |
| `--gradient-page-1`  | `#f7f6f3`  | `#171717`  |
| `--gradient-page-2`  | `#efede8`  | `#1e1e1e`  |
| `--gradient-page-3`  | `#f7f6f3`  | `#171717`  |
| `--gradient-page-4`  | `#e6f0e8`  | `#172320`  |

Applied as a slow-moving 4-stop `linear-gradient(-45deg, …)` with `background-size: 400% 400%` and a 20 s infinite animation.

---

## 3. Typography

### 3.1 Font Stack

| Role      | Font                | Variable          | Fallback              |
| --------- | ------------------- | ----------------- | --------------------- |
| Display   | **Fraunces**        | `--font-display`  | serif                 |
| Body      | **DM Sans**         | `--font-body`     | system-ui, sans-serif |
| Monospace | **JetBrains Mono**  | `--font-mono`     | monospace             |

All three are loaded from **Google Fonts** via `next/font/google` with
`display: "swap"`.

### 3.2 Usage Rules

- `h1–h6` and `.font-display` → Fraunces (serif)
- `body`, all other text → DM Sans (sans-serif)
- `code`, `pre`, `.font-mono` → JetBrains Mono
- Headings are typically `font-semibold` or `font-bold`
- Body text uses the default weight; secondary text uses `font-medium`
- `-webkit-font-smoothing: antialiased` is applied globally

### 3.3 Common Type Sizes (Tailwind)

| Context                  | Classes                                          |
| ------------------------ | ------------------------------------------------ |
| Hero heading             | `text-5xl lg:text-7xl font-display font-semibold`|
| Page heading             | `text-3xl lg:text-4xl font-display font-bold`    |
| Section heading          | `text-xl font-display font-bold`                 |
| Card title               | `font-display font-semibold`                     |
| Body text                | default (`text-base`) or `text-lg`               |
| Labels / small caps      | `text-sm font-semibold`                          |
| Captions, metadata       | `text-xs text-theme-muted`                       |
| Monospace code            | `text-xs font-mono`                             |

---

## 4. Spacing & Layout

- **Container:** `container mx-auto px-4`
- **Page padding:** `py-12` to `py-20` for main sections
- **Card padding:** `p-4 sm:p-5` (compact) to `p-6 lg:p-8` (feature cards)
- **Section gaps:** `space-y-8` between major sections
- **Card grids:** `grid md:grid-cols-2 lg:grid-cols-3 gap-4`
- **Max widths:** `max-w-2xl` (forms), `max-w-4xl` (content), `max-w-5xl`/`max-w-6xl` (grid layouts)
- **Navbar height:** `h-16` (64 px), content starts at `pt-16`

---

## 5. Border Radii

| Element               | Radius       |
| --------------------- | ------------ |
| Cards (`.garden-bed`) | `16px` (rounded-2xl) |
| Buttons               | `12px` (rounded-xl)  |
| Inputs                | `12px` (rounded-xl)  |
| Badges / pills        | `9999px` (rounded-full) |
| Small tags            | `8px` (rounded-lg)   |
| Modal dialog          | `20px`               |
| Focus ring            | `2px`                |

---

## 6. Theme Switching

- **Mechanism:** CSS class on `<html>` — either `light` or `dark`
- **Storage:** `localStorage.getItem("theme")` / `.setItem("theme", …)`
- **Default:** Respects `prefers-color-scheme` on first visit; falls back to `dark`
- **Flash prevention:** Inline `<script>` in `<head>` reads localStorage before paint
- **React:** `ThemeProvider` context using `useSyncExternalStore` → provides
  `{ theme, toggleTheme }` via `useTheme()` hook
- **Transition:** `transition: background-color 0.3s ease, color 0.3s ease` on body

---

## 7. Component Patterns

### 7.1 Garden Bed Card (`.garden-bed`)

The primary card surface throughout the app:

```css
.garden-bed {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
.garden-bed:hover,
.garden-bed:focus-within {
  border-color: var(--accent-border);
  box-shadow: 0 0 0 1px var(--accent-border);
}
```

### 7.2 Buttons

**Primary** (`.btn-primary`):
- `background-color: var(--btn-primary-bg)` → white text
- `border-radius: 12px`, `padding: 0.75rem 1.5rem`, `font-weight: 600`
- Hover: darker green; Active: `scale(0.98)`; Disabled: `opacity: 0.6`
- Always uses `inline-flex items-center justify-center gap-2` with an optional
  leading icon

**Secondary** (`.btn-secondary`):
- `background-color: var(--bg-secondary)` → `color: var(--text-secondary)`
- `border: 1px solid var(--border-color)`, same radius
- Hover: `bg-tertiary`, text primary, accent border

### 7.3 Navbar

- Fixed top, `z-50`, full-width
- `bg-theme-nav backdrop-blur-xl` for translucent glass effect
- `border-b border-theme`
- Contains: Logo (leaf SVG + "A11y Garden"), nav links, theme toggle, auth controls
- Active link: `bg-[var(--accent-bg)] text-accent font-semibold`
- Inactive link: `text-theme-secondary hover:text-theme-primary hover:bg-theme-tertiary`

### 7.4 Footer

- `border-t border-theme`, `py-10`
- Row: leaf icon + brand name (left), navigation links (right)
- `<hr class="garden-divider">` — gradient fade-from-transparent divider
- Centered disclaimer text in `text-xs text-theme-muted`

### 7.5 Form Inputs

- `bg-theme-primary border-2 border-[var(--accent-border)] rounded-xl`
- `px-5 py-4` generous padding
- Focus: `ring-2 ring-[var(--accent)] border-[var(--accent)]`
- Placeholder: `text-theme-muted`
- Disabled: `opacity-50`

### 7.6 Accordion / Collapsible Sections

- Trigger: full-width button inside a `.garden-bed`
- `bg-theme-secondary hover:bg-theme-tertiary rounded-t-2xl`
- Chevron SVG rotates 180° on open: `transition-transform duration-200`
- Panel: `bg-theme-primary border-t border-theme p-6`

### 7.7 Banners / Alerts

- Rounded-xl container with severity/accent tint backgrounds
- `flex items-start gap-3`, icon on left (in a small rounded-lg box), text on right
- Uses matching `--severity-*-bg` / `--severity-*-border` or `--accent-bg` / `--accent-border`

### 7.8 Modal Dialog (native `<dialog>`)

```css
.safe-mode-dialog {
  border: none;
  border-radius: 20px;
  max-width: 680px;
  background-color: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25);
}
.safe-mode-dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}
```
- Entrance animation: fade + slight translateY + scale
- Close on Escape, backdrop click, and close button

### 7.9 Skeleton Loading

```css
.skeleton {
  background: linear-gradient(90deg,
    var(--skeleton-base) 25%,
    var(--skeleton-shine) 50%,
    var(--skeleton-base) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### 7.10 Grade Badge

- `inline-flex` container with accent tint bg + border
- Large letter grade in `font-display font-bold text-accent`
- Text indicators (not color-only): `✓` (A), `↗` (B), `~` (C), `↘` (D), `!` (F)
- Garden-themed labels: "Thriving", "Growing well", "Needs tending", "Needs care", "Needs attention"
- Three sizes: `sm`, `md`, `lg`

### 7.11 Violation Severity Cards

- `grid grid-cols-2 lg:grid-cols-4 gap-4`
- Each card: severity tint bg + border, rounded-xl, `p-5`
- Large count number in `font-display font-bold` + severity color
- Text indicators (not color-only): `!` (critical), `!!` (serious), `~` (moderate), `·` (minor)
- Hover: `scale-[1.02]`

### 7.12 Status Indicator

- Rounded-xl container with accent tint
- Icon + label + description
- Garden-themed copy: "Getting ready to plant…", "Examining your site…",
  "AI is cultivating insights…", "Your report is ready to harvest!"

---

## 8. SVG Icon Library

All icons are **inline SVGs** (no icon library dependency). They use
`stroke="currentColor"` with `fill="none"` (outline style), `viewBox="0 0 24 24"`,
`strokeWidth={2}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, and
`aria-hidden="true"`.

### 8.1 Brand Icons

**Leaf Logo (Navbar)** — Stylized leaf with veins:
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <!-- Leaf body -->
  <path d="M12 2C6.5 6 4 11 4 15c0 3.5 3.5 6 8 7 4.5-1 8-3.5 8-7 0-4-2.5-9-8-13z" />
  <!-- Central vein -->
  <path d="M12 2v20" />
  <!-- Side veins -->
  <path d="M12 8l-3 3" />
  <path d="M12 8l3 3" />
  <path d="M12 13l-4 3" />
  <path d="M12 13l4 3" />
</svg>
```

**Seedling Icon (Footer, empty states, hero badge)** — Simple sprouting seedling:
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 22V12" />
  <path d="M12 12C12 8 8 6 4 6c0 4 2 8 8 6" />
  <path d="M12 12c0-4 4-6 8-6-0 4-2 8-8 6" />
</svg>
```

**Wilted Seedling (Error Boundary)** — 64×64 decorative illustration:
```html
<svg width="64" height="64" viewBox="0 0 64 64" fill="none"
     xmlns="http://www.w3.org/2000/svg" style="color: var(--accent)">
  <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="2" opacity="0.15" />
  <path d="M32 48V28" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
  <path d="M32 28c-4-8-14-8-14-2s8 10 14 2z" fill="currentColor" opacity="0.25" />
  <path d="M32 32c4-6 12-5 12-1s-6 7-12 1z" fill="currentColor" opacity="0.2" />
  <line x1="24" y1="52" x2="40" y2="52" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" opacity="0.3" />
</svg>
```

### 8.2 UI Icons (all 24×24, stroke-based)

| Name             | `d` path(s)                                                                                                                                              | Usage                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **Search**       | `M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z`                                                                                                          | Scan button, search inputs     |
| **Globe**        | `M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9` | URL input decorator            |
| **Chevron Right**| `M9 5l7 7-7 7`                                                                                                                                           | "View All" links, nav arrows   |
| **Chevron Left** | `M15 19l-7-7 7-7`                                                                                                                                        | "Back" links                   |
| **Chevron Down** | `M19 9l-7 7-7-7`                                                                                                                                         | Accordion triggers             |
| **External Link**| `M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14`                                                                         | External URLs                  |
| **Link / Chain** | `M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1`                    | Copy link, "Plant a URL"       |
| **Check**        | `M5 13l4 4L19 7`                                                                                                                                         | Checkmarks, "copied" state     |
| **X / Close**    | `M6 18L18 6M6 6l12 12`                                                                                                                                   | Close buttons, clear input     |
| **Plus**         | `M12 4v16m8-8H4`                                                                                                                                         | "New Scan" button              |
| **Clock**        | `M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z`                                                                                                           | Queued/pending status          |
| **Light Bulb**   | `M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z` | AI summary, "Harvest Insights" |
| **Lightning**    | `M13 10V3L4 14h7v7l9-11h-7z`                                                                                                                             | "Powered by" badges            |
| **Shield Check** | `M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z` | Safe mode badge                |
| **Document**     | `M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z`                                 | Copy report button             |
| **Clipboard**    | `M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4`       | Detailed violations header     |
| **Camera**       | `M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z` + `M15 13a3 3 0 11-6 0 3 3 0 016 0z` | Screenshot section             |
| **Info Circle**  | `M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z`                                                                                             | Info banners, tooltips         |
| **Warning**      | `M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z`                  | Error states, warnings         |
| **Check Circle** | `M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z`                                                                                                         | Complete status, empty states   |
| **X Circle**     | (filled) `M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z` | Error messages                 |
| **Eye Off**      | `M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21` | Private scan badge             |
| **Code**         | `M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4`                                                                                                                 | Platform/tech badge            |
| **Database**     | `M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4`                                          | "Browse Public Audits" CTA     |
| **User**         | `M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z`                                                                                   | "Create Free Account"          |
| **Warning Triangle** (filled) | `M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z` | Rate-limit warnings |

### 8.3 Theme Toggle Icons

**Sun** (shown in dark mode → click for light):
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
  <circle cx="12" cy="12" r="4" stroke-width="2" />
  <path stroke-linecap="round" stroke-width="2"
    d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
</svg>
```

**Moon** (shown in light mode → click for dark):
```html
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
</svg>
```

Toggle animation: `rotate-0 scale-100` ↔ `rotate-90 scale-0` with `transition-all duration-300`.

### 8.4 Spinner

```html
<svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24" aria-hidden="true">
  <circle class="opacity-25" cx="12" cy="12" r="10"
          stroke="currentColor" stroke-width="4" />
  <path class="opacity-75" fill="currentColor"
    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
</svg>
```

---

## 9. Animations & Transitions

| Name                        | Type      | Details                                              |
| --------------------------- | --------- | ---------------------------------------------------- |
| `animated-gradient`         | Keyframe  | 4-stop gradient shifting over 20 s (hero background) |
| `shimmer`                   | Keyframe  | Skeleton loading sweep, 1.5 s infinite               |
| `fadeInUp`                  | Keyframe  | `opacity: 0 → 1`, `translateY(12px → 0)`, 0.5 s     |
| `dialogFadeIn`              | Keyframe  | `opacity + translateY(8px) + scale(0.97)`, 0.2 s     |
| `backdropFadeIn`            | Keyframe  | `opacity: 0 → 1`, 0.2 s                             |
| `animate-fade-in-up-delay-*`| Utility   | Staggered delays: 0.1 s, 0.2 s, 0.3 s               |
| General transitions         | Property  | `0.2s ease` for borders, colors; `0.3s ease` for bg  |

---

## 10. Background Textures

### Leaf Pattern (`.pattern-leaves`)

Subtle organic texture using layered elliptical radial gradients:

```css
.pattern-leaves {
  background-image:
    radial-gradient(ellipse 8px 12px at 12px 12px, var(--pattern-color) 0%, transparent 70%),
    radial-gradient(ellipse 6px 10px at 36px 28px, var(--pattern-color) 0%, transparent 70%),
    radial-gradient(ellipse 7px 11px at 24px 44px, var(--pattern-color) 0%, transparent 70%);
  background-size: 48px 56px;
}
```

Used as a full-bleed overlay on hero sections and CTA areas, typically at
`opacity-20` to `opacity-40`.

### Dot Pattern (`.pattern-dots`) — Fallback

```css
.pattern-dots {
  background-image: radial-gradient(circle, var(--pattern-color) 1px, transparent 1px);
  background-size: 20px 20px;
}
```

---

## 11. Accessibility Practices

These are built into the design system and should be maintained on sister sites:

| Practice                        | Implementation                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| **Skip link**                   | `.skip-link` hidden off-screen, visible on focus, jumps to `#main-content` |
| **Focus visible**               | `outline: 2px solid var(--accent); outline-offset: 2px`               |
| **Screen reader text**          | `.sr-only` utility class for visually-hidden labels                   |
| **ARIA labels**                 | All icon-only buttons have `aria-label`; decorative icons have `aria-hidden="true"` |
| **Live regions**                | `aria-live="assertive"` for scan progress; `aria-live="polite"` for status changes |
| **Color independence**          | Severity uses text indicators (`!`, `!!`, `~`, `·`) alongside color   |
| **Grade independence**          | Grades use symbolic indicators (`✓`, `↗`, `~`, `↘`, `!`) alongside color |
| **Focus management**            | Modal traps focus; dialog uses `showModal()` for native focus trapping |
| **Semantic HTML**               | `<nav>`, `<main>`, `<footer>`, `<section>`, `<dialog>`, `role="status"`, `role="list"` |
| **Reduced motion**              | Animations are subtle and short (< 0.5 s); skeleton shimmer is non-disruptive |

---

## 12. Tech Stack (for Reference)

| Layer       | Technology                                          |
| ----------- | --------------------------------------------------- |
| Framework   | **Next.js 16** (App Router, React 19)               |
| Styling     | **Tailwind CSS 4** + CSS custom properties          |
| Fonts       | Google Fonts via `next/font/google`                 |
| Icons       | Inline SVG (no external icon library)               |
| Auth        | Clerk (`@clerk/nextjs`)                             |
| Database    | Convex (real-time backend)                          |
| Deployment  | Vercel                                              |

---

## 13. Garden Vocabulary / Copy Guide

The garden metaphor runs through all user-facing text. Here's the lexicon:

| Concept             | Garden Term                                  |
| ------------------- | -------------------------------------------- |
| Submitting a URL    | "Planting a seed"                            |
| Running a scan      | "Watch it grow"                              |
| Viewing results     | "Harvest insights"                           |
| Public database     | "Community Garden"                           |
| User's audits       | "Your Garden"                                |
| Recent scans        | "The latest from the community garden"       |
| Violations sections | "Issue Beds"                                 |
| Priority fixes      | "Areas to Tend First"                        |
| Dashboard greeting  | "Welcome back, Gardener!"                    |
| Empty states        | "Your garden is empty", "No seeds planted yet" |
| Grade A             | "Thriving"                                   |
| Grade B             | "Growing well"                               |
| Grade C             | "Needs tending"                              |
| Grade D             | "Needs care"                                 |
| Grade F             | "Needs attention"                            |
| Pending status      | "Getting ready to plant the seeds…"          |
| Scanning status     | "Examining your site…"                       |
| Analyzing status    | "AI is cultivating insights…"                |
| Complete status     | "Your report is ready to harvest!"           |
| Card surface        | "Garden bed"                                 |
| Divider             | "Garden divider"                             |
| Statistics section  | "Garden Statistics"                          |
| In-progress audits  | "Currently Growing"                          |
| CTA heading         | "Explore the Community Garden"               |
| Tagline             | "Nurture a More Accessible Web"              |
| Footer tagline      | "Tended with care."                          |

---

## 14. OG Image Branding

The dynamic Open Graph image uses these hardcoded colors (matching dark theme):

- Background gradient: `#171717 → #1a2420 → #171717`
- Accent bar: `#059669 → #34d399 → #059669`
- Title: `#f0ede6` (matches `--text-primary` dark)
- Subtitle: `#a8b89e` (matches `--text-secondary` dark)
- Muted: `#909f86` (matches `--text-muted` dark)
- Brand emoji: 🌱 in a small rounded box

---

## 15. Quick Start Checklist for Sister Sites

1. **Copy `globals.css`** — All CSS custom properties, utility classes, and component styles
2. **Install fonts** — Fraunces, DM Sans, JetBrains Mono from Google Fonts
3. **Use Tailwind CSS 4** with `@tailwindcss/postcss`
4. **Set up ThemeProvider** — `useSyncExternalStore` pattern with `localStorage`
5. **Inline SVG icons** — Copy from the icon library above (no npm icon packages)
6. **Follow the border-radius scale** — 12 px buttons/inputs, 16 px cards, 20 px modals
7. **Maintain WCAG AA** — Use the provided severity/grade color pairs per theme
8. **Keep the garden vocabulary** — Adapt the copy guide to your domain
9. **Include accessibility scaffolding** — Skip link, focus ring, `.sr-only`, ARIA labels
10. **Respect dark-mode-first** — Default to dark, honor `prefers-color-scheme`
