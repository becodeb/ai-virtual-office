import { describe, expect, it } from 'vitest';
import {
  computeIdentityKey,
  isHookEventPayloadShape,
  normalizeRawClaudeCodeEvent,
  summarizeToolInput,
  type RawClaudeCodeHookEnvelope,
} from './normalize.js';

const ctx = { machineId: 'gentle-desktop', now: 1_700_000_000_000 };

describe('normalizeRawClaudeCodeEvent', () => {
  it('normalises a raw SessionStart envelope into a HookEventPayload', () => {
    const raw: RawClaudeCodeHookEnvelope = {
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      cwd: '/home/user/projects/api',
      source: 'startup',
      model: 'claude-sonnet-5',
    };
    const payload = normalizeRawClaudeCodeEvent(raw, ctx);
    expect(payload).not.toBeNull();
    expect(payload!.v).toBe(1);
    expect(payload!.event).toBe('SessionStart');
    expect(payload!.sessionId).toBe('sess-1');
    expect(payload!.project).toBe('api');
    expect(payload!.machineId).toBe('gentle-desktop');
    expect(payload!.identityKey).toBe(computeIdentityKey('gentle-desktop', '/home/user/projects/api'));
    expect(payload!.data).toEqual({ source: 'startup', model: 'claude-sonnet-5' });
  });

  it('computes identityKey exactly as sha256(machineId + " " + cwd).hex.slice(0, 12)', () => {
    const key = computeIdentityKey('gentle-desktop', '/home/user/projects/api');
    expect(key).toMatch(/^[0-9a-f]{12}$/);
    expect(key).toBe(computeIdentityKey('gentle-desktop', '/home/user/projects/api'));
    expect(key).not.toBe(computeIdentityKey('gentle-desktop', '/home/user/projects/other'));
  });

  it('normalises PreToolUse Bash into the frozen ToolInputSummary shape', () => {
    const raw: RawClaudeCodeHookEnvelope = {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      cwd: '/home/user/projects/api',
      tool_name: 'Bash',
      tool_use_id: 'tu_01',
      tool_input: { command: 'pnpm test --run' },
    };
    const payload = normalizeRawClaudeCodeEvent(raw, ctx);
    expect(payload!.data).toEqual({
      tool: 'Bash',
      toolUseId: 'tu_01',
      input: { command: 'pnpm test --run', argv0: 'pnpm' },
    });
  });

  it('normalises PostToolUse with an explicit exit code', () => {
    const raw: RawClaudeCodeHookEnvelope = {
      hook_event_name: 'PostToolUse',
      session_id: 'sess-1',
      cwd: '/home/user/projects/api',
      tool_name: 'Bash',
      tool_use_id: 'tu_01',
      tool_response: { exit_code: 1, stderr: 'boom' },
    };
    const payload = normalizeRawClaudeCodeEvent(raw, ctx);
    expect(payload!.data).toMatchObject({ exitCode: 1, ok: false, outputSummary: 'boom' });
  });

  it('truncates promptSummary to 80 characters', () => {
    const longPrompt = 'x'.repeat(120);
    const raw: RawClaudeCodeHookEnvelope = {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1',
      cwd: '/home/user/projects/api',
      prompt: longPrompt,
    };
    const payload = normalizeRawClaudeCodeEvent(raw, ctx);
    const data = payload!.data as { promptSummary: string; promptLength: number };
    expect(data.promptSummary).toHaveLength(80);
    expect(data.promptLength).toBe(120);
  });

  it('returns null for a missing sessionId', () => {
    const raw: RawClaudeCodeHookEnvelope = { hook_event_name: 'SessionStart', cwd: '/x' };
    expect(normalizeRawClaudeCodeEvent(raw, ctx)).toBeNull();
  });

  it('returns null for an unrecognised hook_event_name (e.g. PreCompact, Notification)', () => {
    const raw: RawClaudeCodeHookEnvelope = { hook_event_name: 'PreCompact', session_id: 'sess-1', cwd: '/x' };
    expect(normalizeRawClaudeCodeEvent(raw, ctx)).toBeNull();
  });

  it('returns null when hook_event_name is entirely absent', () => {
    const raw: RawClaudeCodeHookEnvelope = { session_id: 'sess-1', cwd: '/x' };
    expect(normalizeRawClaudeCodeEvent(raw, ctx)).toBeNull();
  });
});

describe('summarizeToolInput', () => {
  it('summarises Edit into {path, ext}', () => {
    expect(summarizeToolInput('Edit', { file_path: '/repo/src/app.ts' })).toEqual({
      path: '/repo/src/app.ts',
      ext: '.ts',
    });
  });

  it('summarises Read into {path, pattern}', () => {
    expect(summarizeToolInput('Read', { file_path: '/repo/README.md' })).toEqual({
      path: '/repo/README.md',
      pattern: '',
    });
  });

  it('summarises WebFetch into {query, host}', () => {
    expect(summarizeToolInput('WebFetch', { url: 'https://example.com/page', prompt: 'summarize' })).toEqual({
      query: 'summarize',
      host: 'example.com',
    });
  });

  it('summarises an unrecognised tool into {}', () => {
    expect(summarizeToolInput('SomeFutureTool', { anything: true })).toEqual({});
  });
});

describe('isHookEventPayloadShape', () => {
  it('discriminates on the presence of the v field', () => {
    expect(isHookEventPayloadShape({ v: 1, event: 'SessionStart' })).toBe(true);
    expect(isHookEventPayloadShape({ hook_event_name: 'SessionStart' })).toBe(false);
    expect(isHookEventPayloadShape(null)).toBe(false);
  });
});
