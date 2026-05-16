
export interface WorldSizePreset {
  label: string;
  short: string;
  bounds: { width: number; height: number } | null;
  testId: string;
}

export const WORLD_SIZE_PRESETS: WorldSizePreset[] = [
  { label: '∞ Aucune limite', short: '∞', bounds: null, testId: 'world-size-option-none' },
  { label: 'Carré 1000×1000', short: '1K²', bounds: { width: 1000, height: 1000 }, testId: 'world-size-option-square' },
  { label: '16:9 Présentation', short: '16:9', bounds: { width: 1920, height: 1080 }, testId: 'world-size-option-16-9' },
  { label: 'A4 portrait', short: 'A4↕', bounds: { width: 2480, height: 3508 }, testId: 'world-size-option-a4-portrait' },
  { label: 'A4 paysage', short: 'A4↔', bounds: { width: 3508, height: 2480 }, testId: 'world-size-option-a4-landscape' },
];

export function getWorldSizeShort(bounds?: { width: number; height: number }): string {
  if (!bounds) return '∞';
  const match = WORLD_SIZE_PRESETS.find(
    p => p.bounds && p.bounds.width === bounds.width && p.bounds.height === bounds.height,
  );
  return match ? match.short : 'custom';
}

interface WorldSizeSheetProps {
  sceneBounds?: { width: number; height: number };
  sceneLabel: string;
  onSelect: (bounds: { width: number; height: number } | null, presetLabel: string) => void;
  onClose: () => void;
}

export function WorldSizeSheet({ sceneBounds, sceneLabel, onSelect, onClose }: WorldSizeSheetProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute bottom-0 left-0 right-0 bg-ink border-t border-white/10 rounded-t-2xl shadow-2xl p-5 flex flex-col gap-4"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}
        onClick={e => e.stopPropagation()}
        data-testid="world-size-sheet"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-white font-semibold text-base">Taille du monde actuel</h2>
          <p className="text-gray-400 text-xs leading-relaxed">
            Ce réglage s'applique uniquement à la scène où vous êtes actuellement.
          </p>
          <p className="text-gray-500 text-xs mt-0.5">
            Monde : <span className="text-gray-300">{sceneLabel}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {WORLD_SIZE_PRESETS.map(p => {
            const active = p.bounds === null
              ? !sceneBounds
              : (sceneBounds?.width === p.bounds.width && sceneBounds?.height === p.bounds.height);
            return (
              <button
                key={p.testId}
                data-testid={p.testId}
                onClick={() => onSelect(p.bounds, p.label)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm touch-manipulation transition-colors ${
                  active
                    ? 'bg-accent text-white'
                    : 'bg-white/5 text-gray-200 active:bg-white/10 border border-white/10'
                }`}
              >
                <span className="font-mono font-bold w-9 text-center flex-shrink-0">{p.short}</span>
                <span className="flex-1 text-left">{p.label}</span>
                {active && <span className="text-white/70 text-xs">✓</span>}
              </button>
            );
          })}
        </div>

        <button
          onClick={onClose}
          className="py-2 text-gray-500 text-sm hover:text-gray-300 transition-colors touch-manipulation text-center"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
