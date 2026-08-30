import { describe, expect, it } from 'vitest';
import { LABEL_TASK_MAX_CHARS, resolveOverlayLabel, truncateTaskText } from './label.js';

describe('truncateTaskText', () => {
  it('leaves short text untouched', () => {
    expect(truncateTaskText('short task')).toBe('short task');
  });

  it('truncates a 120-character task summary to at most 80 characters', () => {
    const long = 'x'.repeat(120);
    const truncated = truncateTaskText(long);
    expect(truncated).toHaveLength(LABEL_TASK_MAX_CHARS);
    expect(truncated).toBe('x'.repeat(80));
  });
});

describe('resolveOverlayLabel (office-renderer spec: label content + redaction)', () => {
  it('shows machine, state, and truncated task text by default', () => {
    const content = resolveOverlayLabel({
      machineId: 'foo-laptop',
      state: 'ACTIVE',
      taskText: 'y'.repeat(120),
      redactPrompts: false,
    });
    expect(content.machineId).toBe('foo-laptop');
    expect(content.state).toBe('ACTIVE');
    expect(content.taskText).not.toBeNull();
    expect(content.taskText).toHaveLength(80);
  });

  it('redaction hides task text and falls back to tool name metadata, never a blank gap', () => {
    const content = resolveOverlayLabel({
      machineId: 'foo-laptop',
      state: 'SEATED_TYPING',
      taskText: '',
      toolName: 'Bash',
      redactPrompts: true,
    });
    expect(content.taskText).toBeNull();
    expect(content.metadata).toBe('Bash');
    expect(content.metadata.length).toBeGreaterThan(0);
  });

  it('redaction with no tool name falls back to state, never an empty string', () => {
    const content = resolveOverlayLabel({
      machineId: 'foo-laptop',
      state: 'WALKING',
      taskText: '',
      redactPrompts: true,
    });
    expect(content.taskText).toBeNull();
    expect(content.metadata).toBe('WALKING');
  });

  it('empty task text (even without redaction) falls back to metadata rather than an empty task line', () => {
    const content = resolveOverlayLabel({
      machineId: 'foo-laptop',
      state: 'QUEUED',
      taskText: '',
      redactPrompts: false,
    });
    expect(content.taskText).toBeNull();
    expect(content.metadata).toBe('QUEUED');
  });
});
