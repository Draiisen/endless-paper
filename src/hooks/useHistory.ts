import { useCallback, useRef, useState } from 'react';
import { Scene, Viewport } from '../types/scene';

interface HistoryEntry {
  scene: Scene;
  viewport: Viewport;
}

const MAX_HISTORY = 50;

export function useHistory(initialScene: Scene, initialViewport: Viewport) {
  const historyRef = useRef<HistoryEntry[]>([{ scene: initialScene, viewport: initialViewport }]);
  const indexRef = useRef(0);
  const [, forceUpdate] = useState(0);

  const push = useCallback((scene: Scene, viewport: Viewport) => {
    const history = historyRef.current;
    const index = indexRef.current;

    // Remove any future history
    const newHistory = history.slice(0, index + 1);
    newHistory.push({ scene, viewport });

    // Limit history size
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    } else {
      indexRef.current = newHistory.length - 1;
    }

    historyRef.current = newHistory;
    forceUpdate((n) => n + 1);
  }, []);

  const undo = useCallback((): HistoryEntry | null => {
    if (indexRef.current <= 0) return null;
    indexRef.current--;
    forceUpdate((n) => n + 1);
    return historyRef.current[indexRef.current];
  }, []);

  const redo = useCallback((): HistoryEntry | null => {
    if (indexRef.current >= historyRef.current.length - 1) return null;
    indexRef.current++;
    forceUpdate((n) => n + 1);
    return historyRef.current[indexRef.current];
  }, []);

  const canUndo = indexRef.current > 0;
  const canRedo = indexRef.current < historyRef.current.length - 1;

  const current = historyRef.current[indexRef.current];

  return { current, push, undo, redo, canUndo, canRedo };
}
