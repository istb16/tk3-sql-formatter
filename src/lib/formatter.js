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
 * Dialects where `#` starts a line comment. Everywhere else `#` is an operator
 * (PostgreSQL's `#>` / `#>>`), so it must not be mistaken for a comment.
 */
const HASH_COMMENT_LANGUAGES = new Set(['mysql', 'mariadb', 'tidb', 'singlestoredb']);

/** True when a line carries a comment that runs to the end of the line. */
function hasLineComment(line, hashComments) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '-' && line[i + 1] === '-') return true;
    if (ch === '#' && hashComments) return true;
  }
  return false;
}

/**
 * True when a line is part of a block comment that spans several lines, either
 * because it opens one it does not close or because it closes one opened
 * earlier. Joining those lines would flatten the comment's own layout.
 */
function spansBlockComment(line) {
  let quote = null;
  let open = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (open > 0) {
      if (ch === '*' && line[i + 1] === '/') { open--; i++; }
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '*') { open++; i++; continue; }
    if (ch === '*' && line[i + 1] === '/') return true;
  }
  return open > 0;
}

/** True when a line leaves a string literal open (a literal spanning lines). */
function hasOpenQuote(line) {
  let quote = null;
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
  }
  return quote !== null;
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
function parseTree(lines) {
  const root = { indent: -1, children: [], closer: null };
  const stack = [root];

  for (const raw of lines) {
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
      prev.closer = { raw, text };
      continue;
    }

    const node = { indent, raw, text, children: [], closer: null };
    parent.children.push(node);
    stack.push(node);
  }

  return root;
}

/** Every line of a subtree, in order. */
function subtreeLines(node, acc = []) {
  acc.push(node.text);
  for (const child of node.children) subtreeLines(child, acc);
  if (node.closer) acc.push(node.closer.text);
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
 * comment spanning lines would lose its layout, and a CTE body is always kept
 * expanded.
 */
function isJoinable(node, opts) {
  for (const line of subtreeLines(node)) {
    if (hasLineComment(line, opts.hashComments)) return false;
    if (hasOpenQuote(line)) return false;
    if (spansBlockComment(line)) return false;
    if (CTE_OPENER.test(line)) return false;
  }
  return true;
}

function hasSelect(node) {
  return subtreeLines(node).some(line => /\bSELECT\b/i.test(line));
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

  if (isJoinable(node, opts)) {
    const indent = node.raw.slice(0, node.indent);
    const columns = indentColumns(indent, opts.tabWidth);
    const joined = flatten(node);
    // A function call broken on a keyword that only looks like a clause is put
    // back together whatever the mode, as long as the argument list itself fits
    // the width. Measuring the arguments rather than the whole line keeps
    // EXTRACT(YEAR FROM d) together however deeply it sits, while a genuinely
    // long argument list keeps the wrapping sql-formatter chose for it.
    const brokenOnArgKeyword =
      FUNCTION_CALL.test(node.text) &&
      !hasSelect(node) &&
      node.children.some(child => ARG_KEYWORD.test(child.text)) &&
      joinedArguments(node).length <= opts.maxWidth;
    if (brokenOnArgKeyword || (opts.compact && columns + joined.length <= opts.maxWidth)) {
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
    hashComments: HASH_COMMENT_LANGUAGES.has(fmtOpts.language),
  };

  const out = [];
  for (const node of parseTree(result.split('\n')).children) {
    render(node, out, renderOpts);
  }
  return out.join('\n');
}
