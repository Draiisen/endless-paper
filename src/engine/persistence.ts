import { PersistedState } from '../types/scene';

const STORAGE_KEY = 'endless-paper-autosave';

export function saveToLocalStorage(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be full or unavailable; fail silently
  }
}

export function loadFromLocalStorage(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1 || !parsed.rootScene) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearLocalStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function exportToFile(state: PersistedState): void {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `endless-paper-${new Date().toISOString().slice(0, 10)}.endless.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importFromFile(): Promise<PersistedState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.endless.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        if (!settled) { settled = true; cleanup(); reject(new Error('No file selected')); }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as PersistedState;
          if (!parsed || parsed.version !== 1 || !parsed.rootScene) {
            throw new Error('Invalid file format');
          }
          settled = true;
          cleanup();
          resolve(parsed);
        } catch (e) {
          settled = true;
          cleanup();
          reject(e);
        }
      };
      reader.onerror = () => {
        settled = true;
        cleanup();
        reject(reader.error ?? new Error('Read error'));
      };
      reader.readAsText(file);
    };

    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!settled && !input.files?.length) {
          settled = true;
          cleanup();
          reject(new Error('Cancelled'));
        }
      }, 500);
    }, { once: true });

    input.click();
  });
}

// ---- Settings (toolbar prefs) ----
const SETTINGS_KEY = 'endless-paper-settings';
export interface AppSettings {
  stabilizer: number;
  symmetry: 'off' | 'vertical' | 'horizontal' | 'both' | 'radial4' | 'radial6' | 'radial8';
  symmetryCenter?: { x: number; y: number } | null;
  miniMapVisible?: boolean;
  audioMuted?: boolean;
  showReference?: boolean;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw);
    return { ...defaultSettings(), ...parsed };
  } catch { return defaultSettings(); }
}
export function saveSettings(s: AppSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function defaultSettings(): AppSettings {
  return { stabilizer: 0, symmetry: 'off', symmetryCenter: null, miniMapVisible: true, audioMuted: false, showReference: true };
}
