/**
 * The renderer's single source of truth. Per task 4.3, this store is written
 * ONLY by the WS client (`net/useWorld.ts`) — scene, HUD, and camera code
 * only ever read via selectors, never call `set` directly.
 */
import { create } from 'zustand';
import type { ServerFrame } from '@virtual-office/shared';
import { applyServerFrame, initialWorldReducerState, type WorldReducerState } from './worldReducer.js';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface WorldStore extends WorldReducerState {
  connectionStatus: ConnectionStatus;
  focusAgentId: string | null;
  /** Applies one server frame through the pure reducer. The only mutator the WS client should call. */
  handleServerFrame: (frame: ServerFrame) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setFocusAgentId: (agentId: string | null) => void;
  resetWorld: () => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  ...initialWorldReducerState(),
  connectionStatus: 'connecting',
  focusAgentId: null,
  handleServerFrame: (frame) => set((state) => applyServerFrame(state, frame)),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setFocusAgentId: (agentId) => set({ focusAgentId: agentId }),
  resetWorld: () => set({ ...initialWorldReducerState() }),
}));
