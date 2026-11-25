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

A node is never joined when its lines contain a line comment, a line that belongs to a multi-line string literal or block comment, or a CTE opener (`name AS (`) — CTE bodies stay expanded whatever the width. `lexLines()` lexes the whole sql-formatter output in one pass, carrying the in-string / in-comment state across lines, so the middle lines of a long literal (which contain no quote of their own) are recognised too. It knows `'`, `"`, `` ` ``, dollar-quoted strings (`$$…$$` in `postgresql`/`snowflake`/`clickhouse`, `$tag$…$tag$` in `postgresql`), backslash escapes where the dialect has them (MySQL family, Snowflake `'…'`, PostgreSQL `E'…'`) and nested block comments (`postgresql`, `transactsql`).

The line-comment prefixes are per dialect, following sql-formatter's `lineCommentTypes` (the `SYNTAX` table in `formatter.js`): `--` everywhere, `#` in `mysql`, `mariadb`, `tidb`, `singlestoredb`, `bigquery`, `clickhouse`, `n1ql`, and `//` in `snowflake`. `#` must not be treated as a comment elsewhere because PostgreSQL uses `#>` and `#>>` as JSON operators.

### Template placeholders

With the `ignoreTemplates` option (the "Ignore template syntax" toggle), SQL carrying dbt / Jinja expressions (`{{ ref('orders') }}`) or MyBatis parameters (`#{id}`, `${raw}`) is formatted instead of failing to parse, and each placeholder's text comes through untouched — no case folding and no re-spacing inside. Statement blocks such as `{% if %}` are out of scope: a statement carrying one is not valid SQL on its own.

The template engine runs before the SQL is parsed, so `maskTemplates()` finds placeholders in the raw text wherever they sit — inside a SQL string literal or comment too — and swaps each one for a mask token (`<sentinel><index>___<sentinel>`) before `format()` runs. They cannot be left to sql-formatter's `paramTypes`: it settles strings and line comments first, so a quote inside `'{{ var('d') }}'` would end the SQL string, and in the MySQL family the `#` of `#{id}` would open a comment. Details:

- The sentinel is the first Private Use Area character (U+E000 onward) the SQL does not contain, so it never clashes with the input. Only if every one of them is taken is the SQL formatted unmasked.
- A placeholder is masked together with the identifier characters (letters, digits, `_`, `$`) and any other placeholders glued to it, so `log_${month}`, `{{ prefix }}orders` or `{{ a }}{{ b }}` is one token. Masked on its own, sql-formatter would put a space inside the name. A `$` that opens the next `${...}` is not taken as an identifier character.
- Each mask is padded with `_` to the length of the text it replaces, so sql-formatter's own `expressionWidth` decisions are the same as for the real text.
- The end of a `{{ ... }}` is found by `jinjaEnd()`, which skips quoted strings (with backslash escapes) and bracket nesting, so `{{ var('x', '}}') }}` and `{{ {'a': {'b': 1}} }}` are one placeholder. One that never balances falls back to its first `}}`; one with no `}}` at all is left as SQL. Once one `{{` has no `}}` after it, no later `{{` can have one either, so later ones are not scanned again.
- Only a `#{...}` / `${...}` that closes on its own line is masked, so a MySQL comment starting with an unclosed `#{` stays the comment it is rather than becoming a parse error. A `#{...}` that *does* close is treated as a placeholder even where the dialect would have read the whole line as a comment — with the option on, that is what the user is asking for. (A closed `#{...}` after a `#` that already opened a comment stays inside that comment.)
- The mask is passed to sql-formatter as a `custom` parameter. sql-formatter replaces `paramTypes` one field at a time, so `templateParamTypes()` appends the dialect's own `custom` rules (ClickHouse `{id:UInt64}`, SQLite `$name`) to keep them working.

`unmaskTemplates()` puts the original text back byte-for-byte before the output is read again and returns where each masked span now sits. `lexLines()` skips exactly those ranges, even one that starts on the character after a backslash escape (`'C:\{{ dir }}'`), so neither a `#` that opens one nor a quote or `--` inside it is taken for SQL, and lexing agrees with how sql-formatter read the statement; a placeholder that runs over several lines marks the lines it covers as spanning, which keeps them from being joined.

### i18n

Translations live in `src/lib/i18n.js` as the `TRANSLATIONS` constant. The derived value `t = $derived(TRANSLATIONS[lang])` gives the active translation object. All UI strings go through `t`. Adding a new UI string requires entries in both `ja` and `en` objects.

### Colors and dark mode

The UI follows the OS color scheme (`prefers-color-scheme`); there is no toggle. All colors come from the `--tk-*` tokens in `src/tk-base.css`, exposed to Tailwind in `src/app.css` as `bg`, `surface`, `surface-2`, `ink`, `body`, `muted`, `line`, `line-strong`, `accent`, `on-accent`, `danger`, `success` (e.g. `bg-surface`, `text-muted`, `border-line`). Borders that outline a form control (selects, the toggle track) use `line-strong` (3:1 against the surface); `line` is for separators and panel edges. Use these instead of raw Tailwind palette colors (`slate-*`, `blue-*`) or hex values so both schemes keep working. The header and footer use `.tk-header` / `.tk-footer`, and the main buttons `.tk-btn` / `.tk-btn--quiet`.

### Narrow screens

The three-column editor (options sidebar, input, output) is the `lg` (1024px) and up layout; below that the three columns are too narrow (the title truncates and each pane is only ~260px at 768px). Below `lg` the page scrolls instead of being fixed to the viewport height: the header controls wrap (Sample / Clear / Format stay together as one row), the format options fold into a disclosure button above the editors (`optionsOpen`, closed at first and not saved), and the input and output panes stack, each `45svh` tall. Keep new layout classes mobile-first with `lg:` for the desktop form so the desktop look does not change.

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
