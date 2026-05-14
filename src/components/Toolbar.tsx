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
}

function ToolButton({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all text-lg ${active ? 'bg-accent text-white shadow-inner' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
      onClick={onClick} title={title}
    >{children}</button>
  );
}

const SYMMETRY_OPTIONS: { value: SymmetryMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'vertical', label: '↔ V' },
  { value: 'horizontal', label: '↕ H' },
  { value: 'both', label: '✛ Both' },
  { value: 'radial4', label: '✦ 4×' },
  { value: 'radial6', label: '✦ 6×' },
  { value: 'radial8', label: '✦ 8×' },
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
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSymmetryMenu, setShowSymmetryMenu] = useState(false);

  return (
    <div className="fixed left-0 top-0 bottom-0 w-14 bg-ink flex flex-col items-center py-3 gap-1 z-20 shadow-xl select-none overflow-y-auto">
      {/* Logo */}
      <div className="w-10 h-10 flex items-center justify-center mb-2 flex-shrink-0">
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-accent">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </div>

      <div className="w-10 h-px bg-white/10 mb-1 flex-shrink-0" />

      {/* Drawing tools */}
      <ToolButton active={tool === 'hand'} onClick={() => setTool('hand')} title="Hand (H)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.03 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5S23 4.67 23 5.5z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Select (V)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M4 0l16 12-7 2-4 8L4 0z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen (P)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'pathedit'} onClick={() => setTool('pathedit')} title="Edit path nodes">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><circle cx="5" cy="19" r="3"/><circle cx="19" cy="5" r="3"/><path d="M5.5 16.5Q12 12 18.5 5.5" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} title="Rectangle (R)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><rect x="2" y="4" width="20" height="16" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2.5"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} title="Circle (C)">
        <svg viewBox="0 0 24 24" className="w-5 h-5"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'text'} onClick={() => setTool('text')} title="Text (T)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M5 4v3h5.5v12h3V7H19V4z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (E)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.77-.78 2.04 0 2.83L5.17 20H20v-2H9.84l-4-4L17 2.94l4 4V8h2V6.59c0-.51-.2-1.02-.59-1.41l-3.86-3.77C14.16 3.2 13.65 3 13.14 3h2z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'image'} onClick={() => fileInputRef.current?.click()} title="Import Image (I)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
      </ToolButton>

      <ToolButton active={tool === 'stamp'} onClick={() => setTool('stamp')} title="Stamp brush">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M21 17H3v2h18v-2zm-9-10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zM8 8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm8 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-4-6C7.93 2 4.6 5.12 4.6 9H3v2h2.07c.22.84.6 1.63 1.1 2.31L5.1 14.38 6.52 15.8l1.07-1.07C8.27 15.22 9.1 15.6 10 15.83V17h4v-1.17c.9-.23 1.73-.61 2.41-1.1l1.07 1.07 1.42-1.42-1.07-1.07c.5-.68.88-1.47 1.1-2.31H21V9h-1.6C19.4 5.12 16.07 2 12 2z"/></svg>
      </ToolButton>

      {canVectorize && (
        <ToolButton active={false} onClick={onVectorize} title="Vectorize image (V)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-accent"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
        </ToolButton>
      )}

      {hasMultiSelection && !selectedAreInGroup && (
        <ToolButton active={false} onClick={onGroup} title="Group (Ctrl+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M3 5h7v2H5v5H3V5zm18 0v7h-2V7h-5V5h7zM3 19v-7h2v5h5v2H3zm18 0h-7v-2h5v-5h2v7z"/></svg>
        </ToolButton>
      )}

      {hasSelection && selectedAreInGroup && (
        <ToolButton active={false} onClick={onUngroup} title="Ungroup (Ctrl+Shift+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M5 5h4v2H7v2H5V5zm14 0v4h-2V7h-2V5h4zM5 19v-4h2v2h2v2H5zm14 0h-4v-2h2v-2h2v4z"/></svg>
        </ToolButton>
      )}

      {hasSelection && (
        <ToolButton active={false} onClick={onSaveToLibrary} title="Save to asset library">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
        </ToolButton>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) { onImageImport(f); e.target.value = ''; } }} />

      <div className="flex-1 min-h-[4px]" />

      {/* Symmetry */}
      <div className="relative w-full flex justify-center">
        <button
          className={`w-10 h-7 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${symmetry !== 'off' ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}
          onClick={() => setShowSymmetryMenu(v => !v)}
          title="Symmetry"
        >
          SYM
        </button>
        {showSymmetryMenu && (
          <div className="absolute left-12 bottom-0 bg-ink border border-white/10 rounded-lg shadow-xl z-30 min-w-[120px] py-1">
            {SYMMETRY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${symmetry === opt.value ? 'text-accent' : 'text-gray-300 hover:text-white hover:bg-white/5'}`}
                onClick={() => { setSymmetry(opt.value); setShowSymmetryMenu(false); }}
              >{opt.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* Stabilizer */}
      <div className="w-10 flex flex-col items-center gap-0.5 my-1 flex-shrink-0" title={`Stabilizer ${stabilizer}%`}>
        <span className="text-[8px] text-gray-500 uppercase">STB</span>
        <input type="range" min={0} max={95} value={stabilizer}
          onChange={e => setStabilizer(Number(e.target.value))}
          className="accent-accent"
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '40px', width: '10px' }}
        />
      </div>

      {/* Toggles */}
      <button
        className={`w-10 h-7 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${pressureEnabled ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}
        onClick={() => setPressureEnabled(!pressureEnabled)}
        title="Pen pressure sensitivity"
      >PSI</button>

      <button
        className={`w-10 h-7 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${autoEnterEnabled ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}
        onClick={() => setAutoEnterEnabled(!autoEnterEnabled)}
        title="Auto-enter scene on deep zoom"
      >ZOOM</button>

      <button
        className={`w-10 h-7 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${showReference ? 'bg-accent/30 text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}
        onClick={() => setShowReference(!showReference)}
        title="Toggle reference images"
      >REF</button>

      {/* Panel toggles */}
      <div className="w-10 h-px bg-white/10 my-1 flex-shrink-0" />

      <button onClick={() => setShowLayers(!showLayers)} title="Layers panel"
        className={`w-10 h-7 rounded text-[10px] transition-colors flex-shrink-0 ${showLayers ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/></svg>
      </button>

      <button onClick={() => setShowLibrary(!showLibrary)} title="Asset library"
        className={`w-10 h-7 rounded text-[10px] transition-colors flex-shrink-0 ${showLibrary ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
      </button>

      <button onClick={() => setShowMiniMap(!showMiniMap)} title="Mini-map (M)"
        className={`w-10 h-7 rounded text-[10px] transition-colors flex-shrink-0 ${showMiniMap ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'}`}>
        <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current mx-auto"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5z"/></svg>
      </button>

      {/* Camera tour */}
      <button onClick={onAddCamera} title="Add camera waypoint" className="w-10 h-7 rounded text-[10px] text-gray-500 hover:text-white border border-white/10 transition-colors flex-shrink-0">
        🎬
      </button>
      {hasCameras && (
        <button onClick={onPlayTour} title={tourPlaying ? 'Stop tour' : 'Play camera tour'}
          className={`w-10 h-7 rounded text-[10px] transition-colors flex-shrink-0 ${tourPlaying ? 'bg-red-500/80 text-white' : 'bg-accent/20 text-accent hover:bg-accent/40'}`}>
          {tourPlaying ? '■' : '▶'}
        </button>
      )}

      {/* Color pickers */}
      <div className="w-10 flex flex-col items-center gap-2 mt-2 mb-1 flex-shrink-0">
        <ColorPicker value={strokeColor} onChange={setStrokeColor} title="Stroke color" swatchClassName="w-8 h-8 rounded-full border-2 border-white/30 cursor-pointer shadow-md" />
        <ColorPicker value={fillColor} onChange={setFillColor} title="Fill color" swatchClassName="w-6 h-6 rounded border-2 border-white/30 cursor-pointer shadow" showFillToggle onClearFill={() => setFillColor(fillColor === 'none' ? '#ffffff' : 'none')} />
      </div>

      {/* Stroke width */}
      <div className="w-10 flex flex-col items-center gap-1 mb-2 flex-shrink-0" title="Stroke width">
        <div className="w-6 rounded-full bg-white/60" style={{ height: `${Math.max(2, Math.min(12, strokeWidth))}px` }} />
        <input type="range" min="1" max="20" value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} className="w-10 accent-accent" style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '60px' }} />
      </div>
    </div>
  );
}
