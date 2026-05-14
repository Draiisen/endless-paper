import { useState, useEffect } from 'react';
import { PersistedState } from '../types/scene';
import { loadFromIDB, clearIDB } from '../engine/idb-store';
import { exportToFile } from '../engine/persistence';

interface SavesModalProps {
  currentState: PersistedState;
  onClose: () => void;
  onRestore: (state: PersistedState) => void;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

function SaveInfo({ state }: { state: PersistedState }) {
  const nodes = state.rootScene?.nodes?.length ?? 0;
  const inner = state.rootScene?.nodes?.filter(n => n.innerScene).length ?? 0;
  const assets = state.assets?.length ?? 0;
  return (
    <div className="text-xs text-ink/60 mt-0.5">
      {nodes} node{nodes !== 1 ? 's' : ''}
      {inner > 0 ? ` · ${inner} nested scene${inner !== 1 ? 's' : ''}` : ''}
      {assets > 0 ? ` · ${assets} asset${assets !== 1 ? 's' : ''}` : ''}
    </div>
  );
}

export function SavesModal({ currentState, onClose, onRestore }: SavesModalProps) {
  const [idbSave, setIdbSave] = useState<PersistedState | null | 'loading'>('loading');

  useEffect(() => {
    loadFromIDB().then(s => setIdbSave(s));
  }, []);

  const handleClearIdb = async () => {
    if (!confirm('Delete the autosave? This cannot be undone.')) return;
    await clearIDB();
    setIdbSave(null);
  };

  const handleRestoreIdb = () => {
    if (idbSave && idbSave !== 'loading') {
      onRestore(idbSave);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="bg-paper rounded-xl shadow-2xl border border-ink/20 w-[500px] max-w-[95vw] flex flex-col overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-ink/90 text-white">
          <span className="font-semibold text-sm">Save Management</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Current session */}
          <section>
            <h3 className="text-[11px] font-semibold text-ink/50 uppercase tracking-wider mb-2">Current session</h3>
            <div className="bg-ink/5 rounded-lg p-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-ink">In memory</div>
                <SaveInfo state={currentState} />
              </div>
              <button
                onClick={() => exportToFile(currentState)}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors flex-shrink-0"
              >
                Export .endless.json
              </button>
            </div>
          </section>

          {/* IndexedDB autosave */}
          <section>
            <h3 className="text-[11px] font-semibold text-ink/50 uppercase tracking-wider mb-2">Auto-save (IndexedDB)</h3>

            {idbSave === 'loading' && (
              <div className="text-sm text-ink/40 py-2">Loading…</div>
            )}

            {idbSave !== 'loading' && idbSave === null && (
              <div className="text-sm text-ink/40 py-2">No autosave found — canvas is blank or was cleared.</div>
            )}

            {idbSave !== 'loading' && idbSave !== null && (
              <div className="bg-ink/5 rounded-lg p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-ink">
                      Saved {formatDate(idbSave.savedAt)}
                    </div>
                    <SaveInfo state={idbSave} />
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={handleRestoreIdb}
                      title="Load this autosave into the current session"
                      className="px-2.5 py-1.5 rounded-lg bg-ink/10 text-ink text-xs font-semibold hover:bg-ink/20 transition-colors"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => exportToFile(idbSave)}
                      title="Download as .endless.json"
                      className="px-2.5 py-1.5 rounded-lg bg-accent/90 text-white text-xs font-semibold hover:bg-accent transition-colors"
                    >
                      Export
                    </button>
                    <button
                      onClick={handleClearIdb}
                      title="Delete the autosave from IndexedDB"
                      className="px-2.5 py-1.5 rounded-lg bg-red-500/80 text-white text-xs font-semibold hover:bg-red-500 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <p className="text-xs text-ink/40 leading-relaxed">
            Auto-save runs 500 ms after every change and stores the full project (nodes, assets, viewport) in your browser's IndexedDB.
            Use <strong>Export</strong> to create a portable <code>.endless.json</code> backup that survives clearing browser data.
            <strong> Restore</strong> replaces the current session with the autosave without reloading.
          </p>
        </div>
      </div>
    </div>
  );
}
