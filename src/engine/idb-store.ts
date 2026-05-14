import { PersistedState } from '../types/scene';

const DB_NAME = 'endless-paper';
const STORE = 'state';
const KEY = 'autosave';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveToIDB(state: PersistedState): Promise<boolean> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadFromIDB(): Promise<PersistedState | null> {
  try {
    const db = await openDB();
    const result = await new Promise<PersistedState | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as PersistedState | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!result || !result.rootScene) return null;
    if (result.version !== 1) {
      console.warn(
        `[Endless Paper] Unrecognized save format version ${(result as any).version}.` +
        ' Load skipped to avoid corruption. Export your project first, then clear the autosave.'
      );
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

export async function clearIDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

// On first run after upgrade: move localStorage data into IDB and free the space.
const LS_KEY = 'endless-paper-autosave';
export async function migrateFromLocalStorage(): Promise<PersistedState | null> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1 || !parsed.rootScene) return null;
    const ok = await saveToIDB(parsed);
    if (ok) localStorage.removeItem(LS_KEY);
    return parsed;
  } catch {
    return null;
  }
}
