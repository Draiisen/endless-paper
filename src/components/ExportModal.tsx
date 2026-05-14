import { Scene, SceneLevel, PersistedState } from '../types/scene';
import { downloadHTML, exportToSVG } from '../utils/export';
import { exportToFile } from '../engine/persistence';

interface ExportModalProps {
  state: PersistedState;
  sceneStack: SceneLevel[];
  onClose: () => void;
}

export function ExportModal({ state, sceneStack, onClose }: ExportModalProps) {
  const rootScene = state.rootScene;

  const handleExportHTML = () => {
    downloadHTML(rootScene, sceneStack);
    onClose();
  };

  const handleExportSVG = () => {
    const svg = exportToSVG(rootScene, 1200, 900);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'endless-paper.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 100);
    onClose();
  };

  const nodeCount = countNodes(rootScene);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-ink rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-white text-xl font-semibold">Export</h2>
            <button
              className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {nodeCount} object{nodeCount !== 1 ? 's' : ''} in {countScenes(rootScene)} scene{countScenes(rootScene) !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Export options */}
        <div className="p-6 flex flex-col gap-4">
          {/* HTML Export */}
          <button
            className="flex items-start gap-4 p-4 rounded-xl border border-accent/30 bg-accent/10 hover:bg-accent/20 transition-all text-left group"
            onClick={handleExportHTML}
          >
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                <path d="M4.5 11h-2V9H1v6h1.5v-2.5h2V15H6V9H4.5v2zm2.5-1.5h1.5V15H10v-5.5h1.5V8H7v1.5zm5.5 0H14V15h1.5v-5.5H17V8h-4.5v1.5zm9-1.5h-4.5v6H19v-2h2.5v-1.5H19v-1h2.5V8zM11 0H4L0 4v16a2 2 0 002 2h16a2 2 0 002-2V7l-9-7z"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold">Interactive HTML</div>
              <div className="text-gray-400 text-sm mt-0.5">Self-contained file with pan, zoom, and scene navigation. Works offline.</div>
            </div>
          </button>

          {/* SVG Export */}
          <button
            className="flex items-start gap-4 p-4 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-left group"
            onClick={handleExportSVG}
          >
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white/70">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold">SVG Vector</div>
              <div className="text-gray-400 text-sm mt-0.5">Scalable vector graphics of the current scene. For Figma, Illustrator, etc.</div>
            </div>
          </button>

          {/* JSON Export */}
          <button
            className="flex items-start gap-4 p-4 rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-left group"
            onClick={() => { exportToFile(state); onClose(); }}
          >
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white/70">
                <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 9h-2v5h-2v-5H7l4-4 4 4h-2v0z"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-semibold">Endless Paper (.endless.json)</div>
              <div className="text-gray-400 text-sm mt-0.5">Full project backup — scenes, assets, viewport. Re-import into Endless Paper.</div>
            </div>
          </button>
        </div>

        <div className="px-6 pb-6">
          <p className="text-gray-500 text-xs text-center">
            All exports include nested scenes and are self-contained.
          </p>
        </div>
      </div>
    </div>
  );
}

function countNodes(scene: Scene): number {
  let count = scene.nodes.length;
  for (const node of scene.nodes) {
    if (node.innerScene) {
      count += countNodes(node.innerScene);
    }
  }
  return count;
}

function countScenes(scene: Scene): number {
  let count = 1;
  for (const node of scene.nodes) {
    if (node.innerScene && node.innerScene.nodes.length > 0) {
      count += countScenes(node.innerScene);
    }
  }
  return count;
}
