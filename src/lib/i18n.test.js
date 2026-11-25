import { describe, it, expect } from 'vitest';
import { TRANSLATIONS, groupLabel, dialectLabel } from './i18n.js';
import { DIALECTS, DIALECT_GROUPS } from './constants.js';

const LOCALES = Object.keys(TRANSLATIONS);

describe('TRANSLATIONS', () => {
  const jaKeys = Object.keys(TRANSLATIONS.ja).sort();
  const enKeys = Object.keys(TRANSLATIONS.en).sort();

  it('ja and en have exactly the same keys', () => {
    expect(jaKeys).toEqual(enKeys);
  });

  it('all ja values are non-empty strings', () => {
    for (const [key, val] of Object.entries(TRANSLATIONS.ja)) {
      expect(typeof val, `ja.${key}`).toBe('string');
      expect(val.length, `ja.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('all en values are non-empty strings', () => {
    for (const [key, val] of Object.entries(TRANSLATIONS.en)) {
      expect(typeof val, `en.${key}`).toBe('string');
      expect(val.length, `en.${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('contains the expected locale keys', () => {
    expect(TRANSLATIONS).toHaveProperty('ja');
    expect(TRANSLATIONS).toHaveProperty('en');
    expect(Object.keys(TRANSLATIONS)).toHaveLength(2);
  });
});

describe('groupLabel', () => {
  it.each(LOCALES)('translates every dialect group in %s', (locale) => {
    for (const group of DIALECT_GROUPS) {
      const label = groupLabel(TRANSLATIONS[locale], group.key);
      expect(label, `${locale}: no label for group "${group.key}"`).not.toBe(group.key);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the key for a group that has no entry', () => {
    expect(groupLabel(TRANSLATIONS.ja, 'nonsense')).toBe('nonsense');
  });
});

describe('dialectLabel', () => {
  it.each(LOCALES)('gives every dialect a name in %s', (locale) => {
    for (const d of DIALECTS) {
      expect(dialectLabel(TRANSLATIONS[locale], d).length, `${locale}: ${d.value}`)
        .toBeGreaterThan(0);
    }
  });

  it('never shows a bare dialect identifier', () => {
    for (const locale of LOCALES) {
      for (const d of DIALECTS) {
        expect(dialectLabel(TRANSLATIONS[locale], d), `${locale}: ${d.value}`).not.toBe(d.value);
      }
    }
  });

  it('translates the dialects that are not product names', () => {
    expect(dialectLabel(TRANSLATIONS.ja, { value: 'sql', label: 'Standard SQL' })).toBe('標準 SQL');
    expect(dialectLabel(TRANSLATIONS.en, { value: 'sql', label: 'Standard SQL' })).toBe('Standard SQL');
  });

  it('keeps the product name where there is no translation', () => {
    const mysql = DIALECTS.find(d => d.value === 'mysql');
    for (const locale of LOCALES) {
      expect(dialectLabel(TRANSLATIONS[locale], mysql)).toBe('MySQL');
    }
  });
});
