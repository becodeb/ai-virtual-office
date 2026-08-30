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

describe('machine — off-desk breaks', () => {
  /** Runs the world forward until `done`, or gives up. Returns every state the agent passed through. */
  function runBreak(agentId: string, world: WorldState, from: number, budgetMs: number) {
    const seen = new Set<string>();
    let now = from;
    while (now < from + budgetMs) {
      now += 250;
      tick(world, now);
      const agent = world.agents.get(agentId);
      if (agent !== undefined) seen.add(agent.state);
    }
    return seen;
  }

  function idleAgentAtDesk(id: string) {
    const world = createWorld();
    hook(world, sessionStart(id, T0), T0);
    tickUntil(world, T0, () => world.agents.get(id)!.state !== 'WALKING');
    const agent = world.agents.get(id)!;
    agent.state = 'SEATED_IDLE';
    agent.lastActivityAt = T0;
    return world;
  }

  /**
   * The office has a kitchen and a television and, until breaks existed,
   * nobody ever used either: characters sat perfectly still at their desks
   * until they timed out, which is most of what made a furnished floor still
   * look deserted.
   */
  it('an idle agent leaves its desk, does something, and comes back', () => {
    const world = idleAgentAtDesk('s1');
    // Breaks repeat, so the state at the end of a long run is arbitrary. What
    // matters is that one whole trip completes: away from the desk and back.
    let left = false;
    let returned = false;
    let now = T0;
    while (now < T0 + COFFEE_IDLE_THRESHOLD_MS + 150_000 && !returned) {
      now += 250;
      tick(world, now);
      const agent = world.agents.get('s1')!;
      if (agent.onCoffeeRun) left = true;
      if (left && !agent.onCoffeeRun) returned = true;
    }

    expect(left, 'the agent never left its desk').toBe(true);
    expect(returned, 'the agent left and never came back').toBe(true);
    expect(world.agents.get('s1')!.state).toBe('SEATED_IDLE');
  });

  it('over many sessions, breaks use the kitchen, the stove and the couch', () => {
    const destinations = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const world = idleAgentAtDesk(`s${i}`);
      const states = runBreak(`s${i}`, world, T0, COFFEE_IDLE_THRESHOLD_MS + 90_000);
      for (const state of ['COOKING', 'WATCHING_TV']) if (states.has(state)) destinations.add(state);
      // The coffee run has no state of its own; it announces itself as an effect.
    }
    expect(destinations, 'nobody ever cooked or watched television').not.toHaveLength(0);
  });

  it('still emits coffeeSipped when the break is a coffee run', () => {
    let sawCoffee = false;
    for (let i = 0; i < 12 && !sawCoffee; i++) {
      const world = idleAgentAtDesk(`c${i}`);
      let now = T0;
      while (now < T0 + COFFEE_IDLE_THRESHOLD_MS + 90_000) {
        now += 250;
        if (tick(world, now).some((e) => e.kind === 'coffeeSipped')) sawCoffee = true;
      }
    }
    expect(sawCoffee).toBe(true);
  });

  it('never seats two agents on the same couch', () => {
    const world = createWorld();
    for (let i = 0; i < 6; i++) {
      hook(world, sessionStart(`m${i}`, T0), T0);
    }
    tickUntil(world, T0, () => [...world.agents.values()].every((a) => a.state !== 'WALKING'));
    for (const agent of world.agents.values()) {
      agent.state = 'SEATED_IDLE';
      agent.lastActivityAt = T0;
    }
    let now = T0;
    while (now < T0 + COFFEE_IDLE_THRESHOLD_MS + 120_000) {
      now += 250;
      tick(world, now);
      const claimed = [...world.agents.values()]
        .map((a) => a.couchCell)
        .filter((c): c is [number, number] => c !== null)
        .map((c) => `${c[0]},${c[1]}`);
      expect(new Set(claimed).size, 'two agents claimed the same couch').toBe(claimed.length);
    }
  });
});
