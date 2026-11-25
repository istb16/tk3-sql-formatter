import { describe, it, expect, vi } from 'vitest';
import { formatSql } from './formatter.js';

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

  it.each(['mysql', 'postgresql', 'snowflake', 'plsql', 'transactsql'])(
    'does not throw for dialect %s',
    (language) => {
      expect(() => formatSql('SELECT 1', { language, compactLists: false })).not.toThrow();
    }
  );

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

  // ── テンプレート構文 ──────────────────────────────────────────────────────
  // dbt / Jinja の {{ ... }} と MyBatis の #{...} / ${...} は、ignoreTemplates
  // が ON のときだけプレースホルダとして通す。中身は一字も変えないこと。
  describe('template placeholders (ignoreTemplates)', () => {
    const DBT_SQL =
      `SELECT a, b FROM {{ ref('orders') }} o WHERE o.d > '{{ var("start") }}' AND o.x = 1`;
    const MYBATIS_SQL =
      'SELECT * FROM t WHERE id = #{id} AND name LIKE #{name} AND k = ${raw}';
    const ON = { language: 'mysql', compactLists: false, keywordCase: 'upper', ignoreTemplates: true };
    const OFF = { ...ON, ignoreTemplates: false };

    it('formats dbt / Jinja SQL and keeps the placeholders as written', () => {
      const result = formatSql(DBT_SQL, ON);
      expect(result).toContain("{{ ref('orders') }}");
      expect(result).toContain('\'{{ var("start") }}\'');
      expect(result.split('\n').length).toBeGreaterThan(1);
      expect(result.replace(/\s+/g, ' ').trim()).toBe(
        `SELECT a, b FROM {{ ref('orders') }} o WHERE o.d > '{{ var("start") }}' AND o.x = 1`
      );
    });

    it('formats MyBatis SQL and keeps the placeholders as written', () => {
      const result = formatSql(MYBATIS_SQL, ON);
      expect(result).toContain('#{id}');
      expect(result).toContain('#{name}');
      expect(result).toContain('${raw}');
      expect(result.replace(/\s+/g, ' ').trim()).toBe(
        'SELECT * FROM t WHERE id = #{id} AND name LIKE #{name} AND k = ${raw}'
      );
    });

    it('breaks a MyBatis statement onto several lines instead of reading #{ as a comment', () => {
      // MySQL 系では # が行コメントなので、手当てがないと #{id} 以降が丸ごと
      // コメント扱いになり、1 行のまま整形されない。
      const lines = formatSql(MYBATIS_SQL, ON).split('\n');
      expect(lines.filter((l) => /^\s*AND\b/.test(l))).toHaveLength(2);
    });

    it.each([
      'mysql', 'postgresql', 'snowflake', 'plsql', 'transactsql',
      // # が行コメントになる方言。#{ のマスクはこれらのためにある。
      'mariadb', 'bigquery', 'clickhouse', 'n1ql',
    ])(
      'keeps MyBatis placeholders intact in dialect %s',
      (language) => {
        const result = formatSql(MYBATIS_SQL, { ...ON, language });
        expect(result).toContain('#{id}');
        expect(result).toContain('#{name}');
        expect(result).toContain('${raw}');
        // name は方言によってはキーワードとして大文字になるので、大小は問わない。
        // プレースホルダの中身は上の toContain で一字ずつ確かめている。
        expect(result.replace(/\s+/g, ' ').trim().toUpperCase()).toBe(
          'SELECT * FROM T WHERE ID = #{ID} AND NAME LIKE #{NAME} AND K = ${RAW}'
        );
      }
    );

    it('breaks a MyBatis statement onto several lines in BigQuery too', () => {
      const lines = formatSql(MYBATIS_SQL, { ...ON, language: 'bigquery' }).split('\n');
      expect(lines.filter((l) => /^\s*AND\b/.test(l))).toHaveLength(2);
    });

    it('does not fold the case of a placeholder body', () => {
      const result = formatSql(MYBATIS_SQL, {
        ...ON, identifierCase: 'upper', functionCase: 'upper',
      });
      expect(result).toContain('#{id}');
      expect(result).toContain('#{name}');
      expect(result).toContain('${raw}');
    });

    it('leaves the sentinel character out of the result', () => {
      for (const sql of [MYBATIS_SQL, DBT_SQL]) {
        const result = formatSql(sql, ON);
        expect(result).not.toContain('\u0001');
        expect(result).not.toMatch(/[-]/);
      }
    });

    it('keeps a sentinel character the SQL itself contains', () => {
      // #{ のマスクを戻す処理は U+0001 をすべて # にするので、もともと SQL に
      // 入っていた U+0001 まで書き換えてはいけない。Hive などの区切り文字で
      // 文字列リテラルに実際に現れる。
      const ddl = "CREATE TABLE t (a STRING) ROW FORMAT DELIMITED FIELDS TERMINATED BY '\u0001'";
      expect(formatSql(ddl, ON)).toContain("'\u0001'");
      expect(formatSql("SELECT '\u0001' AS a, b FROM t", ON)).toContain("'\u0001'");
    });

    it('masks #{...} even when the SQL already holds U+0001', () => {
      // 以前は U+0001 を含む SQL ではマスクを諦めていたため、MySQL では #{id}
      // 以降がコメント扱いになり、AND の改行も止まっていた。
      const sql = "SELECT '\u0001', a FROM t WHERE x = #{id} AND y = 2";
      expect(formatSql(sql, ON)).toBe(
        "SELECT\n  '\u0001',\n  a\nFROM\n  t\nWHERE\n  x = #{id}\n  AND y = 2"
      );
    });

    it('does not join SQL onto a #{...} that sql-formatter read as a comment', () => {
      // sql-formatter と lexLines で #{note} の読み方が食い違うと、閉じ括弧まで
      // コメントの中に連結される。今は両方ともプレースホルダとして読む。
      const sql = "SELECT '\u0001' FROM t WHERE (x = 1 #{note}\n AND y=2\n)";
      const result = formatSql(sql, { ...ON, compactLists: true });
      expect(result).toBe("SELECT '\u0001'\nFROM t\nWHERE (x = 1 #{note} AND y = 2)");
      expect(formatSql(result, { ...ON, compactLists: true })).toBe(result);
    });

    it.each(['mysql', 'postgresql'])(
      'keeps both U+0001 and a MyBatis placeholder in dialect %s',
      (language) => {
        const sql = "SELECT '\u0001', #{id}";
        expect(() => formatSql(sql, { ...ON, language })).not.toThrow();
        expect(formatSql(sql, { ...ON, language })).toBe("SELECT\n  '\u0001',\n  #{id}");
      }
    );

    it('picks another sentinel when the SQL already holds U+E000', () => {
      // 番兵は SQL に含まれない最初の私用領域の文字。U+E000 を番兵にすると、
      // マスクに見える文字列リテラルまで #{id} に戻されてしまう。
      expect(formatSql("SELECT '', #{id}", ON)).toBe("SELECT\n  '',\n  #{id}");
      expect(formatSql("SELECT '0_', #{id}", ON))
        .toBe("SELECT\n  '0_',\n  #{id}");
    });

    it('formats the SQL unmasked when every Private Use Area character is taken', () => {
      let all = '';
      for (let c = 0xe000; c <= 0xf8ff; c++) all += String.fromCharCode(c);
      // マスクに見える '0_' も、マスクしない以上そのまま残る。
      const sql = `SELECT '${all}', '0_' FROM t WHERE a = 1 #{id}`;
      const result = formatSql(sql, ON);
      expect(result).toBe(formatSql(sql, OFF));
      expect(result).toContain(`'${all}'`);
      expect(result).toContain("'0_'");
    });

    it('leaves a MySQL # comment that never closes its brace alone', () => {
      // #{ を必ずマスクすると、閉じない #{ を持つ行コメントが構文エラーになる。
      const sql = 'SELECT a FROM t #{unclosed note';
      expect(() => formatSql(sql, ON)).not.toThrow();
      expect(formatSql(sql, ON)).toContain('#{unclosed note');
    });

    it('reads an unclosed #{ as a comment without touching a later placeholder', () => {
      const sql = 'SELECT a FROM t #{open\nWHERE b = #{id}';
      expect(formatSql(sql, ON)).toBe('SELECT\n  a\nFROM\n  t #{open\nWHERE\n  b = #{id}');
    });

    it('treats a closed #{...} inside a MySQL # comment as part of the comment', () => {
      // 閉じた #{x} はプレースホルダとしてマスクされるが、その前の # c が
      // コメントを始めるので、行末までコメントのまま残る。
      const sql = 'SELECT a FROM t # c #{x}\nWHERE b = #{id}';
      expect(formatSql(sql, ON)).toBe('SELECT\n  a\nFROM\n  t # c #{x}\nWHERE\n  b = #{id}');
    });

    it('treats a closed #{...} as a placeholder even where MySQL reads # as a comment', () => {
      // オプションを ON にした以上、閉じた #{...} はコメントではなくプレース
      // ホルダとして扱う（CLAUDE.md に記載の仕様）。
      expect(formatSql('SELECT a, #{x} FROM t', ON)).toBe('SELECT\n  a,\n  #{x}\nFROM\n  t');
    });

    it('keeps a {{ ... }} inside a string that uses the same quote', () => {
      // 外側の文字列と同じ引用符を {{ }} の中で使っても、中身を SQL として
      // 読んではいけない（以前は var(' START_DATE ') になっていた）。
      const result = formatSql("SELECT '{{ var('start_date') }}'", {
        ...ON, language: 'postgresql', identifierCase: 'upper',
      });
      expect(result).toBe("SELECT\n  '{{ var('start_date') }}'");
    });

    it('does not end a {{ ... }} at a }} inside a quote or brackets', () => {
      const PG_ON = { ...ON, language: 'postgresql' };
      expect(formatSql("SELECT {{ var('x', '}}') }} AS x", PG_ON))
        .toBe("SELECT\n  {{ var('x', '}}') }} AS x");
      expect(formatSql("SELECT {{ {'a': {'b': 1}} }} AS x", PG_ON))
        .toBe("SELECT\n  {{ {'a': {'b': 1}} }} AS x");
    });

    it('does not end a {{ ... }} at a }} after a backslash-escaped quote', () => {
      expect(formatSql('SELECT {{ var("a\\"}}") }} AS x', ON))
        .toBe('SELECT\n  {{ var("a\\"}}") }} AS x');
    });

    it('ends a {{ ... }} that never balances at its first }}', () => {
      // 閉じないアポストロフィや括弧があっても、最初の }} で区切って次の
      // プレースホルダは別に扱う。
      expect(formatSql("SELECT {{ don't }} AS x, {{ y }} AS z", ON))
        .toBe("SELECT\n  {{ don't }} AS x,\n  {{ y }} AS z");
      expect(formatSql('SELECT {{ f( }} FROM t', ON)).toBe('SELECT\n  {{ f( }}\nFROM\n  t');
    });

    it('leaves a {{ with no }} anywhere as SQL', () => {
      // マスクされないので、オプション OFF と同じく SQL として解析される。
      expect(() => formatSql('SELECT {{ a', ON)).toThrow(/Parse error/);
      expect(formatSql("SELECT '{{ a' AS x", ON)).toBe("SELECT\n  '{{ a' AS x");
    });

    it('does not rescan the rest of the input for every {{ that never closes', () => {
      // }} が後ろに一つもない {{ が続いても、残りを毎回走査し直さない
      // （以前は 64 KB で約 6 秒かかっていた）。時間ではなく走査回数で確かめる。
      const sql = "SELECT '" + '{{'.repeat(2000) + "'";
      const indexOf = vi.spyOn(String.prototype, 'indexOf');
      let result;
      try {
        result = formatSql(sql, ON);
        expect(indexOf.mock.calls.filter(([s]) => s === '}}').length).toBeLessThanOrEqual(1);
      } finally {
        indexOf.mockRestore();
      }
      expect(result).toBe("SELECT\n  '" + '{{'.repeat(2000) + "'");
    });

    it.each([
      ['FROM log_${month}', 'SELECT a FROM log_${month} WHERE id = 1',
        'SELECT\n  a\nFROM\n  log_${month}\nWHERE\n  id = 1'],
      ['{{ prefix }}orders', 'SELECT a FROM {{ prefix }}orders WHERE id = 1',
        'SELECT\n  a\nFROM\n  {{ prefix }}orders\nWHERE\n  id = 1'],
      ["stg_{{ var('src') }}", "SELECT a FROM stg_{{ var('src') }} WHERE id=1",
        "SELECT\n  a\nFROM\n  stg_{{ var('src') }}\nWHERE\n  id = 1"],
      ['col_${n}', 'SELECT col_${n} FROM t', 'SELECT\n  col_${n}\nFROM\n  t'],
      ['pre_#{id}', 'SELECT a FROM t WHERE k = pre_#{id}',
        'SELECT\n  a\nFROM\n  t\nWHERE\n  k = pre_#{id}'],
      ['テーブル_${n}', 'SELECT a FROM テーブル_${n}', 'SELECT\n  a\nFROM\n  テーブル_${n}'],
    ])('does not split a name glued to a placeholder (%s)', (_, sql, expected) => {
      // 識別子にくっついたプレースホルダを別トークンにすると、間に空白が入り
      // テンプレート展開後の SQL が壊れる。
      expect(formatSql(sql, ON)).toBe(expected);
    });

    it('keeps placeholders glued to their neighbours', () => {
      expect(formatSql(
        "SELECT * FROM {{ schema }}.orders WHERE a LIKE '%${kw}%' AND b = #{id}::int",
        { ...ON, language: 'postgresql' },
      )).toBe("SELECT\n  *\nFROM\n  {{ schema }}.orders\nWHERE\n  a LIKE '%${kw}%'\n  AND b = #{id}::int");
      expect(formatSql(
        "SELECT {{ ref('a') }}::int, #{id}_suffix, {{ a }}{{ b }}, x_${a}${b}_y FROM t",
        { ...ON, language: 'postgresql' },
      )).toBe("SELECT\n  {{ ref('a') }}::int,\n  #{id}_suffix,\n  {{ a }}{{ b }},\n  x_${a}${b}_y\nFROM\n  t");
    });

    it('restores 10 or more placeholders, including ones shorter than their mask', () => {
      // 11 番目以降はマスクの番号が 2 桁になり、#{} はマスクより短い。
      const params = [...Array.from({ length: 11 }, (_, i) => `#{p${i}}`), '#{}', '{{}}'];
      const sql = `INSERT INTO t VALUES (${params.join(', ')})`;
      const result = formatSql(sql, ON);
      expect(result.match(/#\{[^}]*\}|\{\{\}\}/g)).toEqual(params);
      expect(result).not.toMatch(/[-]/);
    });

    it('keeps the dialect own custom parameters when the option is on', () => {
      // paramTypes.custom を渡すと方言側の custom 定義が置き換わってしまう。
      const ch = 'SELECT * FROM t WHERE id = {id:UInt64} AND x = #{x}';
      expect(formatSql(ch, { ...ON, language: 'clickhouse' })).toBe(
        'SELECT\n  *\nFROM\n  t\nWHERE\n  id = {id:UInt64}\n  AND x = #{x}'
      );
      const lite = 'SELECT * FROM t WHERE id = $name';
      expect(formatSql(lite, { ...ON, language: 'sqlite' }))
        .toBe(formatSql(lite, { ...OFF, language: 'sqlite' }));
    });

    it('keeps the placeholder shapes seen in real MyBatis and dbt files', () => {
      const sql = 'SELECT #{id,jdbcType=INTEGER}, #{user.name}, #{ id }, {{ a }} || {{ b }} FROM t';
      expect(formatSql(sql, ON)).toBe(
        'SELECT\n  #{id,jdbcType=INTEGER},\n  #{user.name},\n  #{ id },\n  {{ a }} || {{ b }}\nFROM\n  t'
      );
    });

    it.each([
      ['a quote', `SELECT a FROM t WHERE (x = {{ var("it's") }} AND y = 2)`,
        `WHERE (x = {{ var("it's") }} AND y = 2)`],
      ['--', 'SELECT a FROM t WHERE (x = #{a--b} AND y = 2)', 'WHERE (x = #{a--b} AND y = 2)'],
      ['/*', 'SELECT a FROM t WHERE (x = ${a/*b} AND y = 2)', 'WHERE (x = ${a/*b} AND y = 2)'],
      ['a quote next to it', "SELECT a FROM t WHERE (x = '{{ y }}' AND z = 2)",
        "WHERE (x = '{{ y }}' AND z = 2)"],
    ])('joins a block around a placeholder holding %s', (_, sql, line) => {
      // プレースホルダの中の ' や -- を SQL と読むと、以降が文字列やコメント
      // 扱いになり、この括弧は連結されなくなる。
      expect(formatSql(sql, { ...ON, compactLists: true }).split('\n')).toContain(line);
    });

    it.each([false, true])('formats its own output to the same thing (compactLists: %s)', (compactLists) => {
      const multiLine = 'SELECT a FROM t WHERE (x = {{ f(\n  1\n) }} AND y = 2)';
      for (const sql of [DBT_SQL, MYBATIS_SQL, multiLine]) {
        const once = formatSql(sql, { ...ON, compactLists });
        expect(formatSql(once, { ...ON, compactLists })).toBe(once);
      }
    });

    it('keeps the lines around a multi-line {{ ... }} in parentheses expanded', () => {
      const sql = 'SELECT a FROM t WHERE (x = {{ f(\n  1\n) }} AND y = 2)';
      expect(formatSql(sql, { ...ON, compactLists: true })).toBe(
        'SELECT a\nFROM t\nWHERE\n  (\n    x = {{ f(\n  1\n) }}\n    AND y = 2\n  )'
      );
    });

    it('sees a placeholder that starts on a backslash-escaped character', () => {
      // MySQL の '...' はバックスラッシュエスケープを取る。\ の次の文字を読み
      // 飛ばすと {{ の始まりを見落とし、中の ' で文字列が閉じたと誤認して
      // 括弧が連結されなくなる。
      const sql = `SELECT a FROM t WHERE (x = 'C:\\{{ v("it's") }}' AND y = 2)`;
      expect(formatSql(sql, { ...ON, compactLists: true })).toBe(
        `SELECT a\nFROM t\nWHERE (x = 'C:\\{{ v("it's") }}' AND y = 2)`
      );
    });

    it('keeps a multi-line {{ ... }} inside a string literal from being joined', () => {
      // 文字列の中で複数行にわたるプレースホルダの後も、文字列の外に戻って
      // 以降の括弧は連結される。
      const sql = "SELECT '{{ f(\n 1\n) }}' AS a, b FROM t WHERE (x = 1 AND y = 2)";
      expect(formatSql(sql, { ...ON, compactLists: true })).toBe(
        "SELECT\n  '{{ f(\n 1\n) }}' AS a,\n  b\nFROM t\nWHERE (x = 1 AND y = 2)"
      );
    });

    it('reads a placeholder sharing a line with the end of a multi-line one', () => {
      const sql = 'SELECT a FROM t WHERE (x = {{ f(\n 1\n) }} || {{ g }} AND y = 2) AND (p = 1 AND q = 2)';
      expect(formatSql(sql, { ...ON, compactLists: true })).toBe(
        'SELECT a\nFROM t\nWHERE\n  (\n    x = {{ f(\n 1\n) }} || {{ g }}\n    AND y = 2\n  )\n  AND (p = 1 AND q = 2)'
      );
    });

    it('keeps a multi-line {{ ... }} inside a line comment out of the SQL', () => {
      const sql = 'SELECT a -- {{ x\n}} y\nFROM t';
      expect(formatSql(sql, ON)).toBe('SELECT\n  a -- {{ x\n}} y\nFROM\n  t');
    });

    it('joins a block holding a MyBatis placeholder in compact mode', () => {
      // #{p} をコメントの始まりと誤認すると、この括弧は展開されたままになる。
      const result = formatSql('SELECT a FROM t WHERE (x = #{p} AND y = 2)', {
        ...ON, compactLists: true,
      });
      expect(result.split('\n')).toContain('WHERE (x = #{p} AND y = 2)');
    });

    it('keeps a {{ ... }} spanning lines as written', () => {
      const literal = '{{ config(\n  materialized = "table"\n) }}';
      const result = formatSql(`SELECT ${literal} AS x, y FROM t`, {
        ...ON, compactLists: true,
      });
      expect(result).toBe(`SELECT\n  ${literal} AS x,\n  y\nFROM t`);
    });

    it('still fails on template syntax when the option is off', () => {
      expect(() => formatSql(DBT_SQL, OFF)).toThrow();
      expect(() => formatSql(MYBATIS_SQL, { ...OFF, language: 'postgresql' })).toThrow();
    });

    it('does not change plain SQL when the option is on', () => {
      const sql = 'SELECT id, name FROM users WHERE id = 1';
      expect(formatSql(sql, ON)).toBe(formatSql(sql, OFF));
    });
  });
});
