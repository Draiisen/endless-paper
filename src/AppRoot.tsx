import { useState, useEffect } from 'react';
import App from './App';
import { loadFromIDB, migrateFromLocalStorage } from './engine/idb-store';
import { loadFromLocalStorage, loadSettings, AppSettings } from './engine/persistence';
import { PersistedState } from './types/scene';

interface LoadedInit {
  state: PersistedState | null;
  settings: AppSettings;
}

export default function AppRoot() {
  const [init, setInit] = useState<LoadedInit | null>(null);

  useEffect(() => {
    async function load() {
      const settings = loadSettings();

      // Check for shared scene encoded in URL hash (#share=...)
      const hash = window.location.hash;
      if (hash.startsWith('#share=')) {
        try {
          const b64 = decodeURIComponent(hash.slice(7));
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(bytes);
          writer.close();
          const buf = await new Response(ds.readable).arrayBuffer();
          const shared = JSON.parse(new TextDecoder().decode(buf)) as PersistedState;
          if (shared.version === 1 && shared.rootScene) {
            window.history.replaceState(null, '', window.location.pathname);
            setInit({ state: shared, settings });
            return;
          }
        } catch {
          // malformed hash — fall through to normal load
        }
      }

      // 1. Try IndexedDB first (handles large scenes with images/audio)
      let state = await loadFromIDB();
      if (!state) {
        // 2. Migrate from localStorage if present
        state = await migrateFromLocalStorage();
      }
      if (!state) {
        // 3. Last resort: direct localStorage read (handles rare IDB failure)
        state = loadFromLocalStorage();
      }
      setInit({ state, settings });
    }
    load().catch(() => {
      setInit({ state: loadFromLocalStorage(), settings: loadSettings() });
    });
  }, []);

  if (!init) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#f8f7f4',
        color: '#1a1a2e', fontFamily: 'system-ui, sans-serif', fontSize: 14,
      }}>
        Loading…
      </div>
    );
  }

  return <App initialState={init.state} settings={init.settings} />;
}
