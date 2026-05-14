import React, { useRef } from 'react';
import { ToolType } from '../types/scene';
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
  selectedNodeType?: string;
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
}

interface ToolButtonProps {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function ToolButton({ active, onClick, title, children }: ToolButtonProps) {
  return (
    <button
      className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all text-lg
        ${active
          ? 'bg-accent text-white shadow-inner'
          : 'text-gray-400 hover:text-white hover:bg-white/10'
        }`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}

export function Toolbar({
  tool, setTool,
  strokeColor, setStrokeColor,
  fillColor, setFillColor,
  strokeWidth, setStrokeWidth,
  onImageImport,
  onVectorize,
  canVectorize,
  pressureEnabled, setPressureEnabled,
  autoEnterEnabled, setAutoEnterEnabled,
  hasMultiSelection, hasSelection, selectedAreInGroup,
  onGroup, onUngroup,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageImport(file);
      e.target.value = '';
    }
  };

  return (
    <div className="fixed left-0 top-0 bottom-0 w-14 bg-ink flex flex-col items-center py-3 gap-1 z-20 shadow-xl select-none overflow-y-auto">
      {/* Logo */}
      <div className="w-10 h-10 flex items-center justify-center mb-2 flex-shrink-0">
        <svg viewBox="0 0 24 24" className="w-7 h-7 fill-accent">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </div>

      <div className="w-10 h-px bg-white/10 mb-1 flex-shrink-0" />

      {/* Tools */}
      <ToolButton active={tool === 'hand'} onClick={() => setTool('hand')} title="Hand (H)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.03 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5S23 4.67 23 5.5z"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'select'} onClick={() => setTool('select')} title="Select (V)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M4 0l16 12-7 2-4 8L4 0z"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'pen'} onClick={() => setTool('pen')} title="Pen (P)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'rect'} onClick={() => setTool('rect')} title="Rectangle (R)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <rect x="2" y="4" width="20" height="16" rx="2" fillOpacity="0" stroke="currentColor" strokeWidth="2.5"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} title="Circle (C)">
        <svg viewBox="0 0 24 24" className="w-5 h-5">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'text'} onClick={() => setTool('text')} title="Text (T)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M5 4v3h5.5v12h3V7H19V4z"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} title="Eraser (E)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M15.14 3c-.51 0-1.02.2-1.41.59L2.59 14.73c-.78.77-.78 2.04 0 2.83L5.17 20H20v-2H9.84l-4-4L17 2.94l4 4V8h2V6.59c0-.51-.2-1.02-.59-1.41l-3.86-3.77C14.16 3.2 13.65 3 13.14 3h2z"/>
          <path d="M5.14 17.41l3 3H20v1H7.56l-3-3 .58-.58v-.42z" opacity=".3"/>
        </svg>
      </ToolButton>

      <ToolButton active={tool === 'image'} onClick={handleImageClick} title="Import Image (I)">
        <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
      </ToolButton>

      {canVectorize && (
        <ToolButton active={false} onClick={onVectorize} title="Vectorize Selected Image (V)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current text-accent">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
          </svg>
        </ToolButton>
      )}

      {hasMultiSelection && !selectedAreInGroup && (
        <ToolButton active={false} onClick={onGroup} title="Group selection (Ctrl+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
            <path d="M3 5h7v2H5v5H3V5zm18 0v7h-2V7h-5V5h7zM3 19v-7h2v5h5v2H3zm18 0h-7v-2h5v-5h2v7z"/>
          </svg>
        </ToolButton>
      )}

      {hasSelection && selectedAreInGroup && (
        <ToolButton active={false} onClick={onUngroup} title="Ungroup (Ctrl+Shift+G)">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
            <path d="M5 5h4v2H7v2H5V5zm14 0v4h-2V7h-2V5h4zM5 19v-4h2v2h2v2H5zm14 0h-4v-2h2v-2h2v4zM11 9h2v6h-2z"/>
          </svg>
        </ToolButton>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex-1 min-h-[8px]" />

      {/* Pressure toggle */}
      <button
        className={`w-10 h-7 mb-1 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${
          pressureEnabled ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'
        }`}
        onClick={() => setPressureEnabled(!pressureEnabled)}
        title="Pen pressure sensitivity"
      >
        PSI
      </button>

      {/* Auto-enter toggle */}
      <button
        className={`w-10 h-7 mb-1 rounded text-[10px] font-semibold transition-colors flex-shrink-0 ${
          autoEnterEnabled ? 'bg-accent text-white' : 'text-gray-500 hover:text-white border border-white/10'
        }`}
        onClick={() => setAutoEnterEnabled(!autoEnterEnabled)}
        title="Auto-enter scene on deep zoom"
      >
        ZOOM
      </button>

      {/* Color pickers */}
      <div className="w-10 flex flex-col items-center gap-2 mb-2 flex-shrink-0">
        <ColorPicker
          value={strokeColor}
          onChange={setStrokeColor}
          title="Stroke color"
          swatchClassName="w-8 h-8 rounded-full border-2 border-white/30 cursor-pointer shadow-md"
        />
        <ColorPicker
          value={fillColor}
          onChange={setFillColor}
          title="Fill color"
          swatchClassName="w-6 h-6 rounded border-2 border-white/30 cursor-pointer shadow"
          showFillToggle
          onClearFill={() => setFillColor(fillColor === 'none' ? '#ffffff' : 'none')}
        />
      </div>

      {/* Stroke width */}
      <div className="w-10 flex flex-col items-center gap-1 mb-2 flex-shrink-0" title="Stroke width">
        <div
          className="w-6 rounded-full bg-white/60"
          style={{ height: `${Math.max(2, Math.min(12, strokeWidth))}px` }}
        />
        <input
          type="range"
          min="1"
          max="20"
          value={strokeWidth}
          onChange={(e) => setStrokeWidth(Number(e.target.value))}
          className="w-10 accent-accent"
          style={{ writingMode: 'vertical-lr', direction: 'rtl', height: '60px' }}
        />
      </div>
    </div>
  );
}
