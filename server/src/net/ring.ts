/**
 * The 256-entry delta replay ring, per design.md §3. Keeps the last
 * `DELTA_RING_SIZE` broadcast deltas keyed by `seq` so a reconnecting
 * client can request a gap replay instead of a full snapshot rebuild —
 * unless the gap has already fallen out of the ring, in which case a full
 * snapshot is the only correct answer.
 */
import { DELTA_RING_SIZE, type DeltaOp } from '@virtual-office/shared';

export interface RingEntry {
  seq: number;
  ops: DeltaOp[];
}

export class DeltaRing {
  private readonly slots: Array<RingEntry | undefined>;
  private nextSeq = 1;

  constructor(private readonly capacity: number = DELTA_RING_SIZE) {
    this.slots = new Array(capacity);
  }

  /** The most recently issued sequence number, or 0 if nothing has been pushed yet. */
  get currentSeq(): number {
    return this.nextSeq - 1;
  }

  /** Records one delta and returns its assigned `seq`. */
  push(ops: DeltaOp[]): RingEntry {
    const entry: RingEntry = { seq: this.nextSeq, ops };
    this.slots[this.nextSeq % this.capacity] = entry;
    this.nextSeq += 1;
    return entry;
  }

  /**
   * Returns every delta after `lastSeq` up to {@link currentSeq}, or `null`
   * if `lastSeq` is not (or no longer) reconstructable from the ring — the
   * caller must then send a full snapshot instead of a partial replay.
   */
  replaySince(lastSeq: number): RingEntry[] | null {
    if (lastSeq < 0 || lastSeq > this.currentSeq) return null;
    if (lastSeq === this.currentSeq) return [];
    if (this.currentSeq - lastSeq > this.capacity) return null;

    const result: RingEntry[] = [];
    for (let seq = lastSeq + 1; seq <= this.currentSeq; seq++) {
      const entry = this.slots[seq % this.capacity];
      if (entry === undefined || entry.seq !== seq) return null;
      result.push(entry);
    }
    return result;
  }
}
