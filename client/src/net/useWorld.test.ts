/**
 * WS client harness (task 4.4's "RED integration test (ws harness)"): a fake
 * `WebSocketLike` injected via `useWorld`'s factory parameter drives the
 * hook through connect -> snapshot -> deltas -> forced drop -> reconnect
 * with `lastSeq` -> replay, and a `lastSeq` outside the ring -> full
 * snapshot. A live server harness lives in `pnpm --filter client dev`
 * against a running server from Unit 2 (tasks.md's runtime harness column);
 * this test exercises the same protocol contract without spinning the real
 * hub, since `server/` is a separate workspace this package must not import.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerFrame } from '@virtual-office/shared';
import { useWorldStore } from '../state/store.js';
import { useWorld, type WebSocketFactory, type WebSocketLike } from './useWorld.js';

class FakeWebSocket implements WebSocketLike {
  readyState = 0; // CONNECTING
  sent: string[] = [];
  onopen: WebSocketLike['onopen'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onmessage: WebSocketLike['onmessage'] = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.call(this, undefined);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.call(this, undefined);
  }
  receive(frame: ServerFrame): void {
    this.onmessage?.call(this, { data: JSON.stringify(frame) });
  }
  lastSentFrame(): unknown {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

function snapshotFrame(seq: number): ServerFrame {
  return {
    t: 'snapshot',
    seq,
    world: { layout: {}, props: [], desks: [], agents: [], npcs: [], hud: {} },
  };
}

describe('useWorld (WS client harness)', () => {
  let sockets: FakeWebSocket[];
  let factory: WebSocketFactory;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets = [];
    factory = () => {
      const ws = new FakeWebSocket();
      sockets.push(ws);
      return ws;
    };
    useWorldStore.getState().resetWorld();
    useWorldStore.setState({ connectionStatus: 'connecting' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connect -> snapshot -> deltas -> forced drop -> reconnect with lastSeq -> replay', () => {
    const { unmount } = renderHook(() => useWorld(factory));

    expect(sockets).toHaveLength(1);
    act(() => sockets[0]!.open());
    expect(sockets[0]!.lastSentFrame()).toEqual({ t: 'hello', p: 'office.v1' });
    expect(useWorldStore.getState().connectionStatus).toBe('open');

    act(() => sockets[0]!.receive(snapshotFrame(1)));
    expect(useWorldStore.getState().seq).toBe(1);

    act(() => sockets[0]!.receive({ t: 'delta', seq: 2, ops: [] }));
    expect(useWorldStore.getState().seq).toBe(2);

    // Forced drop.
    act(() => sockets[0]!.close());
    expect(useWorldStore.getState().connectionStatus).toBe('reconnecting');
    expect(sockets).toHaveLength(1); // no immediate reconnect — backoff pending

    // Advance past the backoff window (500ms floor, up to +/-20% jitter).
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]!.open());
    // Reconnect must carry the last applied seq so the hub can replay from its ring.
    expect(sockets[1]!.lastSentFrame()).toEqual({ t: 'hello', p: 'office.v1', lastSeq: 2 });

    // "Replay" case: hub sends the missed delta directly (seq 3 continues cleanly from 2).
    act(() => sockets[1]!.receive({ t: 'delta', seq: 3, ops: [] }));
    expect(useWorldStore.getState().seq).toBe(3);

    unmount();
  });

  it('a lastSeq outside the ring makes the hub fall back to a full snapshot, which the client applies wholesale', () => {
    renderHook(() => useWorld(factory));
    act(() => sockets[0]!.open());
    act(() => sockets[0]!.receive(snapshotFrame(1)));

    // The hub decides server-side that `lastSeq` fell out of the ring and
    // sends a full snapshot instead of a delta replay — the client has no
    // special-case logic here, it just applies whatever frame arrives.
    act(() => sockets[0]!.receive(snapshotFrame(500)));
    expect(useWorldStore.getState().seq).toBe(500);
  });

  it('a mid-connection sequence gap triggers a client-initiated resync instead of applying a partial delta', () => {
    renderHook(() => useWorld(factory));
    act(() => sockets[0]!.open());
    act(() => sockets[0]!.receive(snapshotFrame(1)));

    // Expected seq 2, but a delta arrives at seq 5 (a gap — some deltas were lost).
    act(() => sockets[0]!.receive({ t: 'delta', seq: 5, ops: [] }));

    expect(useWorldStore.getState().seq).toBe(1); // the gapped delta was NOT applied
    expect(sockets[0]!.lastSentFrame()).toEqual({ t: 'resync' });

    // The hub answers the resync request with a fresh snapshot.
    act(() => sockets[0]!.receive(snapshotFrame(20)));
    expect(useWorldStore.getState().seq).toBe(20);
  });

  it('exponential backoff grows across repeated reconnect attempts, within documented bounds', () => {
    // Pin jitter to exactly the base delay (deterministic): random()=0.5 -> (0.5*2-1)=0 jitter offset.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    renderHook(() => useWorld(factory));
    act(() => sockets[0]!.close());
    expect(useWorldStore.getState().connectionStatus).toBe('reconnecting');

    // Attempt 0 backoff base: 500ms.
    act(() => vi.advanceTimersByTime(499));
    expect(sockets).toHaveLength(1);
    act(() => vi.advanceTimersByTime(2));
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]!.close());
    // Attempt 1 backoff base: 1000ms (500 * 2^1) — strictly greater than attempt 0's.
    act(() => vi.advanceTimersByTime(999));
    expect(sockets).toHaveLength(2);
    act(() => vi.advanceTimersByTime(2));
    expect(sockets).toHaveLength(3);

    randomSpy.mockRestore();
  });
});
