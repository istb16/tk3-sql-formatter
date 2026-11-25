/**
 * The tree of lines built from sql-formatter's output, and the rendering that
 * decides per node whether to join it onto one line or leave it expanded.
 */

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
export function parseTree(lines, lex) {
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

export function render(node, out, opts) {
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
