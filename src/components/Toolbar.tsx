import React, { useRef, useState } from 'react';
import { ToolType, SymmetryMode } from '../types/scene';
import { ColorPicker } from './ColorPicker';

interface ToolbarProps {
  tool: ToolType;
  setTool: (t: ToolType) => void;
  strokeColor: string;
  setStrokeColor: (c: string) => void;
  fillColor: string;
  setFillColor: (c: string) => void;
  strokeWidth: number;
  setStrokeWidth: (w: number) => void;
  onImageImport: (file: File) => void;
  onVectorize: () => void;
  canVectorize: boolean;
  pressureEnabled: boolean;
  setPressureEnabled: (b: boolean) => void;
  autoEnterEnabled: boolean;
  setAutoEnterEnabled: (b: boolean) => void;
  hasMultiSelection: boolean;
  hasSelection: boolean;
  selectedAreInGroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  symmetry: SymmetryMode;
  setSymmetry: (m: SymmetryMode) => void;
  stabilizer: number;
  setStabilizer: (n: number) => void;
  showReference: boolean;
  setShowReference: (b: boolean) => void;
  showLibrary: boolean;
  setShowLibrary: (b: boolean) => void;
  showLayers: boolean;
  setShowLayers: (b: boolean) => void;
  showMiniMap: boolean;
  setShowMiniMap: (b: boolean) => void;
  onSaveToLibrary: () => void;
  onAddCamera: () => void;
  hasCameras: boolean;
  onPlayTour: () => void;
  tourPlaying: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sceneBounds?: { width: number; height: number } | null;
  onSetSceneBounds: (bounds: { width: number; height: number } | null) => void;
}

function ToolButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      className={`w-11 h-11 flex items-center justify-center rounded-lg transition-all text-lg touch-manipulation ${active ? 'bg-accent text-white shadow-inner' : 'text-gray-400 active:text-white active:bg-white/10 hover:text-white hover:bg-white/10'}`}
      onClick={onClick} title={title}
    >{children}</button>
  );
}

interface BoundsPreset {
  label: string;
  short: string;
  bounds: { width: number; height: number } | null;
}

const BOUNDS_PRESETS: BoundsPreset[] = [
  { label: 'Aucune limite', short: '∞', bounds: null },
  { label: 'Carré 1000×1000', short: '1K²', bounds: { width: 1000, height: 1000 } },
  { label: '16:9 (1920×1080)', short: '16:9', bounds: { width: 1920, height: 1080 } },
  { label: 'A4 portrait (2480×3508)', short: 'A4↕', bounds: { width: 2480, height: 3508 } },
  { label: 'A4 paysage (3508×2480)', short: 'A4↔', bounds: { width: 3508, height: 2480 } },
];

const SYMMETRY_OPTIONS: { value: SymmetryMode; label: string }[] = [
  { value: 'off', label: 'Désactivée' },
  { value: 'vertical', label: '↔ Verticale' },
  { value: 'horizontal', label: '↕ Horizontale' },
  { value: 'both', label: '✛ Les deux' },
  { value: 'radial4', label: '✦ Radiale 4×' },
  { value: 'radial6', label: '✦ Radiale 6×' },
  { value: 'radial8', label: '✦ Radiale 8×' },
];

export function Toolbar({
  tool, setTool,
  strokeColor, setStrokeColor,
  fillColor, setFillColor,
  strokeWidth, setStrokeWidth,
  onImageImport, onVectorize, canVectorize,
  pressureEnabled, setPressureEnabled,
  autoEnterEnabled, setAutoEnterEnabled,
  hasMultiSelection, hasSelection, selectedAreInGroup,
  onGroup, onUngroup,
  symmetry, setSymmetry,
  stabilizer, setStabilizer,
  showReference, setShowReference,
  showLibrary, setShowLibrary,
  showLayers, setShowLayers,
  showMiniMap, setShowMiniMap,
  onSaveToLibrary,
  onAddCamera, hasCameras, onPlayTour, tourPlaying,
  collapsed, onToggleCollapsed,
  sceneBounds, onSetSceneBounds,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSymmetryMenu, setShowSymmetryMenu] = useState(false);
  const [showBoundsMenu, setShowBoundsMenu] = useState(false);

  if (collapsed) {
    return (
      <div className="hidden sm:flex fixed left-0 top-0 bottom-0 w-9 bg-ink z-20 flex-col items-center pt-2 gap-2 select-none">
        <button
          onClick={onToggleCollapsed}
          className="w-9 h-11 flex items-center justify-center text-gray-400 hover:text-white active:text-white touch-manipulation text-lg"
          title="Développer la barre d'outils"
        >›</button>
        <div
          className="w-5 h-5 rounded-full border-2 border-white/30 flex-shrink-0 cursor-pointer touch-manipulation"
          style={{ background: strokeColor }}
          onClick={onToggleCollapsed}
          title="Développer la barre d'outils"
        />
      </div>
    );
  }

  return (
    <div className="hidden sm:flex fixed left-0 top-0 bottom-0 w-14 bg-ink flex-col items-center py-2 gap-0.5 z-20 shadow-xl select-none overflow-y-auto">
      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapsed}
        className="w-11 h-8 flex items-center justify-center text-gray-500 hover:text-white active:text-white touch-manipulation text-base mb-1 flex-shrink-0"
        title="Réduire la barre d'outils"
      >‹</button>

      {/* ── Couleurs + épaisseur ── */}
      <div className="w-full flex flex-col items-center gap-1.5 py-2 border-y border-white/10 flex-shrink-0">
        <ColorPicker value={strokeColor} onChange={setStrokeColor} title="Couleur du trait" swatchClassName="w-9 h-9 rounded-full border-2 border-white/30 cursor-pointer shadow-md touch-manipulation" />
        <div className="w-10 flex flex-col items-center gap-0.5 flex-shrink-0" title={`Épaisseur: ${strokeWidth}px`}>
          <div className="w-7 rounded-full bg-white/50" style={{ height: `${Math.max(2, Math.min(10, strokeWidth))}px` }} />
          <input type="range" min="1" max="20" value={strokeWidth}
            onChange={e => setStrokeWidth(Number(e.target.value))}
            className="accent-accent touch-manipulation w-10" />
        </div>
        <ColorPicker
          value={fillColor} onChange={setFillColor}
          title="Couleur de remplissage"
          swatchClassName="w-8 h-8 rounded border-2 border-white/30 cursor-pointer shadow touch-manipulation"
          showFillToggle onClearFill={() => setFillColor(fillColor === 'none' ? '#ffffff' : 'none')}
        />
      </div>

      {/* ── Outils de dessin ── */}
      <ToolButton active={tool === 'hand'} onClick={() => setTool('hand')} title="Main — déplacer le canvas (H)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.03 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5S23 4.67 23 5.5z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Sélection — sélectionner et déplacer des éléments (V)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M4 0l16 12-7 2-4 8L4 0z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} title="Stylo — dessiner librement (P)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'pathedit'} onClick={() => setTool('pathedit')} title="Édition de nœuds — modifier les points d'un tracé">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><circle cx="5" cy="19" r="3"/><circle cx="19" cy="5" r="3"/><path d="M5.5 16.5Q12 12 18.5 5.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} title="Rectangle (R)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><rect x="2" y="4" width="20" height="16" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2.5"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} title="Ellipse (C)">
        <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'text'} onClick={() => setTool('text')} title="Texte (T)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M5 4v3h5.5v12h3V7H19V4z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Gomme (E)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.77-.78 2.04 0 2.83L5.17 20H20v-2H9.84l-4-4L17 2.94l4 4V8h2V6.59c0-.51-.2-1.02-.59-1.41l-3.86-3.77C14.16 3.2 13.65 3 13.14 3h2z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'image'} onClick={() => fileInputRef.current?.click()} title="Importer une image (I)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
      </ToolButton>

      {canVectorize && (
        <ToolButton active={false} onClick={onVectorize} title="Vectoriser l'image sélectionnée">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-accent"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
        </ToolButton>
      )}

      {hasMultiSelection && !selectedAreInGroup && (
        <ToolButton active={false} onClick={onGroup} title="Grouper la sélection (Ctrl+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M3 5h7v2H5v5H3V5zm18 0v7h-2V7h-5V5h7zM3 19v-7h2v5h5v2H3zm18 0h-7v-2h5v-5h2v7z"/></svg>
        </ToolButton>
      )}

      {hasSelection && selectedAreInGroup && (
        <ToolButton active={false} onClick={onUngroup} title="Dégrouper (Ctrl+Shift+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M5 5h4v2H7v2H5V5zm14 0v4h-2V7h-2V5h4zM5 19v-4h2v2h2v2H5zm14 0h-4v-2h2v-2h2v4z"/></svg>
        </ToolButton>
      )}

      {hasSelection && (
        <ToolButton active={false} onClick={onSaveToLibrary} title="Sauvegarder dans la bibliothèque">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
        </ToolButton>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) { onImageImport(f); e.target.value = ''; } }} />

      <div className="flex-1 min-h-[4px]" />

      {/* ── Symétrie ── */}
      <div className="relative w-full flex justify-center">
        <button
          className={`w-11 h-9 rounded text-[10px] font-semibold transition-colors flex-shrink-0 touch-manipulation ${symmetry !== 'off' ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}
          onClick={() => setShowSymmetryMenu(v => !v)}
          title="Symétrie de dessin"
        >
          {symmetry === 'off' ? 'SYM' : symmetry === 'vertical' ? '↔' : symmetry === 'horizontal' ? '↕' : symmetry === 'both' ? '✛' : symmetry === 'radial4' ? '✦4' : symmetry === 'radial6' ? '✦6' : '✦8'}
        </button>
        {/* Backdrop — closes menu on outside click */}
        {showSymmetryMenu && <div className="fixed inset-0 z-20" onClick={() => setShowSymmetryMenu(false)} />}
        {showSymmetryMenu && (
          <div className="absolute left-full ml-1 bottom-0 bg-ink border border-white/10 rounded-lg shadow-xl z-30 min-w-[150px] py-1">
            {SYMMETRY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`w-full text-left px-3 py-2.5 text-[12px] touch-manipulation transition-colors ${symmetry === opt.value ? 'text-accent font-semibold' : 'text-gray-300 active:text-white hover:text-white hover:bg-white/5'}`}
                onClick={() => { setSymmetry(opt.value); setShowSymmetryMenu(false); }}
              >{opt.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Stabilisateur ── */}
      <div className="w-11 flex flex-col items-center gap-0.5 my-1 flex-shrink-0" title={`Stabilisateur: ${stabilizer}% — lisse les tracés`}>
        <span className="text-[8px] text-gray-500 select-none">~{stabilizer}%</span>
        <input type="range" min={0} max={95} value={stabilizer}
          onChange={e => setStabilizer(Number(e.target.value))}
          className="accent-accent touch-manipulation"
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '44px', width: '10px' }}
        />
      </div>

      {/* ── Options ── */}
      <button
        className={`w-11 h-9 rounded text-[11px] font-semibold transition-colors flex-shrink-0 touch-manipulation ${pressureEnabled ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}
        onClick={() => setPressureEnabled(!pressureEnabled)}
        title={pressureEnabled ? 'Pression du stylet activée — cliquer pour désactiver' : 'Pression du stylet désactivée — cliquer pour activer'}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M17 3c-1.1 0-2 .9-2 2v3c0 1.1.9 2 2 2h1v11h2V10h1c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-4zM2 20c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V8.83C13.39 8.29 13 7.54 13 6.76V3H3c-1.1 0-2 .9-2 2v15z"/></svg>
      </button>

      <button
        className={`w-11 h-9 rounded text-[10px] font-semibold transition-colors flex-shrink-0 touch-manipulation ${autoEnterEnabled ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}
        onClick={() => setAutoEnterEnabled(!autoEnterEnabled)}
        title={autoEnterEnabled ? 'Zoom automatique activé — entre dans les formes en zoomant dessus' : 'Zoom automatique désactivé'}
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/><path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/></svg>
      </button>

      <button
        className={`w-11 h-9 rounded text-[10px] font-semibold transition-colors flex-shrink-0 touch-manipulation ${showReference ? 'bg-accent/30 text-white' : 'text-gray-500 active:text-white border border-white/10'}`}
        onClick={() => setShowReference(!showReference)}
        title="Afficher/masquer les images de référence"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d={showReference ? "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" : "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"}/></svg>
      </button>

      {/* ── Panneaux ── */}
      <div className="w-10 h-px bg-white/10 my-1 flex-shrink-0" />

      <button onClick={() => setShowLayers(!showLayers)} title="Calques"
        className={`w-11 h-9 rounded text-[10px] transition-colors flex-shrink-0 touch-manipulation ${showLayers ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>
      </button>

      <button onClick={() => setShowLibrary(!showLibrary)} title="Bibliothèque d'éléments"
        className={`w-11 h-9 rounded text-[10px] transition-colors flex-shrink-0 touch-manipulation ${showLibrary ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
      </button>

      <button onClick={() => setShowMiniMap(!showMiniMap)} title="Mini-carte"
        className={`w-11 h-9 rounded text-[10px] transition-colors flex-shrink-0 touch-manipulation ${showMiniMap ? 'bg-accent text-white' : 'text-gray-500 active:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5z"/></svg>
      </button>

      {/* ── Caméra / tour ── */}
      <button onClick={onAddCamera} title="Ajouter un point de caméra pour le tour"
        className="w-11 h-9 rounded text-[10px] text-gray-500 active:text-white border border-white/10 transition-colors flex-shrink-0 touch-manipulation">
        🎬
      </button>
      {hasCameras && (
        <button onClick={onPlayTour} title={tourPlaying ? 'Arrêter le tour' : 'Lancer le tour de caméras'}
          className={`w-11 h-9 rounded text-[10px] transition-colors flex-shrink-0 touch-manipulation ${tourPlaying ? 'bg-red-500/80 text-white' : 'bg-accent/20 text-accent active:bg-accent/40'}`}>
          {tourPlaying ? '■' : '▶'}
        </button>
      )}

      {/* ── Limites du monde ── */}
      <div className="relative w-full flex justify-center">
        <button
          className={`w-11 h-9 rounded text-[10px] font-semibold transition-colors flex-shrink-0 touch-manipulation ${sceneBounds ? 'bg-accent/30 text-white border border-accent/40' : 'text-gray-500 active:text-white border border-white/10'}`}
          onClick={() => setShowBoundsMenu(v => !v)}
          title="Taille du monde (délimitation de page)"
        >
          {sceneBounds
            ? BOUNDS_PRESETS.find(p => p.bounds?.width === sceneBounds.width && p.bounds?.height === sceneBounds.height)?.short ?? 'BND'
            : '⊞'}
        </button>
        {/* Backdrop — closes menu on outside click */}
        {showBoundsMenu && <div className="fixed inset-0 z-20" onClick={() => setShowBoundsMenu(false)} />}
        {showBoundsMenu && (
          <div className="absolute left-full ml-1 bottom-0 bg-ink border border-white/10 rounded-lg shadow-xl z-30 min-w-[180px] py-1">
            {BOUNDS_PRESETS.map(preset => (
              <button
                key={preset.label}
                className={`w-full text-left px-3 py-2.5 text-[12px] touch-manipulation transition-colors ${
                  (!sceneBounds && !preset.bounds) || (sceneBounds && preset.bounds?.width === sceneBounds.width && preset.bounds?.height === sceneBounds.height)
                    ? 'text-accent font-semibold'
                    : 'text-gray-300 active:text-white hover:text-white hover:bg-white/5'
                }`}
                onClick={() => { onSetSceneBounds(preset.bounds); setShowBoundsMenu(false); }}
              >{preset.label}</button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
