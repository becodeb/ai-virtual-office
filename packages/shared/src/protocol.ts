/**
 * Versioned WebSocket protocol between the hub (`server/`) and the renderer
 * (`client/`), per design.md §3. `PROTOCOL_VERSION` is sent both as the
 * WebSocket subprotocol and in the `hello` frame's `p` field; a mismatch
 * closes the connection with code 1008.
 */
import type { AgentState, Role, Confidence } from './state.js';

export const PROTOCOL_VERSION = 'office.v1' as const;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AgentSnapshot {
  agentId: string;
  sessionId: string;
  parentSessionId: string | null;
  role: Role;
  confidence: Confidence;
  skin: string;
  badge: string;
  state: AgentState;
  position: Vec3;
  facingRad: number;
  deskId: string | null;
  label: {
    name: string;
    machineId: string;
    taskText: string;
  };
}

export interface DeskSnapshot {
  deskId: string;
  occupiedBy: string | null;
}

export interface WorldSnapshot {
  layout: unknown;
  props: unknown;
  desks: DeskSnapshot[];
  agents: AgentSnapshot[];
  npcs: unknown[];
  hud: unknown;
}

/** Delta operation kinds broadcast between snapshots. */
export type DeltaOp =
  | { op: 'agent_add'; agent: AgentSnapshot }
  | { op: 'agent_remove'; agentId: string }
  | { op: 'agent_state'; agentId: string; state: AgentState }
  | { op: 'agent_path'; agentId: string; cells: Array<[number, number]>; speed: number }
  | { op: 'agent_anim'; agentId: string; clip: string }
  | { op: 'agent_label'; agentId: string; taskText: string }
  | { op: 'desk'; deskId: string; occupiedBy: string | null }
  | { op: 'hud'; hud: unknown };

export type EggCode = 'konami' | 'moo' | 'coffee_stare';

export type EventKind = 'confetti' | 'alarm' | 'elevator_ding' | 'dance_party' | 'cow';

/** Server -> client frames. */
export type ServerFrame =
  | {
      t: 'hello';
      p: typeof PROTOCOL_VERSION;
      serverTime: number;
      tickRate: number;
      config: { redactPrompts: boolean; deskCount: number };
    }
  | { t: 'protocol_mismatch'; expected: typeof PROTOCOL_VERSION }
  | { t: 'snapshot'; seq: number; world: WorldSnapshot }
  | { t: 'delta'; seq: number; ops: DeltaOp[] }
  | { t: 'event'; kind: EventKind; [extra: string]: unknown }
  | { t: 'pong'; t2: number };

/** Client -> server frames. Nothing here mutates simulation state except by opening a session. */
export type ClientFrame =
  | { t: 'hello'; p: typeof PROTOCOL_VERSION; lastSeq?: number }
  | { t: 'focus'; agentId: string | null }
  | { t: 'egg'; code: EggCode }
  | { t: 'ping'; clientTime: number }
  | { t: 'resync' };

/** Size of the server's delta replay ring, keyed by `seq`. */
export const DELTA_RING_SIZE = 256;

/** Idle timeout after which the server closes a WebSocket connection, in ms. */
export const WS_IDLE_TIMEOUT_MS = 60_000;

/** `egg` rate limit: burst size and refill rate. */
export const EGG_RATE_LIMIT = { burst: 3, refillPerMs: 1 / 3000 } as const;
