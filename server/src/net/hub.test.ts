import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerFrame } from '@virtual-office/shared';
import { createWorld, reduce, type WorldState } from '../world/machine.js';
import { OfficeHub } from './hub.js';

let server: Server;
let hub: OfficeHub;
let world: WorldState;
let url: string;

beforeEach(async () => {
  server = createServer();
  world = createWorld();
  hub = new OfficeHub(server, world, { redactPrompts: false, tickRate: 10 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, PROTOCOL_VERSION);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextFrame(ws: WebSocket): Promise<ServerFrame> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

function send(ws: WebSocket, frame: unknown): void {
  ws.send(JSON.stringify(frame));
}

describe('OfficeHub — snapshot-then-delta protocol', () => {
  it('a new client receives a full snapshot before any delta', async () => {
    const ws = await connect();
    const framePromise = nextFrame(ws);
    send(ws, { t: 'hello', p: PROTOCOL_VERSION });
    const frame = await framePromise;
    expect(frame.t).toBe('snapshot');
    ws.close();
  });

  it('reconnecting without a lastSeq triggers a fresh full snapshot', async () => {
    const first = await connect();
    send(first, { t: 'hello', p: PROTOCOL_VERSION });
    await nextFrame(first);
    first.close();

    const second = await connect();
    const framePromise = nextFrame(second);
    send(second, { t: 'hello', p: PROTOCOL_VERSION });
    const frame = await framePromise;
    expect(frame.t).toBe('snapshot');
    second.close();
  });

  it('a lastSeq outside the ring forces a full snapshot, not a partial replay', async () => {
    const ws = await connect();
    const framePromise = nextFrame(ws);
    send(ws, { t: 'hello', p: PROTOCOL_VERSION, lastSeq: 999_999 });
    const frame = await framePromise;
    expect(frame.t).toBe('snapshot');
    ws.close();
  });

  it('a lastSeq still within the ring receives only the missed deltas, not a snapshot', async () => {
    const ws = await connect();
    send(ws, { t: 'hello', p: PROTOCOL_VERSION });
    await nextFrame(ws); // initial snapshot

    hub.publishDeltas(); // no-op: nothing changed yet
    // Force a real change so publishDeltas has something to emit.
    reduce(
      world,
      {
        kind: 'hook',
        payload: {
          v: 1,
          event: 'SessionStart',
          sessionId: 's1',
          parentSessionId: null,
          machineId: 'm',
          cwd: '/x',
          project: 'x',
          identityKey: 'id1',
          ts: Date.now(),
          data: { source: 'startup', model: 'x' },
        },
      },
      Date.now()
    );
    hub.publishDeltas();

    const framePromise = nextFrame(ws);
    send(ws, { t: 'hello', p: PROTOCOL_VERSION, lastSeq: 0 });
    const frame = await framePromise;
    expect(frame.t).toBe('delta');
    ws.close();
  });

  it('rejects a protocol version mismatch with protocol_mismatch and closes 1008', async () => {
    const ws = await connect();
    const framePromise = nextFrame(ws);
    const closePromise = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    send(ws, { t: 'hello', p: 'office.v999' });
    const frame = await framePromise;
    expect(frame).toEqual({ t: 'protocol_mismatch', expected: PROTOCOL_VERSION });
    expect(await closePromise).toBe(1008);
  });
});

describe('OfficeHub — ping/pong and egg rate limiting', () => {
  it('replies to ping with pong echoing clientTime', async () => {
    const ws = await connect();
    const framePromise = nextFrame(ws);
    send(ws, { t: 'ping', clientTime: 12345 });
    const frame = await framePromise;
    expect(frame).toEqual({ t: 'pong', t2: 12345 });
    ws.close();
  });

  it('sends nothing at all until the client has completed the handshake', async () => {
    const ws = await connect();
    const received: ServerFrame[] = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));

    // Force at least one tick's worth of broadcast while the client is silent.
    hub.publishDeltas();
    hub.broadcastEvent('dance_party');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(received, 'frames leaked to an unhandshaken client').toHaveLength(0);

    send(ws, { t: 'hello', p: PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received[0]?.t).toBe('snapshot');
    ws.close();
  });

  it('rate-limits egg bursts to 3 per 10s and broadcasts on success', async () => {
    const ws = await connect();
    const received: ServerFrame[] = [];
    ws.on('message', (data) => received.push(JSON.parse(data.toString())));

    // Broadcasts only reach clients that have completed the handshake, so a
    // real client always gets here via `hello` first.
    send(ws, { t: 'hello', p: PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 50));
    received.length = 0;

    send(ws, { t: 'egg', code: 'moo' });
    send(ws, { t: 'egg', code: 'moo' });
    send(ws, { t: 'egg', code: 'moo' });
    send(ws, { t: 'egg', code: 'moo' }); // 4th exceeds the burst of 3, dropped silently

    await new Promise((resolve) => setTimeout(resolve, 100));
    const cowEvents = received.filter((f) => f.t === 'event' && f.kind === 'cow');
    expect(cowEvents).toHaveLength(3);
    ws.close();
  });
});
