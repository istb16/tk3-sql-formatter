import { describe, it, expect } from 'vitest';
import { format, supportedDialects } from 'sql-formatter';
import {
  DIALECTS,
  DIALECT_GROUPS,
  DEFAULT_DIALECT,
  SAMPLE_SQL,
  normalizeDialect,
  sampleFor,
} from './constants.js';

/** `tsql` is sql-formatter's alias for `transactsql`; only one is listed. */
const ALIASES = { tsql: 'transactsql' };

describe('DIALECTS', () => {
  it('every entry has a non-empty value and label', () => {
    for (const d of DIALECTS) {
      expect(typeof d.value, `${d.value}.value`).toBe('string');
      expect(d.value.length, `empty value`).toBeGreaterThan(0);
      expect(typeof d.label, `${d.value}.label`).toBe('string');
      expect(d.label.length, `empty label for ${d.value}`).toBeGreaterThan(0);
    }
  });

  it('lists no value twice', () => {
    const values = DIALECTS.map(d => d.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('covers every dialect sql-formatter supports, aliases aside', () => {
    const expected = [...new Set(supportedDialects.map(d => ALIASES[d] ?? d))].sort();
    expect(DIALECTS.map(d => d.value).sort()).toEqual(expected);
  });

  it('lists neither alias of a dialect', () => {
    const values = DIALECTS.map(d => d.value);
    for (const alias of Object.keys(ALIASES)) {
      expect(values, `"${alias}" is an alias and should not be listed`).not.toContain(alias);
    }
  });

  it('every value is one sql-formatter accepts', () => {
    for (const d of DIALECTS) {
      expect(() => format('select 1', { language: d.value })).not.toThrow();
    }
  });

  it('is the groups flattened, in order', () => {
    expect(DIALECTS).toEqual(DIALECT_GROUPS.flatMap(g => g.dialects));
  });

  it('every dialect carries the key of the group holding it', () => {
    for (const group of DIALECT_GROUPS) {
      expect(group.key.length, 'empty group key').toBeGreaterThan(0);
      expect(group.dialects.length, `empty group "${group.key}"`).toBeGreaterThan(0);
      for (const d of group.dialects) expect(d.group, `${d.value}.group`).toBe(group.key);
    }
  });

  it('DEFAULT_DIALECT is one of the listed dialects', () => {
    expect(DIALECTS.map(d => d.value)).toContain(DEFAULT_DIALECT);
  });
});

describe('normalizeDialect', () => {
  it('keeps a value that is in the list', () => {
    expect(normalizeDialect('bigquery')).toBe('bigquery');
    expect(normalizeDialect('plsql')).toBe('plsql');
  });

  it('falls back for a value that is not, including an alias', () => {
    expect(normalizeDialect('tsql')).toBe(DEFAULT_DIALECT);
    expect(normalizeDialect('oracle')).toBe(DEFAULT_DIALECT);
    expect(normalizeDialect('')).toBe(DEFAULT_DIALECT);
    expect(normalizeDialect(undefined)).toBe(DEFAULT_DIALECT);
    expect(normalizeDialect(null)).toBe(DEFAULT_DIALECT);
  });
});

describe('SAMPLE_SQL', () => {
  it('all values are non-empty strings', () => {
    for (const [dialect, sql] of Object.entries(SAMPLE_SQL)) {
      expect(typeof sql, `${dialect} sample`).toBe('string');
      expect(sql.trim().length, `${dialect} sample is empty`).toBeGreaterThan(0);
    }
  });

  it('has no key that is not a declared dialect', () => {
    const values = DIALECTS.map(d => d.value);
    for (const key of Object.keys(SAMPLE_SQL)) {
      expect(values, `SAMPLE_SQL has an unknown key "${key}"`).toContain(key);
    }
  });

  it('Oracle sample contains named bind variables', () => {
    expect(SAMPLE_SQL.plsql).toContain(':EMPLOYEE_ID');
    expect(SAMPLE_SQL.plsql).toContain(':STATUS');
    expect(SAMPLE_SQL.plsql).toContain(':COUNTRY_ID');
  });

  it('the BigQuery sample uses syntax only BigQuery parses', () => {
    expect(SAMPLE_SQL.bigquery).toContain('qualify');
    expect(SAMPLE_SQL.bigquery).toContain('offset(0)');
    expect(() => format(SAMPLE_SQL.bigquery, { language: 'bigquery' })).not.toThrow();
    expect(() => format(SAMPLE_SQL.bigquery, { language: 'postgresql' })).toThrow();
  });
});

describe('sampleFor', () => {
  it('returns the dialect’s own sample when it has one', () => {
    expect(sampleFor('mysql')).toBe(SAMPLE_SQL.mysql);
    expect(sampleFor('bigquery')).toBe(SAMPLE_SQL.bigquery);
  });

  it('falls back to the generic sample for a dialect without one', () => {
    expect(sampleFor('trino')).toBe(SAMPLE_SQL.sql);
    expect(sampleFor('nonsense')).toBe(SAMPLE_SQL.sql);
  });

  it('gives every dialect a sample that dialect can format', () => {
    for (const d of DIALECTS) {
      const sql = sampleFor(d.value);
      expect(sql.trim().length, `no sample for ${d.value}`).toBeGreaterThan(0);
      expect(() => format(sql, { language: d.value }), `${d.value} cannot format its sample`)
        .not.toThrow();
    }
  });
});
