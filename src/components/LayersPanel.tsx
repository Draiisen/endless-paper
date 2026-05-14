import { useState } from 'react';
import { Layer } from '../types/scene';

interface LayersPanelProps {
  layers: Layer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  onAddLayer: () => void;
  onDeleteLayer: (id: string) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  onReorderLayer: (fromIdx: number, toIdx: number) => void;
}

export function LayersPanel({
  layers, activeLayerId, setActiveLayerId,
  onAddLayer, onDeleteLayer, onUpdateLayer, onReorderLayer,
}: LayersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Render top-to-bottom but storage order is bottom-to-top
  const display = [...layers].reverse();

  return (
    <div className="flex flex-col gap-1 text-white text-xs select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Layers</span>
        <button
          className="px-2 py-0.5 rounded bg-accent text-white hover:bg-accent/80"
          onClick={onAddLayer}
          title="Add layer"
        >
          + New
        </button>
      </div>

      {display.map((layer, displayIdx) => {
        const idx = layers.length - 1 - displayIdx;
        const isActive = layer.id === activeLayerId;
        return (
          <div
            key={layer.id}
            className={`group flex items-center gap-1 p-1.5 rounded transition-colors ${isActive ? 'bg-accent/30 border border-accent/50' : 'hover:bg-white/5 border border-transparent'} ${dragIdx === displayIdx ? 'opacity-50' : ''}`}
            onClick={() => setActiveLayerId(layer.id)}
            draggable
            onDragStart={() => setDragIdx(displayIdx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx === null || dragIdx === displayIdx) { setDragIdx(null); return; }
              const fromIdx = layers.length - 1 - dragIdx;
              const toIdx = idx;
              onReorderLayer(fromIdx, toIdx);
              setDragIdx(null);
            }}
            onDragEnd={() => setDragIdx(null)}
          >
            <button
              className="text-gray-400 hover:text-white p-0.5"
              onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { visible: !layer.visible }); }}
              title={layer.visible ? 'Hide' : 'Show'}
            >
              {layer.visible ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5C21.3 7.6 17 4.5 12 4.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92C21.06 15.07 22.31 13.07 22.5 12c-1.7-4.4-6-7.5-11-7.5-1.4 0-2.74.25-4 .7l2.17 2.15C10.3 7.13 11.13 7 12 7zM2.71 3.16L1.39 4.47l2.27 2.27C2.07 8.13 1.07 9.96.5 12c1.7 4.4 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l3.05 3.05 1.32-1.32L2.71 3.16zM7.53 7.98l1.55 1.55c-.05.16-.08.31-.08.47 0 1.66 1.34 3 3 3 .16 0 .31-.03.47-.08l1.55 1.55c-.62.28-1.3.43-2.02.43-2.76 0-5-2.24-5-5 0-.72.15-1.4.43-2.02z"/></svg>
              )}
            </button>
            <button
              className="text-gray-400 hover:text-white p-0.5"
              onClick={(e) => { e.stopPropagation(); onUpdateLayer(layer.id, { locked: !layer.locked }); }}
              title={layer.locked ? 'Unlock' : 'Lock'}
            >
              {layer.locked ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5-2.28 0-4.27 1.54-4.84 3.75-.14.54.18 1.08.72 1.22.53.14 1.08-.18 1.22-.72C9.44 3.93 10.6 3 12 3c1.65 0 3 1.35 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>
              )}
            </button>
            {editingId === layer.id ? (
              <input
                autoFocus
                className="flex-1 bg-ink/60 border border-accent/40 rounded px-1 text-[11px] outline-none"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => { onUpdateLayer(layer.id, { name: draftName.trim() || layer.name }); setEditingId(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.currentTarget.blur(); }
                  if (e.key === 'Escape') { setEditingId(null); }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="flex-1 truncate"
                onDoubleClick={(e) => { e.stopPropagation(); setEditingId(layer.id); setDraftName(layer.name); }}
                title="Double-click to rename"
              >
                {layer.name}
              </span>
            )}
            <input
              type="range" min={0} max={100} value={Math.round(layer.opacity * 100)}
              className="w-16 accent-accent"
              title={`Opacity ${Math.round(layer.opacity * 100)}%`}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUpdateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
            />
            <button
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 p-0.5"
              onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }}
              title="Delete layer"
              disabled={layers.length <= 1}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
