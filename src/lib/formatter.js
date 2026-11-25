import { format } from 'sql-formatter';
import { syntaxFor } from './dialect-syntax.js';
import { lexLines } from './sql-lexer.js';
import { maskTemplates, unmaskTemplates, templateParamTypes } from './templates.js';
import { parseTree, render } from './line-tree.js';

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
 *
 * The pieces live next door: `dialect-syntax.js` (what each dialect's
 * literals and comments look like), `sql-lexer.js` (which lines must be left
 * alone), `templates.js` (hiding template placeholders) and `line-tree.js`
 * (the tree and the join decision).
 */

/**
 * Formats SQL using sql-formatter, then runs the block-aware post-processing.
 * With `compactLists` the lines are joined back together as far as
 * `expressionWidth` allows; without it only function-call arguments are pulled
 * back onto one line. With `ignoreTemplates` the template placeholders listed
 * at `TEMPLATE_START` in `templates.js` are treated as parameters rather
 * than as SQL.
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
