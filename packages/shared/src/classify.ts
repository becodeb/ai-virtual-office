/**
 * Pure role classifier, per design.md §7 and the role-classification spec.
 *
 * No I/O, no `Date`, no randomness, no module state — the same input always
 * returns the same {@link RoleAssignment}. Rules are checked in a single
 * fixed order, first match wins; this is the whole precedence contract.
 *
 * Decision 6 supersedes design.md's literal default row ("14 | default |
 * Scribe | keyboard"): the documented fallback is Temp / `BaseCharacter` /
 * `?`, not Scribe. The cast table has no default, and a classifier that can
 * return nothing forces every consumer to handle null.
 */
import type { Confidence, Role } from './state.js';
import { FALLBACK_ROLE, badgeForRole, skinsForRole, type SkinName } from './skins.js';
import type { HookEventName } from './wire.js';

/**
 * The classifier's only input. Extra context fields (like `promptText`) may
 * be populated by the hub from an agent's own tracked state (e.g. its last
 * `UserPromptSubmit` summary) without breaking purity: the function remains
 * deterministic in terms of everything it is given.
 */
export interface ClassifierInput {
  event: HookEventName;
  tool?: string;
  command?: string;
  path?: string;
  pattern?: string;
  query?: string;
  host?: string;
  model?: string;
  /** Associated prompt/task context text, when the hub has one for this agent. */
  promptText?: string;
}

export interface RoleAssignment {
  role: Role;
  badge: string;
  confidence: Confidence;
  /** Set only by rule 1, when the Bash command is a `git push --force` (feeds the P1 fire drill). */
  forcePush: boolean;
}

export interface SkinChoice {
  skin: SkinName;
  badge: string;
}

const RE_GIT_PUSH = /\bgit\s+push\b/;
const RE_FORCE_PUSH = /--force\b/;
const RE_TEST_RUNNER = /\b(vitest|jest|pytest|go test|cargo test|(npm|pnpm|yarn) test)\b/;

/** Whether `command` has the shape of a known test-runner invocation (rule 2). Exported for the P1 ship-it detector, which needs the same shape check but reacts to `PostToolUse`'s exit code, not `PreToolUse`. */
export function isTestRunnerShapedCommand(command: string): boolean {
  return RE_TEST_RUNNER.test(command);
}
const RE_BUILD = /\b(build|compile|bundle|tsc|vite build|webpack)\b/;
const RE_INSTALL = /\b(docker|make|apt|brew|(npm|pnpm|yarn) (i|add|install))\b/;
const RE_SECRET = /(auth|secret|token|credential|\.env|security)/i;
const RE_MODEL_TOUCH = /(model|embedding|prompt|llm|openai|anthropic)/i;
const RE_DESTRUCTIVE_INTENT = /(refactor|rename|delete|remove|migrate)/i;
const RE_PLANNING = /\b(plan|design|research)\b/i;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);

function assignment(role: Role, confidence: Confidence, forcePush = false): RoleAssignment {
  return { role, badge: badgeForRole(role), confidence, forcePush };
}

/** Combines every textual "path or query" field the input carries, for the Ninja/Witch signal rules. */
function pathQueryHaystack(input: ClassifierInput): string {
  return [input.path, input.pattern, input.query, input.host].filter((v): v is string => Boolean(v)).join(' ');
}

/**
 * Classifies one event's tool/prompt signal into a role. Total: every input
 * maps somewhere, including inputs that match no cast-table rule.
 */
export function classify(input: ClassifierInput): RoleAssignment {
  const tool = input.tool ?? '';
  const command = input.command ?? '';

  // Rule 1: Bash + git push -> Pirate.
  if (tool === 'Bash' && RE_GIT_PUSH.test(command)) {
    return assignment('Pirate', 'exact', RE_FORCE_PUSH.test(command));
  }
  // Rule 2: Bash + known test runner -> Medic (inferred: shape, not semantics).
  if (tool === 'Bash' && RE_TEST_RUNNER.test(command)) {
    return assignment('Medic', 'inferred');
  }
  // Rule 3: Bash + build/compile/bundle -> Cook (inferred).
  if (tool === 'Bash' && RE_BUILD.test(command)) {
    return assignment('Cook', 'inferred');
  }
  // Rule 4: Bash + docker/make/apt/brew/install -> Builder.
  if (tool === 'Bash' && RE_INSTALL.test(command)) {
    return assignment('Builder', 'exact');
  }
  // Rule 5: Bash fallback -> Builder.
  if (tool === 'Bash') {
    return assignment('Builder', 'exact');
  }
  // Rule 6: Task on a Haiku-class model -> Intern.
  if (tool === 'Task' && /haiku/i.test(input.model ?? '')) {
    return assignment('Intern', 'exact');
  }
  // Rule 6b: a delegated Task that is not Haiku-class carries no tool and no
  // path - its description is the only signal it will ever have. Read the role
  // out of that text, because a subagent's walk across the floor to its
  // parent's desk is the most-watched thing it does, and arriving as a faceless
  // Temp wastes it. Confidence is `inferred`: this is text, not a tool call.
  if (tool === 'Task') {
    const task = input.promptText ?? '';
    if (RE_SECRET.test(task)) return assignment('Ninja', 'inferred');
    if (RE_MODEL_TOUCH.test(task)) return assignment('Witch', 'inferred');
    if (RE_DESTRUCTIVE_INTENT.test(task)) return assignment('Viking', 'inferred');
    if (RE_TEST_RUNNER.test(task)) return assignment('Medic', 'inferred');
    if (RE_PLANNING.test(task)) return assignment('Wizard', 'inferred');
  }
  // Rule 7: any path/query touching auth/secrets/security -> Ninja.
  if (RE_SECRET.test(pathQueryHaystack(input))) {
    return assignment('Ninja', 'exact');
  }
  // Rule 8: any path/query touching a model/embedding/prompt -> Witch.
  if (RE_MODEL_TOUCH.test(pathQueryHaystack(input))) {
    return assignment('Witch', 'exact');
  }
  // Rule 9: Edit/Write/NotebookEdit with destructive-intent prompt context -> Viking.
  if (EDIT_TOOLS.has(tool) && RE_DESTRUCTIVE_INTENT.test(input.promptText ?? '')) {
    return assignment('Viking', 'exact');
  }
  // Rule 10: Edit/Write/NotebookEdit -> Scribe.
  if (EDIT_TOOLS.has(tool)) {
    return assignment('Scribe', 'exact');
  }
  // Rule 11: Read/Grep/Glob -> Detective.
  if (READ_TOOLS.has(tool)) {
    return assignment('Detective', 'exact');
  }
  // Rule 12: WebSearch/WebFetch -> Wizard.
  if (WEB_TOOLS.has(tool)) {
    return assignment('Wizard', 'exact');
  }
  // Rule 13: UserPromptSubmit with planning language -> Wizard.
  if (input.event === 'UserPromptSubmit' && RE_PLANNING.test(input.promptText ?? '')) {
    return assignment('Wizard', 'exact');
  }
  // Rule 14 (decision 6, supersedes design.md's default row): documented fallback -> Temp.
  return assignment(FALLBACK_ROLE, 'exact');
}

/**
 * Deterministically picks a skin variant for `role`, keyed by `identityKey`
 * so the same session always gets the same variant (e.g. Male/Female).
 * `machineId` is accepted per design.md §2 (it selects the tint palette at
 * render time) but does not affect which skin variant is chosen here.
 */
export function pickSkin(role: Role, identityKey: string, _machineId: string): SkinChoice {
  const variants = skinsForRole(role);
  const skin = variants[hashString(identityKey) % variants.length] ?? variants[0]!;
  return { skin, badge: badgeForRole(role) };
}

/** Small, deterministic, non-cryptographic string hash (FNV-1a), used only to pick a stable skin variant. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
