import { useState } from 'react';
import { Asset } from '../types/scene';

interface AssetLibraryProps {
  assets: Asset[];
  onDelete: (id: string) => void;
  onBeginPlace: (asset: Asset) => void;
}

export function AssetLibrary({ assets, onDelete, onBeginPlace }: AssetLibraryProps) {
  const [search, setSearch] = useState('');

  const filtered = assets.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.tags ?? []).some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-2 text-white text-xs select-none">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Asset Library</span>
        <span className="text-[10px] text-gray-500">{assets.length}</span>
      </div>

      <input
        className="bg-ink/60 border border-white/10 rounded px-2 py-1 text-[11px] outline-none focus:border-accent/60"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        {filtered.map(asset => (
          <div
            key={asset.id}
            className="group relative bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg p-1.5 cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-endless-asset', asset.id);
              e.dataTransfer.effectAllowed = 'copy';
              if (asset.thumbnail) {
                const img = new Image();
                img.src = asset.thumbnail;
                e.dataTransfer.setDragImage(img, 32, 32);
              }
            }}
            onClick={() => onBeginPlace(asset)}
            title={asset.name}
          >
            <div className="aspect-square w-full bg-paper/10 rounded overflow-hidden flex items-center justify-center">
              {asset.thumbnail ? (
                <img src={asset.thumbnail} alt={asset.name} className="w-full h-full object-contain" />
              ) : (
                <span className="text-gray-500 text-[10px]">no preview</span>
              )}
            </div>
            <div className="mt-1 truncate text-[10px] text-gray-300">{asset.name}</div>
            <button
              className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 bg-red-500/90 hover:bg-red-500 text-white rounded p-0.5 transition-opacity"
              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${asset.name}"?`)) onDelete(asset.id); }}
              title="Delete asset"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-2 text-center text-gray-500 text-[11px] py-6">
            {assets.length === 0 ? 'Select something and click "Save to library"' : 'No matches'}
          </div>
        )}
      </div>
    </div>
  );
}
