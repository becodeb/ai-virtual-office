/**
 * Hook -> hub wire contract.
 *
 * Every Claude Code lifecycle event the hook observes is serialised into one
 * JSON object matching {@link HookEventPayload} and POSTed to the hub's
 * `/events` endpoint. `v` is the payload version and evolves independently of
 * the WebSocket protocol version in `protocol.ts`.
 *
 * The hook script itself (`hooks/office-hook.js`) does NOT import this file —
 * it must stay dependency-free to survive inside any Claude Code session.
 * Its emitted shape is instead asserted against these types in a contract
 * test (see `hooks/office-hook.test.ts`).
 */

/** The eight Claude Code lifecycle events the office observes. */
export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop'
  | 'SessionEnd';

/** Frozen, classifier-facing summary of a tool's input. Never the raw input. */
export type ToolInputSummary =
  | { command: string; argv0: string }
  | { path: string; ext: string }
  | { path: string; pattern: string }
  | { query: string; host: string }
  | { subagentType: string; model: string; taskSummary: string }
  | Record<string, never>;

export interface SessionStartData {
  source: string;
  model: string;
}

export interface UserPromptSubmitData {
  /** Truncated to <= 80 chars (decision 3). Dropped under redaction. */
  promptSummary: string;
  promptLength: number;
}

export interface PreToolUseData {
  tool: string;
  toolUseId: string;
  input: ToolInputSummary;
}

export interface PostToolUseData {
  tool: string;
  toolUseId: string;
  /** `null` for non-Bash tools. */
  exitCode: number | null;
  ok: boolean;
  durationMs: number;
  /** Truncated to <= 80 chars. Dropped under redaction. */
  outputSummary: string;
}

export interface SubagentStartData {
  subagentId: string;
  subagentType: string;
  model: string;
  /** Truncated to <= 80 chars. Dropped under redaction. */
  taskSummary: string;
}

export interface SubagentStopData {
  subagentId: string;
  ok: boolean;
}

export interface StopData {
  reason: string;
}

export interface SessionEndData {
  reason: string;
}

/** Maps each event name to its `data` payload shape. */
export interface HookEventDataMap {
  SessionStart: SessionStartData;
  UserPromptSubmit: UserPromptSubmitData;
  PreToolUse: PreToolUseData;
  PostToolUse: PostToolUseData;
  SubagentStart: SubagentStartData;
  SubagentStop: SubagentStopData;
  Stop: StopData;
  SessionEnd: SessionEndData;
}

/** Current hook payload schema version. Independent of the WS protocol version. */
export const WIRE_PAYLOAD_VERSION = 1 as const;

/** One event, as sent by the hook and received by the hub's `POST /events`. */
export type HookEventPayload<E extends HookEventName = HookEventName> = {
  [K in E]: {
    v: typeof WIRE_PAYLOAD_VERSION;
    event: K;
    sessionId: string;
    parentSessionId: string | null;
    machineId: string;
    cwd: string;
    project: string;
    /** `sha256(machineId + " " + cwd).hex.slice(0, 12)` — stable across restarts. */
    identityKey: string;
    /** `Date.now()` at hook entry; ordering hint only, never treated as a clock. */
    ts: number;
    data: HookEventDataMap[K];
  };
}[E];

/** Maximum accepted `/events` request body size, in bytes (design threat matrix). */
export const MAX_EVENT_BODY_BYTES = 16 * 1024;

/** Maximum length for any free-text field before server-side re-truncation. */
export const MAX_TEXT_FIELD_LENGTH = 80;

/** Environment variable that drops task/prompt text from every outgoing payload. */
export const REDACT_PROMPTS_ENV_VAR = 'OFFICE_REDACT_PROMPTS';
