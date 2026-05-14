import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Scene, ToolType, Viewport, SceneLevel, PersistedState } from './types/scene';
import { createScene, createNode, addNode } from './engine/scene-graph';
import { Canvas, CanvasHandle } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { ExportModal } from './components/ExportModal';
import { useHistory } from './hooks/useHistory';
import { saveToLocalStorage, loadFromLocalStorage, exportToFile, importFromFile, clearLocalStorage } from './engine/persistence';

function makeInitialViewport(): Viewport {
  return { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150, scale: 1 };
}

function createInitialSceneStack(scene: Scene, vp: Viewport): SceneLevel[] {
  return [
    {
      scene,
      parentNodeId: '',
      label: 'World',
      viewportWhenLeft: vp,
    },
  ];
}

// One-shot loader to avoid showing an empty scene before localStorage is read
function loadInitial(): { scene: Scene; viewport: Viewport } {
  const stored = loadFromLocalStorage();
  if (stored) {
    return { scene: stored.rootScene, viewport: stored.viewport };
  }
  return { scene: createScene(), viewport: makeInitialViewport() };
}

const _initialLoad = loadInitial();

export default function App() {
  const [tool, setTool] = useState<ToolType>('pen');
  const [strokeColor, setStrokeColor] = useState('#1a1a2e');
  const [fillColor, setFillColor] = useState('none');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(_initialLoad.viewport);
  const [pressureEnabled, setPressureEnabled] = useState(true);
  const [autoEnterEnabled, setAutoEnterEnabled] = useState(true);
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const savedFlashTimerRef = useRef<number | null>(null);

  const history = useHistory(_initialLoad.scene, _initialLoad.viewport);
  const [scene, setSceneState] = useState<Scene>(_initialLoad.scene);
  const [sceneStack, setSceneStackState] = useState<SceneLevel[]>(createInitialSceneStack(_initialLoad.scene, _initialLoad.viewport));

  const sceneRef = useRef(scene);
  const sceneStackRef = useRef(sceneStack);
  const rootSceneRef = useRef(_initialLoad.scene);
  const viewportRef = useRef(viewport);
  const canvasHandleRef = useRef<CanvasHandle | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);

  // If we initialized with a default viewport but the window has since resized
  // (e.g. orientation flip on mobile happened between module load and mount),
  // recenter the viewport when the canvas is empty.
  const didRecenterRef = useRef(false);
  useEffect(() => {
    if (didRecenterRef.current) return;
    didRecenterRef.current = true;
    if (sceneRef.current.nodes.length === 0 && sceneStackRef.current.length === 1) {
      const fresh = makeInitialViewport();
      setViewport(fresh);
      const stack = sceneStackRef.current.map((e, i) => i === 0 ? { ...e, viewportWhenLeft: fresh } : e);
      setSceneStackState(stack);
      sceneStackRef.current = stack;
    }
  }, []);

  // Compute the root scene from sceneStack[0], with current scene merged in if at root.
  const getRootScene = useCallback((): Scene => {
    const stack = sceneStackRef.current;
    if (stack.length === 0) return sceneRef.current;
    if (stack.length === 1) return sceneRef.current; // we are at root
    return stack[0].scene;
  }, []);

  const triggerSavedFlash = useCallback(() => {
    setShowSavedFlash(true);
    if (savedFlashTimerRef.current !== null) {
      window.clearTimeout(savedFlashTimerRef.current);
    }
    savedFlashTimerRef.current = window.setTimeout(() => {
      setShowSavedFlash(false);
      savedFlashTimerRef.current = null;
    }, 1000);
  }, []);

  // Auto-save (debounced)
  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      const root = getRootScene();
      const state: PersistedState = {
        version: 1,
        rootScene: root,
        viewport: viewportRef.current,
        savedAt: Date.now(),
      };
      saveToLocalStorage(state);
      triggerSavedFlash();
      autoSaveTimerRef.current = null;
    }, 500);
  }, [getRootScene, triggerSavedFlash]);

  const setScene = useCallback((s: Scene) => {
    setSceneState(s);
    sceneRef.current = s;
  }, []);

  const setSceneStack = useCallback((stack: SceneLevel[]) => {
    setSceneStackState(stack);
    sceneStackRef.current = stack;
    if (stack.length > 0) {
      rootSceneRef.current = stack[0].scene;
    }
  }, []);

  const handleSceneChange = useCallback((s: Scene, vp: Viewport) => {
    history.push(s, vp);
    const stack = sceneStackRef.current;
    const lastIdx = stack.length - 1;
    const newStack = stack.map((entry, i) =>
      i === lastIdx ? { ...entry, scene: s } : entry
    );
    // If we're at root, the new scene IS the root
    if (newStack.length === 1) {
      rootSceneRef.current = s;
      newStack[0] = { ...newStack[0], scene: s };
    } else {
      // Propagate the change up through parents: replace the parent node's innerScene
      // We rebuild the chain from the bottom up.
      let current = s;
      for (let i = newStack.length - 1; i > 0; i--) {
        const parentEntry = newStack[i - 1];
        const parentScene = parentEntry.scene;
        const parentNodeId = newStack[i].parentNodeId;
        const updatedParent: Scene = {
          ...parentScene,
          nodes: parentScene.nodes.map(n =>
            n.id === parentNodeId ? { ...n, innerScene: current } : n
          ),
        };
        newStack[i - 1] = { ...parentEntry, scene: updatedParent };
        current = updatedParent;
      }
      rootSceneRef.current = newStack[0].scene;
    }
    setSceneStackState(newStack);
    sceneStackRef.current = newStack;
    scheduleAutoSave();
  }, [history, scheduleAutoSave]);

  // Initial save on mount (debounced)
  useEffect(() => {
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry) {
      setScene(entry.scene);
      setViewport(entry.viewport);
      // Reflect into the current stack frame
      const stack = sceneStackRef.current;
      const lastIdx = stack.length - 1;
      const newStack = stack.map((e, i) => i === lastIdx ? { ...e, scene: entry.scene } : e);
      setSceneStackState(newStack);
      sceneStackRef.current = newStack;
      if (newStack.length === 1) rootSceneRef.current = entry.scene;
      scheduleAutoSave();
    }
  }, [history, setScene, scheduleAutoSave]);

  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry) {
      setScene(entry.scene);
      setViewport(entry.viewport);
      const stack = sceneStackRef.current;
      const lastIdx = stack.length - 1;
      const newStack = stack.map((e, i) => i === lastIdx ? { ...e, scene: entry.scene } : e);
      setSceneStackState(newStack);
      sceneStackRef.current = newStack;
      if (newStack.length === 1) rootSceneRef.current = entry.scene;
      scheduleAutoSave();
    }
  }, [history, setScene, scheduleAutoSave]);

  const navigateTo = useCallback((index: number) => {
    const stack = sceneStackRef.current;
    if (index >= stack.length - 1) return;

    const updatedStack = stack.map((entry, i) =>
      i === stack.length - 1 ? { ...entry, viewportWhenLeft: viewport } : entry
    );

    const targetEntry = updatedStack[index];

    const finishNav = () => {
      setScene(targetEntry.scene);
      setViewport(targetEntry.viewportWhenLeft);
      setSceneStack(updatedStack.slice(0, index + 1));
      setSelectedNodeIds(new Set());
    };

    // Animate a zoom-out before swapping to give a sense of leaving the inner scene
    const handle = canvasHandleRef.current;
    if (handle && index === stack.length - 2) {
      const cur = viewportRef.current;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const targetScale = Math.max(0.001, cur.scale * 0.4);
      const factor = targetScale / cur.scale;
      const animTarget: Viewport = {
        x: cx - (cx - cur.x) * factor,
        y: cy - (cy - cur.y) * factor,
        scale: targetScale,
      };
      handle.animateViewportTo(animTarget, finishNav);
    } else {
      finishNav();
    }
  }, [viewport, setScene, setSceneStack]);

  // Save / Load / New
  const handleManualSave = useCallback(() => {
    const root = getRootScene();
    const state: PersistedState = {
      version: 1,
      rootScene: root,
      viewport: viewportRef.current,
      savedAt: Date.now(),
    };
    exportToFile(state);
  }, [getRootScene]);

  const handleLoad = useCallback(async () => {
    try {
      const state = await importFromFile();
      const newScene = state.rootScene;
      const newVp = state.viewport ?? makeInitialViewport();
      setScene(newScene);
      setViewport(newVp);
      const stack = createInitialSceneStack(newScene, newVp);
      setSceneStack(stack);
      setSelectedNodeIds(new Set());
      history.push(newScene, newVp);
      scheduleAutoSave();
    } catch {
      // Cancelled or invalid file
    }
  }, [setScene, setSceneStack, history, scheduleAutoSave]);

  const handleNew = useCallback(() => {
    if (!confirm('Start a new canvas? Unsaved changes will be lost.')) return;
    const newScene = createScene();
    const newVp = makeInitialViewport();
    setScene(newScene);
    setViewport(newVp);
    setSceneStack(createInitialSceneStack(newScene, newVp));
    setSelectedNodeIds(new Set());
    history.push(newScene, newVp);
    clearLocalStorage();
    scheduleAutoSave();
  }, [setScene, setSceneStack, history, scheduleAutoSave]);

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
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleManualSave();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          canvasHandleRef.current?.ungroupSelected();
        } else {
          canvasHandleRef.current?.groupSelected();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const all = new Set(sceneRef.current.nodes.map(n => n.id));
        setSelectedNodeIds(all);
        return;
      }

      if (e.key === 'Escape') {
        // First, abort an in-progress stroke
        canvasHandleRef.current?.cancelStroke();
        // Then exit to parent scene
        const stack = sceneStackRef.current;
        if (stack.length > 1) {
          navigateTo(stack.length - 2);
        } else {
          setSelectedNodeIds(new Set());
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeIds.size > 0) {
          const current = sceneRef.current;
          const newScene: Scene = {
            ...current,
            nodes: current.nodes.filter(n => !selectedNodeIds.has(n.id)),
          };
          setScene(newScene);
          handleSceneChange(newScene, viewport);
          setSelectedNodeIds(new Set());
        }
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        if (e.ctrlKey || e.metaKey) return;
        // Vectorize if a single image node is selected
        const ids = Array.from(selectedNodeIds);
        if (ids.length === 1) {
          const node = sceneRef.current.nodes.find(n => n.id === ids[0]);
          if (node?.type === 'image' && node.imageData && !node.isVectorized) {
            canvasHandleRef.current?.vectorizeSelected();
          }
        }
        return;
      }

      if (e.key === 'z' || e.key === 'Z') {
        if (e.ctrlKey || e.metaKey) return;
        canvasHandleRef.current?.enterSelected();
        return;
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'h': setTool('hand'); break;
          case 'p': setTool('pen'); break;
          case 'r': setTool('rect'); break;
          case 'c': setTool('circle'); break;
          case 'e': setTool('eraser'); break;
          case 'i': setTool('image'); break;
          case 't': setTool('text'); break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, navigateTo, selectedNodeIds, viewport, setScene, handleSceneChange, handleManualSave]);

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

  const handleVectorize = useCallback(() => {
    canvasHandleRef.current?.vectorizeSelected();
  }, []);

  const onGroup = useCallback(() => { canvasHandleRef.current?.groupSelected(); }, []);
  const onUngroup = useCallback(() => { canvasHandleRef.current?.ungroupSelected(); }, []);

  const selectedNodes = scene.nodes.filter(n => selectedNodeIds.has(n.id));
  const singleSelection = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const canVectorize = !!(singleSelection?.type === 'image' && singleSelection.imageData && !singleSelection.isVectorized);
  const hasMultiSelection = selectedNodes.length >= 2;
  const hasSelection = selectedNodes.length >= 1;
  const selectedAreInGroup = selectedNodes.length > 0 && selectedNodes.every(n => !!n.groupId);

  const zoomPercent = Math.round(viewport.scale * 100);

  return (
    <div className="fixed inset-0 overflow-hidden bg-paper" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <Canvas
        ref={canvasHandleRef}
        scene={scene}
        setScene={setScene}
        viewport={viewport}
        setViewport={setViewport}
        tool={tool}
        setTool={setTool}
        strokeColor={strokeColor}
        fillColor={fillColor}
        strokeWidth={strokeWidth}
        selectedNodeIds={selectedNodeIds}
        setSelectedNodeIds={setSelectedNodeIds}
        sceneStack={sceneStack}
        setSceneStack={setSceneStack}
        onSceneChange={handleSceneChange}
        pressureEnabled={pressureEnabled}
        autoEnterEnabled={autoEnterEnabled}
      />

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
        pressureEnabled={pressureEnabled}
        setPressureEnabled={setPressureEnabled}
        autoEnterEnabled={autoEnterEnabled}
        setAutoEnterEnabled={setAutoEnterEnabled}
        hasMultiSelection={hasMultiSelection}
        hasSelection={hasSelection}
        selectedAreInGroup={selectedAreInGroup}
        onGroup={onGroup}
        onUngroup={onUngroup}
      />

      {/* Top bar */}
      <div className="fixed top-0 left-14 right-0 h-11 bg-ink/90 backdrop-blur-sm flex items-center px-4 gap-3 z-10">
        <span className="text-white font-semibold text-sm hidden sm:block" style={{ color: '#4a90d9' }}>
          ✏ Endless Paper
        </span>

        <div className="w-px h-5 bg-white/20 hidden sm:block" />

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

        {showSavedFlash && (
          <span className="text-[10px] text-accent transition-opacity">Saved</span>
        )}

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

        <span className="text-xs font-mono text-accent min-w-[52px] text-right">
          {zoomPercent}%
        </span>

        <button
          className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          onClick={handleNew}
          title="New canvas"
        >
          New
        </button>
        <button
          className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          onClick={handleManualSave}
          title="Save to file (Ctrl+S)"
        >
          Save
        </button>
        <button
          className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          onClick={handleLoad}
          title="Load from file"
        >
          Load
        </button>
        <button
          className="ml-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors"
          onClick={() => setShowExport(true)}
          title="Export (Ctrl+E)"
        >
          Export
        </button>
      </div>

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
