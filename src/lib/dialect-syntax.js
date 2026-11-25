/**
 * What each dialect's lexical rules are, as `syntaxFor()` hands them to the
 * lexer in `sql-lexer.js`. Nothing here looks at the SQL itself.
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
export const prefixRegex = (prefixes) => new RegExp(`(?:^|[^\\w$])(?:${prefixes.join('|')})$`, 'i');
export const Q_PREFIX = prefixRegex(['Q', 'NQ']);
/**
 * The rest of an Oracle q-string from its opening quote, following
 * sql-formatter's own pattern (`.` stops at the end of the line).
 */
export const Q_STRING = /^'(?:<(?:(?!>').)*?>|\[(?:(?!\]').)*?\]|\((?:(?!\)').)*?\)|\{(?:(?!\}').)*?\}|([^\s<[({])(?:(?!\1').)*?\1)'/u;

export function syntaxFor(language) {
  const syntax = { ...DEFAULT_SYNTAX, ...SYNTAX[language] };
  if (syntax.rawPrefixes) {
    syntax.rawPrefix = Object.fromEntries(
      Object.entries(syntax.rawPrefixes).map(([quote, prefixes]) => [quote, prefixRegex(prefixes)]),
    );
  }
  return syntax;
}
