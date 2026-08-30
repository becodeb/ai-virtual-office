import { useEffect, useRef } from 'react';
import { matchesTrailingSequence } from './keySequence.js';

/** Fires `onMatch` when the trailing window of recent keydowns matches `sequence` (case-sensitive, matching `KeyboardEvent.key`). */
export function useKeySequence(sequence: readonly string[], onMatch: () => void): void {
  const bufferRef = useRef<string[]>([]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      bufferRef.current = [...bufferRef.current, e.key].slice(-sequence.length);
      if (matchesTrailingSequence(bufferRef.current, sequence)) {
        bufferRef.current = [];
        onMatch();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sequence, onMatch]);
}
