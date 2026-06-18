import { describe, it, expect } from 'vitest';
import { DIALECTS, SAMPLE_SQL } from './constants.js';

describe('DIALECTS', () => {
  it('every entry has a non-empty value and label', () => {
    for (const d of DIALECTS) {
      expect(typeof d.value, `${d.value}.value`).toBe('string');
      expect(d.value.length, `empty value`).toBeGreaterThan(0);
      expect(typeof d.label, `${d.value}.label`).toBe('string');
      expect(d.label.length, `empty label for ${d.value}`).toBeGreaterThan(0);
    }
  });

  it('contains exactly the 5 supported dialects', () => {
    const values = DIALECTS.map(d => d.value);
    expect(values).toEqual(['mysql', 'postgresql', 'snowflake', 'plsql', 'transactsql']);
  });

  it('every dialect value has a corresponding SAMPLE_SQL entry', () => {
    for (const d of DIALECTS) {
      expect(SAMPLE_SQL, `SAMPLE_SQL missing key "${d.value}"`).toHaveProperty(d.value);
    }
  });
});

describe('SAMPLE_SQL', () => {
  it('all values are non-empty strings', () => {
    for (const [dialect, sql] of Object.entries(SAMPLE_SQL)) {
      expect(typeof sql, `${dialect} sample`).toBe('string');
      expect(sql.trim().length, `${dialect} sample is empty`).toBeGreaterThan(0);
    }
  });

  it('has no extra keys beyond the declared dialects', () => {
    const dialectValues = DIALECTS.map(d => d.value).sort();
    const sampleKeys = Object.keys(SAMPLE_SQL).sort();
    expect(sampleKeys).toEqual(dialectValues);
  });

  it('Oracle sample contains named bind variables', () => {
    expect(SAMPLE_SQL.plsql).toContain(':EMPLOYEE_ID');
    expect(SAMPLE_SQL.plsql).toContain(':STATUS');
    expect(SAMPLE_SQL.plsql).toContain(':COUNTRY_ID');
  });
});
