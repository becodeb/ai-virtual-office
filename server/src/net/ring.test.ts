import { describe, expect, it } from 'vitest';
import { DeltaRing } from './ring.js';

describe('DeltaRing', () => {
  it('assigns increasing seq numbers starting at 1', () => {
    const ring = new DeltaRing(8);
    expect(ring.push([]).seq).toBe(1);
    expect(ring.push([]).seq).toBe(2);
    expect(ring.currentSeq).toBe(2);
  });

  it('replays the exact gap when lastSeq is still within the ring', () => {
    const ring = new DeltaRing(8);
    const op = { op: 'agent_state', agentId: 'a1', state: 'SEATED_IDLE' } as const;
    ring.push([op]);
    ring.push([op]);
    ring.push([op]);
    const replay = ring.replaySince(1);
    expect(replay).not.toBeNull();
    expect(replay!.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('returns an empty replay when the client is already current', () => {
    const ring = new DeltaRing(8);
    ring.push([]);
    expect(ring.replaySince(1)).toEqual([]);
  });

  it('forces a full snapshot (returns null) when lastSeq has fallen out of the ring', () => {
    const ring = new DeltaRing(4);
    for (let i = 0; i < 10; i++) ring.push([]);
    expect(ring.replaySince(1)).toBeNull();
  });

  it('forces a full snapshot when lastSeq is ahead of the current seq (invalid/future)', () => {
    const ring = new DeltaRing(8);
    ring.push([]);
    expect(ring.replaySince(999)).toBeNull();
  });
});
