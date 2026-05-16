import { useRef } from 'react';
import { BrushStamp } from '../types/scene';

interface StampPanelProps {
  stamps: BrushStamp[];
  activeStampId: string | null;
  onSelectStamp: (id: string) => void;
  onAddStamp: (file: File) => void;
  onDeleteStamp: (id: string) => void;
  onUpdateStamp: (id: string, changes: Partial<BrushStamp>) => void;
  onClose: () => void;
}

export function StampPanel({ stamps, activeStampId, onSelectStamp, onAddStamp, onDeleteStamp, onUpdateStamp, onClose }: StampPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const active = stamps.find(s => s.id === activeStampId) ?? null;

  return (
    <div className="fixed right-0 top-12 bottom-0 w-56 bg-ink border-l border-white/10 z-20 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
        <span className="text-white text-sm font-semibold">Tampons</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2 py-1 rounded bg-accent text-white text-xs hover:bg-accent/80 transition-colors"
            title="Ajouter un tampon depuis une image"
          >+ Image</button>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none transition-colors" title="Fermer">×</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) { onAddStamp(f); e.target.value = ''; } }} />
      </div>

      {/* Stamp grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {stamps.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-10 leading-relaxed">
            Importez une image<br/>pour créer votre premier tampon.
            <button
              onClick={() => fileRef.current?.click()}
              className="mt-3 block mx-auto px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs hover:bg-accent/30 transition-colors"
            >Importer une image</button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-1.5">
            {stamps.map(stamp => (
              <button
                key={stamp.id}
                onClick={() => onSelectStamp(stamp.id)}
                className={`aspect-square rounded-lg border-2 overflow-hidden transition-all touch-manipulation ${stamp.id === activeStampId ? 'border-accent shadow-lg shadow-accent/20' : 'border-white/10 hover:border-white/30'}`}
                title={stamp.name}
              >
                <img src={stamp.imageData} alt={stamp.name} className="w-full h-full object-contain p-0.5" style={{ background: 'rgba(255,255,255,0.04)' }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active stamp properties */}
      {active && (
        <div className="border-t border-white/10 p-3 flex flex-col gap-2.5 flex-shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-white text-xs font-medium truncate mr-2" title={active.name}>{active.name}</span>
            <button
              onClick={() => onDeleteStamp(active.id)}
              className="text-red-400 text-xs hover:text-red-300 transition-colors flex-shrink-0"
            >Suppr.</button>
          </div>

          {/* Size */}
          <label className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-gray-400 text-[10px] uppercase tracking-wider">Taille</span>
              <span className="text-gray-500 text-[10px] font-mono">{active.size}px</span>
            </div>
            <input type="range" min={4} max={500} value={active.size}
              onChange={e => onUpdateStamp(active.id, { size: Number(e.target.value) })}
              className="accent-accent w-full" />
          </label>

          {/* Spacing */}
          <label className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-gray-400 text-[10px] uppercase tracking-wider">Espacement</span>
              <span className="text-gray-500 text-[10px] font-mono">{active.spacing}%</span>
            </div>
            <input type="range" min={5} max={300} value={active.spacing}
              onChange={e => onUpdateStamp(active.id, { spacing: Number(e.target.value) })}
              className="accent-accent w-full" />
          </label>

          {/* Opacity */}
          <label className="flex flex-col gap-1">
            <div className="flex justify-between">
              <span className="text-gray-400 text-[10px] uppercase tracking-wider">Opacité</span>
              <span className="text-gray-500 text-[10px] font-mono">{Math.round(active.opacity * 100)}%</span>
            </div>
            <input type="range" min={5} max={100} value={Math.round(active.opacity * 100)}
              onChange={e => onUpdateStamp(active.id, { opacity: Number(e.target.value) / 100 })}
              className="accent-accent w-full" />
          </label>

          {/* Rotation mode */}
          <div className="flex flex-col gap-1">
            <span className="text-gray-400 text-[10px] uppercase tracking-wider">Rotation</span>
            <div className="flex gap-1">
              {([
                { mode: 'fixed' as const, label: '—', title: 'Fixe (toujours 0°)' },
                { mode: 'random' as const, label: '⟳?', title: 'Aléatoire' },
                { mode: 'follow' as const, label: '→', title: 'Suit la direction' },
              ]).map(({ mode, label, title }) => (
                <button
                  key={mode}
                  onClick={() => onUpdateStamp(active.id, { rotationMode: mode })}
                  title={title}
                  className={`flex-1 py-1.5 rounded text-[11px] transition-colors touch-manipulation ${active.rotationMode === mode ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'}`}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
