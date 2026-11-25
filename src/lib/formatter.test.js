import { describe, it, expect } from 'vitest';
import { formatSql } from './formatter.js';
import { DIALECTS } from './constants.js';

const MYSQL = { language: 'mysql', compactLists: false };
const COMPACT = { language: 'mysql', compactLists: true, keywordCase: 'upper' };
const COMPACT_WIDE = { language: 'mysql', compactLists: true, keywordCase: 'upper', expressionWidth: 200 };

describe('formatSql', () => {
  it('returns empty string for empty input', () => {
    expect(formatSql('', MYSQL)).toBe('');
  });

  it('expands minified SQL onto multiple lines', () => {
    const result = formatSql('select id,name from users where id=1', MYSQL);
    expect(result.split('\n').length).toBeGreaterThan(1);
  });

  it('applies keywordCase upper', () => {
    const result = formatSql('select id from users', { ...MYSQL, keywordCase: 'upper' });
    expect(result).toContain('SELECT');
    expect(result).toContain('FROM');
    expect(result).not.toContain('select');
  });

  it('applies keywordCase lower', () => {
    const result = formatSql('SELECT ID FROM USERS', { ...MYSQL, keywordCase: 'lower' });
    expect(result).toContain('select');
    expect(result).toContain('from');
    expect(result).not.toContain('SELECT');
  });

  it('preserves Oracle named bind variables', () => {
    const result = formatSql(
      'SELECT * FROM employees WHERE id = :EMPLOYEE_ID AND status = :STATUS',
      { language: 'plsql', compactLists: false }
    );
    expect(result).toContain(':EMPLOYEE_ID');
    expect(result).toContain(':STATUS');
  });

  describe('compactLists: true (collapseParenBlocks + joinCompactLists)', () => {
    it('collapses EXTRACT(YEAR FROM date) onto a single line', () => {
      const result = formatSql('SELECT EXTRACT(YEAR FROM created_at) FROM orders', COMPACT);
      expect(result.split('\n').some(line => /EXTRACT\([^)]+\)/.test(line))).toBe(true);
    });

    it('joins SELECT comma list onto one line', () => {
      const result = formatSql('SELECT a, b, c FROM t', COMPACT);
      const selectLine = result.split('\n').find(l => l.trim().startsWith('SELECT'));
      expect(selectLine).toContain('a');
      expect(selectLine).toContain('b');
      expect(selectLine).toContain('c');
    });

    it('joins AND chain onto WHERE line', () => {
      const result = formatSql('SELECT 1 FROM t WHERE x = 1 AND y = 2 AND z = 3', COMPACT);
      const whereLine = result.split('\n').find(l => l.trim().startsWith('WHERE'));
      expect(whereLine).toBeDefined();
      expect(whereLine).toContain('x = 1');
      expect(whereLine).toContain('AND y = 2');
    });

    it('joins single child onto parent line', () => {
      const result = formatSql('SELECT COUNT(*) FROM t', COMPACT);
      const fromLine = result.split('\n').find(l => l.trim().startsWith('FROM'));
      expect(fromLine?.trim()).toBe('FROM t');
    });

    it('collapses short SELECT subquery when line fits in expressionWidth', () => {
      const result = formatSql(
        'SELECT amount FROM sales WHERE amount = (SELECT MAX(amount) FROM sales)',
        COMPACT_WIDE
      );
      const whereLine = result.split('\n').find(l => l.trim().startsWith('WHERE'));
      expect(whereLine).toMatch(/WHERE.*\(SELECT.*FROM sales\)/i);
    });

    it('does not collapse SELECT subquery when line exceeds expressionWidth', () => {
      const result = formatSql(
        "SELECT * FROM t WHERE id IN (SELECT id FROM very_long_table_name WHERE status = 'active')",
        COMPACT
      );
      expect(result.split('\n').some(l => /^\s+SELECT\b/.test(l))).toBe(true);
    });

    it('does not collapse CTE subquery regardless of expressionWidth', () => {
      const result = formatSql(
        'WITH cte AS (SELECT id, name FROM users) SELECT * FROM cte',
        COMPACT_WIDE
      );
      expect(result.split('\n').some(l => /^\s+SELECT\b/.test(l))).toBe(true);
    });

    it('produces no more lines than the expanded version', () => {
      const sql = 'SELECT a, b, c FROM t WHERE x = 1 AND y = 2';
      const compact = formatSql(sql, COMPACT);
      const expanded = formatSql(sql, { language: 'mysql', compactLists: false, keywordCase: 'upper' });
      expect(compact.split('\n').length).toBeLessThanOrEqual(expanded.split('\n').length);
    });

    it('joins nothing when expressionWidth leaves no room', () => {
      const sql = 'SELECT a, b, c FROM t';
      const narrow = formatSql(sql, { language: 'mysql', compactLists: false, keywordCase: 'upper', expressionWidth: 1 });
      const compact = formatSql(sql, { language: 'mysql', compactLists: true, keywordCase: 'upper', expressionWidth: 1 });
      expect(compact).toBe(narrow);
    });
  });

  // ── 複雑な SQL ─────────────────────────────────────────────────────────────
  // ネスト・CTE・副問い合わせを含む SQL でも構造が崩れないことを確認する。
  describe('complex SQL', () => {
    const COMPLEX = {
      'multi-stage CTE with window function': `
        WITH base AS (SELECT o.id, o.customer_id, o.total FROM orders o WHERE o.status <> 'CANCELLED'),
        agg AS (SELECT customer_id, COUNT(*) AS cnt, SUM(total) AS amount FROM base GROUP BY customer_id)
        SELECT c.name, a.cnt, RANK() OVER (PARTITION BY c.region ORDER BY a.amount DESC) AS rnk
        FROM agg a JOIN customers c ON c.id = a.customer_id WHERE a.cnt > 3 ORDER BY rnk`,

      'correlated subqueries at several depths': `
        SELECT u.id, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS n
        FROM users u
        WHERE EXISTS (SELECT 1 FROM budgets b WHERE b.user_id = u.id
          AND b.amount > (SELECT AVG(amount) FROM budgets WHERE region = u.region))`,

      'derived tables three levels deep': `
        SELECT x.* FROM (SELECT y.*, y.a + y.b AS total FROM (SELECT z.id, SUM(z.qty) AS a, SUM(z.price) AS b
        FROM (SELECT item_id AS id, qty, price FROM order_lines WHERE qty > 0) z GROUP BY z.id) y
        WHERE y.a > 10) x ORDER BY x.total DESC`,

      'nested CASE expressions': `
        SELECT id, CASE WHEN type = 'A' THEN CASE WHEN score > 90 THEN 'A+' ELSE 'A-' END
        WHEN type = 'B' THEN 'B' ELSE 'N/A' END AS grade FROM assessments`,

      'function call broken on a clause keyword': `
        SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers
        WHERE country IN ('JP', 'US') AND created_at < EXTRACT(YEAR FROM CURRENT_DATE))`,
    };

    const PG = { language: 'postgresql', keywordCase: 'upper', expressionWidth: 60 };
    const names = Object.keys(COMPLEX);
    const squash = (s) => s.replace(/\s+/g, '').toLowerCase();
    const orphanCloses = (s) => s.split('\n').filter((l) => /^\s*\)[,;]?\s*$/.test(l)).length;

    describe.each(names)('%s', (name) => {
      const sql = COMPLEX[name];
      const expanded = formatSql(sql, { ...PG, compactLists: false });
      const compact = formatSql(sql, { ...PG, compactLists: true });

      it.each([
        ['expanded', expanded],
        ['compact', compact],
      ])('keeps every token in the %s output', (_mode, result) => {
        expect(squash(result)).toBe(squash(sql));
      });

      it.each([
        ['expanded', expanded, false],
        ['compact', compact, true],
      ])('is idempotent in the %s output', (_mode, result, compactLists) => {
        expect(formatSql(result, { ...PG, compactLists })).toBe(result);
      });

      it('never leaves a gap after an opening paren', () => {
        // `ranked AS ( SELECT` — a child pulled onto the line that opens a block.
        expect(compact.split('\n').filter((l) => /\(\s+\S/.test(l))).toEqual([]);
      });

      it('keeps joined lines within expressionWidth', () => {
        // 連結してできた行は上限を超えない。上限を超える行は、展開した出力にも
        // そのままある行（それ以上分割できない式）だけ。
        const fromExpanded = new Set(expanded.split('\n').map((l) => l.trim()));
        const tooLong = compact
          .split('\n')
          .filter((l) => l.length > PG.expressionWidth && !fromExpanded.has(l.trim()));
        expect(tooLong).toEqual([]);
      });

      it('does not strand more closing parens than the expanded output', () => {
        expect(orphanCloses(compact)).toBeLessThanOrEqual(orphanCloses(expanded));
      });
    });

    it('collapses a CASE expression that fits onto one line', () => {
      const result = formatSql("SELECT id, CASE WHEN s > 90 THEN 'A' ELSE 'B' END AS grade FROM t", {
        ...PG, compactLists: true,
      });
      expect(result).toContain("CASE WHEN s > 90 THEN 'A' ELSE 'B' END AS grade");
    });

    it('starts a CASE expression that does not fit on its own line', () => {
      const result = formatSql(
        "SELECT id, CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' ELSE 'C' END AS grade FROM t",
        { ...PG, compactLists: true }
      );
      const lines = result.split('\n');
      const caseLine = lines.findIndex((l) => l.trim() === 'CASE');
      expect(caseLine).toBeGreaterThan(-1);
      // WHEN / ELSE は字下げされ、END は CASE と同じ桁に戻る。
      expect(lines[caseLine + 1]).toMatch(/^\s+WHEN score >= 90 THEN 'A'$/);
      const indent = (l) => l.search(/\S/);
      const endLine = lines.find((l) => l.trim().startsWith('END'));
      expect(indent(endLine)).toBe(indent(lines[caseLine]));
    });

    it('collapses a nested function call inside a subquery that stays expanded', () => {
      // 外側の IN (...) が展開されたままでも、内側の EXTRACT は 1 行に畳む。
      const result = formatSql(COMPLEX['function call broken on a clause keyword'], {
        ...PG, compactLists: true,
      });
      expect(result).toContain('EXTRACT(YEAR FROM CURRENT_DATE)');
      expect(result.split('\n').some((l) => /^\s+SELECT id$/.test(l))).toBe(true);
    });

    it('keeps function arguments on one line without compactLists', () => {
      const result = formatSql('SELECT EXTRACT(YEAR FROM created_at) FROM orders', {
        ...PG, compactLists: false,
      });
      expect(result).toContain('EXTRACT(YEAR FROM created_at)');
    });

    /** コメント行の後ろの列が、コメントに飲み込まれず次の行以降に残っていること。 */
    const expectNotSwallowed = (result, marker, column) => {
      const lines = result.split('\n');
      const commentLine = lines.findIndex((l) => l.includes(marker));
      expect(commentLine).toBeGreaterThan(-1);
      expect(lines[commentLine]).not.toMatch(new RegExp(`\\b${column}\\b`));
      expect(lines.slice(commentLine + 1).some((l) => new RegExp(`\\b${column}\\b`).test(l))).toBe(true);
    };

    it('does not join across a line comment', () => {
      const result = formatSql(
        'SELECT id, -- 主キー\n name FROM users WHERE id = 1',
        { ...PG, compactLists: true }
      );
      expectNotSwallowed(result, '--', 'name');
    });

    it.each(['mysql', 'mariadb', 'tidb', 'singlestoredb'])(
      'does not join across a # comment in %s',
      (language) => {
        // `#` はコメントなので、連結すると後ろの列がコメントの中に消える。
        const result = formatSql('SELECT id, # 主キー\n name FROM users WHERE id = 1', {
          language, keywordCase: 'upper', expressionWidth: 60, compactLists: true,
        });
        expectNotSwallowed(result, '#', 'name');
      }
    );

    it('does not join across a // comment in Snowflake', () => {
      // Snowflake では `//` も行コメント。
      const result = formatSql('SELECT a, // メモ\n b FROM t', {
        language: 'snowflake', keywordCase: 'upper', expressionWidth: 60, compactLists: true,
      });
      expectNotSwallowed(result, '//', 'b');
    });

    it('treats # as an operator outside MySQL', () => {
      // PostgreSQL の #>> は演算子なので、これを理由に連結を止めてはいけない。
      const result = formatSql("SELECT id, payload #>> '{a,b}' AS v FROM events", {
        ...PG, compactLists: true,
      });
      expect(result.split('\n')[0]).toBe("SELECT id, payload #>> '{a,b}' AS v");
    });

    it('keeps a block comment that spans lines on its own lines', () => {
      const result = formatSql('SELECT a, /* これは\n   複数行の\n   コメント */ b FROM t', {
        ...PG, compactLists: true,
      });
      expect(result).toContain('/* これは\n');
      expect(result.split('\n').filter((l) => /これは|複数行の|コメント/.test(l))).toHaveLength(3);
    });

    it('leaves a long argument list wrapped as sql-formatter wrapped it', () => {
      // 節キーワードでの分割を戻すのは、引数そのものが幅に収まるときだけ。
      const result = formatSql(
        "SELECT GROUP_CONCAT(DISTINCT some_quite_long_column_name ORDER BY another_quite_long_column_name SEPARATOR ', ') FROM t",
        { language: 'mysql', keywordCase: 'preserve', expressionWidth: 50, compactLists: false }
      );
      expect(result).not.toContain('GROUP_CONCAT(DISTINCT');
      expect(Math.max(...result.split('\n').map((l) => l.length))).toBeLessThan(60);
    });

    it('rejoins a short function call however deeply it sits', () => {
      const result = formatSql(
        "SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE country IN ('JP', 'US') AND created_at < EXTRACT(YEAR FROM CURRENT_DATE))",
        { ...PG, compactLists: false }
      );
      expect(result).toContain('EXTRACT(YEAR FROM CURRENT_DATE)');
    });

    it('measures a tab indent by the columns it takes up', () => {
      const sql =
        'SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.id = t.id AND u.flag' +
        ' AND EXISTS (SELECT 1 FROM v WHERE v.id = u.id AND v.x = 1))';
      const result = formatSql(sql, {
        ...PG, compactLists: true, useTabs: true, tabWidth: 8,
      });
      // タブ 5 段は 40 桁ぶんあるので、29 文字のこの行は幅 50 に収まらない。
      // 字数で数えていたときは 5 + 29 = 34 と判定して連結してしまっていた。
      expect(result).not.toContain('WHERE v.id = u.id AND v.x = 1');
      // 同じ深さでも、タブを使わなければ 5 + 29 = 34 桁なので連結する。
      const spaces = formatSql(sql, { ...PG, compactLists: true, tabWidth: 1 });
      expect(spaces).toContain('WHERE v.id = u.id AND v.x = 1');
    });

    it('measures full-width characters as two columns', () => {
      // 「WHERE name = '山田太郎' AND kana = 'ヤマダタロウ'」は 39 文字だが、
      // 全角 10 文字が 2 桁ずつなので画面上は 49 桁ある。
      const sql = "SELECT id, name FROM users WHERE name = '山田太郎' AND kana = 'ヤマダタロウ'";
      const joined = "WHERE name = '山田太郎' AND kana = 'ヤマダタロウ'";
      expect(formatSql(sql, { ...PG, compactLists: true, expressionWidth: 45 })).not.toContain(joined);
      expect(formatSql(sql, { ...PG, compactLists: true, expressionWidth: 49 })).toContain(joined);
    });

    it('measures only the argument list when rejoining a function call', () => {
      // 関数の引数を戻すときは引数の長さだけを測るので、深い位置では行全体が
      // expressionWidth を超えることがある（意図した動作）。
      const sql =
        'SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.id = t.id' +
        ' AND EXISTS (SELECT 1 FROM v WHERE v.d = EXTRACT(YEAR FROM CURRENT_DATE)))';
      const result = formatSql(sql, { ...PG, compactLists: true, expressionWidth: 30 });
      const line = result.split('\n').find((l) => l.includes('EXTRACT('));
      expect(line.trim()).toBe('v.d = EXTRACT(YEAR FROM CURRENT_DATE)');
      expect(line.length).toBeGreaterThan(30);
    });

    it.each([
      ['SUBSTRING … FROM … FOR', 'SELECT SUBSTRING(s FROM 1 FOR 2) AS x FROM t', 'SUBSTRING(s FROM 1 FOR 2) AS x'],
      ['CAST … AS', 'SELECT CAST(x AS INT) AS y FROM t', 'CAST(x AS INT) AS y'],
      ['POSITION … IN', 'SELECT POSITION(a IN b) AS p FROM t', 'POSITION(a IN b) AS p'],
      ['EXTRACT … FROM', 'SELECT EXTRACT(YEAR FROM d) AS y FROM t', 'EXTRACT(YEAR FROM d) AS y'],
    ])('keeps %s arguments on one line', (_name, sql, expected) => {
      const result = formatSql(sql, { ...PG, compactLists: false });
      expect(result.split('\n')[1]).toBe(`  ${expected}`);
    });

    it('does not treat IN or a window ORDER BY as function arguments', () => {
      const result = formatSql(
        'SELECT ROW_NUMBER() OVER (PARTITION BY a ORDER BY b) AS rn FROM t WHERE x IN (1, 2, 3)',
        { ...PG, compactLists: false }
      );
      // OVER ( ... ) は関数呼び出しではないので、展開モードではそのまま。
      expect(result).toBe(
        [
          'SELECT',
          '  ROW_NUMBER() OVER (',
          '    PARTITION BY',
          '      a',
          '    ORDER BY',
          '      b',
          '  ) AS rn',
          'FROM',
          '  t',
          'WHERE',
          '  x IN (1, 2, 3)',
        ].join('\n')
      );
    });

    it('joins each statement on its own and keeps the blank line between them', () => {
      const result = formatSql('SELECT a, b FROM t;\n\nSELECT c, d FROM u WHERE c = 1', {
        ...PG, compactLists: true,
      });
      expect(result).toBe('SELECT a, b\nFROM t;\n\nSELECT c, d\nFROM u\nWHERE c = 1');
    });

    it('defaults expressionWidth to 50 and tabWidth to 2', () => {
      const sql = "SELECT id, name, email FROM users WHERE id = 1 AND status = 'active'";
      const base = { language: 'postgresql', keywordCase: 'upper', compactLists: true };
      const byDefault = formatSql(sql, base);
      expect(byDefault).toBe(formatSql(sql, { ...base, expressionWidth: 50 }));
      expect(byDefault).not.toBe(formatSql(sql, { ...base, expressionWidth: 20 }));

      // タブ 5 段 + 29 文字は、タブ幅 2 なら 39 桁で幅 50 に収まる。
      const deep =
        'SELECT a FROM t WHERE EXISTS (SELECT 1 FROM u WHERE u.id = t.id AND u.flag' +
        ' AND EXISTS (SELECT 1 FROM v WHERE v.id = u.id AND v.x = 1))';
      expect(formatSql(deep, { ...base, useTabs: true })).toContain('WHERE v.id = u.id AND v.x = 1');
      expect(formatSql(deep, { ...base, useTabs: true, tabWidth: 8 })).not.toContain('WHERE v.id = u.id AND v.x = 1');
    });
  });

  // ── 文字列リテラルとコメント ───────────────────────────────────────────────
  // 連結によってリテラルの値が変わったり、コメントが後ろの式を飲み込んだり
  // しないことを確認する。squash() は空白をすべて消すので、リテラル内部の
  // 空白の変化は見えない。ここではリテラルそのものの文字列を比較する。
  describe('literals and comments', () => {
    const PG = { language: 'postgresql', keywordCase: 'upper', expressionWidth: 60, compactLists: true };

    it.each([
      ['a quoted string', "'a\nb\n  c\n   d\ne'"],
      ['a dollar-quoted string', '$$hello\n  world\n  again$$'],
      ['a tagged dollar-quoted string', '$body$\n  BEGIN\n    RETURN 1;\n  END\n$body$'],
    ])('keeps %s spanning lines exactly as written', (_name, literal) => {
      const sql = `SELECT ${literal} AS x, y FROM t`;
      const result = formatSql(sql, PG);
      expect(result).toContain(literal);
      // リテラルの外も壊れていないこと。リテラルを伏せ字にして比べる。
      const mask = (s) => s.split(literal).join('<LIT>').replace(/\s+/g, ' ').trim();
      expect(mask(result)).toBe('SELECT <LIT> AS x, y FROM t');
      expect(formatSql(result, PG)).toBe(result);
    });

    it('keeps indented JSON inside a string literal as written', () => {
      const json = "'{\n  \"a\": {\n    \"b\": 1\n  }\n}'";
      const result = formatSql(`INSERT INTO t (id, doc) VALUES (1, ${json})`, PG);
      expect(result).toContain(json);
    });

    it('keeps a dollar-quoted string in Snowflake', () => {
      const literal = '$$hello\n  world\n  again$$';
      const result = formatSql(`SELECT ${literal} AS a, b FROM t`, {
        ...PG, language: 'snowflake',
      });
      expect(result).toContain(literal);
    });

    it('joins lines around a string that only looks like a comment', () => {
      // 文字列の中の -- はコメントではないので、連結を止めない。
      const result = formatSql("SELECT 'a--b' AS a, 'it''s' AS b, c FROM t", PG);
      expect(result.split('\n')[0]).toBe("SELECT 'a--b' AS a, 'it''s' AS b, c");
    });

    it('does not join across a comment after a doubled quote', () => {
      const result = formatSql("SELECT 'it''s' AS a, -- c\n b FROM t", PG);
      expect(result).toContain("'it''s' AS a, -- c");
      expect(result.split('\n').find((l) => l.includes('--'))).not.toMatch(/\bb\b/);
    });

    it('does not join across a comment after a backslash-escaped quote in MySQL', () => {
      // \' を引用符の終わりと読むと、後ろの -- が文字列の中にあると誤認する。
      const result = formatSql("SELECT 'O\\'Brien' AS a, -- c\n b FROM t", {
        ...PG, language: 'mysql',
      });
      const lines = result.split('\n');
      const commentLine = lines.find((l) => l.includes('--'));
      expect(commentLine.trim()).toBe("'O\\'Brien' AS a, -- c");
      expect(lines.slice(lines.indexOf(commentLine) + 1).some((l) => l.trim() === 'b')).toBe(true);
    });
  });

  describe('per-dialect lexing', () => {
    const BASE = { keywordCase: 'upper', expressionWidth: 60, compactLists: true };
    const opts = (language) => ({ ...BASE, language });

    /** `b` が連結されずに次の行に残っていること = コメントが認識されていること。 */
    const stopsAtComment = (result, comment) => {
      const lines = result.split('\n');
      const commentLine = lines.find((l) => l.includes(comment));
      expect(commentLine, `no ${comment} comment in:\n${result}`).toBeDefined();
      expect(commentLine).not.toMatch(/\bb\b\s*$/);
      expect(lines.slice(lines.indexOf(commentLine) + 1).some((l) => l.trim() === 'b')).toBe(true);
    };

    it.each(DIALECTS.map((d) => d.value))('does not throw for dialect %s', (language) => {
      expect(() => formatSql('SELECT 1', { language, compactLists: false })).not.toThrow();
    });

    it.each([
      ['mysql', '#'],
      ['mariadb', '#'],
      ['tidb', '#'],
      ['singlestoredb', '#'],
      ['bigquery', '#'],
      ['clickhouse', '#'],
      ['n1ql', '#'],
      ['snowflake', '//'],
      ['sql', '--'],
      ['trino', '--'],
    ])('reads %s as a line comment in %s', (language, comment) => {
      stopsAtComment(formatSql(`SELECT a, ${comment} c\n b FROM t`, opts(language)), comment);
    });

    it('does not read # as a comment in PostgreSQL', () => {
      // PostgreSQL の #> は JSON 演算子なので、コメントとして扱ってはいけない。
      const result = formatSql("SELECT doc #> '{a}' AS a, b FROM t", opts('postgresql'));
      expect(result.split('\n')[0]).toBe("SELECT doc #> '{a}' AS a, b");
    });

    // \' を引用符の終わりと読むと、その後ろの -- が文字列の外に見えてしまい、
    // 行コメントだと誤認して連結が止まる。1 行に収まることで正しさを確かめる。
    it.each([
      ['sql', "'O\\'Brien--x'"],
      ['spark', "'O\\'Brien--x'"],
      ['hive', "'O\\'Brien--x'"],
      ['bigquery', "'O\\'Brien--x'"],
      ['mysql', "'O\\'Brien--x'"],
      ['duckdb', "E'O\\'Brien--x'"],
    ])('honours backslash-escaped quotes in %s', (language, literal) => {
      const result = formatSql(
        `SELECT ${literal} AS a, bbbbbbbb, cccccccc FROM t`,
        opts(language)
      );
      expect(result.split('\n')[0]).toBe(`SELECT ${literal} AS a, bbbbbbbb, cccccccc`);
    });

    it('does not treat a backslash as an escape where the dialect has none', () => {
      // Trino の '' は \ を escape として扱わないので、そもそも構文エラーになる。
      expect(() => formatSql("SELECT 'O\\'Brien' AS a FROM t", opts('trino'))).toThrow();
    });

    it('keeps a dollar-quoted string spanning lines in DuckDB', () => {
      const literal = '$$hello\n  world$$';
      const result = formatSql(`SELECT ${literal} AS x, y FROM t`, opts('duckdb'));
      expect(result).toContain(literal);
    });

    it.each(['postgresql', 'transactsql', 'db2i', 'duckdb'])(
      'keeps a nested block comment spanning lines in %s',
      (language) => {
        const comment = '/* a\n  /* b */\n  c */';
        const result = formatSql(`SELECT ${comment} x, y FROM t`, opts(language));
        expect(result).toContain(comment);
      }
    );

    it.each(["'''", '"""'])('keeps a %s string spanning lines in BigQuery', (q) => {
      const literal = `${q}hello\n  world${q}`;
      const result = formatSql(`SELECT ${literal} AS x, y FROM t`, opts('bigquery'));
      expect(result).toContain(literal);
      expect(result.split('\n').pop()).toBe('FROM t');
    });

    it('reads a quote inside a triple-quoted BigQuery string as part of it', () => {
      // ''' を ' が 3 つと読むと、中の ' が引用符の開始に見えて行末まで文字列が続く。
      const result = formatSql("SELECT '''it's''' AS x, y FROM t", opts('bigquery'));
      expect(result.split('\n')[0]).toBe("SELECT '''it's''' AS x, y");
    });

    it('does not mistake an empty string for a triple quote in BigQuery', () => {
      const result = formatSql("SELECT '' AS x, -- c\n y FROM t", opts('bigquery'));
      expect(result).toContain("'' AS x, -- c");
      expect(result.split('\n').some((l) => l.trim() === 'y')).toBe(true);
    });

    it('formats the BigQuery query from issue #10', () => {
      const sql =
        'SELECT a.* FROM `proj.ds.tbl` a\n' +
        'WHERE DATE(ts) = CURRENT_DATE() AND a.arr[OFFSET(0)] = 1\n' +
        'QUALIFY ROW_NUMBER() OVER (PARTITION BY a.id ORDER BY ts DESC) = 1';
      const result = formatSql(sql, opts('bigquery'));
      expect(result).toContain('`proj.ds.tbl`');
      expect(result).toContain('QUALIFY');
      expect(result).toContain('OFFSET(0)');
      expect(() => formatSql(sql, opts('postgresql'))).toThrow();
    });
  });
});
