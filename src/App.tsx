import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Scene, ToolType, Viewport, SceneLevel } from './types/scene';
import { createScene, createNode, addNode } from './engine/scene-graph';
import { Canvas } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { ExportModal } from './components/ExportModal';
import { useHistory } from './hooks/useHistory';

const initialScene = createScene();
const initialViewport: Viewport = { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150, scale: 1 };

function createInitialSceneStack(scene: Scene): SceneLevel[] {
  return [
    {
      scene,
      parentNodeId: '',
      label: 'World',
      viewportWhenLeft: initialViewport,
    },
  ];
}

export default function App() {
  const [tool, setTool] = useState<ToolType>('pen');
  const [strokeColor, setStrokeColor] = useState('#1a1a2e');
  const [fillColor, setFillColor] = useState('none');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(initialViewport);

  const history = useHistory(initialScene, initialViewport);
  const [scene, setSceneState] = useState<Scene>(initialScene);
  const [sceneStack, setSceneStackState] = useState<SceneLevel[]>(createInitialSceneStack(initialScene));

  const sceneRef = useRef(scene);
  const sceneStackRef = useRef(sceneStack);
  const rootSceneRef = useRef(initialScene);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);

  const setScene = useCallback((s: Scene) => {
    setSceneState(s);
    sceneRef.current = s;
  }, []);

  const setSceneStack = useCallback((stack: SceneLevel[]) => {
    setSceneStackState(stack);
    sceneStackRef.current = stack;
    // The root scene is the first entry
    if (stack.length > 0) {
      rootSceneRef.current = stack[0].scene;
    }
  }, []);

  // Called when scene changes (for history)
  const handleSceneChange = useCallback((s: Scene, vp: Viewport) => {
    history.push(s, vp);
    // Update stack entry
    const stack = sceneStackRef.current;
    const lastIdx = stack.length - 1;
    const newStack = stack.map((entry, i) =>
      i === lastIdx ? { ...entry, scene: s } : entry
    );
    setSceneStackState(newStack);
    if (newStack.length === 1) {
      rootSceneRef.current = s;
    }
  }, [history]);

  // Sync root scene for export
  useEffect(() => {
    if (sceneStack.length === 1) {
      rootSceneRef.current = scene;
    }
  }, [scene, sceneStack]);

  // Undo
  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry) {
      setScene(entry.scene);
      setViewport(entry.viewport);
    }
  }, [history, setScene]);

  // Redo
  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry) {
      setScene(entry.scene);
      setViewport(entry.viewport);
    }
  }, [history, setScene]);

  // Navigate breadcrumb
  const navigateTo = useCallback((index: number) => {
    const stack = sceneStackRef.current;
    if (index >= stack.length - 1) return;

    // Save current viewport in stack
    const updatedStack = stack.map((entry, i) =>
      i === stack.length - 1 ? { ...entry, viewportWhenLeft: viewport } : entry
    );

    const targetEntry = updatedStack[index];
    setScene(targetEntry.scene);
    setViewport(targetEntry.viewportWhenLeft);
    setSceneStack(updatedStack.slice(0, index + 1));
    setSelectedNodeId(null);
  }, [sceneStack, viewport, setScene, setSceneStack]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        setShowExport(true);
        return;
      }

      if (e.key === 'Escape') {
        // Exit to parent scene
        const stack = sceneStackRef.current;
        if (stack.length > 1) {
          navigateTo(stack.length - 2);
        } else {
          setSelectedNodeId(null);
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = selectedNodeId;
        if (sel) {
          const current = sceneRef.current;
          const newScene: Scene = {
            ...current,
            nodes: current.nodes.filter(n => n.id !== sel),
          };
          setScene(newScene);
          handleSceneChange(newScene, viewport);
          setSelectedNodeId(null);
        }
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        if (e.ctrlKey || e.metaKey) return; // Ctrl+V = paste
        // Vectorize shortcut
        const ep = (window as unknown as Record<string, unknown>).__epVectorize;
        if (typeof ep === 'function') (ep as () => void)();
        return;
      }

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'h': setTool('hand'); break;
          case 'p': setTool('pen'); break;
          case 'r': setTool('rect'); break;
          case 'c': setTool('circle'); break;
          case 'e': setTool('eraser'); break;
          case 'i': setTool('image'); break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, navigateTo, selectedNodeId, viewport, setScene, handleSceneChange]);

  // Image import handler
  const handleImageImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxW = 400;
        const maxH = 300;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxW || h > maxH) {
          const r = Math.min(maxW / w, maxH / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        // Place near center of viewport
        const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale - w / 2;
        const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale - h / 2;
        const node = createNode('image', cx, cy, w, h);
        node.imageData = dataUrl;
        const newScene = addNode(sceneRef.current, node);
        setScene(newScene);
        handleSceneChange(newScene, viewport);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    setTool('select');
  }, [viewport, setScene, handleSceneChange]);

  // Vectorize selected image
  const handleVectorize = useCallback(() => {
    const ep = (window as unknown as Record<string, unknown>).__epVectorize;
    if (typeof ep === 'function') (ep as () => void)();
  }, []);

  const selectedNode = scene.nodes.find(n => n.id === selectedNodeId);
  const canVectorize = !!(selectedNode?.type === 'image' && selectedNode.imageData && !selectedNode.isVectorized);

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Canvas */}
      <Canvas
        scene={scene}
        setScene={setScene}
        viewport={viewport}
        setViewport={setViewport}
        tool={tool}
        strokeColor={strokeColor}
        fillColor={fillColor}
        strokeWidth={strokeWidth}
        selectedNodeId={selectedNodeId}
        setSelectedNodeId={setSelectedNodeId}
        sceneStack={sceneStack}
        setSceneStack={setSceneStack}
        onSceneChange={handleSceneChange}
      />

      {/* Toolbar */}
      <Toolbar
        tool={tool}
        setTool={setTool}
        strokeColor={strokeColor}
        setStrokeColor={setStrokeColor}
        fillColor={fillColor}
        setFillColor={setFillColor}
        strokeWidth={strokeWidth}
        setStrokeWidth={setStrokeWidth}
        onImageImport={handleImageImport}
        onVectorize={handleVectorize}
        canVectorize={canVectorize}
      />

      {/* Top bar */}
      <div className="fixed top-0 left-14 right-0 h-11 bg-ink/90 backdrop-blur-sm flex items-center px-4 gap-3 z-10">
        {/* Title */}
        <span className="text-white font-semibold text-sm hidden sm:block" style={{ color: '#4a90d9' }}>
          ✏ Endless Paper
        </span>

        <div className="w-px h-5 bg-white/20 hidden sm:block" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
          {sceneStack.map((entry, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <span className="text-gray-500 text-xs flex-shrink-0">›</span>
              )}
              <button
                className={`text-xs px-2 py-1 rounded flex-shrink-0 transition-colors ${
                  i === sceneStack.length - 1
                    ? 'text-white font-medium'
                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                }`}
                onClick={() => navigateTo(i)}
                disabled={i === sceneStack.length - 1}
              >
                {entry.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Undo / Redo */}
        <button
          className={`p-1.5 rounded transition-colors ${history.canUndo ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 cursor-not-allowed'}`}
          onClick={handleUndo}
          disabled={!history.canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
          </svg>
        </button>
        <button
          className={`p-1.5 rounded transition-colors ${history.canRedo ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 cursor-not-allowed'}`}
          onClick={handleRedo}
          disabled={!history.canRedo}
          title="Redo (Ctrl+Y)"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
            <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>
          </svg>
        </button>

        {/* Zoom */}
        <span className="text-xs font-mono text-accent min-w-[52px] text-right">
          {zoomPercent}%
        </span>

        {/* Export */}
        <button
          className="ml-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors"
          onClick={() => setShowExport(true)}
          title="Export (Ctrl+E)"
        >
          Export
        </button>
      </div>

      {/* Scene depth indicator */}
      {sceneStack.length > 1 && (
        <div className="fixed bottom-4 right-4 z-20">
          <button
            className="px-3 py-1.5 rounded-lg bg-ink/80 text-white text-xs hover:bg-ink transition-colors backdrop-blur-sm"
            onClick={() => navigateTo(sceneStack.length - 2)}
            title="Go back (Escape)"
          >
            ← Back to {sceneStack[sceneStack.length - 2]?.label ?? 'World'}
          </button>
        </div>
      )}

      {/* Export Modal */}
      {showExport && (
        <ExportModal
          rootScene={rootSceneRef.current}
          sceneStack={sceneStack}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
