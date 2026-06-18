import { format } from 'sql-formatter';

/**
 * Collapses multi-line (...) blocks onto one line.
 * - Non-subquery blocks (EXTRACT etc.) are always collapsed.
 * - SELECT subqueries are collapsed only when the full resulting line fits
 *   within expressionWidth characters.
 * - CTE blocks (WITH name AS (...)) are always left expanded.
 * - Blocks where any inner line has unbalanced parens (nested unclosed block)
 *   are left expanded.
 * Runs until stable.
 */
function collapseParenBlocks(sql, expressionWidth) {
  let prev = '';
  let result = sql;
  let limit = 100;
  while (prev !== result && limit-- > 0) {
    prev = result;
    result = result.replace(
      /\((\n[ \t]+[^\n]+)+\n[ \t]*\)/g,
      (match, _group, offset, input) => {
        const lineStart = input.lastIndexOf('\n', offset) + 1;
        const prefix = input.slice(lineStart, offset);
        const inner = match.slice(1, match.lastIndexOf('\n'))
          .split('\n').map(l => l.trim()).filter(Boolean);

        // CTE: WITH name AS (  → always keep expanded
        if (/\bAS\s*$/i.test(prefix.trimEnd())) return match;

        // Reject if any inner line has unbalanced parens (nested unclosed block)
        const hasUnclosedParen = inner.some(l => {
          let depth = 0;
          for (const ch of l) {
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
          }
          return depth !== 0;
        });
        if (hasUnclosedParen) return match;

        // Non-SELECT: always collapse (EXTRACT, function calls, etc.)
        if (!inner.some(l => /^SELECT\b/i.test(l))) {
          return '(' + inner.join(' ') + ')';
        }

        // SELECT subquery: collapse only if full line fits in expressionWidth
        const fullLine = prefix + '(' + inner.join(' ') + ')';
        return fullLine.length <= expressionWidth ? '(' + inner.join(' ') + ')' : match;
      }
    );
  }
  return result;
}

/**
 * Pulls keyword lines and their indented children onto one line when the
 * children form a comma list, AND/OR chain, or are a single item.
 * Subquery bodies are guarded against collapsing.
 */
function joinCompactLists(sql) {
  const lines = sql.split('\n');
  const out   = [];
  let i = 0;

  while (i < lines.length) {
    const cur       = lines[i];
    const curIndent = cur.search(/\S/);

    if (i + 1 < lines.length) {
      const nextIndent = lines[i + 1].search(/\S/);

      if (nextIndent > curIndent && nextIndent >= 0) {
        const group = [];
        let j = i + 1;
        while (j < lines.length && lines[j].search(/\S/) === nextIndent) {
          group.push(lines[j].trim());
          j++;
        }

        if (group.length >= 1) {
          const isCommaList      = group.length === 1 || group.slice(0, -1).every(l => l.endsWith(','));
          const isAndOrBefore    = group.length > 1 && group.slice(1).every(l => /^(AND|OR)\s/i.test(l));
          const isAndOrAfter     = group.length > 1 && group.slice(0, -1).every(l => /\s(AND|OR)$/i.test(l));
          const endsWithSubquery = group.length > 1 && group[group.length - 1] === '(';

          if (!endsWithSubquery && (isCommaList || isAndOrBefore || isAndOrAfter)) {
            out.push(cur.trimEnd() + ' ' + group.join(' '));
            i = j;
            continue;
          }
        }
      }
    }

    out.push(cur);
    i++;
  }

  return out.join('\n');
}

/**
 * Formats SQL using sql-formatter, then optionally applies the compact-list
 * post-processing pipeline (collapseParenBlocks → joinCompactLists).
 */
export function formatSql(sql, opts) {
  const { compactLists, ...fmtOpts } = opts;
  let result = format(sql, {
    ...fmtOpts,
    expressionWidth: compactLists ? 9999 : fmtOpts.expressionWidth,
  });
  if (compactLists) {
    result = collapseParenBlocks(result, fmtOpts.expressionWidth ?? 50);
    result = joinCompactLists(result);
  }
  return result;
}
