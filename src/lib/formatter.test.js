import { describe, it, expect } from 'vitest';
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

    it('does not join across a line comment', () => {
      const result = formatSql(
        'SELECT id, -- 主キー\n name FROM users WHERE id = 1',
        { ...PG, compactLists: true }
      );
      expect(result).toMatch(/--.*\n/);
      expect(result.split('\n').filter((l) => /--/.test(l))).toHaveLength(1);
    });
  });
});
