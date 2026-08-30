import { describe, expect, it } from 'vitest';
import { classify, pickSkin, type ClassifierInput } from './classify.js';
import { FALLBACK_ROLE, FALLBACK_SKIN, FALLBACK_BADGE } from './skins.js';

describe('classify — one case per cast-table rule', () => {
  it('rule 1: Bash git push -> Pirate, exact, no forcePush flag', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'git push origin main' });
    expect(result).toEqual({ role: 'Pirate', badge: 'flag', confidence: 'exact', forcePush: false });
  });

  it('rule 1: Bash git push --force -> Pirate with forcePush set', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'git push --force' });
    expect(result.role).toBe('Pirate');
    expect(result.forcePush).toBe(true);
  });

  it('rule 2: Bash test runner -> Medic, inferred', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'pnpm test' });
    expect(result.role).toBe('Medic');
    expect(result.confidence).toBe('inferred');
  });

  it('rule 3: Bash build command -> Cook, inferred', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'vite build' });
    expect(result.role).toBe('Cook');
    expect(result.confidence).toBe('inferred');
  });

  it('rule 4: Bash install command classifies as Builder', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'npm install' });
    expect(result.role).toBe('Builder');
    expect(result.confidence).toBe('exact');
  });

  it('rule 5: any other Bash command falls back to Builder', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Bash', command: 'ls -la' });
    expect(result.role).toBe('Builder');
  });

  it('rule 6: Task on a Haiku-class model -> Intern', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Task', model: 'claude-haiku-4' });
    expect(result.role).toBe('Intern');
  });

  it('rule 7: a secret-looking path -> Ninja', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Read', path: '/repo/config/secrets.yaml' });
    expect(result.role).toBe('Ninja');
  });

  it('rule 8: a model/embedding-looking path -> Witch', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Read', path: '/repo/src/embedding-store.ts' });
    expect(result.role).toBe('Witch');
  });

  it('rule 9: Edit with destructive-intent prompt context -> Viking', () => {
    const result = classify({
      event: 'PreToolUse',
      tool: 'Edit',
      path: '/repo/src/legacy.ts',
      promptText: 'refactor the legacy module',
    });
    expect(result.role).toBe('Viking');
  });

  it('rule 10: plain Edit/Write/NotebookEdit -> Scribe', () => {
    expect(classify({ event: 'PreToolUse', tool: 'Edit', path: '/repo/src/app.ts' }).role).toBe('Scribe');
    expect(classify({ event: 'PreToolUse', tool: 'Write', path: '/repo/src/new.ts' }).role).toBe('Scribe');
    expect(classify({ event: 'PreToolUse', tool: 'NotebookEdit', path: '/repo/nb.ipynb' }).role).toBe('Scribe');
  });

  it('rule 11: Read/Grep/Glob -> Detective', () => {
    expect(classify({ event: 'PreToolUse', tool: 'Read', path: '/repo/README.md' }).role).toBe('Detective');
    expect(classify({ event: 'PreToolUse', tool: 'Grep', pattern: 'TODO' }).role).toBe('Detective');
    expect(classify({ event: 'PreToolUse', tool: 'Glob', pattern: '**/*.ts' }).role).toBe('Detective');
  });

  it('rule 12: WebSearch/WebFetch -> Wizard', () => {
    expect(classify({ event: 'PreToolUse', tool: 'WebSearch', query: 'react 19 changelog' }).role).toBe('Wizard');
    expect(classify({ event: 'PreToolUse', tool: 'WebFetch', host: 'example.com' }).role).toBe('Wizard');
  });

  it('rule 13: UserPromptSubmit with planning language -> Wizard', () => {
    const result = classify({ event: 'UserPromptSubmit', promptText: 'lets design the new schema' });
    expect(result.role).toBe('Wizard');
  });

  it('rule 14 (decision 6): unrecognized input falls back to the documented fallback role', () => {
    const result = classify({ event: 'SessionStart' });
    expect(result.role).toBe(FALLBACK_ROLE);
    expect(result.badge).toBe(FALLBACK_BADGE);
  });
});

describe('classify — precedence and determinism', () => {
  it('a .env Edit resolves to Ninja, not Scribe (rule 7 precedes rule 10)', () => {
    const result = classify({ event: 'PreToolUse', tool: 'Edit', path: '/repo/.env' });
    expect(result.role).toBe('Ninja');
  });

  it('same input classified twice returns the same role (determinism)', () => {
    const input: ClassifierInput = { event: 'PreToolUse', tool: 'Bash', command: 'docker build .' };
    const first = classify(input);
    const second = classify(input);
    expect(first).toEqual(second);
  });
});

describe('pickSkin', () => {
  it('is a total function returning a curated skin and the role badge', () => {
    const choice = pickSkin('Builder', 'abc123', 'machine-1');
    expect(choice.badge).toBe('hard hat');
    expect(['Worker_Male', 'Worker_Female']).toContain(choice.skin);
  });

  it('is deterministic: same identityKey always yields the same skin variant', () => {
    const a = pickSkin('Builder', 'same-identity', 'machine-1');
    const b = pickSkin('Builder', 'same-identity', 'machine-2');
    expect(a.skin).toBe(b.skin);
  });

  it('falls back to BaseCharacter for the Temp role', () => {
    const choice = pickSkin('Temp', 'anything', 'machine-1');
    expect(choice.skin).toBe(FALLBACK_SKIN);
  });
});

describe('a delegated Task is classified from its description', () => {
  /**
   * A non-Haiku subagent has no tool and no path - the task description is the
   * only signal it will ever carry. Before this rule every one of them arrived
   * as a faceless Temp during the single most visible thing it does: walking
   * across the floor to its parent's desk.
   */
  const task = (promptText: string, model = 'claude-opus-5') =>
    classify({ event: 'PreToolUse', tool: 'Task', model, promptText });

  it('routes a security task to Ninja', () => {
    expect(task('audit the auth secret handling').role).toBe('Ninja');
  });

  it('routes a planning task to Wizard', () => {
    expect(task('design the architecture for the delta protocol').role).toBe('Wizard');
  });

  it('marks text-derived roles as inferred, not exact', () => {
    expect(task('audit the auth secret handling').confidence).toBe('inferred');
  });

  it('still prefers the Haiku rule over the description', () => {
    expect(task('audit the auth secret handling', 'claude-haiku-4-5').role).toBe('Intern');
  });

  it('falls back to Temp when the description says nothing useful', () => {
    expect(task('do the needful').role).toBe(FALLBACK_ROLE);
  });
});
