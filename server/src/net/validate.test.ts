import { describe, expect, it } from 'vitest';
import { MAX_EVENT_BODY_BYTES } from '@virtual-office/shared';
import { isWithinBodySizeCap, validateInboundPayload } from './validate.js';

const ctx = { machineId: 'gentle-desktop', now: 1_700_000_000_000, redactPrompts: false };

describe('isWithinBodySizeCap', () => {
  it('accepts a body at or under the 16KB cap and rejects anything over it', () => {
    expect(isWithinBodySizeCap(MAX_EVENT_BODY_BYTES)).toBe(true);
    expect(isWithinBodySizeCap(MAX_EVENT_BODY_BYTES + 1)).toBe(false);
  });
});

describe('validateInboundPayload — already-structured HookEventPayload (v present)', () => {
  it('accepts a well-formed payload as-is', () => {
    const body = {
      v: 1,
      event: 'SessionStart',
      sessionId: 'sess-1',
      parentSessionId: null,
      machineId: 'gentle-desktop',
      cwd: '/home/user/projects/api',
      project: 'api',
      identityKey: 'abc123',
      ts: ctx.now,
      data: { source: 'startup', model: 'claude-sonnet-5' },
    };
    const result = validateInboundPayload(body, ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown event value without mutating anything (caller never touches world state)', () => {
    const body = { v: 1, event: 'PreCompact', sessionId: 'sess-1', machineId: 'm', cwd: '/x', identityKey: 'k', data: {} };
    const result = validateInboundPayload(body, ctx);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    const body = { v: 1, event: 'SessionStart', machineId: 'm', cwd: '/x', identityKey: 'k', data: { source: 's', model: 'x' } };
    const result = validateInboundPayload(body, ctx);
    expect(result.ok).toBe(false);
  });

  it('rejects a missing data object', () => {
    const body = { v: 1, event: 'SessionStart', sessionId: 's', machineId: 'm', cwd: '/x', identityKey: 'k' };
    const result = validateInboundPayload(body, ctx);
    expect(result.ok).toBe(false);
  });

  it('re-truncates an over-long text field server-side even though the hook already truncates', () => {
    const longPrompt = 'y'.repeat(500);
    const body = {
      v: 1,
      event: 'UserPromptSubmit',
      sessionId: 'sess-1',
      parentSessionId: null,
      machineId: 'gentle-desktop',
      cwd: '/x',
      project: 'x',
      identityKey: 'abc123',
      ts: ctx.now,
      data: { promptSummary: longPrompt, promptLength: 500 },
    };
    const result = validateInboundPayload(body, ctx);
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.event === 'UserPromptSubmit') {
      expect(result.payload.data.promptSummary).toHaveLength(80);
    }
  });

  it('drops task text under redaction, keeping tool name and metadata', () => {
    const body = {
      v: 1,
      event: 'PreToolUse',
      sessionId: 'sess-1',
      parentSessionId: null,
      machineId: 'gentle-desktop',
      cwd: '/x',
      project: 'x',
      identityKey: 'abc123',
      ts: ctx.now,
      data: { tool: 'Bash', toolUseId: 't1', input: { command: 'rm -rf /', argv0: 'rm' } },
    };
    const result = validateInboundPayload(body, { ...ctx, redactPrompts: true });
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.event === 'PreToolUse') {
      expect(result.payload.data.tool).toBe('Bash');
      const input = result.payload.data.input as { command: string };
      expect(input.command).toBe('');
    }
  });
});

describe('validateInboundPayload — raw Claude Code envelope (v absent)', () => {
  it('normalises a raw sh-hook envelope into a valid payload', () => {
    const raw = {
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      cwd: '/home/user/projects/api',
      source: 'startup',
      model: 'claude-sonnet-5',
    };
    const result = validateInboundPayload(raw, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.v).toBe(1);
      expect(result.payload.machineId).toBe('gentle-desktop');
    }
  });

  it('rejects an unrecognised raw hook_event_name without mutating anything', () => {
    const raw = { hook_event_name: 'Notification', session_id: 'sess-1', cwd: '/x' };
    const result = validateInboundPayload(raw, ctx);
    expect(result.ok).toBe(false);
  });

  it('rejects a raw envelope missing session_id', () => {
    const raw = { hook_event_name: 'SessionStart', cwd: '/x' };
    const result = validateInboundPayload(raw, ctx);
    expect(result.ok).toBe(false);
  });
});

describe('validateInboundPayload — malformed bodies', () => {
  it('rejects null, arrays, and primitives', () => {
    expect(validateInboundPayload(null, ctx).ok).toBe(false);
    expect(validateInboundPayload([], ctx).ok).toBe(false);
    expect(validateInboundPayload('nope', ctx).ok).toBe(false);
    expect(validateInboundPayload(42, ctx).ok).toBe(false);
  });
});
