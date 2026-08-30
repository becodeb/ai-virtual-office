/**
 * The office hub entrypoint: one HTTP server exposing `POST /events` and
 * `GET /healthz`, with the WebSocket upgrade on the same port, per
 * design.md §2. A fixed 10 Hz tick advances the state machine's timers and
 * broadcasts a batched delta.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { REDACT_PROMPTS_ENV_VAR } from '@virtual-office/shared';
import { OfficeHub } from './net/hub.js';
import { isWithinBodySizeCap, validateInboundPayload } from './net/validate.js';
import { createWorld, reduce } from './world/machine.js';
import { IdentityStore } from './world/identity.js';
import { applyP1OnHookEvent, runP1Behaviors } from './p1/index.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const TICK_RATE_HZ = 10;
const TICK_INTERVAL_MS = 1000 / TICK_RATE_HZ;

const redactPrompts = process.env[REDACT_PROMPTS_ENV_VAR] === 'true';
const world = createWorld();
const identities = new IdentityStore();

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let overLimit = false;
    req.on('data', (chunk: Buffer) => {
      if (overLimit) return;
      total += chunk.length;
      if (total > maxBytes) {
        overLimit = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!overLimit) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => resolve(null));
  });
}

function extractMachineId(req: IncomingMessage): string {
  const header = req.headers['x-office-machine'];
  if (typeof header === 'string' && header.length > 0) return header;
  return req.socket.remoteAddress ?? 'unknown';
}

async function handleEvents(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readRequestBody(req, 32 * 1024); // read a bit over the cap so we can reject cleanly rather than truncate silently
  if (body === null) {
    res.writeHead(413).end();
    return;
  }
  if (!isWithinBodySizeCap(body.length)) {
    res.writeHead(413).end();
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf-8'));
  } catch {
    res.writeHead(400).end();
    return;
  }

  const outcome = validateInboundPayload(parsed, {
    machineId: extractMachineId(req),
    now: Date.now(),
    redactPrompts,
  });

  if (!outcome.ok) {
    // Never let a malformed body crash the hub or mutate world state; log
    // and drop instead of failing loudly onto a fire-and-forget hook that
    // discards the response anyway.
    // eslint-disable-next-line no-console
    console.warn(`[office] dropped /events payload: ${outcome.reason}`);
    res.writeHead(400).end();
    return;
  }

  const eventNow = Date.now();
  reduce(world, { kind: 'hook', payload: outcome.payload }, eventNow);
  applyP1OnHookEvent(world, outcome.payload, eventNow);
  identities.get(outcome.payload.identityKey); // touch: ensures a record exists for later P1 writes
  res.writeHead(204).end();
}

function handleHealthz(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    handleHealthz(res);
    return;
  }
  if (req.method === 'POST' && req.url === '/events') {
    void handleEvents(req, res);
    return;
  }
  res.writeHead(404).end();
});

const hub = new OfficeHub(server, world, { redactPrompts, tickRate: TICK_RATE_HZ });

const tickTimer = setInterval(() => {
  const now = Date.now();
  const effects = reduce(world, { kind: 'tick' }, now);
  runP1Behaviors(world, effects, identities, hub, now);
  hub.publishDeltas();
  hub.closeIdleConnections();
}, TICK_INTERVAL_MS);
tickTimer.unref();

function shutdown(): void {
  identities.flush();
  clearInterval(tickTimer);
  hub.close();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[office] hub listening on http://${HOST}:${PORT} (redactPrompts=${redactPrompts})`);
});

export { server, world, hub };
