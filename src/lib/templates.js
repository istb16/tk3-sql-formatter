import * as dialects from 'sql-formatter';

/**
 * Hiding template placeholders from sql-formatter and putting them back
 * afterwards, for the `ignoreTemplates` option.
 */

/**
 * The template placeholders `ignoreTemplates` lets through: dbt / Jinja
 * expressions (`{{ ref('orders') }}`) and MyBatis parameters (`#{id}`,
 * `${raw}`). Statement blocks such as `{% if %}` are left out on purpose — a
 * statement carrying one is not valid SQL on its own anyway.
 *
 * The template engine runs before the SQL is ever parsed, so a placeholder is
 * found in the raw text wherever it sits — inside a SQL string literal or a
 * comment too — and each one is swapped for a mask token before sql-formatter
 * sees the SQL (see `maskTemplates`). Leaving them to sql-formatter's own
 * `paramTypes` does not work: it settles strings and line comments first, so a
 * quote inside `'{{ var('d') }}'` would end the SQL string, and in the MySQL
 * family the `#` of `#{id}` would open a comment.
 *
 * Only a `#{...}` / `${...}` that closes on its own line is a placeholder, so a
 * MySQL comment that happens to start with `#{` and never closes it (`#{todo:
 * ask about this`) keeps being read as the comment it is instead of becoming a
 * parse error. A `#{...}` that does close is a placeholder as far as this
 * option is concerned, even where the dialect would have read the whole line
 * as a comment — that is what turning the option on asks for.
 */
const TEMPLATE_START = /\{\{|[#$]\{[^{}\n]*\}/g;

/**
 * How far past the first `}}` the search for one at depth 0 keeps going. The
 * depth tracking is there for `{{ {'a': {'b': 1}} }}`, where the real close sits
 * a few characters further on; an expression that never balances (`{{ f( }}`)
 * would otherwise have the whole rest of the input scanned, once per opener.
 * An expression whose close is further than this past its first `}}` ends at
 * that first `}}` instead.
 */
const JINJA_LOOKAHEAD = 1024;

/**
 * Where the Jinja expression opened by the `{{` at `start` ends (the index just
 * past its `}}`), or -1 when it never closes. A `}}` inside a quoted string or
 * inside brackets (`{{ var('x', '}}') }}`, `{{ {'a': {'b': 1}} }}`) does not
 * close it. An expression that never balances falls back to its first `}}`.
 */
function jinjaEnd(sql, start) {
  // The first `}}` anywhere after the opener, quoted or not. With none, the
  // expression never closes and is left as SQL, and there is nothing to scan.
  const fallback = sql.indexOf('}}', start + 2);
  if (fallback === -1) return -1;
  const limit = Math.min(sql.length, fallback + JINJA_LOOKAHEAD);
  let depth = 0;
  let quote = null;
  for (let i = start + 2; i < limit; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (depth > 0 && ')]}'.includes(ch)) depth--;
    else if (depth === 0 && sql.startsWith('}}', i)) return i + 2;
  }
  return fallback + 2;
}

/**
 * A character the SQL does not contain, taken from the Private Use Area: no
 * dialect gives it a meaning and it is not whitespace or a word character, so
 * sql-formatter never joins it to a neighbouring token.
 */
function freeSentinel(sql) {
  for (let c = 0xe000; c <= 0xf8ff; c++) {
    const ch = String.fromCharCode(c);
    if (!sql.includes(ch)) return ch;
  }
  return null;
}

/**
 * Identifier characters glued to a placeholder (`log_${month}`,
 * `{{ prefix }}orders`). They are masked together with it, since sql-formatter
 * would otherwise read the name as two tokens and put a space between them. A
 * `$` that opens the next `${...}` is not one of them.
 */
const WORD_CHAR = /[\p{L}\p{N}_$]/u;
const WORD_AFTER = /(?:[\p{L}\p{N}_]|\$(?!\{))*/uy;

/** Where the identifier characters running up to `end` start, not before `from`. */
function wordStart(sql, from, end) {
  let i = end;
  while (i > from && WORD_CHAR.test(sql[i - 1])) i--;
  return i;
}

/**
 * Swaps every placeholder for `<sentinel><index>___<sentinel>`, padded with `_`
 * to the length of the text it replaces so that sql-formatter's own decisions
 * on what fits within `expressionWidth` are the same as for the real text. A
 * placeholder is masked together with the identifier characters and any other
 * placeholders glued to it, so the whole name is one token.
 * Returns null when no sentinel is free (the SQL is then formatted as it is).
 */
export function maskTemplates(sql) {
  const sentinel = freeSentinel(sql);
  if (!sentinel) return null;
  // [start, end) of each run of glued placeholders and identifier characters.
  const runs = [];
  // Once a `{{` has no `}}` anywhere after it, no later `{{` has one either,
  // so the rest of the input is not scanned again for each of them.
  let jinjaClosed = true;
  TEMPLATE_START.lastIndex = 0;
  for (let m; (m = TEMPLATE_START.exec(sql)); ) {
    let end;
    if (m[0] !== '{{') end = m.index + m[0].length;
    else if (jinjaClosed) end = jinjaEnd(sql, m.index);
    else end = -1;
    if (end === -1) { jinjaClosed = false; continue; }
    WORD_AFTER.lastIndex = end;
    end += WORD_AFTER.exec(sql)[0].length;
    const prev = runs[runs.length - 1];
    if (prev && prev[1] === m.index) prev[1] = end;
    else runs.push([wordStart(sql, prev ? prev[1] : 0, m.index), end]);
    TEMPLATE_START.lastIndex = end;
  }

  const originals = [];
  let masked = '';
  let last = 0;
  for (const [start, end] of runs) {
    const text = sql.slice(start, end);
    const id = String(originals.length);
    masked += sql.slice(last, start) + sentinel + id +
      '_'.repeat(Math.max(0, text.length - id.length - 2)) + sentinel;
    originals.push(text);
    last = end;
  }
  masked += sql.slice(last);
  return { sql: masked, sentinel, originals };
}

/**
 * Puts the original placeholders back and reports where each one now sits in
 * the text, as `[start, end)` offsets, so that `lexLines` can skip exactly the
 * placeholders that were masked.
 */
export function unmaskTemplates(text, { sentinel, originals }) {
  const ranges = [];
  let out = '';
  let last = 0;
  for (const m of text.matchAll(new RegExp(`${sentinel}(\\d+)_*${sentinel}`, 'g'))) {
    out += text.slice(last, m.index);
    const original = originals[Number(m[1])];
    ranges.push([out.length, out.length + original.length]);
    out += original;
    last = m.index + m[0].length;
  }
  return { text: out + text.slice(last), ranges };
}

/**
 * sql-formatter takes `paramTypes` one field at a time, so passing `custom`
 * replaces the dialect's own custom parameters (ClickHouse `{id:UInt64}`,
 * SQLite `$name`) instead of adding to them. They are added back here.
 */
export function templateParamTypes(language, sentinel) {
  const own = dialects[language ?? 'sql']?.tokenizerOptions?.paramTypes?.custom ?? [];
  return { custom: [{ regex: `${sentinel}\\d+_*${sentinel}` }, ...own] };
}
