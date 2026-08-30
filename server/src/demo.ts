/**
 * Demo mode: a small cast of synthetic sessions so the office is alive the
 * first time somebody opens it.
 *
 * An empty office is indistinguishable from a broken one. Before any hook is
 * installed there is nothing on screen but furniture, and no way to tell
 * whether the thing works. Demo mode answers that in the first five seconds.
 *
 * These are not a separate simulation. Each demo session emits real
 * `HookEventPayload`s through the same `/events` reduction the shell hook
 * feeds, so it exercises the actual classifier, state machine, pathfinding and
 * broadcast path. If demo mode looks right, the real thing works.
 *
 * Every demo machine is named `demo-*` so nobody mistakes one for a colleague.
 */
import type { HookEventPayload } from '@virtual-office/shared';

export const DEMO_MACHINE_PREFIX = 'demo-';

interface DemoScript {
  sessionId: string;
  machineId: string;
  project: string;
  /** Seconds from start, and the event to emit at that point. */
  beats: Array<{ at: number; event: () => Partial<HookEventPayload> & { event: string; data: unknown } }>;
}

const hook = (event: string, data: unknown) => () => ({ event, data }) as never;

/**
 * A short loop of plausible office life: a builder, a tester, a reader who
 * force-pushes, and a delegation that spawns an intern. Roughly 90 seconds,
 * then it repeats with fresh session ids.
 */
function buildScripts(cycle: number): DemoScript[] {
  const s = (name: string) => `demo-${name}-${cycle}`;
  return [
    {
      sessionId: s('nico'),
      machineId: `${DEMO_MACHINE_PREFIX}nico`,
      project: 'checkout-api',
      beats: [
        { at: 1, event: hook('SessionStart', { source: 'startup', model: 'claude-opus-5' }) },
        { at: 4, event: hook('UserPromptSubmit', { promptSummary: 'get the docker build green again', promptLength: 34 }) },
        {
          at: 7,
          event: hook('PreToolUse', {
            tool: 'Bash',
            toolUseId: 'd1',
            input: { command: 'docker compose build --no-cache', argv0: 'docker' },
          }),
        },
        { at: 20, event: hook('Stop', { reason: 'complete' }) },
        { at: 70, event: hook('SessionEnd', { reason: 'exit' }) },
      ],
    },
    {
      sessionId: s('vale'),
      machineId: `${DEMO_MACHINE_PREFIX}vale`,
      project: 'billing',
      beats: [
        { at: 3, event: hook('SessionStart', { source: 'startup', model: 'claude-opus-5' }) },
        { at: 6, event: hook('UserPromptSubmit', { promptSummary: 'why is the invoice total off by a cent', promptLength: 38 }) },
        {
          at: 9,
          event: hook('PreToolUse', { tool: 'Bash', toolUseId: 'd2', input: { command: 'pnpm vitest run', argv0: 'pnpm' } }),
        },
        {
          at: 14,
          event: hook('PostToolUse', {
            tool: 'Bash',
            toolUseId: 'd2',
            exitCode: 0,
            ok: true,
            durationMs: 4200,
            outputSummary: '42 passed',
          }),
        },
        { at: 30, event: hook('Stop', { reason: 'complete' }) },
        { at: 80, event: hook('SessionEnd', { reason: 'exit' }) },
      ],
    },
    {
      sessionId: s('juan'),
      machineId: `${DEMO_MACHINE_PREFIX}juan`,
      project: 'landing',
      beats: [
        { at: 5, event: hook('SessionStart', { source: 'startup', model: 'claude-opus-5' }) },
        { at: 8, event: hook('PreToolUse', { tool: 'Read', toolUseId: 'd3', input: { path: 'src/hero.tsx', ext: '.tsx' } }) },
        // The one everybody notices.
        {
          at: 24,
          event: hook('PreToolUse', {
            tool: 'Bash',
            toolUseId: 'd4',
            input: { command: 'git push --force origin main', argv0: 'git' },
          }),
        },
        { at: 40, event: hook('Stop', { reason: 'complete' }) },
        { at: 85, event: hook('SessionEnd', { reason: 'exit' }) },
      ],
    },
    {
      sessionId: s('nico'),
      machineId: `${DEMO_MACHINE_PREFIX}nico`,
      project: 'checkout-api',
      beats: [
        {
          at: 12,
          event: hook('SubagentStart', {
            subagentId: `demo-intern-${cycle}`,
            subagentType: 'Explore',
            model: 'claude-haiku-4-5',
            taskSummary: 'find every place the old price field is still read',
          }),
        },
        { at: 46, event: hook('SubagentStop', { subagentId: `demo-intern-${cycle}`, ok: true }) },
      ],
    },
  ];
}

/** One cycle of the demo loop, in seconds. */
export const DEMO_CYCLE_SECONDS = 95;

export interface DemoDriverOptions {
  /** Receives each synthesized payload exactly as `/events` would. */
  emit: (payload: HookEventPayload) => void;
  now?: () => number;
}

/**
 * Drives the demo cast. Call {@link DemoDriver.tick} from the existing server
 * tick — it needs no timer of its own, so it cannot outlive the hub.
 */
export class DemoDriver {
  private readonly startedAt: number;
  private readonly emit: (payload: HookEventPayload) => void;
  private readonly fired = new Set<string>();
  private cycle = 0;

  constructor(options: DemoDriverOptions) {
    this.emit = options.emit;
    this.startedAt = (options.now ?? (() => Date.now()))();
  }

  tick(now: number): void {
    const elapsed = (now - this.startedAt) / 1000;
    const cycle = Math.floor(elapsed / DEMO_CYCLE_SECONDS);
    if (cycle !== this.cycle) {
      this.cycle = cycle;
      this.fired.clear();
    }
    const withinCycle = elapsed - cycle * DEMO_CYCLE_SECONDS;

    for (const script of buildScripts(cycle)) {
      for (const beat of script.beats) {
        const key = `${script.sessionId}:${beat.at}:${cycle}`;
        if (beat.at > withinCycle || this.fired.has(key)) continue;
        this.fired.add(key);
        const partial = beat.event();
        this.emit({
          v: 1,
          sessionId: script.sessionId,
          parentSessionId: null,
          machineId: script.machineId,
          cwd: `/demo/${script.project}`,
          project: script.project,
          identityKey: `demo${script.machineId}`.slice(0, 12),
          ts: now,
          ...partial,
        } as HookEventPayload);
      }
    }
  }
}

/** True when the office should populate itself with the demo cast. */
export function demoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OFFICE_DEMO === 'true';
}
