import { format } from 'sql-formatter';

/**
 * Collapses multi-line (...) blocks that contain no nested parens and no
 * subqueries. Fixes EXTRACT(YEAR FROM date) being expanded by sql-formatter
 * because FROM is treated as a keyword. Runs until stable.
 */
function collapseParenBlocks(sql) {
  let prev = '';
  let result = sql;
  let limit = 100;
  while (prev !== result && limit-- > 0) {
    prev = result;
    result = result.replace(
      /\((\n[\t ]+[^()\n]+)+\n[\t ]*\)/g,
      (match) => {
        const inner = match.slice(1, -1).split('\n').map(l => l.trim()).filter(Boolean);
        if (inner.some(l => /^SELECT\b/i.test(l))) return match;
        return '(' + inner.join(' ') + ')';
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
    result = collapseParenBlocks(result);
    result = joinCompactLists(result);
  }
  return result;
}
