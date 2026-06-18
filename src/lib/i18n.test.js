import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from './i18n.js';

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
