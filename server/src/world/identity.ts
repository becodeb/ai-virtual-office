/**
 * Cross-restart identity persistence, per decision 1 and the world-state-hub
 * spec's cross-restart-persistence requirement.
 *
 * Only the small per-identity record (coffee count, completed tasks, rank,
 * skin) is persisted, debounced and flushed on `SIGTERM`. Live world state
 * (positions, in-memory agent state) is never written here and always
 * resets on restart — the hub simply never asks this store to hold it.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SkinName } from '@virtual-office/shared';

export interface IdentityRecord {
  coffeeCount: number;
  completedTasks: number;
  rank: number;
  skin: SkinName | null;
}

export function defaultIdentityRecord(): IdentityRecord {
  return { coffeeCount: 0, completedTasks: 0, rank: 0, skin: null };
}

type IdentityFile = Record<string, IdentityRecord>;

export interface IdentityStoreOptions {
  /** Path to the persisted JSON file. Defaults to `OFFICE_IDENTITY_PATH` env var, then `/data/identities.json`. */
  filePath?: string;
  /** Debounce delay, in ms, before a mutation is flushed to disk. Default 5000 (decision 1). */
  debounceMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

/**
 * In-memory identity table backed by a debounced JSON file. `get` always
 * returns a record (creating the default in memory, not on disk, until the
 * identity is actually mutated) so callers never need to null-check.
 */
export class IdentityStore {
  private readonly filePath: string;
  private readonly debounceMs: number;
  private records: IdentityFile = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(opts: IdentityStoreOptions = {}) {
    this.filePath = opts.filePath ?? process.env.OFFICE_IDENTITY_PATH ?? '/data/identities.json';
    this.debounceMs = opts.debounceMs ?? 5000;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') {
        this.records = parsed as IdentityFile;
      }
    } catch {
      // A corrupt identity file must never crash the hub; start fresh in memory.
      this.records = {};
    }
  }

  get(identityKey: string): IdentityRecord {
    return this.records[identityKey] ?? defaultIdentityRecord();
  }

  /**
   * Registers an identity the first time it is seen, so its coffee count and
   * completed tasks start accumulating from its very first event rather than
   * from whenever it first happens to earn one. Returns the existing record
   * untouched if there already is one, and schedules no write in that case.
   */
  touch(identityKey: string): IdentityRecord {
    const existing = this.records[identityKey];
    if (existing !== undefined) return existing;
    return this.update(identityKey, {});
  }

  /** Applies a partial update to `identityKey`'s record and schedules a debounced save. */
  update(identityKey: string, patch: Partial<IdentityRecord>): IdentityRecord {
    const current = this.records[identityKey] ?? defaultIdentityRecord();
    const next: IdentityRecord = { ...current, ...patch };
    this.records[identityKey] = next;
    this.scheduleSave();
    return next;
  }

  incrementCoffeeCount(identityKey: string): IdentityRecord {
    const current = this.get(identityKey);
    return this.update(identityKey, { coffeeCount: current.coffeeCount + 1 });
  }

  incrementCompletedTasks(identityKey: string): IdentityRecord {
    const current = this.get(identityKey);
    return this.update(identityKey, { completedTasks: current.completedTasks + 1 });
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  /** Immediately writes the current in-memory records to disk, bypassing the debounce. Safe to call on `SIGTERM`. */
  flush(): void {
    if (!this.dirty) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.records, null, 2), 'utf-8');
    this.dirty = false;
  }

  /** Cancels any pending debounce timer without flushing. Used in tests to avoid leaking timers. */
  cancelPendingSave(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
