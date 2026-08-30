import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityStore, defaultIdentityRecord } from './identity.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'office-identity-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('IdentityStore', () => {
  it('returns the default record for an unknown identity', () => {
    const store = new IdentityStore({ filePath: join(dir, 'identities.json') });
    expect(store.get('unknown')).toEqual(defaultIdentityRecord());
  });

  it('debounces disk writes: no file exists until the debounce elapses', () => {
    vi.useFakeTimers();
    const filePath = join(dir, 'identities.json');
    const store = new IdentityStore({ filePath, debounceMs: 5000 });

    store.incrementCoffeeCount('id-a');
    expect(existsSync(filePath)).toBe(false);

    vi.advanceTimersByTime(4999);
    expect(existsSync(filePath)).toBe(false);

    vi.advanceTimersByTime(1);
    expect(existsSync(filePath)).toBe(true);

    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written['id-a'].coffeeCount).toBe(1);
  });

  it('flush() writes immediately, bypassing the debounce (SIGTERM path)', () => {
    const filePath = join(dir, 'identities.json');
    const store = new IdentityStore({ filePath, debounceMs: 5000 });
    store.incrementCompletedTasks('id-b');
    store.flush();
    expect(existsSync(filePath)).toBe(true);
    const written = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(written['id-b'].completedTasks).toBe(1);
  });

  it('identity record survives a simulated hub restart', () => {
    const filePath = join(dir, 'identities.json');
    const first = new IdentityStore({ filePath, debounceMs: 5000 });
    first.update('id-c', { coffeeCount: 5, completedTasks: 2, rank: 1, skin: 'Suit_Male' });
    first.flush();

    // Simulate a fresh hub process: a brand-new store instance reading the same file.
    const second = new IdentityStore({ filePath, debounceMs: 5000 });
    expect(second.get('id-c')).toEqual({ coffeeCount: 5, completedTasks: 2, rank: 1, skin: 'Suit_Male' });
  });

  it('a corrupt identity file does not crash the store — starts fresh in memory', () => {
    const filePath = join(dir, 'identities.json');
    writeFileSync(filePath, '{not valid json', 'utf-8');
    const store = new IdentityStore({ filePath, debounceMs: 5000 });
    expect(store.get('anything')).toEqual(defaultIdentityRecord());
  });

  it('cancelPendingSave prevents a scheduled write (test hygiene helper)', () => {
    vi.useFakeTimers();
    const filePath = join(dir, 'identities.json');
    const store = new IdentityStore({ filePath, debounceMs: 5000 });
    store.incrementCoffeeCount('id-d');
    store.cancelPendingSave();
    vi.advanceTimersByTime(10_000);
    expect(existsSync(filePath)).toBe(false);
  });
});

describe('touch', () => {
  it('registers an unseen identity so its counters start from first sight', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'office-identity-')), 'identities.json');
    const store = new IdentityStore({ filePath: file, debounceMs: 0 });
    store.touch('idk-new');
    store.flush();
    expect(JSON.parse(readFileSync(file, 'utf-8'))['idk-new']).toBeDefined();
    store.cancelPendingSave();
  });

  it('leaves an existing record untouched', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'office-identity-')), 'identities.json');
    const store = new IdentityStore({ filePath: file, debounceMs: 0 });
    store.incrementCoffeeCount('idk-known');
    const before = store.get('idk-known');
    expect(store.touch('idk-known')).toEqual(before);
    store.cancelPendingSave();
  });
});
