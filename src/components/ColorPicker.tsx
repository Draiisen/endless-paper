import { useEffect, useRef, useState } from 'react';

const PALETTE = [
  '#1a1a2e', '#0f3460', '#704214', '#2d4a2b', '#6b1f1f', '#3a2c4a', '#4a3b1f', '#1f3a4a',
  '#4a90d9', '#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#9d4edd', '#ff7b00', '#ffffff',
];

const RECENT_KEY = 'endless-paper-recent-colors';
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch { return []; }
}

function saveRecent(colors: string[]): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(colors.slice(0, MAX_RECENT))); }
  catch { /* ignore */ }
}

function pushRecent(color: string): string[] {
  const cur = loadRecent().filter(c => c.toLowerCase() !== color.toLowerCase());
  const next = [color, ...cur].slice(0, MAX_RECENT);
  saveRecent(next);
  return next;
}

// Parse #rrggbb or rgba(...) -> { hex, alpha }
function parseColor(value: string): { hex: string; alpha: number } {
  if (value.startsWith('rgba')) {
    const m = value.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (m) {
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      const a = parseFloat(m[4]);
      return { hex: `#${[r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')}`, alpha: a };
    }
  }
  if (value.startsWith('#') && value.length === 7) return { hex: value, alpha: 1 };
  return { hex: '#1a1a2e', alpha: 1 };
}

function buildColor(hex: string, alpha: number): string {
  if (alpha >= 0.999) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  swatchClassName?: string;
  title?: string;
  showFillToggle?: boolean;
  onClearFill?: () => void;
}

export function ColorPicker({ value, onChange, swatchClassName, title, showFillToggle, onClearFill }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const wrapRef = useRef<HTMLDivElement>(null);

  const isNone = value === 'none' || !value;
  const parsed = isNone ? { hex: '#1a1a2e', alpha: 1 } : parseColor(value);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = (hex: string, alpha: number) => {
    const c = buildColor(hex, alpha);
    onChange(c);
    setRecent(pushRecent(c));
  };

  return (
    <div ref={wrapRef} className="relative" title={title}>
      <button
        type="button"
        className={swatchClassName ?? 'w-8 h-8 rounded-full border-2 border-white/30 shadow-md cursor-pointer'}
        style={{
          backgroundColor: isNone ? 'transparent' : value,
          backgroundImage: isNone
            ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
            : 'none',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
        }}
        onClick={() => setOpen(o => !o)}
      />
      {open && (
        <div className="absolute left-12 top-0 z-50 bg-ink/95 backdrop-blur-sm rounded-xl shadow-2xl border border-white/10 p-3 w-56">
          {recent.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Recent</div>
              <div className="grid grid-cols-8 gap-1 mb-3">
                {recent.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    className="w-5 h-5 rounded border border-white/20 hover:scale-110 transition-transform"
                    style={{ backgroundColor: c }}
                    onClick={() => { onChange(c); setOpen(false); }}
                    title={c}
                  />
                ))}
              </div>
            </>
          )}
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Palette</div>
          <div className="grid grid-cols-8 gap-1 mb-3">
            {PALETTE.map(c => (
              <button
                key={c}
                className="w-5 h-5 rounded border border-white/20 hover:scale-110 transition-transform"
                style={{ backgroundColor: c }}
                onClick={() => { apply(c, parsed.alpha); }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="color"
              value={parsed.hex}
              onChange={(e) => apply(e.target.value, parsed.alpha)}
              className="w-7 h-7 rounded cursor-pointer bg-transparent"
            />
            <span className="text-xs text-gray-400 font-mono">{parsed.hex.toUpperCase()}</span>
          </div>
          <div>
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400 mb-1">
              <span>Opacity</span>
              <span className="font-mono">{Math.round(parsed.alpha * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(parsed.alpha * 100)}
              onChange={(e) => apply(parsed.hex, Number(e.target.value) / 100)}
              className="w-full accent-accent"
            />
          </div>
          {showFillToggle && (
            <button
              className="mt-3 w-full text-xs text-gray-300 hover:text-white py-1 rounded border border-white/10 hover:bg-white/5 transition-colors"
              onClick={() => { onClearFill?.(); setOpen(false); }}
            >
              {isNone ? 'Set fill' : 'Clear fill'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
