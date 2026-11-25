import * as dialects from 'sql-formatter';
import { format } from 'sql-formatter';

/**
 * Post-processing for sql-formatter's output.
 *
 * sql-formatter encodes the block structure of a statement in its indentation,
 * so the output is parsed back into a tree of lines and each node is rendered
 * bottom-up: a node collapses onto one line when the joined line fits, and is
 * left expanded otherwise. Working on the tree (instead of scanning the text
 * line by line) means inner blocks are always considered, even when the block
 * around them stays expanded, and a block's opening line, body and closing
 * line always move together.
 */

/**
 * The lexical details of each dialect that decide where a literal or comment
 * starts and ends, taken from sql-formatter's own language definitions
 * (`lineCommentTypes`, `stringTypes`, `nestedBlockComments`).
 *
 * - `lineComments`: prefixes that start a comment running to the end of the
 *   line. `--` everywhere; `#` only where it is a comment — elsewhere it is an
 *   operator (PostgreSQL's `#>` / `#>>`) and must not be mistaken for one.
 * - `backslash`: quote characters whose strings take backslash escapes
 *   (`'O\'Brien'`).
 * - `eStrings`: `E'...'` strings take backslash escapes (PostgreSQL, DuckDB).
 * - `rawPrefixes`: per quote character, the prefixes (case-insensitive) that
 *   make a `'...'` or `"..."` string raw, so a backslash in it escapes nothing
 *   (BigQuery `r'\'`, Spark `R'\'`, the hex and bit strings `X'...'` and
 *   `B'...'` of the MySQL family and standard SQL). Only the dialects that
 *   otherwise take backslash escapes need them. Triple-quoted strings are not
 *   affected: sql-formatter honours backslashes in `R'''...'''` too.
 * - `qStrings`: Oracle's `q'[...]'` (also `N`-prefixed), whose delimiter pair —
 *   `[]`, `()`, `{}`, `<>`, or any other non-space character used on both
 *   sides — follows the opening quote, and in which a `'` does not close the
 *   string. Like sql-formatter, only a q-string that closes on the same line is
 *   one; otherwise `q` is a plain identifier and the quote opens an ordinary
 *   string.
 * - `tripleQuotes`: `'''...'''` and `"""..."""` open a string that commonly
 *   runs over several lines (BigQuery).
 * - `dollar`: how a dollar-quoted string opens (`$$ ... $$`, `$tag$ ... $tag$`).
 *   Where a tag is allowed, its shape follows what sql-formatter actually
 *   accepts: in PostgreSQL and DuckDB a tag cannot start with a digit (`$1` is
 *   a parameter), in ClickHouse it can, and Snowflake takes no tag at all
 *   (`$name` is a variable).
 * - `brackets`: `[...]` is a quoted identifier, with `]]` standing for a
 *   literal `]` (SQLite, T-SQL).
 * - `nestedBlockComments`: a block comment opened inside a block comment must
 *   be closed before the outer one is.
 *
 * The dialects that need none of this (db2, redshift, trino) are left out and
 * take `DEFAULT_SYNTAX`.
 */
const HASH_COMMENTS = ['--', '#'];
const MYSQL_SYNTAX = {
  lineComments: HASH_COMMENTS,
  backslash: `'"`,
  rawPrefixes: { "'": ['B', 'X'] },
};
const TAGGED_DOLLAR = /^\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/;
/** Both quote characters taking the same raw prefixes. */
const rawQuotes = (prefixes) => ({ "'": prefixes, '"': prefixes });
const SYNTAX = {
  sql: { backslash: "'", rawPrefixes: { "'": ['X'] } },
  mysql: MYSQL_SYNTAX,
  mariadb: MYSQL_SYNTAX,
  tidb: MYSQL_SYNTAX,
  singlestoredb: MYSQL_SYNTAX,
  n1ql: { lineComments: HASH_COMMENTS, backslash: `'"` },
  bigquery: {
    lineComments: HASH_COMMENTS,
    backslash: `'"`,
    rawPrefixes: rawQuotes(['R', 'B', 'RB', 'BR']),
    tripleQuotes: true,
  },
  hive: { backslash: `'"` },
  spark: { backslash: `'"`, rawPrefixes: rawQuotes(['R', 'X']) },
  plsql: { qStrings: true },
  clickhouse: { lineComments: HASH_COMMENTS, backslash: `'"`, dollar: /^\$\w*\$/ },
  snowflake: { lineComments: ['--', '//'], backslash: "'", dollar: /^\$\$/ },
  postgresql: { eStrings: true, dollar: TAGGED_DOLLAR, nestedBlockComments: true },
  duckdb: { eStrings: true, dollar: TAGGED_DOLLAR, nestedBlockComments: true },
  sqlite: { brackets: true },
  transactsql: { brackets: true, nestedBlockComments: true },
  db2i: { nestedBlockComments: true },
};
const DEFAULT_SYNTAX = { lineComments: ['--'], backslash: '' };

/**
 * A prefix that stands on its own at the end of `before`: `abr'x'` is not a
 * raw string, nor `abq'[x]'` a q-string.
 */
const prefixRegex = (prefixes) => new RegExp(`(?:^|[^\\w$])(?:${prefixes.join('|')})$`, 'i');
const Q_PREFIX = prefixRegex(['Q', 'NQ']);
/**
 * The rest of an Oracle q-string from its opening quote, following
 * sql-formatter's own pattern (`.` stops at the end of the line).
 */
const Q_STRING = /^'(?:<(?:(?!>').)*?>|\[(?:(?!\]').)*?\]|\((?:(?!\)').)*?\)|\{(?:(?!\}').)*?\}|([^\s<[({])(?:(?!\1').)*?\1)'/u;

function syntaxFor(language) {
  const syntax = { ...DEFAULT_SYNTAX, ...SYNTAX[language] };
  if (syntax.rawPrefixes) {
    syntax.rawPrefix = Object.fromEntries(
      Object.entries(syntax.rawPrefixes).map(([quote, prefixes]) => [quote, prefixRegex(prefixes)]),
    );
  }
  return syntax;
}

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
function maskTemplates(sql) {
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
function unmaskTemplates(text, { sentinel, originals }) {
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
function templateParamTypes(language, sentinel) {
  const own = dialects[language ?? 'sql']?.tokenizerOptions?.paramTypes?.custom ?? [];
  return { custom: [{ regex: `${sentinel}\\d+_*${sentinel}` }, ...own] };
}

/**
 * Whether the quote at `line[i]` opens a string that takes backslash escapes.
 * `triple` is set when it opens a triple-quoted string.
 */
function takesBackslash(line, i, syntax, triple) {
  const ch = line[i];
  const before = line.slice(0, i);
  if (!triple && syntax.rawPrefix?.[ch]?.test(before)) return false;
  if (syntax.backslash.includes(ch)) return true;
  return !!syntax.eStrings && ch === "'" && /(^|[^\w$])[eE]$/.test(before);
}

/**
 * Lexes the whole of sql-formatter's output in one pass and reports, per line:
 *
 * - `spans`: the line starts or ends inside a string literal, quoted identifier
 *   or block comment, i.e. it belongs to one that runs over several lines. Its
 *   line breaks and indentation are part of the literal's value (or the
 *   identifier's name, or the comment's layout), so
 *   such a line must never be joined. `parseTree` still reads its indent like
 *   any other line, which can put it in the tree in a place that does not match
 *   the statement's own structure; that is harmless because `isJoinable`
 *   refuses any subtree holding such a line, so it is only ever left as it is.
 * - `comment`: the line carries a line comment, which would swallow everything
 *   joined after it.
 *
 * The state is carried across lines, so the middle lines of a long literal are
 * recognised even though they contain no quote of their own.
 *
 * `templates` are the `[start, end)` offsets, in the lines joined with `\n`, of
 * the placeholders `maskTemplates` hid from sql-formatter. Each is skipped
 * whole, wherever it sits, so neither a `#` that opens one nor a quote or a
 * `--` inside it is taken for SQL; one that runs over several lines leaves
 * every line it covers marked as spanning, which keeps them from being joined.
 */
function lexLines(lines, syntax, templates = []) {
  // null, or { quote, backslash, doubled }, { dollar }, { block: depth },
  // { template: end, outer } (a placeholder inside the `outer` state).
  // `quote` is the closing delimiter, one character or a triple quote.
  let state = null;
  let offset = 0;
  let next = 0;
  return lines.map((line) => {
    const startsInside = state !== null;
    const lineEnd = offset + line.length;
    let comment = false;
    let i = 0;
    while (i < line.length) {
      if (state?.template) {
        if (state.template > lineEnd) i = line.length;
        else { i = state.template - offset; state = state.outer; }
        continue;
      }
      while (next < templates.length && templates[next][0] < offset + i) next++;
      if (templates[next]?.[0] === offset + i) {
        state = { template: templates[next++][1], outer: state };
        continue;
      }

      if (state?.quote) {
        // The escaped character is skipped, unless a placeholder starts on it
        // ('C:\{{ dir }}'): the next pass then picks the placeholder up.
        if (state.backslash && line[i] === '\\') {
          i += templates[next]?.[0] === offset + i + 1 ? 1 : 2;
          continue;
        }
        // `]]` inside a bracketed identifier is a literal `]`. A doubled quote
        // ('it''s') needs no such rule: it closes and reopens, which ends the
        // same way.
        if (state.doubled && line.startsWith(state.quote.repeat(2), i)) { i += 2; continue; }
        if (line.startsWith(state.quote, i)) { i += state.quote.length; state = null; continue; }
        i++;
        continue;
      }
      if (state?.dollar) {
        if (line.startsWith(state.dollar, i)) { i += state.dollar.length; state = null; } else i++;
        continue;
      }
      if (state?.block) {
        if (line.startsWith('*/', i)) {
          i += 2;
          if (--state.block === 0) state = null;
        } else if (syntax.nestedBlockComments && line.startsWith('/*', i)) {
          i += 2;
          state.block++;
        } else i++;
        continue;
      }

      if (syntax.lineComments.some((p) => line.startsWith(p, i))) {
        comment = true;
        // The comment ends with the line, unless a placeholder inside it runs
        // on past the line end.
        while (next < templates.length && templates[next][0] < lineEnd) {
          const [, end] = templates[next++];
          if (end > lineEnd) state = { template: end, outer: null };
        }
        break;
      }
      if (line.startsWith('/*', i)) { state = { block: 1 }; i += 2; continue; }
      const ch = line[i];
      if (ch === "'" && syntax.qStrings && Q_PREFIX.test(line.slice(0, i))) {
        const m = Q_STRING.exec(line.slice(i));
        if (m) { i += m[0].length; continue; }
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        // A triple quote has to be recognised before the single one, or its
        // first two quotes read as an empty string.
        const triple = syntax.tripleQuotes && ch !== '`' && line.startsWith(ch.repeat(3), i);
        const quote = triple ? ch.repeat(3) : ch;
        state = { quote, backslash: takesBackslash(line, i, syntax, triple) };
        i += quote.length;
        continue;
      }
      if (ch === '[' && syntax.brackets) {
        state = { quote: ']', backslash: false, doubled: true };
        i++;
        continue;
      }
      if (ch === '$' && syntax.dollar && !/[\w$]/.test(line[i - 1] ?? '')) {
        const m = syntax.dollar.exec(line.slice(i));
        if (m) { state = { dollar: m[0] }; i += m[0].length; continue; }
      }
      i++;
    }
    offset = lineEnd + 1;
    return { spans: startsInside || state !== null, comment };
  });
}

/**
 * Display columns taken up by a piece of text: full-width (East Asian Wide)
 * characters such as kanji and kana take two columns.
 */
function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff) ||
      (c >= 0x20000 && c <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** A line that closes the block opened by the preceding sibling. */
const CLOSER = /^(\)|END\b)/i;
/** `... AS (` — the opening line of a CTE. */
const CTE_OPENER = /\bAS\s*\($/i;
/** `... FOO(` — an opening paren that belongs to a function call. */
const FUNCTION_CALL = /[\w"`\]]\($/;
/**
 * Keywords that start a clause of their own, but are also used inside the
 * argument list of a function — EXTRACT(YEAR FROM d), SUBSTRING(s FROM 1 FOR 2),
 * CAST(x AS INT), POSITION(a IN b). sql-formatter breaks the line on them, so
 * those arguments are pulled back together whatever the mode.
 */
const ARG_KEYWORD = /^(FROM|IN|FOR|AS|USING|ORDER BY|SEPARATOR)\b/i;

/**
 * Builds a tree of lines from sql-formatter's output.
 * A node owns the lines indented deeper than itself, plus the closing line that
 * follows them at its own indent (`)` or `END`).
 */
function parseTree(lines, lex) {
  const root = { indent: -1, children: [], closer: null };
  const stack = [root];

  for (const [index, raw] of lines.entries()) {
    const { spans, comment } = lex[index];
    if (!raw.trim()) {
      root.children.push({ blank: true, raw });
      stack.length = 1;
      continue;
    }

    const indent = raw.search(/\S/);
    const text = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();

    const parent = stack[stack.length - 1];
    const prev = parent.children[parent.children.length - 1];
    if (prev && !prev.blank && !prev.closer && prev.indent === indent && CLOSER.test(text)) {
      prev.closer = { raw, text, spans, comment };
      continue;
    }

    const node = { indent, raw, text, spans, comment, children: [], closer: null };
    parent.children.push(node);
    stack.push(node);
  }

  return root;
}

/** Every line of a subtree, in order, as `{ text, spans, comment }`. */
function subtreeLines(node, acc = []) {
  acc.push(node);
  for (const child of node.children) subtreeLines(child, acc);
  if (node.closer) acc.push(node.closer);
  return acc;
}

/** Joins the parts of a node onto one line, keeping `(`, `)` and `,` tight. */
function joinParts(parts) {
  let out = '';
  for (const part of parts) {
    if (!out) { out = part; continue; }
    const tight = out.endsWith('(') || /^[),;]/.test(part);
    out += (tight ? '' : ' ') + part;
  }
  return out;
}

function flatten(node) {
  const parts = [node.text, ...node.children.map(flatten)];
  if (node.closer) parts.push(node.closer.text);
  return joinParts(parts);
}

/**
 * Whether a subtree may be joined onto one line at all.
 * A line comment would swallow everything after it, a string literal or a block
 * comment spanning lines would have its value or layout changed (see
 * `lexLines`), and a CTE body is always kept expanded.
 */
function isJoinable(node) {
  for (const line of subtreeLines(node)) {
    if (line.comment || line.spans) return false;
    if (CTE_OPENER.test(line.text)) return false;
  }
  return true;
}

function hasSelect(node) {
  return subtreeLines(node).some(line => /\bSELECT\b/i.test(line.text));
}

/** The argument list of a node that opens a function call, joined onto one line. */
function joinedArguments(node) {
  const parts = node.children.map(flatten);
  if (node.closer) parts.push(node.closer.text);
  return joinParts(parts);
}

/** How many columns an indent takes up on screen, with tabs expanded. */
function indentColumns(indent, tabWidth) {
  return indent.replace(/\t/g, ' '.repeat(tabWidth)).length;
}

function render(node, out, opts) {
  if (node.blank) { out.push(node.raw); return; }
  if (!node.children.length && !node.closer) { out.push(node.raw); return; }

  if (isJoinable(node)) {
    const indent = node.raw.slice(0, node.indent);
    const columns = indentColumns(indent, opts.tabWidth);
    const joined = flatten(node);
    // A function call broken on a keyword that only looks like a clause is put
    // back together whatever the mode, as long as the argument list itself fits
    // the width. Measuring the arguments rather than the whole line keeps
    // EXTRACT(YEAR FROM d) together however deeply it sits, while a genuinely
    // long argument list keeps the wrapping sql-formatter chose for it. The
    // joined line itself may therefore end up wider than the width.
    const brokenOnArgKeyword =
      FUNCTION_CALL.test(node.text) &&
      !hasSelect(node) &&
      node.children.some(child => ARG_KEYWORD.test(child.text)) &&
      displayWidth(joinedArguments(node)) <= opts.maxWidth;
    if (brokenOnArgKeyword || (opts.compact && columns + displayWidth(joined) <= opts.maxWidth)) {
      out.push(indent + joined);
      return;
    }
  }

  out.push(node.raw);
  for (const child of node.children) render(child, out, opts);
  if (node.closer) out.push(node.closer.raw);
}

/**
 * Formats SQL using sql-formatter, then runs the block-aware post-processing.
 * With `compactLists` the lines are joined back together as far as
 * `expressionWidth` allows; without it only function-call arguments are pulled
 * back onto one line. With `ignoreTemplates` the template placeholders listed
 * at `TEMPLATE_START` are treated as parameters rather than as SQL.
 */
export function formatSql(sql, opts) {
  const { compactLists, ignoreTemplates, ...fmtOpts } = opts;

  let result;
  let templates = [];
  const mask = ignoreTemplates ? maskTemplates(sql) : null;
  if (!mask) {
    result = format(sql, fmtOpts);
  } else {
    fmtOpts.paramTypes = templateParamTypes(fmtOpts.language, mask.sentinel);
    ({ text: result, ranges: templates } = unmaskTemplates(format(mask.sql, fmtOpts), mask));
  }

  const renderOpts = {
    compact: !!compactLists,
    maxWidth: fmtOpts.expressionWidth ?? 50,
    tabWidth: fmtOpts.tabWidth ?? 2,
  };

  const lines = result.split('\n');
  const lex = lexLines(lines, syntaxFor(fmtOpts.language), templates);
  const out = [];
  for (const node of parseTree(lines, lex).children) {
    render(node, out, renderOpts);
  }
  return out.join('\n');
}
