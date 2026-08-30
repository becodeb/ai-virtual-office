/**
 * Pure protocol reducer: turns the sequence of `ServerFrame`s the hub sends
 * into renderer-facing world state. No WebSocket, no timers, no randomness —
 * everything network-shaped lives in `net/useWorld.ts`, which is why this
 * module is directly unit-testable against synthetic frame sequences
 * (design.md §3 / office-renderer spec's snapshot-then-delta contract).
 */
import type { AgentSnapshot, DeltaOp, EventKind, ServerFrame } from '@virtual-office/shared';
import { isFloorLayout, type FloorLayout } from '../net/floorLayout.js';

export interface FxEvent {
  id: number;
  kind: EventKind;
  inferred: boolean;
  receivedAt: number;
}

/** A one-shot clip cue targeted at a single agent (P1 bear talk/bow), from the `agent_anim` delta op. */
export interface AgentAnimCue {
  id: number;
  agentId: string;
  clip: string;
  receivedAt: number;
}

/** One broadcast A* route, with the wall-clock moment the client began walking it. */
export interface AgentPath {
  cells: ReadonlyArray<readonly [number, number]>;
  /** Cells per second, matching the hub's own estimate. */
  speed: number;
  startedAt: number;
}

export interface WorldReducerState {
  /** `true` once the server's `hello` handshake has been received and accepted. */
  helloReceived: boolean;
  protocolMismatch: boolean;
  redactPrompts: boolean;
  deskCount: number;
  serverTime: number | null;
  tickRate: number | null;
  /** Last applied frame sequence number (snapshot or delta). `null` before the first snapshot. */
  seq: number | null;
  layout: FloorLayout | null;
  desks: Map<string, string | null>;
  agents: Map<string, AgentSnapshot>;
  npcs: unknown[];
  /** Whatever `WorldSnapshot.hud`/`{op:'hud'}` currently carries — see `hud/coffeeLeaderboard.ts` for defensive parsing. */
  hud: unknown;
  /** Ephemeral one-shot cosmetic events (confetti, alarm, elevator_ding, dance_party, cow). Newest last. */
  fx: FxEvent[];
  /** Monotonic counter for `FxEvent.id`, so React keys stay stable and unique across a session. */
  nextFxId: number;
  /** Ephemeral per-agent clip cues from `agent_anim` ops (P1 bear talk/bow). Newest last. */
  animCues: AgentAnimCue[];
  /** The route the hub actually planned per walking agent, keyed by agent id. */
  paths: Map<string, AgentPath>;
  nextAnimCueId: number;
}

export function initialWorldReducerState(): WorldReducerState {
  return {
    helloReceived: false,
    protocolMismatch: false,
    redactPrompts: false,
    deskCount: 0,
    serverTime: null,
    tickRate: null,
    seq: null,
    layout: null,
    desks: new Map(),
    agents: new Map(),
    npcs: [],
    hud: {},
    fx: [],
    nextFxId: 1,
    animCues: [],
    paths: new Map(),
    nextAnimCueId: 1,
  };
}

/** How many `FxEvent`s to retain — the HUD only ever shows the most recent one or two. */
const MAX_FX_HISTORY = 8;

function applyOps(state: WorldReducerState, ops: DeltaOp[]): void {
  for (const op of ops) {
    switch (op.op) {
      case 'agent_add':
        state.agents.set(op.agent.agentId, op.agent);
        break;
      case 'agent_remove':
        state.agents.delete(op.agentId);
        state.paths.delete(op.agentId);
        break;
      case 'agent_state': {
        const agent = state.agents.get(op.agentId);
        if (agent !== undefined) state.agents.set(op.agentId, { ...agent, state: op.state });
        break;
      }
      case 'agent_label': {
        const agent = state.agents.get(op.agentId);
        if (agent !== undefined) {
          state.agents.set(op.agentId, { ...agent, label: { ...agent.label, taskText: op.taskText } });
        }
        break;
      }
      case 'agent_anim':
        // Cosmetic one-shot clip cue (P1 bear talk/bow) targeted at one agent.
        state.animCues.push({ id: state.nextAnimCueId++, agentId: op.agentId, clip: op.clip, receivedAt: Date.now() });
        if (state.animCues.length > MAX_FX_HISTORY) state.animCues.splice(0, state.animCues.length - MAX_FX_HISTORY);
        break;
      case 'agent_path':
        state.paths.set(op.agentId, { cells: op.cells, speed: op.speed, startedAt: Date.now() });
        break;
      case 'desk':
        state.desks.set(op.deskId, op.occupiedBy);
        break;
      case 'hud':
        state.hud = op.hud;
        break;
    }
  }
  if (state.fx.length > MAX_FX_HISTORY) state.fx.splice(0, state.fx.length - MAX_FX_HISTORY);
}

/**
 * Applies one `ServerFrame` and returns the next state. Always returns a new
 * top-level object (shallow) so it composes cleanly with a zustand `set`.
 */
export function applyServerFrame(state: WorldReducerState, frame: ServerFrame, now: number = Date.now()): WorldReducerState {
  switch (frame.t) {
    case 'hello': {
      return {
        ...state,
        helloReceived: true,
        protocolMismatch: false,
        redactPrompts: frame.config.redactPrompts,
        deskCount: frame.config.deskCount,
        serverTime: frame.serverTime,
        tickRate: frame.tickRate,
      };
    }
    case 'protocol_mismatch': {
      return { ...state, protocolMismatch: true };
    }
    case 'snapshot': {
      const layout = isFloorLayout(frame.world.layout) ? frame.world.layout : state.layout;
      const desks = new Map(frame.world.desks.map((d) => [d.deskId, d.occupiedBy] as const));
      const agents = new Map(frame.world.agents.map((a) => [a.agentId, a] as const));
      // A fresh snapshot says nothing about routes in flight; keeping the old
      // ones would walk characters along paths the hub has already forgotten.
      return { ...state, seq: frame.seq, layout, desks, agents, npcs: frame.world.npcs, hud: frame.world.hud, fx: state.fx, nextFxId: state.nextFxId, paths: new Map() };
    }
    case 'delta': {
      const next: WorldReducerState = {
        ...state,
        seq: frame.seq,
        desks: new Map(state.desks),
        agents: new Map(state.agents),
        fx: [...state.fx],
        animCues: [...state.animCues],
      };
      applyOps(next, frame.ops);
      return next;
    }
    case 'event': {
      const inferred = frame.inferred === true;
      const fx = [...state.fx, { id: state.nextFxId, kind: frame.kind, inferred, receivedAt: now }];
      if (fx.length > MAX_FX_HISTORY) fx.splice(0, fx.length - MAX_FX_HISTORY);
      return { ...state, fx, nextFxId: state.nextFxId + 1 };
    }
    case 'pong':
      return state;
  }
}

/**
 * Gap detection for `delta` frames (task 4.2's "resync-on-gap logic"). The
 * hub's delta stream is a strict `seq` sequence; a `delta` whose `seq` is not
 * exactly `lastSeq + 1` means at least one delta was missed (e.g. a brief
 * disconnect the socket layer did not notice), so the caller must fall back
 * to a `resync` request rather than applying a partial, wrong world. `null`
 * `lastSeq` (nothing applied yet) always resyncs rather than guessing.
 */
export function needsResync(lastSeq: number | null, incomingSeq: number): boolean {
  if (lastSeq === null) return true;
  return incomingSeq !== lastSeq + 1;
}
