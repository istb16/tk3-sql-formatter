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

`doFormat()` in `App.svelte` delegates to `formatSql()` in `src/lib/formatter.js`, which calls `sql-formatter`'s `format()` and then post-processes the result.

sql-formatter encodes the block structure of a statement in its indentation, so `parseTree()` parses the output back into a tree of lines: a node owns the lines indented deeper than itself, plus the closing line that follows them at its own indent (`)` or `END`). `render()` then walks the tree and decides per node whether to join it onto one line or leave it expanded. Because a node is only ever joined as a whole, a block's opening line, body and closing line always move together, and an inner block is considered even when the block around it stays expanded.

A node is joined when:

- **Compact mode** (`compactLists`) is on and the joined line, indent included, fits within `expressionWidth`. Long lines that sql-formatter itself could not split are left alone.
- Or the node is a function call that sql-formatter broke on a keyword that only looks like a clause (`EXTRACT(YEAR FROM d)`, `SUBSTRING(s FROM 1 FOR 2)`, `CAST(x AS INT)`, `POSITION(a IN b)`), and the argument list itself fits within `expressionWidth`. These are rejoined in both modes. Only the argument list is measured, not the indent or the rest of the line, so a short call is kept together however deeply it sits — the resulting line may then be wider than `expressionWidth` — while a genuinely long one keeps the wrapping sql-formatter chose for it.

Widths are counted in display columns: a tab in the indent counts as `tabWidth` columns, and a full-width (East Asian Wide) character such as a kanji counts as two.

A node is never joined when its lines contain a line comment, a line that belongs to a multi-line string literal or block comment, or a CTE opener (`name AS (`) — CTE bodies stay expanded whatever the width. `lexLines()` lexes the whole sql-formatter output in one pass, carrying the in-string / in-comment state across lines, so the middle lines of a long literal (which contain no quote of their own) are recognised too. It knows `'`, `"`, `` ` ``, BigQuery's triple quotes (`'''…'''`, `"""…"""`), dollar-quoted strings (`$$…$$` in `postgresql`/`snowflake`/`clickhouse`/`duckdb`, `$tag$…$tag$` in `postgresql`), backslash escapes where the dialect has them (MySQL family, `bigquery`, `hive`, `spark`, `sql`, Snowflake `'…'`, `E'…'` in `postgresql`/`duckdb`) and nested block comments (`postgresql`, `transactsql`, `db2i`, `duckdb`). The dialects needing none of this are left out of `SYNTAX` and take `DEFAULT_SYNTAX`.

The line-comment prefixes are per dialect, following sql-formatter's `lineCommentTypes` (the `SYNTAX` table in `formatter.js`): `--` everywhere, `#` in `mysql`, `mariadb`, `tidb`, `singlestoredb`, `bigquery`, `clickhouse`, `n1ql`, and `//` in `snowflake`. `#` must not be treated as a comment elsewhere because PostgreSQL uses `#>` and `#>>` as JSON operators.

### i18n

Translations live in `src/lib/i18n.js` as the `TRANSLATIONS` constant. The derived value `t = $derived(TRANSLATIONS[lang])` gives the active translation object. All UI strings go through `t`. Adding a new UI string requires entries in both `ja` and `en` objects.

### Colors and dark mode

The UI follows the OS color scheme (`prefers-color-scheme`); there is no toggle. All colors come from the `--tk-*` tokens in `src/tk-base.css`, exposed to Tailwind in `src/app.css` as `bg`, `surface`, `surface-2`, `ink`, `body`, `muted`, `line`, `line-strong`, `accent`, `on-accent`, `danger`, `success` (e.g. `bg-surface`, `text-muted`, `border-line`). Borders that outline a form control (selects, the toggle track) use `line-strong` (3:1 against the surface); `line` is for separators and panel edges. Use these instead of raw Tailwind palette colors (`slate-*`, `blue-*`) or hex values so both schemes keep working. The header and footer use `.tk-header` / `.tk-footer`, and the main buttons `.tk-btn` / `.tk-btn--quiet`.

### Narrow screens

The three-column editor (options sidebar, input, output) is the `lg` (1024px) and up layout; below that the three columns are too narrow (the title truncates and each pane is only ~260px at 768px). Below `lg` the page scrolls instead of being fixed to the viewport height: the header controls wrap (Sample / Clear / Format stay together as one row), the format options fold into a disclosure button above the editors (`optionsOpen`, closed at first and not saved), and the input and output panes stack, each `45svh` tall. Keep new layout classes mobile-first with `lg:` for the desktop form so the desktop look does not change.

### Dialects

Every dialect `sql-formatter` supports is offered, except `tsql`, which is its alias for `transactsql`. `src/lib/constants.js` holds them as `DIALECT_GROUPS` — the groups the select's `optgroup`s follow — with `DIALECTS` the same list flattened; `constants.test.js` checks the two against `sql-formatter`'s own `supportedDialects`, so adding a dialect there is all a version bump needs.

Group names come from `t.dialectGroup_<key>`, and a dialect whose name is not a product name (`sql`) from `t.dialectLabel_<value>`; `groupLabel()` / `dialectLabel()` in `src/lib/i18n.js` look them up and fall back to the `label` in `constants.js`. `normalizeDialect()` guards the value restored from localStorage, so a dialect that is no longer listed falls back to `DEFAULT_DIALECT` instead of reaching `sql-formatter`.

Only a few dialects have their own `SAMPLE_SQL`; `sampleFor()` falls back to the `sql` sample, which is plain enough to parse in every dialect. The Oracle sample uses named bind variables (`:EMPLOYEE_ID`, `:STATUS`, `:COUNTRY_ID`) — intentional, valid PL/SQL — and the BigQuery one uses `QUALIFY` and `arr[OFFSET(0)]`, which only BigQuery parses.

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
