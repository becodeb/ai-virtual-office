/**
 * `/events` payload validation, per design.md's untrusted-network-input
 * threat-matrix row and decision 3 (redaction is enforced at the hub, one
 * variable, one place — here).
 *
 * Discriminates the two accepted body shapes (see
 * `@virtual-office/shared/normalize`): a `HookEventPayload` from the Node
 * fallback hook (has `v`), or a raw Claude Code envelope from the primary
 * `sh` hook (no `v`), normalised server-side. Either way, the resulting
 * payload is re-validated and its text fields are re-truncated/redacted
 * here — the hub never trusts a hook's own truncation.
 */
import {
  MAX_EVENT_BODY_BYTES,
  MAX_TEXT_FIELD_LENGTH,
  type HookEventName,
  type HookEventPayload,
  type ToolInputSummary,
} from '@virtual-office/shared';
import {
  SUPPORTED_EVENTS,
  isHookEventPayloadShape,
  normalizeRawClaudeCodeEvent,
  type RawClaudeCodeHookEnvelope,
} from '@virtual-office/shared/normalize';

/** Bash commands get a longer budget than other text fields, per design.md §1's frozen `ToolInputSummary` shape. */
const MAX_COMMAND_LENGTH = 120;

export interface ValidateContext {
  machineId: string;
  now: number;
  redactPrompts: boolean;
}

export type ValidationOutcome = { ok: true; payload: HookEventPayload } | { ok: false; reason: string };

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Structural validation for an already-shaped `HookEventPayload` (from the Node fallback hook). */
function validateStructuredPayload(body: Record<string, unknown>): ValidationOutcome {
  if (typeof body.event !== 'string' || !SUPPORTED_EVENTS.has(body.event)) {
    return { ok: false, reason: 'unknown or missing event' };
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
    return { ok: false, reason: 'missing sessionId' };
  }
  if (!isPlainObject(body.data)) {
    return { ok: false, reason: 'missing data' };
  }
  if (typeof body.machineId !== 'string' || typeof body.cwd !== 'string' || typeof body.identityKey !== 'string') {
    return { ok: false, reason: 'missing required string field' };
  }
  return { ok: true, payload: body as unknown as HookEventPayload };
}

/** Applies decision 3's redaction switch and defensive server-side re-truncation to one payload's text fields. */
function redactAndTruncate(payload: HookEventPayload, redactPrompts: boolean): HookEventPayload {
  const data: Record<string, unknown> = { ...payload.data };

  switch (payload.event) {
    case 'UserPromptSubmit': {
      data.promptSummary = redactPrompts ? '' : truncate(String(data.promptSummary ?? ''), MAX_TEXT_FIELD_LENGTH);
      break;
    }
    case 'PreToolUse': {
      const input = { ...(data.input as ToolInputSummary) } as Record<string, unknown>;
      if ('command' in input) {
        input.command = redactPrompts ? '' : truncate(String(input.command ?? ''), MAX_COMMAND_LENGTH);
      }
      if ('path' in input) input.path = truncate(String(input.path ?? ''), MAX_TEXT_FIELD_LENGTH);
      if ('pattern' in input) input.pattern = truncate(String(input.pattern ?? ''), MAX_TEXT_FIELD_LENGTH);
      if ('query' in input) input.query = truncate(String(input.query ?? ''), MAX_TEXT_FIELD_LENGTH);
      if ('taskSummary' in input) {
        input.taskSummary = redactPrompts ? '' : truncate(String(input.taskSummary ?? ''), MAX_TEXT_FIELD_LENGTH);
      }
      data.input = input;
      break;
    }
    case 'PostToolUse': {
      data.outputSummary = redactPrompts ? '' : truncate(String(data.outputSummary ?? ''), MAX_TEXT_FIELD_LENGTH);
      break;
    }
    case 'SubagentStart': {
      data.taskSummary = redactPrompts ? '' : truncate(String(data.taskSummary ?? ''), MAX_TEXT_FIELD_LENGTH);
      break;
    }
    case 'Stop':
    case 'SessionEnd': {
      data.reason = truncate(String(data.reason ?? ''), MAX_TEXT_FIELD_LENGTH);
      break;
    }
    default:
      break;
  }

  return { ...payload, data } as unknown as HookEventPayload;
}

/** The 16KB body cap (design threat matrix). Checked against the raw byte length before JSON parsing. */
export function isWithinBodySizeCap(byteLength: number): boolean {
  return byteLength <= MAX_EVENT_BODY_BYTES;
}

/**
 * Validates and normalises one inbound `/events` body (already JSON-parsed
 * and within the byte-size cap — that check happens earlier, on the raw
 * body, in `index.ts`). Never throws.
 */
export function validateInboundPayload(body: unknown, ctx: ValidateContext): ValidationOutcome {
  if (!isPlainObject(body)) {
    return { ok: false, reason: 'malformed body' };
  }

  let structured: ValidationOutcome;
  if (isHookEventPayloadShape(body)) {
    structured = validateStructuredPayload(body);
  } else {
    const normalized = normalizeRawClaudeCodeEvent(body as RawClaudeCodeHookEnvelope, {
      machineId: ctx.machineId,
      now: ctx.now,
    });
    structured = normalized === null ? { ok: false, reason: 'unrecognised raw hook envelope' } : { ok: true, payload: normalized };
  }

  if (!structured.ok) return structured;
  return { ok: true, payload: redactAndTruncate(structured.payload, ctx.redactPrompts) };
}

export type { HookEventName };
