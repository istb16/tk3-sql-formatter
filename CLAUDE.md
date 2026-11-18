# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Serve the dist/ build locally
npm test          # Run Vitest once (jsdom environment)
npm run test:watch  # Run Vitest in watch mode
```

Tests live next to their modules as `src/lib/*.test.js`. CI (`.github/workflows/deploy.yaml`) runs `npm test` before building and deploying to Firebase Hosting. Pull requests run the same test and build in `.github/workflows/ci.yml` (no deploy). There is no lint script.

Requires Node `^22.22.2 || ^24.15.0 || >=26` (see `engines` in `package.json`). `overrides` forces `@tailwindcss/node` onto the same `lightningcss` as Vite to avoid a duplicate native binary; remove it once Tailwind's pinned version catches up.

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm packages and GitHub Actions.

## Architecture

Single-page application built with Svelte 5 + TailwindCSS v4. Logic is split across `src/App.svelte` (state, actions, template) and supporting modules in `src/lib/`.

### State management

All reactive state uses Svelte 5 runes in `App.svelte`:
- `$state` — all UI settings (dialect, casing, indent, etc.) and SQL strings
- `$derived` — `t` (translation object), `statsIn`/`statsOut`, `caseOptions`, `caseRows`
- `$effect` — two side effects: auto-format trigger (watches all options + `inputSql`) and localStorage persistence via `saveSettings()`

Settings persist to `localStorage` under the key `sql-formatter-settings`. Input/output SQL is intentionally not persisted.

### Formatting pipeline

`doFormat()` in `App.svelte` delegates to `formatSql()` in `src/lib/formatter.js`, which calls `sql-formatter`'s `format()` then optionally applies a two-step post-processing pipeline when **Compact mode** (`compactLists`) is enabled:

1. `collapseParenBlocks(sql)` — Collapses multi-line `(...)` blocks that contain no nested parens and no subqueries. Runs in a loop until stable. This fixes `EXTRACT(YEAR FROM date)` being expanded by sql-formatter (which treats `FROM` as a keyword).
2. `joinCompactLists(sql)` — Pulls keyword lines (SELECT, FROM, WHERE, etc.) and their indented children onto one line when the children form a comma list, AND/OR chain, or are a single item. Guards against collapsing subquery bodies.

When `compactLists` is on, `expressionWidth` is set to `9999` on the sql-formatter call to suppress its own wrapping before the custom pipeline runs.

### i18n

Translations live in `src/lib/i18n.js` as the `TRANSLATIONS` constant. The derived value `t = $derived(TRANSLATIONS[lang])` gives the active translation object. All UI strings go through `t`. Adding a new UI string requires entries in both `ja` and `en` objects.

### Colors and dark mode

The UI follows the OS color scheme (`prefers-color-scheme`); there is no toggle. All colors come from the `--tk-*` tokens in `src/tk-base.css`, exposed to Tailwind in `src/app.css` as `bg`, `surface`, `surface-2`, `ink`, `body`, `muted`, `line`, `line-strong`, `accent`, `on-accent`, `danger`, `success` (e.g. `bg-surface`, `text-muted`, `border-line`). Borders that outline a form control (selects, the toggle track) use `line-strong` (3:1 against the surface); `line` is for separators and panel edges. Use these instead of raw Tailwind palette colors (`slate-*`, `blue-*`) or hex values so both schemes keep working. The header and footer use `.tk-header` / `.tk-footer`, and the main buttons `.tk-btn` / `.tk-btn--quiet`.

### Dialects

Five dialects are supported: `mysql`, `postgresql`, `snowflake`, `plsql` (Oracle), `transactsql` (SQL Server). Defined in `src/lib/constants.js` alongside `SAMPLE_SQL`. The Oracle sample SQL uses named bind variables (`:EMPLOYEE_ID`, `:STATUS`, `:COUNTRY_ID`) — this is intentional and valid PL/SQL syntax.

## Key files

| File | Purpose |
|------|---------|
| `src/App.svelte` | Root component — state, actions, and template (~360 lines) |
| `src/lib/i18n.js` | `TRANSLATIONS` constant (ja/en) |
| `src/lib/constants.js` | `DIALECTS` list and `SAMPLE_SQL` per dialect |
| `src/lib/settings.js` | `loadSettings()` / `saveSettings()` for localStorage |
| `src/lib/formatter.js` | `formatSql()` + compact-list post-processing pipeline |
| `src/lib/ToggleSwitch.svelte` | Reusable toggle switch component used in the header |
| `src/tk-base.css` | Shared tk3 apps design base (color tokens for light/dark, header, footer, buttons). Unmodified copy of the canonical file in tk3-biz-html — never edit it here |
| `src/app.css` | Tailwind import, Tailwind colors mapped to the `--tk-*` tokens, accent (`--tk-blue`), base resets |
| `src/main.js` | Svelte mount entry point (imports `tk-base.css` before `app.css`) |
| `public/icon.svg`, `public/icon-32.png`, `public/apple-touch-icon.png` | App icon (the SVG is also used in the header) |
