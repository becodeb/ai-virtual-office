/**
 * Server-side normalisation of the two body shapes `POST /events` accepts.
 *
 * Decision 8 makes `hooks/office-hook.sh` (POSIX `sh` + `curl`) the primary
 * hook: it pipes Claude Code's raw stdin envelope straight to `curl`, with
 * no transformation, because reaching for `jq` to build a
 * {@link HookEventPayload} client-side would destroy the entire reason `sh`
 * is the primary implementation (measured 3ms vs. Node's 44ms — see
 * `openspec/research/hook-performance.md`). The Node fallback hook
 * (`hooks/office-hook.js`) *does* build a full `HookEventPayload` itself.
 *
 * `POST /events` therefore discriminates on the presence of the `v` field:
 * - `v` present  -> already a `HookEventPayload`. Validate and use as-is.
 * - `v` absent   -> a raw Claude Code hook envelope (snake_case). Normalise
 *   it into a `HookEventPayload` here.
 *
 * This module is Node-only (`node:crypto` for `identityKey`) and is
 * therefore NOT re-exported from the package's main barrel (`index.ts`),
 * which is also imported by the browser client. Import it via the
 * `@virtual-office/shared/normalize` subpath.
 */
import { createHash } from 'node:crypto';
import { WIRE_PAYLOAD_VERSION, MAX_TEXT_FIELD_LENGTH, type HookEventName, type HookEventPayload, type ToolInputSummary } from './wire.js';

/** The raw, snake_case envelope Claude Code writes to a hook's stdin. Shape not fully documented upstream; every field is optional and defensively read. */
export interface RawClaudeCodeHookEnvelope {
  hook_event_name?: string;
  session_id?: string;
  parent_session_id?: string | null;
  cwd?: string;
  tool_name?: string;
  tool_use_id?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  source?: string;
  model?: string;
  subagent_id?: string;
  agent_id?: string;
  subagent_type?: string;
  agent_type?: string;
  task?: string;
  description?: string;
  reason?: string;
  duration_ms?: number;
  timestamp?: number;
  [key: string]: unknown;
}

export interface NormalizeContext {
  /** From the `x-office-machine` request header the sh hook sets, falling back to the remote address, then `"unknown"`. */
  machineId: string;
  /** Server receive time, used when the raw envelope carries no timestamp. */
  now: number;
}

const SUPPORTED_EVENTS: ReadonlySet<string> = new Set<HookEventName>([
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'SessionEnd',
]);

function truncate(value: string, max = MAX_TEXT_FIELD_LENGTH): string {
  return value.length > max ? value.slice(0, max) : value;
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function extOf(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reduces an arbitrary raw `tool_input` object down to the frozen
 * {@link ToolInputSummary} shape for `tool`, per design.md §1. Never throws;
 * an unrecognised shape yields `{}`.
 */
export function summarizeToolInput(tool: string, rawInput: unknown): ToolInputSummary {
  const input = asRecord(rawInput);
  switch (tool) {
    case 'Bash': {
      const command = asString(input.command);
      return { command: truncate(command, 120), argv0: command.trim().split(/\s+/)[0] ?? '' };
    }
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const path = asString(input.file_path ?? input.notebook_path ?? input.path);
      return { path, ext: extOf(path) };
    }
    case 'Read':
    case 'Grep':
    case 'Glob': {
      const path = asString(input.file_path ?? input.path);
      const pattern = asString(input.pattern);
      return { path, pattern };
    }
    case 'WebSearch':
    case 'WebFetch': {
      const query = asString(input.query ?? input.prompt);
      const url = asString(input.url);
      let host = '';
      if (url) {
        try {
          host = new URL(url).host;
        } catch {
          host = '';
        }
      }
      return { query, host };
    }
    case 'Task': {
      return {
        subagentType: asString(input.subagent_type),
        model: asString(input.model),
        taskSummary: truncate(asString(input.description ?? input.prompt)),
      };
    }
    default:
      return {};
  }
}

/** Best-effort `{exitCode, ok, outputSummary}` derivation from an arbitrary `tool_response`. */
function summarizeToolResponse(rawResponse: unknown): { exitCode: number | null; ok: boolean; outputSummary: string } {
  const response = asRecord(rawResponse);
  const explicitCode = response.exitCode ?? response.exit_code ?? response.code;
  const exitCode = typeof explicitCode === 'number' ? explicitCode : null;

  const isError = response.is_error === true || response.isError === true;
  const stderr = asString(response.stderr);
  const stdout = asString(response.stdout);
  const ok = exitCode !== null ? exitCode === 0 : !isError;

  const outputSummary = truncate(stderr || stdout || '');
  return { exitCode, ok, outputSummary };
}

/** `sha256(machineId + " " + cwd).hex.slice(0, 12)` — exactly as `wire.ts` documents `identityKey`. */
export function computeIdentityKey(machineId: string, cwd: string): string {
  return createHash('sha256').update(`${machineId} ${cwd}`).digest('hex').slice(0, 12);
}

function buildData(eventName: HookEventName, raw: RawClaudeCodeHookEnvelope): HookEventPayload['data'] {
  switch (eventName) {
    case 'SessionStart':
      return { source: asString(raw.source) || 'unknown', model: asString(raw.model) || 'unknown' };
    case 'UserPromptSubmit': {
      const prompt = asString(raw.prompt);
      return { promptSummary: truncate(prompt), promptLength: prompt.length };
    }
    case 'PreToolUse': {
      const tool = asString(raw.tool_name) || 'unknown';
      return { tool, toolUseId: asString(raw.tool_use_id), input: summarizeToolInput(tool, raw.tool_input) };
    }
    case 'PostToolUse': {
      const tool = asString(raw.tool_name) || 'unknown';
      const { exitCode, ok, outputSummary } = summarizeToolResponse(raw.tool_response);
      return {
        tool,
        toolUseId: asString(raw.tool_use_id),
        exitCode,
        ok,
        durationMs: typeof raw.duration_ms === 'number' ? raw.duration_ms : 0,
        outputSummary,
      };
    }
    case 'SubagentStart':
      return {
        subagentId: asString(raw.subagent_id ?? raw.agent_id),
        subagentType: asString(raw.subagent_type ?? raw.agent_type) || 'unknown',
        model: asString(raw.model) || 'unknown',
        taskSummary: truncate(asString(raw.task ?? raw.description ?? raw.prompt)),
      };
    case 'SubagentStop':
      return { subagentId: asString(raw.subagent_id ?? raw.agent_id), ok: raw.reason === undefined || raw.reason === 'success' };
    case 'Stop':
      return { reason: asString(raw.reason) || 'stop' };
    case 'SessionEnd':
      return { reason: asString(raw.reason) || 'end' };
  }
}

/**
 * Normalises a raw Claude Code hook envelope (as piped through unmodified by
 * `hooks/office-hook.sh`) into a {@link HookEventPayload}. Returns `null`
 * when `hook_event_name` is missing or not one of the eight supported
 * events (e.g. `PreCompact`, `Notification`) — the caller drops the event
 * without mutating world state, per the untrusted-network-input threat
 * matrix row.
 */
export function normalizeRawClaudeCodeEvent(raw: RawClaudeCodeHookEnvelope, ctx: NormalizeContext): HookEventPayload | null {
  const eventName = raw.hook_event_name;
  if (typeof eventName !== 'string' || !SUPPORTED_EVENTS.has(eventName)) {
    return null;
  }
  const event = eventName as HookEventName;
  const sessionId = asString(raw.session_id);
  if (!sessionId) return null;

  const cwd = asString(raw.cwd);
  const project = cwd ? basename(cwd) : 'unknown';
  const identityKey = computeIdentityKey(ctx.machineId, cwd);

  return {
    v: WIRE_PAYLOAD_VERSION,
    event,
    sessionId,
    parentSessionId: (raw.parent_session_id as string | null | undefined) ?? null,
    machineId: ctx.machineId,
    cwd,
    project,
    identityKey,
    ts: typeof raw.timestamp === 'number' ? raw.timestamp : ctx.now,
    data: buildData(event, raw),
  } as HookEventPayload;
}

/** Type guard for the already-structured shape the Node fallback hook emits. */
export function isHookEventPayloadShape(body: unknown): body is { v: unknown } & Record<string, unknown> {
  return body !== null && typeof body === 'object' && 'v' in body;
}
