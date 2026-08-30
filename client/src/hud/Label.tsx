/**
 * Overlay label (task 4.12): drei `<Html occlude distanceFactor center>`
 * anchored at head height. Shows machine id, state, and the truncated task
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
    <Html occlude distanceFactor={8} center position={[0, yOffset, 0]}>
      <div
        className={`pointer-events-none select-none whitespace-nowrap rounded bg-black/70 px-2 py-1 text-[10px] leading-tight text-white shadow ${
          focused ? 'ring-1 ring-amber-400' : ''
        }`}
      >
        <div className="font-semibold">
          {content.machineId} <span className="text-white/60">· {displayRole}</span>
        </div>
        {content.taskText !== null ? (
          <div className="text-white/80">{content.taskText}</div>
        ) : (
          <div className="italic text-white/50">{content.metadata}</div>
        )}
      </div>
    </Html>
  );
}
