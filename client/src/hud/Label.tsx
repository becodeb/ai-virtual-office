/**
 * Overlay label (task 4.12): drei `<Html occlude center>` anchored at head
 * height. Shows machine id, state, and the truncated task
 * summary — or, under redaction (`OFFICE_REDACT_PROMPTS`), metadata only,
 * never a blank gap (office-renderer spec's two label requirements).
 *
 * The wire protocol's `AgentSnapshot.label` carries no separate "current
 * tool name" field, so the metadata fallback (`resolveOverlayLabel`'s
 * `toolName`) is not populated here — the agent's `state` is used as the
 * metadata line instead, which is the same category of information (what
 * the character is doing) the spec asks the redacted view to preserve.
 */
import { Html } from '@react-three/drei';
import type { AgentSnapshot } from '@virtual-office/shared';
import { resolveOverlayLabel } from '../lib/label.js';

/**
 * `distanceFactor` is deliberately NOT used.
 *
 * drei computes `scale = objectScale(camera) * distanceFactor`, and for an
 * orthographic camera `objectScale` returns `camera.zoom` outright. A
 * `distanceFactor` of 8 at zoom 37 therefore renders every label at **296x** —
 * a 10px chip becomes three thousand pixels of dark panel, which covers the
 * entire viewport and reads as "the whole app went black".
 *
 * Omitting it pins labels to a constant on-screen size, which is what a diorama
 * HUD wants anyway: they stay legible when the office is zoomed out, and they
 * never grow to eat the screen when it is zoomed in. See `labelScreenScale`.
 */

export interface AgentLabelProps {
  agent: AgentSnapshot;
  /** The role to display — callers resolve zombie-hour's Revenant override before passing this in (see `scene/effectiveDisplay.ts`). */
  displayRole: string;
  redactPrompts: boolean;
  focused: boolean;
  yOffset: number;
}

export function AgentLabel({ agent, displayRole, redactPrompts, focused, yOffset }: AgentLabelProps): JSX.Element {
  const content = resolveOverlayLabel({
    machineId: agent.label.machineId,
    state: agent.state,
    taskText: agent.label.taskText,
    redactPrompts,
  });

  return (
    <Html occlude center position={[0, yOffset, 0]}>
      <div
        className={`pointer-events-none max-w-[9rem] select-none truncate rounded bg-black/65 px-1.5 py-0.5 text-[9px] leading-snug text-white shadow ${
          focused ? 'ring-1 ring-amber-400' : ''
        }`}
      >
        <div className="truncate font-semibold">
          {content.machineId} <span className="text-white/60">· {displayRole}</span>
        </div>
        {content.taskText !== null ? (
          <div className="truncate text-white/75">{content.taskText}</div>
        ) : (
          <div className="truncate italic text-white/50">{content.metadata}</div>
        )}
      </div>
    </Html>
  );
}
