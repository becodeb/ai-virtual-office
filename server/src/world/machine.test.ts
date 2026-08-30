import { describe, expect, it } from 'vitest';
import { FALLBACK_ROLE, type HookEventPayload } from '@virtual-office/shared';
import {
  createWorld,
  effectiveRole,
  reduce,
  triggerArchitectReaction,
  HEARTBEAT_TIMEOUT_MS,
  ZOMBIE_AFTER_MS,
  ZOMBIE_LAP_MS,
  DESPAWN_DISSOLVE_MS,
  IDLE_AFTER_MS,
  BUBBLE_MS,
  SUBAGENT_LOUNGE_REST_MS,
  COFFEE_IDLE_THRESHOLD_MS,
  ARCHITECT_REACTION_MS,
  ARCHITECT_NPC_ID,
  type WorldState,
} from './machine.js';

const T0 = 1_700_000_000_000;

function basePayload<E extends HookEventPayload['event']>(
  event: E,
  sessionId: string,
  now: number,
  data: Extract<HookEventPayload, { event: E }>['data'],
  parentSessionId: string | null = null
): Extract<HookEventPayload, { event: E }> {
  return {
    v: 1,
    event,
    sessionId,
    parentSessionId,
    machineId: 'machine-1',
    cwd: '/home/user/projects/api',
    project: 'api',
    identityKey: `identity-${sessionId}`,
    ts: now,
    data,
  } as Extract<HookEventPayload, { event: E }>;
}

function hook(world: WorldState, payload: HookEventPayload, now: number) {
  return reduce(world, { kind: 'hook', payload }, now);
}

function tick(world: WorldState, now: number) {
  return reduce(world, { kind: 'tick' }, now);
}

/** Advances the world clock in fixed steps until `predicate` holds or the budget is exhausted. */
function tickUntil(world: WorldState, from: number, predicate: () => boolean, stepMs = 500, budgetMs = 60_000): number {
  let now = from;
  const end = from + budgetMs;
  while (!predicate() && now < end) {
    now += stepMs;
    tick(world, now);
  }
  return now;
}

function sessionStart(sessionId: string, now: number) {
  return basePayload('SessionStart', sessionId, now, { source: 'startup', model: 'claude-sonnet-5' });
}

function bash(sessionId: string, now: number, command: string) {
  return basePayload('PreToolUse', sessionId, now, { tool: 'Bash', toolUseId: 't1', input: { command, argv0: command.split(' ')[0]! } });
}

function taskTool(sessionId: string, now: number) {
  return basePayload('PreToolUse', sessionId, now, {
    tool: 'Task',
    toolUseId: 't-task',
    input: { subagentType: 'general', model: 'claude-sonnet-5', taskSummary: 'do the thing' },
  });
}

function readTool(sessionId: string, now: number, path = '/repo/README.md') {
  return basePayload('PreToolUse', sessionId, now, { tool: 'Read', toolUseId: 't2', input: { path, pattern: '' } });
}

function editTool(sessionId: string, now: number, path = '/repo/src/app.ts') {
  return basePayload('PreToolUse', sessionId, now, { tool: 'Edit', toolUseId: 't3', input: { path, ext: '.ts' } });
}

function postBash(sessionId: string, now: number, ok: boolean, exitCode: number | null) {
  return basePayload('PostToolUse', sessionId, now, {
    tool: 'Bash',
    toolUseId: 't1',
    exitCode,
    ok,
    durationMs: 10,
    outputSummary: '',
  });
}

function userPrompt(sessionId: string, now: number, promptSummary = 'do something') {
  return basePayload('UserPromptSubmit', sessionId, now, { promptSummary, promptLength: promptSummary.length });
}

function stopEvent(sessionId: string, now: number) {
  return basePayload('Stop', sessionId, now, { reason: 'end_turn' });
}

function sessionEnd(sessionId: string, now: number) {
  return basePayload('SessionEnd', sessionId, now, { reason: 'exit' });
}

function subagentStart(parentSessionId: string, subagentId: string, now: number) {
  return basePayload(
    'SubagentStart',
    parentSessionId,
    now,
    { subagentId, subagentType: 'general', model: 'claude-sonnet-5', taskSummary: 'help out' },
    null
  );
}

function subagentStop(parentSessionId: string, subagentId: string, now: number, ok = true) {
  return basePayload('SubagentStop', parentSessionId, now, { subagentId, ok }, null);
}

/** Fills every desk the floor actually has, so the plan can change freely. */
function fillAllDesks(world: WorldState, now: number, count = world.desks.desks.length): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `filler-${i}`;
    hook(world, sessionStart(id, now), now);
    ids.push(id);
  }
  return ids;
}

describe('machine — spawn, desks, and basic seated transitions', () => {
  it('SessionStart spawns SPAWNING, allocates a desk, and arrives seated', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    const agent = world.agents.get('s1')!;
    expect(agent.state).toBe('WALKING');
    expect(agent.deskId).not.toBeNull();

    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    const arrived = world.agents.get('s1')!;
    expect(['SEATED_TYPING', 'SEATED_IDLE']).toContain(arrived.state);
  });

  it('arrival with no recent activity lands on SEATED_IDLE', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    // Force "no recent activity" by backdating lastActivityAt before arrival resolves.
    world.agents.get('s1')!.lastActivityAt = T0 - IDLE_AFTER_MS - 1;
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });

  it('one session past the last desk queues in the lounge instead of growing the floor', () => {
    const world = createWorld();
    fillAllDesks(world, T0);
    hook(world, sessionStart('overflow', T0), T0);
    const agent = world.agents.get('overflow')!;
    expect(agent.state).toBe('QUEUED');
    expect(agent.deskId).toBeNull();
    expect(world.desks.waitingCount).toBe(1);
  });

  it('freed desk goes to the longest-waiting queued agent (T1 < T2)', () => {
    const world = createWorld();
    fillAllDesks(world, T0);
    hook(world, sessionStart('waiter-1', T0 + 100), T0 + 100);
    hook(world, sessionStart('waiter-2', T0 + 200), T0 + 200);

    hook(world, sessionEnd('filler-0', T0 + 300), T0 + 300);
    tickUntil(world, T0 + 300, () => world.agents.get('filler-0') === undefined);

    expect(world.agents.get('waiter-1')!.state).toBe('WALKING');
    expect(world.agents.get('waiter-2')!.state).toBe('QUEUED');
  });

  it('SEATED_IDLE -> SEATED_TYPING on UserPromptSubmit and PreToolUse', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    world.agents.get('s1')!.state = 'SEATED_IDLE';

    hook(world, userPrompt('s1', T0 + 1000), T0 + 1000);
    expect(world.agents.get('s1')!.state).toBe('SEATED_TYPING');
  });

  it('SEATED_TYPING -> SEATED_IDLE on Stop', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    world.agents.get('s1')!.state = 'SEATED_TYPING';

    hook(world, stopEvent('s1', T0 + 500), T0 + 500);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });

  it('SEATED_TYPING -> SEATED_IDLE after idleAfterMs without a tool event', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    const agent = world.agents.get('s1')!;
    agent.state = 'SEATED_TYPING';
    agent.lastActivityAt = T0 + 5000;

    tick(world, T0 + 5000 + IDLE_AFTER_MS - 1);
    expect(world.agents.get('s1')!.state).toBe('SEATED_TYPING');
    tick(world, T0 + 5000 + IDLE_AFTER_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });

  it('SessionEnd despawns an agent and frees its desk after the dissolve', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    const deskId = world.agents.get('s1')!.deskId!;

    hook(world, sessionEnd('s1', T0 + 10_000), T0 + 10_000);
    expect(world.agents.get('s1')!.state).toBe('DESPAWNING');
    expect(world.desks.occupantOf(deskId)).toBe('s1'); // still held through the dissolve

    tick(world, T0 + 10_000 + DESPAWN_DISSOLVE_MS + 1);
    expect(world.agents.get('s1')).toBeUndefined();
    expect(world.desks.occupantOf(deskId)).toBeNull();
  });
});

describe('machine — delegation (SEATED_* -> DELEGATING -> SEATED_TYPING)', () => {
  it('a Task tool call sends the parent briefly into DELEGATING, then back to SEATED_TYPING', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    world.agents.get('s1')!.state = 'SEATED_TYPING';

    hook(world, taskTool('s1', T0 + 100), T0 + 100);
    expect(world.agents.get('s1')!.state).toBe('DELEGATING');

    tick(world, T0 + 100 + BUBBLE_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SEATED_TYPING');
  });
});

describe('machine — subagent choreography (office-simulation spec)', () => {
  it('plays the full ordered sequence: walk to parent, bubble, secondary desk, report, lounge rest, despawn', () => {
    const world = createWorld();
    hook(world, sessionStart('parent', T0), T0);
    tickUntil(world, T0, () => world.agents.get('parent')!.state !== 'WALKING');

    let now = T0 + 1000;
    hook(world, subagentStart('parent', 'sub-1', now), now);
    const sub = world.agents.get('sub-1')!;
    expect(sub.state).toBe('WALKING'); // (1) walking to parent's desk

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'WALKING');
    expect(world.agents.get('sub-1')!.state).toBe('DELEGATING'); // (2) speech bubble at parent's desk
    expect(world.agents.get('sub-1')!.taskText).toBe('help out');

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'DELEGATING');
    expect(world.agents.get('sub-1')!.state).toBe('WALKING'); // heading to a secondary desk
    expect(world.agents.get('sub-1')!.deskId).not.toBeNull();

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'WALKING');
    expect(['SEATED_TYPING', 'SEATED_IDLE']).toContain(world.agents.get('sub-1')!.state); // (3) occupies secondary desk

    hook(world, subagentStop('parent', 'sub-1', now + 500, true), now + 500);
    now += 500;
    expect(world.agents.get('sub-1')!.state).toBe('REPORTING'); // (4) walking back to report
    expect(world.agents.get('sub-1')!.deskId).toBeNull(); // secondary desk released immediately on SubagentStop

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.bubbleUntil !== null);
    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'REPORTING');
    expect(world.agents.get('sub-1')!.state).toBe('LOUNGING'); // (5) walking to / resting on a lounge seat

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.loungeRestUntil !== null);
    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state === 'DESPAWNING', 500, SUBAGENT_LOUNGE_REST_MS + 5000);
    expect(world.agents.get('sub-1')!.state).toBe('DESPAWNING'); // (6) exits the floor

    tick(world, now + DESPAWN_DISSOLVE_MS + 1);
    expect(world.agents.get('sub-1')).toBeUndefined();
  });

  it('queues in the lounge under the same overflow rule when no secondary desk is free', () => {
    const world = createWorld();
    hook(world, sessionStart('parent', T0), T0);
    let now = tickUntil(world, T0, () => world.agents.get('parent')!.state !== 'WALKING');
    // Fill the remaining 11 desks so none is free for the subagent.
    fillAllDesks(world, now, 11);

    now += 100;
    hook(world, subagentStart('parent', 'sub-1', now), now);
    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'WALKING');
    expect(world.agents.get('sub-1')!.state).toBe('DELEGATING');

    now = tickUntil(world, now, () => world.agents.get('sub-1')!.state !== 'DELEGATING');
    expect(world.agents.get('sub-1')!.state).toBe('QUEUED');
    expect(world.agents.get('sub-1')!.deskId).toBeNull();
  });
});

describe('machine — heartbeat timeout chain (decisions 7 & 10)', () => {
  it('goes 15min silent -> SLEEPING -> +2min -> ZOMBIE (desk freed here) -> lap -> DESPAWNING -> removed', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    const deskId = world.agents.get('s1')!.deskId!;

    tick(world, T0 + HEARTBEAT_TIMEOUT_MS - 1);
    expect(world.agents.get('s1')!.state).not.toBe('SLEEPING');

    tick(world, T0 + HEARTBEAT_TIMEOUT_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SLEEPING');
    expect(world.desks.occupantOf(deskId)).toBe('s1'); // still held while merely sleeping

    const zombieAt = T0 + HEARTBEAT_TIMEOUT_MS + ZOMBIE_AFTER_MS + 1;
    tick(world, zombieAt);
    expect(world.agents.get('s1')!.state).toBe('ZOMBIE');
    // Desk is freed at the ZOMBIE transition, not at removal.
    expect(world.desks.occupantOf(deskId)).toBeNull();

    tick(world, zombieAt + ZOMBIE_LAP_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('DESPAWNING');

    tick(world, zombieAt + ZOMBIE_LAP_MS + DESPAWN_DISSOLVE_MS + 2);
    expect(world.agents.get('s1')).toBeUndefined();
  });

  it('a heartbeat before the 15-minute mark cancels the countdown', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    const almostTimeout = T0 + HEARTBEAT_TIMEOUT_MS - 60_000;
    tick(world, almostTimeout);
    hook(world, userPrompt('s1', almostTimeout), almostTimeout);

    tick(world, almostTimeout + HEARTBEAT_TIMEOUT_MS - 1000);
    expect(world.agents.get('s1')!.state).not.toBe('SLEEPING');
  });

  it('a heartbeat while SLEEPING cancels the chain back to SEATED_IDLE (decision 7)', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    tick(world, T0 + HEARTBEAT_TIMEOUT_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SLEEPING');

    // Stop carries no follow-on SEATED_IDLE -> SEATED_TYPING transition, so
    // it isolates the wake-to-SEATED_IDLE behavior cleanly.
    const wakeAt = T0 + HEARTBEAT_TIMEOUT_MS + 5000;
    hook(world, stopEvent('s1', wakeAt), wakeAt);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });

  it('a heartbeat while ZOMBIE cancels the chain back to SEATED_IDLE and reallocates a desk (decision 7)', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    tick(world, T0 + HEARTBEAT_TIMEOUT_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SLEEPING');

    const zombieAt = T0 + HEARTBEAT_TIMEOUT_MS + ZOMBIE_AFTER_MS + 1;
    tick(world, zombieAt);
    expect(world.agents.get('s1')!.state).toBe('ZOMBIE');
    expect(world.agents.get('s1')!.deskId).toBeNull();

    const wakeAt = zombieAt + 1000;
    hook(world, stopEvent('s1', wakeAt), wakeAt);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
    expect(world.agents.get('s1')!.deskId).not.toBeNull();
  });
});

describe('machine — role hysteresis and the ZOMBIE role override', () => {
  it('requires three consecutive same-role classifications before flipping the displayed role', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, bash('s1', T0 + 100, 'npm install'), T0 + 100); // Builder, exact match
    expect(world.agents.get('s1')!.classifiedRole).toBe('Builder');

    // One stray Read mid-build does not flip Builder -> Detective.
    hook(world, readTool('s1', T0 + 200), T0 + 200);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Builder');

    hook(world, bash('s1', T0 + 300, 'npm install'), T0 + 300);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Builder');

    // Three consecutive Read/Grep/Glob-shaped events flip it to Detective.
    hook(world, readTool('s1', T0 + 400), T0 + 400);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Builder');
    hook(world, readTool('s1', T0 + 500), T0 + 500);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Builder');
    hook(world, readTool('s1', T0 + 600), T0 + 600);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Detective');
  });

  it('ZOMBIE overrides the effective displayed role to Revenant regardless of prior classification', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    hook(world, editTool('s1', T0 + 100), T0 + 100);
    expect(world.agents.get('s1')!.classifiedRole).toBe('Scribe');
    expect(effectiveRole(world.agents.get('s1')!)).toBe('Scribe');

    // Heartbeat resets from the last real event (the Edit at T0+100), not T0.
    tick(world, T0 + 100 + HEARTBEAT_TIMEOUT_MS + 1);
    expect(world.agents.get('s1')!.state).toBe('SLEEPING');
    const zombieAt = T0 + 100 + HEARTBEAT_TIMEOUT_MS + ZOMBIE_AFTER_MS + 1;
    tick(world, zombieAt);
    expect(world.agents.get('s1')!.state).toBe('ZOMBIE');
    expect(effectiveRole(world.agents.get('s1')!)).toBe('Revenant');
    // The underlying classification history is preserved, not destroyed.
    expect(world.agents.get('s1')!.classifiedRole).toBe('Scribe');
  });
});

describe('machine — teddy-bear debugging streak tracking (P1 hook surface)', () => {
  it('tracks 3 consecutive failing Bash exits and clears on success', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, postBash('s1', T0 + 100, false, 1), T0 + 100);
    hook(world, postBash('s1', T0 + 200, false, 1), T0 + 200);
    const effects = hook(world, postBash('s1', T0 + 300, false, 1), T0 + 300);
    expect(world.agents.get('s1')!.bashFailureStreak).toBe(3);
    expect(world.agents.get('s1')!.owesBow).toBe(true);
    expect(effects.some((e) => e.kind === 'bashFailureStreak' && e.streak === 3)).toBe(true);

    const successEffects = hook(world, postBash('s1', T0 + 400, true, 0), T0 + 400);
    expect(world.agents.get('s1')!.bashFailureStreak).toBe(0);
    expect(world.agents.get('s1')!.owesBow).toBe(false);
    expect(successEffects.some((e) => e.kind === 'bashSuccessAfterStreak')).toBe(true);
  });
});

describe('machine — P1 coffee runs', () => {
  it('an idle agent wanders to the kitchen and back, emitting coffeeSipped on arrival', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');
    const agent = world.agents.get('s1')!;
    agent.state = 'SEATED_IDLE';
    agent.lastActivityAt = T0;

    let sawCoffeeSipped = false;
    let now = T0;
    const end = T0 + COFFEE_IDLE_THRESHOLD_MS + 60_000;
    while (now < end) {
      now += 250;
      const effects = tick(world, now);
      if (effects.some((e) => e.kind === 'coffeeSipped')) sawCoffeeSipped = true;
      if (sawCoffeeSipped && world.agents.get('s1')!.state === 'SEATED_IDLE' && !world.agents.get('s1')!.onCoffeeRun) break;
    }

    expect(sawCoffeeSipped).toBe(true);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
    expect(world.agents.get('s1')!.onCoffeeRun).toBe(false);
  });
});

describe('machine — P1 teddy-bear debugging (full walk + bow)', () => {
  it('walks to the bear on the 3rd consecutive failure and bows back on the next success', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, bash('s1', T0 + 100, 'pnpm build'), T0 + 100);
    hook(world, postBash('s1', T0 + 110, false, 1), T0 + 110);
    hook(world, bash('s1', T0 + 200, 'pnpm build'), T0 + 200);
    hook(world, postBash('s1', T0 + 210, false, 1), T0 + 210);
    hook(world, bash('s1', T0 + 300, 'pnpm build'), T0 + 300);
    hook(world, postBash('s1', T0 + 310, false, 1), T0 + 310);

    expect(world.agents.get('s1')!.atBear).toBe(true);
    expect(world.agents.get('s1')!.state).toBe('WALKING');

    const now = tickUntil(world, T0 + 310, () => world.agents.get('s1')!.state === 'LOUNGING');
    expect(world.agents.get('s1')!.atBear).toBe(true);

    hook(world, bash('s1', now + 100, 'pnpm build'), now + 100);
    const effects = hook(world, postBash('s1', now + 110, true, 0), now + 110);
    expect(effects.some((e) => e.kind === 'bashSuccessAfterStreak')).toBe(true);
    expect(world.agents.get('s1')!.atBear).toBe(false);
    expect(world.agents.get('s1')!.state).toBe('WALKING'); // walking back to its desk to bow off

    tickUntil(world, now + 110, () => world.agents.get('s1')!.state !== 'WALKING');
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });
});

describe('machine — P1 ship-it detection (never on retry)', () => {
  it('does not celebrate a pass that immediately follows a failure of the same shape', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, bash('s1', T0 + 100, 'pnpm test'), T0 + 100);
    hook(world, postBash('s1', T0 + 110, false, 1), T0 + 110);

    hook(world, bash('s1', T0 + 200, 'pnpm test'), T0 + 200);
    const retryEffects = hook(world, postBash('s1', T0 + 210, true, 0), T0 + 210);
    expect(retryEffects.some((e) => e.kind === 'shipIt')).toBe(false);
  });

  it('celebrates a fresh test-runner pass that was not a retry-after-fail', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, bash('s1', T0 + 100, 'pnpm test'), T0 + 100);
    const effects = hook(world, postBash('s1', T0 + 110, true, 0), T0 + 110);
    expect(effects.some((e) => e.kind === 'shipIt')).toBe(true);
  });

  it('does not celebrate a non-test-runner Bash success', () => {
    const world = createWorld();
    hook(world, sessionStart('s1', T0), T0);
    tickUntil(world, T0, () => world.agents.get('s1')!.state !== 'WALKING');

    hook(world, bash('s1', T0 + 100, 'ls -la'), T0 + 100);
    const effects = hook(world, postBash('s1', T0 + 110, true, 0), T0 + 110);
    expect(effects.some((e) => e.kind === 'shipIt')).toBe(false);
  });
});

describe('machine — P1 The Architect NPC', () => {
  it('defaults to Idle_FoldArms_Loop and reverts after triggerArchitectReaction elapses', () => {
    const world = createWorld();
    const architect = world.npcs.get(ARCHITECT_NPC_ID)!;
    expect(architect.clip).toBe('Idle_FoldArms_Loop');

    triggerArchitectReaction(world, T0);
    expect(world.npcs.get(ARCHITECT_NPC_ID)!.clip).toBe('Idle_No_Loop');

    tick(world, T0 + ARCHITECT_REACTION_MS - 1);
    expect(world.npcs.get(ARCHITECT_NPC_ID)!.clip).toBe('Idle_No_Loop');

    tick(world, T0 + ARCHITECT_REACTION_MS + 1);
    expect(world.npcs.get(ARCHITECT_NPC_ID)!.clip).toBe('Idle_FoldArms_Loop');
  });
});

describe('role classification never regresses to the fallback', () => {
  const hook = (
    event: string,
    data: Record<string, unknown>,
    sessionId = 'sess-1'
  ): HookEventPayload =>
    ({
      v: 1,
      event,
      sessionId,
      parentSessionId: null,
      machineId: 'eze-desktop',
      cwd: '/home/eze/projects/thing',
      project: 'thing',
      identityKey: 'id-abc',
      ts: Date.now(),
      data,
    }) as unknown as HookEventPayload;

  /**
   * Regression: an opening `UserPromptSubmit` classifies to the fallback, and
   * used to consume the one-shot first-classification exemption. The session
   * then needed three more matching events to escape Temp, so a real session
   * spent its first minutes as a faceless grey placeholder purely because it
   * happened to start with a prompt instead of a tool call.
   */
  it('an unclassifiable first prompt does not lock the agent to the fallback', () => {
    const world = createWorld();
    const now = Date.now();

    reduce(world, { kind: 'hook', payload: hook('SessionStart', { source: 'startup', model: 'x' }) }, now);
    reduce(
      world,
      { kind: 'hook', payload: hook('UserPromptSubmit', { promptSummary: 'do the thing', promptLength: 12 }) },
      now
    );
    reduce(
      world,
      {
        kind: 'hook',
        payload: hook('PreToolUse', {
          tool: 'Bash',
          toolUseId: 't1',
          input: { command: 'docker compose up -d', argv0: 'docker' },
        }),
      },
      now
    );

    const agent = world.agents.get('sess-1');
    expect(agent).toBeDefined();
    expect(agent!.classifiedRole).not.toBe(FALLBACK_ROLE);
    expect(agent!.skin).not.toBe('BaseCharacter');
  });

  it('a later unclassifiable event does not demote an already-known role', () => {
    const world = createWorld();
    const now = Date.now();

    reduce(world, { kind: 'hook', payload: hook('SessionStart', { source: 'startup', model: 'x' }) }, now);
    reduce(
      world,
      {
        kind: 'hook',
        payload: hook('PreToolUse', {
          tool: 'Bash',
          toolUseId: 't1',
          input: { command: 'docker compose up -d', argv0: 'docker' },
        }),
      },
      now
    );
    const known = world.agents.get('sess-1')!.classifiedRole;
    expect(known).not.toBe(FALLBACK_ROLE);

    // Three unclassifiable events in a row must not build a streak toward Temp.
    for (let i = 0; i < 3; i += 1) {
      reduce(
        world,
        { kind: 'hook', payload: hook('UserPromptSubmit', { promptSummary: 'hmm', promptLength: 3 }) },
        now
      );
    }
    expect(world.agents.get('sess-1')!.classifiedRole).toBe(known);
  });
});
