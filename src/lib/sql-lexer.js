import { Q_PREFIX, Q_STRING } from './dialect-syntax.js';

/**
 * Lexing sql-formatter's output, line by line, so that the renderer knows which
 * lines it must leave alone. The rules it follows come from `dialect-syntax.js`.
 */

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
export function lexLines(lines, syntax, templates = []) {
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
