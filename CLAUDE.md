# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server (localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Serve the dist/ build locally
```

There are no tests or lint scripts.

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

### Dialects

Five dialects are supported: `mysql`, `postgresql`, `snowflake`, `plsql` (Oracle), `transactsql` (SQL Server). Defined in `src/lib/constants.js` alongside `SAMPLE_SQL`. The Oracle sample SQL uses named bind variables (`:EMPLOYEE_ID`, `:STATUS`, `:COUNTRY_ID`) — this is intentional and valid PL/SQL syntax.

## Key files

| File | Purpose |
|------|---------|
| `src/App.svelte` | Root component — state, actions, and template (~270 lines) |
| `src/lib/i18n.js` | `TRANSLATIONS` constant (ja/en) |
| `src/lib/constants.js` | `DIALECTS` list and `SAMPLE_SQL` per dialect |
| `src/lib/settings.js` | `loadSettings()` / `saveSettings()` for localStorage |
| `src/lib/formatter.js` | `formatSql()` + compact-list post-processing pipeline |
| `src/lib/ToggleSwitch.svelte` | Reusable toggle switch component used in the header |
| `src/app.css` | Tailwind import + base resets |
| `src/main.js` | Svelte mount entry point |
| `public/favicon.svg` | App icon (also used in the header) |
| `public/icons.svg` | SVG sprite (currently unused) |

`src/lib/Counter.svelte` is a leftover scaffold file — not imported anywhere.
