/**
 * Pure overlay-label text rules, per the office-renderer spec's two label
 * requirements: truncation to 80 chars, and redaction (decision 3 / the
 * `OFFICE_REDACT_PROMPTS` switch). Kept dependency-free and pure so both
 * requirements are directly unit-testable without mounting the scene.
 */
export const LABEL_TASK_MAX_CHARS = 80;

/** Truncates `text` to at most `max` characters. Never adds an ellipsis — the spec only requires a length bound. */
export function truncateTaskText(text: string, max: number = LABEL_TASK_MAX_CHARS): string {
  return text.length > max ? text.slice(0, max) : text;
}

export interface OverlayLabelInput {
  machineId: string;
  state: string;
  /**
   * The raw task/prompt text as broadcast by the hub. Note: the hub itself
   * already redacts this to `''` server-side when `OFFICE_REDACT_PROMPTS` is
   * on (see `server/src/net/validate.ts`), so `redactPrompts` here is a
   * defense-in-depth client-side switch — driven by the `hello` frame's
   * `config.redactPrompts` — that also governs metadata-only fallback
   * copy when task text is empty for any reason.
   */
  taskText: string;
  /** Present when the agent's current activity is a tool call (metadata fallback under redaction). */
  toolName?: string | null;
  redactPrompts: boolean;
}

export interface OverlayLabelContent {
  machineId: string;
  state: string;
  /** Truncated task text to display, or `null` when redacted/unavailable — never an empty gap. */
  taskText: string | null;
  /** Metadata line shown instead of task text under redaction, or when no task text exists at all. */
  metadata: string;
}

/**
 * Resolves what an overlay label should render. Redaction never renders a
 * blank gap where text would have been — it falls back to the tool name (if
 * known) or a neutral "working" metadata string.
 */
export function resolveOverlayLabel(input: OverlayLabelInput): OverlayLabelContent {
  const metadata = input.toolName !== undefined && input.toolName !== null && input.toolName.length > 0
    ? input.toolName
    : input.state;

  if (input.redactPrompts || input.taskText.length === 0) {
    return { machineId: input.machineId, state: input.state, taskText: null, metadata };
  }

  return {
    machineId: input.machineId,
    state: input.state,
    taskText: truncateTaskText(input.taskText),
    metadata,
  };
}
