import { useState } from 'react';
import { SceneNode, Hotspot, NodeAnimation, SceneAudio } from '../types/scene';
import { SceneCatalogEntry } from '../engine/scene-graph';

interface PropertiesPanelProps {
  node: SceneNode;
  sceneCatalog: SceneCatalogEntry[];
  onUpdate: (updates: Partial<SceneNode>) => void;
  onAddAudio: () => void;
  currentSceneAudio: SceneAudio | undefined;
  onUpdateSceneAudio: (audio: SceneAudio | undefined) => void;
}

const ANIM_TYPES: NodeAnimation['type'][] = ['pulse', 'wobble', 'float', 'fade'];

export function PropertiesPanel({ node, sceneCatalog, onUpdate, onAddAudio, currentSceneAudio, onUpdateSceneAudio }: PropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<'hotspot' | 'portal' | 'anim' | 'audio'>('hotspot');

  return (
    <div className="fixed right-0 top-11 bottom-0 w-64 bg-ink/95 border-l border-white/10 text-white text-xs overflow-y-auto z-10 flex flex-col">
      <div className="flex border-b border-white/10 flex-shrink-0">
        {(['hotspot', 'portal', 'anim', 'audio'] as const).map(tab => (
          <button
            key={tab}
            className={`flex-1 py-2 text-[10px] uppercase tracking-wide transition-colors ${activeTab === tab ? 'text-accent border-b border-accent' : 'text-gray-500 hover:text-white'}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'hotspot' ? '💬' : tab === 'portal' ? '🌀' : tab === 'anim' ? '✨' : '🔊'}
          </button>
        ))}
      </div>

      <div className="flex-1 p-3 flex flex-col gap-3">
        {activeTab === 'hotspot' && (
          <HotspotEditor hotspot={node.hotspot} onChange={hs => onUpdate({ hotspot: hs })} />
        )}
        {activeTab === 'portal' && (
          <PortalEditor portal={node.portal} catalog={sceneCatalog} nodeId={node.id} onChange={p => onUpdate({ portal: p })} />
        )}
        {activeTab === 'anim' && (
          <AnimEditor anim={node.animation} onChange={a => onUpdate({ animation: a })} />
        )}
        {activeTab === 'audio' && (
          <AudioEditor audio={currentSceneAudio} onUpdate={onUpdateSceneAudio} onAdd={onAddAudio} />
        )}
      </div>
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

function PortalEditor({ portal, catalog, nodeId, onChange }: {
  portal: { targetSceneId: string; targetCamera?: import('../types/scene').Viewport } | undefined;
  catalog: SceneCatalogEntry[];
  nodeId: string;
  onChange: (p: typeof portal) => void;
}) {
  const enabled = !!portal;
  const others = catalog.filter(c => c.scene.id !== nodeId);

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
