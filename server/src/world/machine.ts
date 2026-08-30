/**
 * The agent state machine — the pure(-ish) reducer at the heart of the hub,
 * per design.md §2 and the world-state-hub + office-simulation specs.
 *
 * `reduce(world, event, now)` never reads the clock, the environment, or any
 * randomness itself — every time-dependent decision is driven entirely by
 * the injected `now`, which is what makes the full heartbeat chain
 * (`15min -> SLEEPING -> 2min -> ZOMBIE -> lap -> DESPAWNING`) testable with
 * fake timers. For implementation convenience the `WorldState` it operates
 * on is mutated in place rather than copied — the reducer is deterministic
 * (same starting state + same event + same `now` always yields the same
 * resulting state), even though it is not a textbook immutable reducer.
 *
 * Decisions 7 and 10 supersede design.md's literal sub-timings: the
 * `SLEEPING -> ZOMBIE` delay is 2 minutes (not 5), the zombie lap is ~20s,
 * and the `DESPAWNING` dissolve is 3s. The desk is freed at the `ZOMBIE`
 * transition, not at removal (design.md §2), so a dead session never
 * squats a desk during its farewell lap. Any event arriving before
 * `DESPAWNING` cancels the whole sleep/zombie chain back to `SEATED_IDLE`
 * (decision 7).
 */
import type { AgentState, Confidence, HookEventPayload, Role, SkinName } from '@virtual-office/shared';
import { classify, pickSkin, type ClassifierInput } from '@virtual-office/shared';
import { findPath } from './astar.js';
import { DeskRegistry } from './desks.js';
import { DEFAULT_FLOOR_LAYOUT, Grid, type Cell, type FloorLayout, type SeatSocket } from './grid.js';

// --- Tunable timings -------------------------------------------------------

/** design.md §2: no heartbeat for this long -> SLEEPING. */
export const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;
/** Decision 10: 2 minutes of further silence after SLEEPING -> ZOMBIE (supersedes design.md's 5min default). */
export const ZOMBIE_AFTER_MS = 2 * 60 * 1000;
/** Decision 7: one ZOMBIE perimeter lap takes about 20s. */
export const ZOMBIE_LAP_MS = 20_000;
/** Decision 7: DESPAWNING dissolve duration. */
export const DESPAWN_DISSOLVE_MS = 3_000;
/** design.md §2: SEATED_TYPING reverts to SEATED_IDLE after this long without a tool event. */
export const IDLE_AFTER_MS = 20_000;
/** design.md §2: handoff/report speech-bubble display duration. */
export const BUBBLE_MS = 3_000;
/** office-simulation spec: a subagent rests in the lounge for exactly this long before despawning. */
export const SUBAGENT_LOUNGE_REST_MS = 15_000;
/** design.md §7: consecutive same-role classifications required before the hub flips the displayed role. */
export const ROLE_HYSTERESIS_STREAK = 3;
/**
 * Cosmetic walking speed used only to estimate server-side arrival timing.
 * Not pinned by any spec or design value (design.md's Open Questions calls
 * the tick rate and `zombieAfterMs` "tuned by watching the thing run" —
 * this constant is the same kind of deliberately configurable default).
 */
export const AGENT_MOVE_CELLS_PER_SEC = 2;

// --- Types -------------------------------------------------------------

export type ArrivalAction =
  | 'seatAtDesk'
  | 'seatAtLounge'
  | 'arriveAtParentForDelegation'
  | 'arriveAtSecondaryDesk'
  | 'arriveAtParentForReport'
  | 'arriveAtLoungeForRest'
  | 'completeZombieLap';

export interface Movement {
  cells: Cell[];
  speed: number;
  arrivesAt: number;
  action: ArrivalAction;
}

export interface AgentRecord {
  agentId: string;
  sessionId: string;
  parentSessionId: string | null;
  identityKey: string;
  machineId: string;
  isSubagent: boolean;
  state: AgentState;
  /** The classifier's raw, already-confirmed role (post-hysteresis). */
  classifiedRole: Role;
  /** Whether this agent has ever received a real tool/prompt classification (vs. still on the spawn-time Temp default). */
  everClassified: boolean;
  pendingRole: Role | null;
  pendingRoleStreak: number;
  confidence: Confidence;
  skin: SkinName;
  badge: string;
  deskId: string | null;
  /** The agent's current logical grid cell (its last settled position, not mid-movement interpolation). */
  cell: Cell;
  position: { x: number; y: number; z: number };
  facingRad: number;
  movement: Movement | null;
  taskText: string;
  lastEventAt: number;
  lastActivityAt: number;
  sleepAt: number | null;
  zombieAt: number | null;
  despawningAt: number | null;
  bubbleUntil: number | null;
  loungeRestUntil: number | null;
  forcePush: boolean;
  /** P1 teddy-bear debugging: consecutive failing Bash exits. */
  bashFailureStreak: number;
  /** P1 teddy-bear debugging: this agent owes the bear a bow on its next success. */
  owesBow: boolean;
}

export interface WorldState {
  layout: FloorLayout;
  grid: Grid;
  desks: DeskRegistry;
  agents: Map<string, AgentRecord>;
}

export type MachineEvent = { kind: 'hook'; payload: HookEventPayload } | { kind: 'tick' };

/** One-shot broadcast-worthy occurrence a caller (net/hub.ts) may want to react to beyond ordinary agent deltas. */
export type MachineSideEffect =
  | { kind: 'agentRemoved'; agentId: string }
  | { kind: 'zombified'; agentId: string }
  | { kind: 'bashFailureStreak'; agentId: string; streak: number }
  | { kind: 'bashSuccessAfterStreak'; agentId: string }
  | { kind: 'shipIt'; agentId: string; forcePush: boolean };

export function createWorld(layout: FloorLayout = DEFAULT_FLOOR_LAYOUT, grid: Grid = Grid.fromLayout(layout)): WorldState {
  return { layout, grid, desks: new DeskRegistry(layout, grid), agents: new Map() };
}

function seatPosition(seat: SeatSocket): { cell: Cell; position: AgentRecord['position']; facingRad: number } {
  return { cell: seat.cell, position: seat.position, facingRad: seat.facingRad };
}

function elevatorPosition(layout: FloorLayout): { cell: Cell; position: AgentRecord['position']; facingRad: number } {
  return {
    cell: layout.elevatorCell,
    position: { x: layout.elevatorCell[0] + 0.5, y: 0, z: layout.elevatorCell[1] + 0.5 },
    facingRad: 0,
  };
}

/** Applies a `{cell, position, facingRad}` triple (from {@link seatPosition} or {@link elevatorPosition}) onto an agent. */
function settleAt(agent: AgentRecord, at: { cell: Cell; position: AgentRecord['position']; facingRad: number }): void {
  agent.cell = at.cell;
  agent.position = at.position;
  agent.facingRad = at.facingRad;
}

function planMovement(grid: Grid, from: Cell, to: Cell, action: ArrivalAction, now: number): Movement | null {
  const path = findPath(grid, from, to);
  if (path === null) return null;
  const travelMs = (path.cost / AGENT_MOVE_CELLS_PER_SEC) * 1000;
  return { cells: path.cells, speed: AGENT_MOVE_CELLS_PER_SEC, arrivesAt: now + travelMs, action };
}

/** Builds the inner-boundary ring the ZOMBIE lap walks, in a fixed clockwise order. */
export function computePerimeterRing(layout: FloorLayout): Cell[] {
  const ring: Cell[] = [];
  const minX = 1;
  const maxX = layout.width - 2;
  const minY = 1;
  const maxY = layout.height - 2;
  for (let x = minX; x <= maxX; x++) ring.push([x, minY]);
  for (let y = minY + 1; y <= maxY; y++) ring.push([maxX, y]);
  for (let x = maxX - 1; x >= minX; x--) ring.push([x, maxY]);
  for (let y = maxY - 1; y > minY; y--) ring.push([minX, y]);
  return ring;
}

function withRole(agent: AgentRecord, identityKey: string, machineId: string): void {
  const choice = pickSkin(agent.classifiedRole, identityKey, machineId);
  agent.skin = choice.skin;
  agent.badge = choice.badge;
}

/**
 * The role hysteresis rule (design.md §7): three consecutive same-role
 * classifications before the hub flips the displayed role. The very first
 * real classification an agent ever receives applies immediately instead —
 * hysteresis exists to stop an *already established* role from flickering
 * on one stray event, not to delay a freshly spawned Temp from ever
 * showing its real role.
 */
function applyClassification(agent: AgentRecord, result: ReturnType<typeof classify>): void {
  agent.confidence = result.confidence;
  if (result.forcePush) agent.forcePush = true;

  if (!agent.everClassified) {
    agent.everClassified = true;
    agent.classifiedRole = result.role;
    agent.pendingRole = null;
    agent.pendingRoleStreak = 0;
    withRole(agent, agent.identityKey, agent.machineId);
    return;
  }

  if (result.role === agent.classifiedRole) {
    agent.pendingRole = null;
    agent.pendingRoleStreak = 0;
    return;
  }
  if (result.role === agent.pendingRole) {
    agent.pendingRoleStreak += 1;
  } else {
    agent.pendingRole = result.role;
    agent.pendingRoleStreak = 1;
  }
  if (agent.pendingRoleStreak >= ROLE_HYSTERESIS_STREAK) {
    agent.classifiedRole = agent.pendingRole;
    agent.pendingRole = null;
    agent.pendingRoleStreak = 0;
    withRole(agent, agent.identityKey, agent.machineId);
  }
}

/** role-classification spec: ZOMBIE overrides the displayed role to Revenant regardless of classification history. */
export function effectiveRole(agent: AgentRecord): Role {
  return agent.state === 'ZOMBIE' ? 'Revenant' : agent.classifiedRole;
}

function toClassifierInput(payload: HookEventPayload): ClassifierInput | null {
  if (payload.event === 'PreToolUse') {
    const { tool, input } = payload.data;
    const base: ClassifierInput = { event: payload.event, tool };
    if ('command' in input) return { ...base, command: input.command };
    if ('path' in input && 'pattern' in input) return { ...base, path: input.path, pattern: input.pattern };
    if ('path' in input) return { ...base, path: input.path };
    if ('query' in input) return { ...base, query: input.query, host: input.host };
    if ('subagentType' in input) return { ...base, model: input.model, promptText: input.taskSummary };
    return base;
  }
  if (payload.event === 'UserPromptSubmit') {
    return { event: payload.event, promptText: payload.data.promptSummary };
  }
  return null;
}

function touchHeartbeat(agent: AgentRecord, now: number): void {
  agent.lastEventAt = now;
}

/** Decision 7: any event before DESPAWNING cancels the sleep/zombie chain back to SEATED_IDLE. */
function wakeIfAsleep(world: WorldState, agent: AgentRecord, now: number): void {
  if (agent.state !== 'SLEEPING' && agent.state !== 'ZOMBIE') return;
  agent.sleepAt = null;
  agent.zombieAt = null;
  agent.movement = null;
  agent.state = 'SEATED_IDLE';
  agent.lastActivityAt = now;

  if (agent.deskId === null) {
    const desk = world.desks.tryAllocate(agent.agentId);
    if (desk !== null) {
      agent.deskId = desk.id;
      settleAt(agent, seatPosition(desk.seat));
    } else {
      world.desks.enqueue(agent.agentId, now);
      agent.state = 'QUEUED';
    }
  }
}

function newAgentRecord(opts: {
  agentId: string;
  sessionId: string;
  parentSessionId: string | null;
  identityKey: string;
  machineId: string;
  isSubagent: boolean;
  now: number;
  layout: FloorLayout;
}): AgentRecord {
  const { cell, position, facingRad } = elevatorPosition(opts.layout);
  const skinChoice = pickSkin('Temp', opts.identityKey, opts.machineId);
  return {
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    parentSessionId: opts.parentSessionId,
    identityKey: opts.identityKey,
    machineId: opts.machineId,
    isSubagent: opts.isSubagent,
    state: 'SPAWNING',
    classifiedRole: 'Temp',
    everClassified: false,
    pendingRole: null,
    pendingRoleStreak: 0,
    confidence: 'exact',
    skin: skinChoice.skin,
    badge: skinChoice.badge,
    deskId: null,
    cell,
    position,
    facingRad,
    movement: null,
    taskText: '',
    lastEventAt: opts.now,
    lastActivityAt: opts.now,
    sleepAt: null,
    zombieAt: null,
    despawningAt: null,
    bubbleUntil: null,
    loungeRestUntil: null,
    forcePush: false,
    bashFailureStreak: 0,
    owesBow: false,
  };
}

/** Assigns a desk (or queues in the lounge) and starts the SPAWNING -> WALKING|QUEUED movement. */
function spawnIntoFloor(world: WorldState, agent: AgentRecord, now: number): void {
  const desk = world.desks.tryAllocate(agent.agentId);
  if (desk !== null) {
    agent.deskId = desk.id;
    agent.state = 'WALKING';
    agent.movement = planMovement(world.grid, agent.cell, desk.seat.standCell, 'seatAtDesk', now);
  } else {
    world.desks.enqueue(agent.agentId, now);
    agent.state = 'QUEUED';
    const seat = world.layout.loungeSeats[0];
    if (seat !== undefined) {
      agent.movement = planMovement(world.grid, agent.cell, seat.standCell, 'seatAtLounge', now);
    }
  }
}

// --- Event application ---------------------------------------------------

function applySessionStart(world: WorldState, payload: HookEventPayload<'SessionStart'>, now: number): void {
  const existing = world.agents.get(payload.sessionId);
  if (existing !== undefined) {
    touchHeartbeat(existing, now);
    wakeIfAsleep(world, existing, now);
    return;
  }
  const agent = newAgentRecord({
    agentId: payload.sessionId,
    sessionId: payload.sessionId,
    parentSessionId: null,
    identityKey: payload.identityKey,
    machineId: payload.machineId,
    isSubagent: false,
    now,
    layout: world.layout,
  });
  world.agents.set(agent.agentId, agent);
  spawnIntoFloor(world, agent, now);
}

function applyUserPromptSubmit(world: WorldState, payload: HookEventPayload<'UserPromptSubmit'>, now: number): void {
  const agent = world.agents.get(payload.sessionId);
  if (agent === undefined) return;
  touchHeartbeat(agent, now);
  wakeIfAsleep(world, agent, now);
  agent.taskText = payload.data.promptSummary;
  if (agent.state === 'SEATED_IDLE') {
    agent.state = 'SEATED_TYPING';
  }
  agent.lastActivityAt = now;
  const classification = toClassifierInput(payload);
  if (classification !== null) applyClassification(agent, classify(classification));
}

function applyPreToolUse(world: WorldState, payload: HookEventPayload<'PreToolUse'>, now: number): MachineSideEffect[] {
  const agent = world.agents.get(payload.sessionId);
  if (agent === undefined) return [];
  touchHeartbeat(agent, now);
  wakeIfAsleep(world, agent, now);
  if (agent.state === 'SEATED_IDLE') agent.state = 'SEATED_TYPING';
  agent.lastActivityAt = now;

  const classification = toClassifierInput(payload);
  if (classification !== null) applyClassification(agent, classify(classification));

  if (payload.data.tool === 'Task' && agent.state === 'SEATED_TYPING') {
    agent.state = 'DELEGATING';
    agent.bubbleUntil = now + BUBBLE_MS;
  }
  return [];
}

function applyPostToolUse(payload: HookEventPayload<'PostToolUse'>, world: WorldState, now: number): MachineSideEffect[] {
  const agent = world.agents.get(payload.sessionId);
  if (agent === undefined) return [];
  touchHeartbeat(agent, now);
  wakeIfAsleep(world, agent, now);
  agent.lastActivityAt = now;

  const effects: MachineSideEffect[] = [];
  if (payload.data.tool === 'Bash') {
    if (payload.data.ok) {
      if (agent.owesBow) {
        agent.owesBow = false;
        effects.push({ kind: 'bashSuccessAfterStreak', agentId: agent.agentId });
      }
      agent.bashFailureStreak = 0;
    } else {
      agent.bashFailureStreak += 1;
      effects.push({ kind: 'bashFailureStreak', agentId: agent.agentId, streak: agent.bashFailureStreak });
      if (agent.bashFailureStreak >= 3) agent.owesBow = true;
    }
  }
  return effects;
}

function applySubagentStart(world: WorldState, payload: HookEventPayload<'SubagentStart'>, now: number): void {
  const parent = world.agents.get(payload.sessionId);
  if (parent !== undefined) {
    touchHeartbeat(parent, now);
    wakeIfAsleep(world, parent, now);
    if (parent.state === 'SEATED_TYPING' || parent.state === 'SEATED_IDLE') {
      parent.state = 'DELEGATING';
      parent.bubbleUntil = now + BUBBLE_MS;
    }
  }

  const subagent = newAgentRecord({
    agentId: payload.data.subagentId,
    sessionId: payload.sessionId,
    parentSessionId: payload.sessionId,
    identityKey: payload.identityKey,
    machineId: payload.machineId,
    isSubagent: true,
    now,
    layout: world.layout,
  });
  subagent.taskText = payload.data.taskSummary;
  world.agents.set(subagent.agentId, subagent);

  const parentDesk = parent?.deskId !== undefined && parent?.deskId !== null ? world.desks.getDesk(parent.deskId) : undefined;
  const target = parentDesk?.seat.standCell ?? world.layout.elevatorCell;
  subagent.state = 'WALKING';
  subagent.movement = planMovement(world.grid, subagent.cell, target, 'arriveAtParentForDelegation', now);
}

function applySubagentStop(world: WorldState, payload: HookEventPayload<'SubagentStop'>, now: number): void {
  const subagent = world.agents.get(payload.data.subagentId);
  if (subagent === undefined) return;
  touchHeartbeat(subagent, now);

  if (subagent.deskId !== null) {
    world.desks.release(subagent.deskId);
    subagent.deskId = null;
  } else {
    world.desks.removeFromQueue(subagent.agentId);
  }

  const parent = world.agents.get(subagent.sessionId);
  const parentDesk = parent?.deskId !== undefined && parent?.deskId !== null ? world.desks.getDesk(parent.deskId) : undefined;
  const target = parentDesk?.seat.standCell ?? world.layout.elevatorCell;

  subagent.state = 'REPORTING';
  subagent.movement = planMovement(world.grid, subagent.cell, target, 'arriveAtParentForReport', now);
}

function applyStop(world: WorldState, payload: HookEventPayload<'Stop'>, now: number): void {
  const agent = world.agents.get(payload.sessionId);
  if (agent === undefined) return;
  touchHeartbeat(agent, now);
  wakeIfAsleep(world, agent, now);
  if (agent.state === 'SEATED_TYPING') agent.state = 'SEATED_IDLE';
}

function despawnAgent(world: WorldState, agent: AgentRecord, now: number): void {
  agent.movement = null;
  agent.state = 'DESPAWNING';
  agent.despawningAt = now;
}

function applySessionEnd(world: WorldState, payload: HookEventPayload<'SessionEnd'>, now: number): void {
  const agent = world.agents.get(payload.sessionId);
  if (agent === undefined) return;
  despawnAgent(world, agent, now);
}

function applyHookEvent(world: WorldState, payload: HookEventPayload, now: number): MachineSideEffect[] {
  switch (payload.event) {
    case 'SessionStart':
      applySessionStart(world, payload, now);
      return [];
    case 'UserPromptSubmit':
      applyUserPromptSubmit(world, payload, now);
      return [];
    case 'PreToolUse':
      return applyPreToolUse(world, payload, now);
    case 'PostToolUse':
      return applyPostToolUse(payload, world, now);
    case 'SubagentStart':
      applySubagentStart(world, payload, now);
      return [];
    case 'SubagentStop':
      applySubagentStop(world, payload, now);
      return [];
    case 'Stop':
      applyStop(world, payload, now);
      return [];
    case 'SessionEnd':
      applySessionEnd(world, payload, now);
      return [];
    default:
      return [];
  }
}

// --- Tick / timers ---------------------------------------------------------

function finishMovement(world: WorldState, agent: AgentRecord, now: number, effects: MachineSideEffect[]): void {
  const action = agent.movement!.action;
  const finalCell = agent.movement!.cells[agent.movement!.cells.length - 1]!;
  agent.movement = null;

  switch (action) {
    case 'seatAtDesk': {
      const desk = agent.deskId !== null ? world.desks.getDesk(agent.deskId) : undefined;
      if (desk !== undefined) settleAt(agent, seatPosition(desk.seat));
      agent.state = now - agent.lastActivityAt < IDLE_AFTER_MS ? 'SEATED_TYPING' : 'SEATED_IDLE';
      break;
    }
    case 'seatAtLounge': {
      const seat = world.layout.loungeSeats.find((s) => s.cell[0] === finalCell[0] && s.cell[1] === finalCell[1]);
      if (seat !== undefined) settleAt(agent, seatPosition(seat));
      agent.state = 'LOUNGING';
      break;
    }
    case 'arriveAtParentForDelegation': {
      agent.cell = finalCell;
      agent.state = 'DELEGATING';
      agent.bubbleUntil = now + BUBBLE_MS;
      break;
    }
    case 'arriveAtSecondaryDesk': {
      const desk = agent.deskId !== null ? world.desks.getDesk(agent.deskId) : undefined;
      if (desk !== undefined) settleAt(agent, seatPosition(desk.seat));
      agent.state = 'SEATED_TYPING';
      agent.lastActivityAt = now;
      break;
    }
    case 'arriveAtParentForReport': {
      agent.cell = finalCell;
      agent.bubbleUntil = now + BUBBLE_MS;
      break;
    }
    case 'arriveAtLoungeForRest': {
      const seat = world.layout.loungeSeats.find((s) => s.cell[0] === finalCell[0] && s.cell[1] === finalCell[1]);
      if (seat !== undefined) settleAt(agent, seatPosition(seat));
      agent.state = 'LOUNGING';
      agent.loungeRestUntil = now + SUBAGENT_LOUNGE_REST_MS;
      break;
    }
    case 'completeZombieLap': {
      agent.cell = finalCell;
      despawnAgent(world, agent, now);
      break;
    }
  }
  void effects;
}

/** Sends the head-of-queue agent walking to a just-freed desk (hot-desk handoff, design.md §2). */
function sendWaitingAgentToDesk(world: WorldState, agentId: string, deskId: string, now: number): void {
  const agent = world.agents.get(agentId);
  if (agent === undefined) return;
  const desk = world.desks.getDesk(deskId);
  if (desk === undefined) return;
  agent.state = 'WALKING';
  agent.movement = planMovement(world.grid, agent.cell, desk.seat.standCell, 'seatAtDesk', now);
}

function tickAgent(world: WorldState, agent: AgentRecord, now: number, effects: MachineSideEffect[]): 'remove' | 'keep' {
  // Arrival.
  if (agent.movement !== null && now >= agent.movement.arrivesAt) {
    finishMovement(world, agent, now, effects);
  }

  // SEATED_TYPING -> SEATED_IDLE after idleAfterMs without a tool event.
  if (agent.state === 'SEATED_TYPING' && now - agent.lastActivityAt >= IDLE_AFTER_MS) {
    agent.state = 'SEATED_IDLE';
  }

  // Bubble timers (parent handoff gesture, subagent speech bubble, subagent report bubble).
  if (agent.bubbleUntil !== null && now >= agent.bubbleUntil) {
    agent.bubbleUntil = null;
    if (agent.state === 'DELEGATING' && agent.isSubagent) {
      // Subagent's speech-bubble-at-parent-desk elapsed: walk to a secondary desk, or queue.
      const desk = world.desks.tryAllocate(agent.agentId);
      if (desk !== null) {
        agent.deskId = desk.id;
        agent.state = 'WALKING';
        agent.movement = planMovement(world.grid, agent.cell, desk.seat.standCell, 'arriveAtSecondaryDesk', now);
      } else {
        world.desks.enqueue(agent.agentId, now);
        agent.state = 'QUEUED';
      }
    } else if (agent.state === 'DELEGATING' && !agent.isSubagent) {
      // Parent's own handoff gesture elapsed.
      agent.state = 'SEATED_TYPING';
      agent.lastActivityAt = now;
    } else if (agent.state === 'REPORTING') {
      // Subagent's report bubble elapsed: walk to a lounge seat to rest.
      const seat = world.layout.loungeSeats[0];
      if (seat !== undefined) {
        agent.movement = planMovement(world.grid, agent.cell, seat.standCell, 'arriveAtLoungeForRest', now);
      }
    }
  }

  // Subagent lounge rest elapsed -> despawn.
  if (agent.isSubagent && agent.state === 'LOUNGING' && agent.loungeRestUntil !== null && now >= agent.loungeRestUntil) {
    agent.loungeRestUntil = null;
    despawnAgent(world, agent, now);
  }

  // Heartbeat timeout chain.
  const isTimeoutEligible = agent.state !== 'SLEEPING' && agent.state !== 'ZOMBIE' && agent.state !== 'DESPAWNING';
  if (isTimeoutEligible && now - agent.lastEventAt >= HEARTBEAT_TIMEOUT_MS) {
    agent.state = 'SLEEPING';
    agent.sleepAt = now;
    agent.movement = null;
  }
  if (agent.state === 'SLEEPING' && agent.sleepAt !== null && now - agent.sleepAt >= ZOMBIE_AFTER_MS) {
    agent.state = 'ZOMBIE';
    agent.zombieAt = now;
    if (agent.deskId !== null) {
      const freedDeskId = agent.deskId;
      const result = world.desks.release(freedDeskId);
      agent.deskId = null;
      if (result.reassignedTo !== null) sendWaitingAgentToDesk(world, result.reassignedTo, freedDeskId, now);
    } else {
      world.desks.removeFromQueue(agent.agentId);
    }
    const ring = computePerimeterRing(world.layout);
    const nearestRingCell = ring[0]!;
    agent.movement = {
      cells: [nearestRingCell, ...ring],
      speed: AGENT_MOVE_CELLS_PER_SEC,
      arrivesAt: now + ZOMBIE_LAP_MS,
      action: 'completeZombieLap',
    };
    effects.push({ kind: 'zombified', agentId: agent.agentId });
  }

  // Despawn dissolve elapsed -> removed.
  if (agent.state === 'DESPAWNING' && agent.despawningAt !== null && now - agent.despawningAt >= DESPAWN_DISSOLVE_MS) {
    if (agent.deskId !== null) {
      const result = world.desks.release(agent.deskId);
      if (result.reassignedTo !== null) sendWaitingAgentToDesk(world, result.reassignedTo, agent.deskId, now);
    } else {
      world.desks.removeFromQueue(agent.agentId);
    }
    effects.push({ kind: 'agentRemoved', agentId: agent.agentId });
    return 'remove';
  }

  return 'keep';
}

function tickWorld(world: WorldState, now: number): MachineSideEffect[] {
  const effects: MachineSideEffect[] = [];
  const toRemove: string[] = [];
  for (const agent of world.agents.values()) {
    const result = tickAgent(world, agent, now, effects);
    if (result === 'remove') toRemove.push(agent.agentId);
  }
  for (const id of toRemove) world.agents.delete(id);
  return effects;
}

/**
 * The reducer. `event.kind === 'tick'` advances every timer-driven
 * transition (arrivals, idle timeout, bubble elapses, the heartbeat chain,
 * and despawn removal); `event.kind === 'hook'` applies one incoming
 * lifecycle event. Returns any side effects worth broadcasting beyond
 * ordinary per-agent deltas (P1 hooks, removals).
 */
export function reduce(world: WorldState, event: MachineEvent, now: number): MachineSideEffect[] {
  if (event.kind === 'tick') return tickWorld(world, now);
  return applyHookEvent(world, event.payload, now);
}
