import { describe, expect, it } from 'vitest';
import { DEFAULT_FLOOR_LAYOUT, DEFAULT_GRID } from './grid.js';
import { DeskRegistry } from './desks.js';

function freshRegistry(): DeskRegistry {
  return new DeskRegistry(DEFAULT_FLOOR_LAYOUT, DEFAULT_GRID);
}

describe('DeskRegistry allocation', () => {
  it('assigns a free desk to a newly active agent', () => {
    const registry = freshRegistry();
    const desk = registry.tryAllocate('agent-1');
    expect(desk).not.toBeNull();
    expect(registry.deskOf('agent-1')).toBe(desk!.id);
    expect(registry.occupantOf(desk!.id)).toBe('agent-1');
  });

  it('allocates deterministically: same sequence of agents always gets the same desks', () => {
    const a = freshRegistry();
    const b = freshRegistry();
    const count = a.desks.length;
    const idsA = Array.from({ length: count }, (_, i) => a.tryAllocate(`a${i}`)!.id);
    const idsB = Array.from({ length: count }, (_, i) => b.tryAllocate(`a${i}`)!.id);
    expect(idsA).toEqual(idsB);
  });

  it('returns null once every desk is occupied', () => {
    const registry = freshRegistry();
    // Driven by the layout's own desk count so the floor plan can change
    // without this test quietly asserting a number nobody maintains.
    const total = registry.desks.length;
    for (let i = 0; i < total; i++) {
      expect(registry.tryAllocate(`a${i}`), `desk ${i} of ${total}`).not.toBeNull();
    }
    expect(registry.tryAllocate(`a${total}`)).toBeNull();
  });

  it('hands a freed desk to the longest-waiting queued agent', () => {
    const registry = freshRegistry();
    for (let i = 0; i < registry.desks.length; i++) registry.tryAllocate(`a${i}`);

    registry.enqueue('waiter-1', 100);
    registry.enqueue('waiter-2', 200);

    const someDesk = registry.deskOf('a0')!;
    const result = registry.release(someDesk);

    expect(result.reassignedTo).toBe('waiter-1');
    expect(registry.deskOf('waiter-1')).toBe(someDesk);
    expect(registry.occupantOf(someDesk)).toBe('waiter-1');
  });

  it('releasing a desk with no queue simply frees it', () => {
    const registry = freshRegistry();
    const desk = registry.tryAllocate('agent-1')!;
    const result = registry.release(desk.id);
    expect(result.reassignedTo).toBeNull();
    expect(registry.occupantOf(desk.id)).toBeNull();
    expect(registry.tryAllocate('agent-2')?.id).toBe(desk.id);
  });

  it('removeFromQueue drops a waiting agent without assigning it a desk', () => {
    const registry = freshRegistry();
    for (let i = 0; i < registry.desks.length; i++) registry.tryAllocate(`a${i}`);
    registry.enqueue('waiter-1', 100);
    registry.removeFromQueue('waiter-1');
    expect(registry.waitingCount).toBe(0);

    const someDesk = registry.deskOf('a0')!;
    const result = registry.release(someDesk);
    expect(result.reassignedTo).toBeNull();
  });

  it('windowOnly allocation only considers desks flagged window: true', () => {
    const registry = freshRegistry();
    const desk = registry.tryAllocate('vip', { windowOnly: true });
    expect(desk).not.toBeNull();
    expect(desk!.window).toBe(true);
  });
});
