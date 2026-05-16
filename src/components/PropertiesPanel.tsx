import { useState, useRef, useCallback } from 'react';
import { SceneNode, Hotspot, NodeAnimation, SceneAudio } from '../types/scene';
import { SceneCatalogEntry } from '../engine/scene-graph';

interface PropertiesPanelProps {
  node: SceneNode;
  sceneCatalog: SceneCatalogEntry[];
  currentSceneId?: string;
  onUpdate: (updates: Partial<SceneNode>) => void;
  onAddAudio: () => void;
  currentSceneAudio: SceneAudio | undefined;
  onUpdateSceneAudio: (audio: SceneAudio | undefined) => void;
  onClose?: () => void;
}

const ANIM_TYPES: NodeAnimation['type'][] = ['pulse', 'wobble', 'float', 'fade'];

type Tab = 'text' | 'image' | 'hotspot' | 'portal' | 'anim' | 'audio';

export function PropertiesPanel({ node, sceneCatalog, currentSceneId, onUpdate, onAddAudio, currentSceneAudio, onUpdateSceneAudio, onClose }: PropertiesPanelProps) {
  const isText = node.type === 'text';
  const isImage = node.type === 'image';
  const [activeTab, setActiveTab] = useState<Tab>(isText ? 'text' : isImage ? 'image' : 'hotspot');
  const [savedFlash, setSavedFlash] = useState(false);
  const savedTimerRef = useRef<number | null>(null);

  const onUpdateWithFeedback = useCallback((updates: Partial<SceneNode>) => {
    onUpdate(updates);
    setSavedFlash(true);
    if (savedTimerRef.current !== null) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => { setSavedFlash(false); savedTimerRef.current = null; }, 1200);
  }, [onUpdate]);

  const tabs: Tab[] = isText
    ? ['text', 'hotspot', 'portal', 'anim', 'audio']
    : isImage
    ? ['image', 'hotspot', 'portal', 'anim', 'audio']
    : ['hotspot', 'portal', 'anim', 'audio'];

  const tabIcon: Record<Tab, string> = {
    text: 'T', image: '🖼', hotspot: '💬', portal: '🌀', anim: '✨', audio: '🔊',
  };

  return (
    <div className="fixed right-0 top-12 bottom-0 w-full sm:w-64 bg-ink/95 border-l border-white/10 text-white text-xs overflow-y-auto z-10 flex flex-col">
      <div className="flex items-center border-b border-white/10 flex-shrink-0">
        {savedFlash && (
          <span className="ml-2 text-green-400 text-[10px] font-medium animate-pulse flex-shrink-0">✓</span>
        )}
        {tabs.map(tab => (
          <button
            key={tab}
            className={`flex-1 py-3 sm:py-2 text-xs sm:text-[10px] uppercase tracking-wide transition-colors touch-manipulation ${activeTab === tab ? 'text-accent border-b-2 border-accent' : 'text-gray-500 active:text-white hover:text-white'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tabIcon[tab]}
          </button>
        ))}
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-3 sm:py-2 text-gray-500 active:text-white hover:text-white transition-colors touch-manipulation flex-shrink-0"
            title="Close"
          >✕</button>
        )}
      </div>

      <div className="flex-1 p-3 flex flex-col gap-3">
        {activeTab === 'text' && isText && (
          <TextEditor node={node} onUpdate={onUpdateWithFeedback} />
        )}
        {activeTab === 'image' && isImage && (
          <ImageEditor node={node} onUpdate={onUpdateWithFeedback} />
        )}
        {activeTab === 'hotspot' && (
          <HotspotEditor hotspot={node.hotspot} onChange={hs => onUpdateWithFeedback({ hotspot: hs })} />
        )}
        {activeTab === 'portal' && (
          <PortalEditor portal={node.portal} catalog={sceneCatalog} currentSceneId={currentSceneId} nodeId={node.id} onChange={p => onUpdateWithFeedback({ portal: p })} />
        )}
        {activeTab === 'anim' && (
          <AnimEditor anim={node.animation} onChange={a => onUpdateWithFeedback({ animation: a })} />
        )}
        {activeTab === 'audio' && (
          <AudioEditor audio={currentSceneAudio} onUpdate={onUpdateSceneAudio} onAdd={onAddAudio} />
        )}
      </div>
    </div>
  );
}

function TextEditor({ node, onUpdate }: { node: SceneNode; onUpdate: (u: Partial<SceneNode>) => void }) {
  const isBold = node.fontWeight === 'bold';
  const isItalic = node.fontStyle === 'italic';
  const isUnderline = node.textDecoration === 'underline';
  const align = node.textAlign ?? 'left';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-gray-400">Style</span>
        <div className="flex gap-1">
          <button onClick={() => onUpdate({ fontWeight: isBold ? 'normal' : 'bold' })}
            className={`flex-1 py-1.5 rounded text-[13px] font-bold ${isBold ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>B</button>
          <button onClick={() => onUpdate({ fontStyle: isItalic ? 'normal' : 'italic' })}
            className={`flex-1 py-1.5 rounded text-[13px] italic ${isItalic ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>I</button>
          <button onClick={() => onUpdate({ textDecoration: isUnderline ? 'none' : 'underline' })}
            className={`flex-1 py-1.5 rounded text-[13px] underline ${isUnderline ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>U</button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gray-400">Align</span>
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} onClick={() => onUpdate({ textAlign: a })}
              className={`flex-1 py-1.5 rounded text-[12px] ${align === a ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
              {a === 'left' ? '▤' : a === 'center' ? '▥' : '▦'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gray-400">Size <span className="text-gray-500">{node.fontSize ?? 16}px</span></span>
        <input type="range" min={8} max={144} value={node.fontSize ?? 16}
          onChange={e => onUpdate({ fontSize: Number(e.target.value) })}
          className="accent-accent" />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gray-400">Color</span>
        <div className="flex items-center gap-2">
          <input type="color" value={node.color ?? '#1a1a2e'}
            onChange={e => onUpdate({ color: e.target.value })}
            className="w-8 h-7 rounded border border-white/20 bg-transparent cursor-pointer" />
          <span className="text-gray-500 text-[10px] font-mono">{node.color ?? '#1a1a2e'}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-gray-400">Font</span>
        <select value={node.fontFamily ?? 'system-ui, sans-serif'}
          onChange={e => onUpdate({ fontFamily: e.target.value })}
          className="bg-ink/60 border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-accent/60">
          <option value="system-ui, sans-serif">System UI</option>
          <option value="Georgia, serif">Georgia</option>
          <option value="'Courier New', monospace">Monospace</option>
          <option value="Impact, sans-serif">Impact</option>
          <option value="'Arial Black', sans-serif">Arial Black</option>
        </select>
      </div>
    </div>
  );
}

function ImageEditor({ node, onUpdate }: { node: SceneNode; onUpdate: (u: Partial<SceneNode>) => void }) {
  const opacity = node.referenceOpacity ?? 0.35;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={!!node.isReference}
          onChange={e => onUpdate({ isReference: e.target.checked })}
          className="accent-accent" />
        <span>Reference layer (renders below)</span>
      </label>
      {node.isReference && (
        <div className="flex flex-col gap-1">
          <span className="text-gray-400">Opacity <span className="text-gray-500">{Math.round(opacity * 100)}%</span></span>
          <input type="range" min={5} max={100} value={Math.round(opacity * 100)}
            onChange={e => onUpdate({ referenceOpacity: Number(e.target.value) / 100 })}
            className="accent-accent" />
        </div>
      )}
    </div>
  );
}

function HotspotEditor({ hotspot, onChange }: { hotspot: Hotspot | undefined; onChange: (h: Hotspot | undefined) => void }) {
  const enabled = !!hotspot;
  const hs: Hotspot = hotspot ?? { type: 'text', trigger: 'click', content: '' };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? hs : undefined)} className="accent-accent" />
        <span>Enable hotspot</span>
      </label>

      {enabled && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Type</span>
            <div className="flex gap-1">
              {(['text', 'window'] as const).map(t => (
                <button key={t} onClick={() => onChange({ ...hs, type: t })}
                  className={`flex-1 py-1 rounded text-[11px] ${hs.type === t ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                >
                  {t === 'text' ? 'Bubble' : 'Window'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Trigger</span>
            <div className="flex gap-1">
              {(['click', 'doubleclick', 'hover'] as const).map(t => (
                <button key={t} onClick={() => onChange({ ...hs, trigger: t })}
                  className={`flex-1 py-1 rounded text-[10px] ${hs.trigger === t ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                >
                  {t === 'click' ? 'Click' : t === 'doubleclick' ? '2× Click' : 'Hover'}
                </button>
              ))}
            </div>
          </div>

          {hs.type === 'window' && (
            <div className="flex flex-col gap-1">
              <span className="text-gray-400">Title</span>
              <input
                className="bg-ink/60 border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-accent/60"
                value={hs.title ?? ''}
                placeholder="Window title"
                onChange={e => onChange({ ...hs, title: e.target.value })}
              />
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Content {hs.type === 'window' ? '(Markdown)' : ''}</span>
            <textarea
              className="bg-ink/60 border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-accent/60 resize-y"
              rows={4}
              value={hs.content}
              placeholder={hs.type === 'text' ? 'Short text (max 200 chars)' : '**Bold** *italic* `code`\n[link](url)'}
              onChange={e => onChange({ ...hs, content: hs.type === 'text' ? e.target.value.slice(0, 200) : e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function PortalEditor({ portal, catalog, currentSceneId, onChange }: {
  portal: { targetSceneId: string; targetCamera?: import('../types/scene').Viewport } | undefined;
  catalog: SceneCatalogEntry[];
  currentSceneId?: string;
  nodeId?: string;
  onChange: (p: typeof portal) => void;
}) {
  const enabled = !!portal;
  const others = catalog.filter(c => c.scene.id !== currentSceneId);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? { targetSceneId: others[0]?.scene.id ?? '' } : undefined)} className="accent-accent" />
        <span>Enable portal</span>
      </label>

      {enabled && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Destination scene</span>
            <select
              className="bg-ink/60 border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-accent/60"
              value={portal?.targetSceneId ?? ''}
              onChange={e => onChange({ ...portal!, targetSceneId: e.target.value })}
            >
              {others.length === 0 && <option value="">No other scenes yet</option>}
              {others.map(c => (
                <option key={c.scene.id} value={c.scene.id}>{c.labels.join(' › ')}</option>
              ))}
            </select>
          </div>
          <p className="text-gray-500 text-[10px]">Clicking this node will jump to the selected scene. Create inner scenes by double-clicking any element.</p>
        </>
      )}
    </div>
  );
}

function AnimEditor({ anim, onChange }: { anim: NodeAnimation | undefined; onChange: (a: NodeAnimation | undefined) => void }) {
  const enabled = !!anim;
  const a: NodeAnimation = anim ?? { type: 'pulse', intensity: 0.05, speed: 1 };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? a : undefined)} className="accent-accent" />
        <span>Enable animation</span>
      </label>

      {enabled && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Type</span>
            <div className="grid grid-cols-2 gap-1">
              {ANIM_TYPES.map(t => (
                <button key={t} onClick={() => onChange({ ...a, type: t })}
                  className={`py-1 rounded text-[11px] capitalize ${a.type === t ? 'bg-accent text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Intensity <span className="text-gray-500">{Math.round(a.intensity * 100)}%</span></span>
            <input type="range" min={1} max={30} value={Math.round(a.intensity * 100)}
              onChange={e => onChange({ ...a, intensity: Number(e.target.value) / 100 })}
              className="accent-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Speed <span className="text-gray-500">{a.speed.toFixed(1)}×</span></span>
            <input type="range" min={1} max={50} value={Math.round(a.speed * 10)}
              onChange={e => onChange({ ...a, speed: Number(e.target.value) / 10 })}
              className="accent-accent"
            />
          </div>
        </>
      )}
    </div>
  );
}

function AudioEditor({ audio, onUpdate, onAdd }: { audio: SceneAudio | undefined; onUpdate: (a: SceneAudio | undefined) => void; onAdd: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-gray-400 text-[10px]">Scene audio plays when entering this scene.</span>

      {audio ? (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-300 truncate max-w-[140px]">Audio loaded</span>
            <button onClick={() => onUpdate(undefined)} className="text-red-400 hover:text-red-300 text-[10px]">Remove</button>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={audio.loop} onChange={e => onUpdate({ ...audio, loop: e.target.checked })} className="accent-accent" />
            <span>Loop</span>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-gray-400">Volume <span className="text-gray-500">{Math.round(audio.volume * 100)}%</span></span>
            <input type="range" min={0} max={100} value={Math.round(audio.volume * 100)}
              onChange={e => onUpdate({ ...audio, volume: Number(e.target.value) / 100 })}
              className="accent-accent"
            />
          </div>
        </>
      ) : (
        <button onClick={onAdd}
          className="px-3 py-2 rounded bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] text-gray-300 hover:text-white transition-colors text-left"
        >
          + Import audio file (MP3, OGG &lt;1MB)
        </button>
      )}
    </div>
  );
}
