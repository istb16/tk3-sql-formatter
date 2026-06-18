import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings.js';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadSettings', () => {
  it('returns {} when storage is empty', () => {
    expect(loadSettings()).toEqual({});
  });

  it('returns parsed object for valid JSON', () => {
    localStorage.setItem('sql-formatter-settings', JSON.stringify({ lang: 'ja', dialect: 'mysql' }));
    expect(loadSettings()).toEqual({ lang: 'ja', dialect: 'mysql' });
  });

  it('returns {} for corrupt JSON', () => {
    localStorage.setItem('sql-formatter-settings', '{invalid json}');
    expect(loadSettings()).toEqual({});
  });

  it('returns {} when localStorage.getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('SecurityError');
    });
    expect(loadSettings()).toEqual({});
  });
});

describe('saveSettings', () => {
  it('stores settings as JSON under the correct key', () => {
    saveSettings({ lang: 'en', tabWidth: 4 });
    expect(localStorage.getItem('sql-formatter-settings')).toBe('{"lang":"en","tabWidth":4}');
  });

  it('round-trips: loadSettings returns what saveSettings stored', () => {
    const settings = { lang: 'ja', dialect: 'postgresql', compactLists: true };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it('does not throw when localStorage.setItem throws (e.g. quota exceeded)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveSettings({ key: 'value' })).not.toThrow();
  });

  it('does not throw for a circular object (JSON.stringify error)', () => {
    const circular = {};
    circular.self = circular;
    expect(() => saveSettings(circular)).not.toThrow();
  });
});
