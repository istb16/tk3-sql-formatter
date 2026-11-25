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
 */
function lexLines(lines, syntax) {
  // null, or { quote, backslash, doubled }, { dollar }, { block: depth }
  // `quote` is the closing delimiter, one character or a triple quote.
  let state = null;
  return lines.map((line) => {
    const startsInside = state !== null;
    let comment = false;
    let i = 0;
    while (i < line.length) {
      if (state?.quote) {
        if (state.backslash && line[i] === '\\') { i += 2; continue; }
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

      if (syntax.lineComments.some((p) => line.startsWith(p, i))) { comment = true; break; }
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
 * back onto one line.
 */
export function formatSql(sql, opts) {
  const { compactLists, ...fmtOpts } = opts;
  const result = format(sql, fmtOpts);

  const renderOpts = {
    compact: !!compactLists,
    maxWidth: fmtOpts.expressionWidth ?? 50,
    tabWidth: fmtOpts.tabWidth ?? 2,
  };

  const lines = result.split('\n');
  const lex = lexLines(lines, syntaxFor(fmtOpts.language));
  const out = [];
  for (const node of parseTree(lines, lex).children) {
    render(node, out, renderOpts);
  }
  return out.join('\n');
}
