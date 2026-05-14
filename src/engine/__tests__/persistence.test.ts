import { describe, it, expect, beforeEach } from 'vitest';
import { saveToLocalStorage, loadFromLocalStorage } from '../persistence';
import type { PersistedState, Scene } from '../../types/scene';

// Mock localStorage for Node environment
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

// Override global localStorage
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

function makeState(overrides: Partial<PersistedState> = {}): PersistedState {
  const rootScene: Scene = {
    id: 'scene_1',
    nodes: [],
    background: '#ffffff',
    layers: [{ id: 'layer_1', name: 'Layer 1', visible: true, locked: false, opacity: 1 }],
  };
  return {
    version: 1,
    rootScene,
    viewport: { x: 0, y: 0, scale: 1 },
    savedAt: Date.now(),
    ...overrides,
  };
}

describe('saveToLocalStorage / loadFromLocalStorage', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('round-trips a valid state', () => {
    const state = makeState();
    const saved = saveToLocalStorage(state);
    expect(saved).toBe(true);
    const loaded = loadFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.rootScene.id).toBe(state.rootScene.id);
    expect(loaded!.viewport).toEqual(state.viewport);
  });

  it('returns null when nothing is stored', () => {
    const loaded = loadFromLocalStorage();
    expect(loaded).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    store['endless-paper-autosave'] = '{bad json{{';
    const loaded = loadFromLocalStorage();
    expect(loaded).toBeNull();
  });

  it('returns null for wrong version', () => {
    const state = makeState({ version: 2 as 1 });
    store['endless-paper-autosave'] = JSON.stringify(state);
    const loaded = loadFromLocalStorage();
    expect(loaded).toBeNull();
  });

  it('returns null when rootScene is missing', () => {
    const raw = JSON.stringify({ version: 1, viewport: { x: 0, y: 0, scale: 1 }, savedAt: 0 });
    store['endless-paper-autosave'] = raw;
    const loaded = loadFromLocalStorage();
    expect(loaded).toBeNull();
  });

  it('returns true on successful save', () => {
    const result = saveToLocalStorage(makeState());
    expect(result).toBe(true);
  });

  it('handles QuotaExceededError gracefully', () => {
    const origSetItem = localStorageMock.setItem;
    localStorageMock.setItem = () => {
      const err = new DOMException('QuotaExceededError');
      Object.defineProperty(err, 'name', { value: 'QuotaExceededError' });
      throw err;
    };
    const result = saveToLocalStorage(makeState());
    expect(result).toBe(false);
    localStorageMock.setItem = origSetItem;
  });

  it('preserves nested scene nodes across round-trip', () => {
    const state = makeState();
    state.rootScene.nodes.push({
      id: 'node_1',
      type: 'rect',
      x: 10, y: 20, width: 50, height: 30,
    });
    saveToLocalStorage(state);
    const loaded = loadFromLocalStorage();
    expect(loaded!.rootScene.nodes).toHaveLength(1);
    expect(loaded!.rootScene.nodes[0].id).toBe('node_1');
  });
});
