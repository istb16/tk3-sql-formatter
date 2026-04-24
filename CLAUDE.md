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

This is a single-page application with **all logic in one file**: `src/App.svelte` (~590 lines). There are no routes, no stores, and no child components — the entire app is one Svelte 5 component.

### State management

All reactive state uses Svelte 5 runes at the top of `<script>`:
- `$state` — all UI settings (dialect, casing, indent, etc.) and SQL strings
- `$derived` — `t` (current translation object), `statsIn`/`statsOut`, `caseOptions`
- `$effect` — two side effects: auto-format trigger (watches all options + `inputSql`) and localStorage persistence (writes every setting on any change)

Settings persist to `localStorage` under the key `sql-formatter-settings`. Input/output SQL is intentionally not persisted.

### Formatting pipeline

`doFormat()` calls `sql-formatter`'s `format()`, then optionally applies a two-step post-processing pipeline when **Compact mode** (`compactLists`) is enabled:

1. `collapseParenBlocks(sql)` — Collapses multi-line `(...)` blocks that contain no nested parens and no subqueries. Runs in a loop until stable. This fixes `EXTRACT(YEAR FROM date)` being expanded by sql-formatter (which treats `FROM` as a keyword).
2. `joinCompactLists(sql)` — Pulls keyword lines (SELECT, FROM, WHERE, etc.) and their indented children onto one line when the children form a comma list, AND/OR chain, or are a single item. Guards against collapsing subquery bodies.

When `compactLists` is on, `expressionWidth` is set to `9999` on the sql-formatter call to suppress its own wrapping before the custom pipeline runs.

### i18n

Translations live in the `TRANSLATIONS` constant at the top of `App.svelte`. The derived value `t = $derived(TRANSLATIONS[lang])` gives the active translation object. All UI strings go through `t`. Adding a new UI string requires entries in both `ja` and `en` objects.

### Dialects

Five dialects are supported: `mysql`, `postgresql`, `snowflake`, `plsql` (Oracle), `transactsql` (SQL Server). The Oracle sample SQL uses named bind variables (`:EMPLOYEE_ID`, `:STATUS`, `:COUNTRY_ID`) — this is intentional and valid PL/SQL syntax.

## Key files

| File | Purpose |
|------|---------|
| `src/App.svelte` | Entire application — state, logic, and template |
| `src/app.css` | Tailwind import + base resets |
| `src/main.js` | Svelte mount entry point |
| `public/favicon.svg` | App icon (also used in the header) |
| `public/icons.svg` | SVG sprite (currently unused) |

`src/lib/Counter.svelte` is a leftover scaffold file — not imported anywhere.
