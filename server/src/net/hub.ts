/**
 * The WebSocket hub, per design.md §3 and the world-state-hub spec's
 * snapshot-then-delta protocol requirement.
 *
 * A new client (no `lastSeq`) always gets a full snapshot before any delta.
 * A reconnecting client that supplies a `lastSeq` still within the replay
 * ring gets only the missed deltas (the design.md §3 optimisation); a
 * `lastSeq` that has fallen out of the ring forces a full snapshot instead
 * of a partial (and therefore wrong) replay.
 *
 * Redaction and re-truncation of task text already happened at `/events`
 * ingestion (`net/validate.ts`, decision 3's "one variable, one place") —
 * `agent.taskText` is safe to broadcast as-is by the time it reaches here.
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  EGG_RATE_LIMIT,
  PROTOCOL_VERSION,
  WS_IDLE_TIMEOUT_MS,
  type AgentSnapshot,
  type ClientFrame,
  type DeltaOp,
  type EggCode,
  type EventKind,
  type ServerFrame,
  type WorldSnapshot,
} from '@virtual-office/shared';
import { effectiveRole, type AgentRecord, type WorldState } from '../world/machine.js';
import { DeltaRing } from './ring.js';

interface EggBucket {
  tokens: number;
  lastRefillAt: number;
}

interface ClientConn {
  lastActivityAt: number;
  focusAgentId: string | null;
  eggBucket: EggBucket;
  /**
   * False until the client has completed the `hello` handshake and been given
   * either a snapshot or a gap-free replay. Broadcasts skip connections that
   * are not ready: a client that receives deltas before it has any world to
   * apply them to would be mutating agents it has never heard of, and a client
   * on a mismatched protocol would be handed data before it is rejected.
   */
  ready: boolean;
}

export interface HubConfig {
  redactPrompts: boolean;
  tickRate: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

export function buildAgentSnapshot(agent: AgentRecord): AgentSnapshot {
  return {
    agentId: agent.agentId,
    sessionId: agent.sessionId,
    parentSessionId: agent.parentSessionId,
    role: effectiveRole(agent),
    confidence: agent.confidence,
    skin: agent.skin,
    badge: agent.badge,
    state: agent.state,
    position: agent.position,
    facingRad: agent.facingRad,
    deskId: agent.deskId,
    label: { name: agent.agentId, machineId: agent.machineId, taskText: agent.taskText },
  };
}

export function buildWorldSnapshot(world: WorldState): WorldSnapshot {
  return {
    layout: world.layout,
    props: [],
    desks: world.desks.desks.map((d) => ({ deskId: d.id, occupiedBy: world.desks.occupantOf(d.id) })),
    agents: Array.from(world.agents.values()).map(buildAgentSnapshot),
    npcs: Array.from(world.npcs.values()),
    hud: {},
  };
}

/** `coffee_stare` has no dedicated `EventKind` in the frozen wire protocol; `alarm` is the closest "everyone freezes and reacts" cosmetic. */
function eggToEventKind(code: EggCode): EventKind {
  switch (code) {
    case 'konami':
      return 'dance_party';
    case 'moo':
      return 'cow';
    case 'coffee_stare':
      return 'alarm';
  }
}

export class OfficeHub {
  private readonly wss: WebSocketServer;
  private readonly ring = new DeltaRing();
  private readonly clients = new Map<WebSocket, ClientConn>();
  private readonly lastAgentSnapshots = new Map<string, AgentSnapshot>();
  private readonly lastDeskOccupancy = new Map<string, string | null>();
  private readonly now: () => number;

  constructor(
    server: HttpServer,
    private readonly world: WorldState,
    private readonly config: HubConfig
  ) {
    this.now = config.now ?? (() => Date.now());
    this.wss = new WebSocketServer({
      server,
      handleProtocols: (protocols) => (protocols.has(PROTOCOL_VERSION) ? PROTOCOL_VERSION : false),
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    // `ws` re-emits the shared HTTP server's errors, and an unhandled 'error'
    // on a WebSocketServer throws. The entrypoint owns the actual reporting and
    // exit; this listener only keeps the throw from pre-empting it.
    this.wss.on('error', () => {});
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  close(): void {
    this.wss.close();
  }

  private onConnection(ws: WebSocket): void {
    const conn: ClientConn = {
      lastActivityAt: this.now(),
      focusAgentId: null,
      eggBucket: { tokens: EGG_RATE_LIMIT.burst, lastRefillAt: this.now() },
      ready: false,
    };
    this.clients.set(ws, conn);
    ws.on('message', (data: RawData) => this.onMessage(ws, conn, data));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  }

  private sendSnapshot(ws: WebSocket): void {
    this.send(ws, { t: 'snapshot', seq: this.ring.currentSeq, world: buildWorldSnapshot(this.world) });
  }

  private onMessage(ws: WebSocket, conn: ClientConn, data: RawData): void {
    let msg: ClientFrame;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    conn.lastActivityAt = this.now();

    switch (msg.t) {
      case 'hello': {
        if (msg.p !== PROTOCOL_VERSION) {
          this.send(ws, { t: 'protocol_mismatch', expected: PROTOCOL_VERSION });
          ws.close(1008);
          return;
        }
        if (msg.lastSeq !== undefined) {
          const replay = this.ring.replaySince(msg.lastSeq);
          if (replay !== null) {
            for (const entry of replay) this.send(ws, { t: 'delta', seq: entry.seq, ops: entry.ops });
            conn.ready = true;
            return;
          }
        }
        this.sendSnapshot(ws);
        conn.ready = true;
        return;
      }
      case 'resync': {
        this.sendSnapshot(ws);
        conn.ready = true;
        return;
      }
      case 'focus': {
        conn.focusAgentId = msg.agentId;
        return;
      }
      case 'egg': {
        if (this.takeEggToken(conn)) this.broadcastEvent(eggToEventKind(msg.code), {});
        return;
      }
      case 'ping': {
        this.send(ws, { t: 'pong', t2: msg.clientTime });
        return;
      }
    }
  }

  private takeEggToken(conn: ClientConn): boolean {
    const now = this.now();
    const elapsedMs = now - conn.eggBucket.lastRefillAt;
    conn.eggBucket.tokens = Math.min(EGG_RATE_LIMIT.burst, conn.eggBucket.tokens + elapsedMs * EGG_RATE_LIMIT.refillPerMs);
    conn.eggBucket.lastRefillAt = now;
    if (conn.eggBucket.tokens >= 1) {
      conn.eggBucket.tokens -= 1;
      return true;
    }
    return false;
  }

  broadcastEvent(kind: EventKind, extra: Record<string, unknown> = {}): void {
    const frame: ServerFrame = { t: 'event', kind, ...extra };
    for (const [ws, conn] of this.clients) if (conn.ready) this.send(ws, frame);
  }

  /** Recomputes deltas since the last call and broadcasts them. Call once per server tick. */
  publishDeltas(): DeltaOp[] {
    const ops = [...this.diffAgents(), ...this.diffDesks()];
    if (ops.length === 0) return ops;
    const entry = this.ring.push(ops);
    const frame: ServerFrame = { t: 'delta', seq: entry.seq, ops };
    for (const [ws, conn] of this.clients) if (conn.ready) this.send(ws, frame);
    return ops;
  }

  /** Broadcasts a one-shot cosmetic clip cue (P1: teddy-bear talking/bowing) as a ring-tracked `agent_anim` delta. */
  publishAgentAnim(agentId: string, clip: string): void {
    const entry = this.ring.push([{ op: 'agent_anim', agentId, clip }]);
    const frame: ServerFrame = { t: 'delta', seq: entry.seq, ops: entry.ops };
    for (const [ws, conn] of this.clients) if (conn.ready) this.send(ws, frame);
  }

  /** Closes any connection that has sent nothing for `WS_IDLE_TIMEOUT_MS`. */
  closeIdleConnections(): void {
    const now = this.now();
    for (const [ws, conn] of this.clients) {
      if (now - conn.lastActivityAt >= WS_IDLE_TIMEOUT_MS) {
        ws.close();
        this.clients.delete(ws);
      }
    }
  }

  private diffAgents(): DeltaOp[] {
    const ops: DeltaOp[] = [];
    const currentIds = new Set<string>();
    for (const agent of this.world.agents.values()) {
      currentIds.add(agent.agentId);
      const snapshot = buildAgentSnapshot(agent);
      const previous = this.lastAgentSnapshots.get(agent.agentId);
      if (previous === undefined) {
        ops.push({ op: 'agent_add', agent: snapshot });
      } else {
        if (previous.state !== snapshot.state) {
          ops.push({ op: 'agent_state', agentId: agent.agentId, state: snapshot.state });
        }
        if (previous.label.taskText !== snapshot.label.taskText) {
          ops.push({ op: 'agent_label', agentId: agent.agentId, taskText: snapshot.label.taskText });
        }
      }
      this.lastAgentSnapshots.set(agent.agentId, snapshot);
    }
    for (const id of Array.from(this.lastAgentSnapshots.keys())) {
      if (!currentIds.has(id)) {
        ops.push({ op: 'agent_remove', agentId: id });
        this.lastAgentSnapshots.delete(id);
      }
    }
    return ops;
  }

  private diffDesks(): DeltaOp[] {
    const ops: DeltaOp[] = [];
    for (const desk of this.world.desks.desks) {
      const occupiedBy = this.world.desks.occupantOf(desk.id);
      if (this.lastDeskOccupancy.get(desk.id) !== occupiedBy) {
        ops.push({ op: 'desk', deskId: desk.id, occupiedBy });
        this.lastDeskOccupancy.set(desk.id, occupiedBy);
      }
    }
    return ops;
  }
}
