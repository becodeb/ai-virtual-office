/**
 * The WebSocket client (task 4.2). Owns the socket lifecycle: connects with
 * the `office.v1` subprotocol, sends `hello{p, lastSeq}`, applies every
 * frame through the store's reducer, detects delta gaps and requests a
 * `resync`, and reconnects with exponential backoff (500ms -> 8s, +/-20%
 * jitter) on close/error. This is the ONLY module allowed to write to
 * `useWorldStore` in response to network activity.
 */
import { useEffect, useRef } from 'react';
import { PROTOCOL_VERSION, type ClientFrame, type EggCode, type ServerFrame } from '@virtual-office/shared';
import { resolveHubWsUrl } from './config.js';
import { backoffDelayMs } from './backoff.js';
import { needsResync } from '../state/worldReducer.js';
import { useWorldStore } from '../state/store.js';

function parseServerFrame(raw: string): ServerFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { t?: unknown }).t !== 'string') {
      return null;
    }
    return parsed as ServerFrame;
  } catch {
    return null;
  }
}

export interface UseWorldControls {
  sendFocus: (agentId: string | null) => void;
  sendEgg: (code: EggCode) => void;
}

/** Minimal shape this module depends on from the socket, so tests can inject a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  onopen: ((this: WebSocketLike, ev: unknown) => void) | null;
  onclose: ((this: WebSocketLike, ev: unknown) => void) | null;
  onerror: ((this: WebSocketLike, ev: unknown) => void) | null;
  onmessage: ((this: WebSocketLike, ev: { data: string }) => void) | null;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url, protocols) => new WebSocket(url, protocols) as unknown as WebSocketLike;

/**
 * Connects to the hub and keeps `useWorldStore` in sync. `factory` is
 * injectable for tests (see `useWorld.test.ts`); production code never needs
 * to pass it.
 */
export function useWorld(factory: WebSocketFactory = defaultFactory): UseWorldControls {
  const socketRef = useRef<WebSocketLike | null>(null);
  const lastSeqRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function connect(): void {
      if (unmountedRef.current) return;
      useWorldStore.getState().setConnectionStatus(attemptRef.current === 0 ? 'connecting' : 'reconnecting');
      const ws = factory(resolveHubWsUrl(), [PROTOCOL_VERSION]);
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        const hello: ClientFrame =
          lastSeqRef.current === null
            ? { t: 'hello', p: PROTOCOL_VERSION }
            : { t: 'hello', p: PROTOCOL_VERSION, lastSeq: lastSeqRef.current };
        ws.send(JSON.stringify(hello));
        useWorldStore.getState().setConnectionStatus('open');
      };

      ws.onmessage = (ev) => {
        const frame = parseServerFrame(ev.data);
        if (frame === null) return;

        if (frame.t === 'delta') {
          if (needsResync(lastSeqRef.current, frame.seq)) {
            const resync: ClientFrame = { t: 'resync' };
            ws.send(JSON.stringify(resync));
            return; // Drop this delta — the incoming full snapshot supersedes it.
          }
        }
        if (frame.t === 'snapshot' || frame.t === 'delta') lastSeqRef.current = frame.seq;
        useWorldStore.getState().handleServerFrame(frame);
      };

      ws.onclose = () => scheduleReconnect();
      ws.onerror = () => scheduleReconnect();
    }

    function scheduleReconnect(): void {
      if (unmountedRef.current) return;
      useWorldStore.getState().setConnectionStatus('reconnecting');
      const delay = backoffDelayMs(attemptRef.current);
      attemptRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      unmountedRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      socketRef.current?.close();
      useWorldStore.getState().setConnectionStatus('closed');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `factory` is stable in production; tests pass a fresh one per render intentionally.
  }, [factory]);

  return {
    sendFocus: (agentId) => {
      const ws = socketRef.current;
      if (ws === null || ws.readyState !== 1) return;
      const frame: ClientFrame = { t: 'focus', agentId };
      ws.send(JSON.stringify(frame));
    },
    sendEgg: (code) => {
      const ws = socketRef.current;
      if (ws === null || ws.readyState !== 1) return;
      const frame: ClientFrame = { t: 'egg', code };
      ws.send(JSON.stringify(frame));
    },
  };
}
