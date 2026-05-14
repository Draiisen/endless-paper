import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Scene, ToolType, Viewport, SceneLevel, PersistedState, Asset, Layer, SceneAudio, StartCamera, SymmetryMode } from './types/scene';
import { createScene, createNode, addNode, ensureLayers, createLayer, buildSceneCatalog, generateId, getBoundingBox } from './engine/scene-graph';
import { Canvas, CanvasHandle } from './components/Canvas';
import { Toolbar } from './components/Toolbar';
import { ExportModal } from './components/ExportModal';
import { AssetLibrary } from './components/AssetLibrary';
import { LayersPanel } from './components/LayersPanel';
import { MiniMap } from './components/MiniMap';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PopupDisplay, useHotspotHandler } from './components/PopupRenderer';
import { SavesModal } from './components/SavesModal';
import { useHistory } from './hooks/useHistory';
import { exportToFile, importFromFile, clearLocalStorage, saveSettings, AppSettings } from './engine/persistence';
import { saveToIDB, clearIDB } from './engine/idb-store';
import { generateThumbnail, requestColorVectorization } from './engine/lod-manager';
import { audioManager } from './engine/audio-manager';

function makeInitialViewport(): Viewport {
  return { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150, scale: 1 };
}

function createInitialSceneStack(scene: Scene, vp: Viewport): SceneLevel[] {
  return [{ scene, parentNodeId: '', label: 'World', viewportWhenLeft: vp }];
}

interface AppProps {
  initialState: PersistedState | null;
  settings: AppSettings;
}

export default function App({ initialState, settings }: AppProps) {
  const initScene = initialState?.rootScene ?? createScene();
  const initViewport = initialState?.viewport ?? makeInitialViewport();
  const initAssets = initialState?.assets ?? [];

  const [tool, setTool] = useState<ToolType>('pen');
  const [strokeColor, setStrokeColor] = useState('#1a1a2e');
  const [fillColor, setFillColor] = useState('none');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [showExport, setShowExport] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(initViewport);
  const [pressureEnabled, setPressureEnabled] = useState(true);
  const [autoEnterEnabled, setAutoEnterEnabled] = useState(true);
  const [showSavedFlash, setShowSavedFlash] = useState(false);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [assets, setAssets] = useState<Asset[]>(initAssets);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(settings.miniMapVisible ?? true);
  const [showProperties, setShowProperties] = useState(false);
  const [activeLayerId, setActiveLayerId] = useState<string>('');
  const [symmetry, setSymmetry] = useState<SymmetryMode>(settings.symmetry ?? 'off');
  const [stabilizer, setStabilizer] = useState(settings.stabilizer ?? 0);
  const [showReference, setShowReference] = useState(settings.showReference ?? true);
  const [audioMuted, setAudioMuted] = useState(settings.audioMuted ?? false);
  const [viewerMode, setViewerMode] = useState(false);
  const [tourPlaying, setTourPlaying] = useState(false);
  const [showSaves, setShowSaves] = useState(false);
  const [projectSizeMB, setProjectSizeMB] = useState(0);
  const [lodProcessingCount, setLodProcessingCount] = useState(0);

  const { popup, handleNodeClick, dismiss: dismissPopup } = useHotspotHandler(viewerMode);

  const savedFlashTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const canvasHandleRef = useRef<CanvasHandle | null>(null);

  const history = useHistory(initScene, initViewport);
  const [scene, setSceneState] = useState<Scene>(initScene);
  const [sceneStack, setSceneStackState] = useState<SceneLevel[]>(createInitialSceneStack(initScene, initViewport));

  const sceneRef = useRef(scene);
  const sceneStackRef = useRef(sceneStack);
  const rootSceneRef = useRef(initScene);
  const viewportRef = useRef(viewport);
  const assetsRef = useRef(assets);

  useEffect(() => { sceneRef.current = scene; }, [scene]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);
  useEffect(() => { viewportRef.current = viewport; }, [viewport]);
  useEffect(() => { assetsRef.current = assets; }, [assets]);

  // Sync active layer when scene changes
  useEffect(() => {
    const layers = ensureLayers(scene);
    if (!activeLayerId || !layers.find(l => l.id === activeLayerId)) {
      setActiveLayerId(layers[0]?.id ?? '');
    }
  }, [scene, activeLayerId]);

  // Audio
  useEffect(() => {
    audioManager.setMuted(audioMuted);
  }, [audioMuted]);

  useEffect(() => {
    if (viewerMode) {
      audioManager.play(scene.audio);
    } else {
      audioManager.stop();
    }
  }, [scene, viewerMode]);

  // Persist settings
  useEffect(() => {
    saveSettings({ stabilizer, symmetry, miniMapVisible: showMiniMap, audioMuted, showReference });
  }, [stabilizer, symmetry, showMiniMap, audioMuted, showReference]);

  // Recenter on first mount if canvas is empty
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

  const getRootScene = useCallback((): Scene => {
    const stack = sceneStackRef.current;
    return stack.length <= 1 ? sceneRef.current : stack[0].scene;
  }, []);

  const triggerSavedFlash = useCallback(() => {
    setShowSavedFlash(true);
    if (savedFlashTimerRef.current !== null) window.clearTimeout(savedFlashTimerRef.current);
    savedFlashTimerRef.current = window.setTimeout(() => {
      setShowSavedFlash(false);
      savedFlashTimerRef.current = null;
    }, 1000);
  }, []);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(async () => {
      const state: PersistedState = {
        version: 1,
        rootScene: getRootScene(),
        viewport: viewportRef.current,
        savedAt: Date.now(),
        assets: assetsRef.current,
      };
      // Measure serialized size for the warning badge (one stringify, debounced)
      const approxBytes = JSON.stringify(state).length;
      setProjectSizeMB(approxBytes / 1_048_576);
      const saved = await saveToIDB(state);
      if (saved) {
        setAutoSaveFailed(false);
        triggerSavedFlash();
      } else {
        setAutoSaveFailed(true);
      }
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
    if (stack.length > 0) rootSceneRef.current = stack[0].scene;
  }, []);

  const handleSceneChange = useCallback((s: Scene, vp: Viewport) => {
    history.push(s, vp);
    const stack = sceneStackRef.current;
    const lastIdx = stack.length - 1;
    const newStack = stack.map((entry, i) => i === lastIdx ? { ...entry, scene: s } : entry);
    if (newStack.length === 1) {
      rootSceneRef.current = s;
      newStack[0] = { ...newStack[0], scene: s };
    } else {
      let current = s;
      for (let i = newStack.length - 1; i > 0; i--) {
        const parentEntry = newStack[i - 1];
        const parentScene = parentEntry.scene;
        const parentNodeId = newStack[i].parentNodeId;
        const updatedParent: Scene = {
          ...parentScene,
          nodes: parentScene.nodes.map(n => n.id === parentNodeId ? { ...n, innerScene: current } : n),
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

  useEffect(() => { scheduleAutoSave(); }, []); // eslint-disable-line

  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry) {
      setScene(entry.scene);
      setViewport(entry.viewport);
      const stack = sceneStackRef.current;
      const newStack = stack.map((e, i) => i === stack.length - 1 ? { ...e, scene: entry.scene } : e);
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
      const newStack = stack.map((e, i) => i === stack.length - 1 ? { ...e, scene: entry.scene } : e);
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
    const handle = canvasHandleRef.current;
    if (handle && index === stack.length - 2) {
      const cur = viewportRef.current;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const targetScale = Math.max(0.001, cur.scale * 0.4);
      const factor = targetScale / cur.scale;
      handle.animateViewportTo(
        { x: cx - (cx - cur.x) * factor, y: cy - (cy - cur.y) * factor, scale: targetScale },
        finishNav
      );
    } else {
      finishNav();
    }
  }, [viewport, setScene, setSceneStack]);

  // Layer operations
  const handleAddLayer = useCallback(() => {
    const layers = ensureLayers(sceneRef.current);
    const newLayer = createLayer(`Layer ${layers.length + 1}`);
    const newScene = { ...sceneRef.current, layers: [...layers, newLayer] };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
    setActiveLayerId(newLayer.id);
  }, [setScene, handleSceneChange]);

  const handleDeleteLayer = useCallback((id: string) => {
    const layers = ensureLayers(sceneRef.current);
    if (layers.length <= 1) return;
    if (!confirm('Delete layer? Nodes on this layer will be moved to the first layer.')) return;
    const firstId = layers.find(l => l.id !== id)?.id ?? '';
    const newLayers = layers.filter(l => l.id !== id);
    const newNodes = sceneRef.current.nodes.map(n => n.layerId === id ? { ...n, layerId: firstId } : n);
    const newScene = { ...sceneRef.current, layers: newLayers, nodes: newNodes };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
    if (activeLayerId === id) setActiveLayerId(firstId);
  }, [setScene, handleSceneChange, activeLayerId]);

  const handleUpdateLayer = useCallback((id: string, updates: Partial<Layer>) => {
    const layers = ensureLayers(sceneRef.current);
    const newScene = { ...sceneRef.current, layers: layers.map(l => l.id === id ? { ...l, ...updates } : l) };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [setScene, handleSceneChange]);

  const handleReorderLayer = useCallback((fromIdx: number, toIdx: number) => {
    const layers = [...ensureLayers(sceneRef.current)];
    const [item] = layers.splice(fromIdx, 1);
    layers.splice(toIdx, 0, item);
    const newScene = { ...sceneRef.current, layers };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [setScene, handleSceneChange]);

  // Asset operations
  const handleSaveToLibrary = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) return;
    const selectedNodes = sceneRef.current.nodes.filter(n => ids.includes(n.id));
    if (selectedNodes.length === 0) return;
    const name = prompt('Asset name:', 'New Asset');
    if (!name) return;
    const bb = getBoundingBox(selectedNodes);

    // Generate thumbnail via offscreen canvas
    const offscreen = document.createElement('canvas');
    offscreen.width = 128;
    offscreen.height = 128;
    const ctx = offscreen.getContext('2d');
    let thumbnail = '';
    if (ctx) {
      const scale = Math.min(120 / Math.max(bb.width, 1), 120 / Math.max(bb.height, 1));
      const vp: Viewport = {
        x: -bb.x * scale + (128 - bb.width * scale) / 2,
        y: -bb.y * scale + (128 - bb.height * scale) / 2,
        scale,
      };
      ctx.fillStyle = '#f8f7f4';
      ctx.fillRect(0, 0, 128, 128);
      // Render synchronously using the already-loaded renderer
      { const { renderScene } = await import('./engine/renderer');
        renderScene(ctx, { ...sceneRef.current, nodes: selectedNodes }, vp, { showGrid: false }); }
      thumbnail = offscreen.toDataURL('image/png');
    }

    const asset: Asset = {
      id: generateId(),
      name,
      thumbnail,
      nodes: selectedNodes.map(n => ({ ...n, id: generateId() })),
      boundingBox: { width: bb.width, height: bb.height },
      createdAt: Date.now(),
    };
    const newAssets = [...assetsRef.current, asset];
    setAssets(newAssets);
    scheduleAutoSave();
  }, [selectedNodeIds, scheduleAutoSave]);

  const handleDeleteAsset = useCallback((id: string) => {
    setAssets(prev => prev.filter(a => a.id !== id));
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const handlePlaceAsset = useCallback((asset: Asset) => {
    const cx = (window.innerWidth / 2 - viewportRef.current.x) / viewportRef.current.scale;
    const cy = (window.innerHeight / 2 - viewportRef.current.y) / viewportRef.current.scale;
    const bb = asset.boundingBox;
    const offsetX = cx - bb.width / 2;
    const offsetY = cy - bb.height / 2;
    const newNodes = asset.nodes.map(n => ({ ...n, id: generateId(), x: n.x + offsetX, y: n.y + offsetY }));
    let newScene = sceneRef.current;
    for (const node of newNodes) newScene = addNode(newScene, node);
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
    setShowLibrary(false);
  }, [setScene, handleSceneChange]);

  // Start camera
  const handleSetStartCamera = useCallback(() => {
    const stack = sceneStackRef.current;
    const scenePath = stack.slice(1).map(e => e.parentNodeId);
    const startCamera: StartCamera = { viewport: viewportRef.current, scenePath };
    const root = getRootScene();
    const newRoot = { ...root, startCamera };
    rootSceneRef.current = newRoot;
    if (stack.length === 1) {
      setScene(newRoot);
      handleSceneChange(newRoot, viewportRef.current);
    } else {
      const newStack = [...stack];
      newStack[0] = { ...newStack[0], scene: newRoot };
      setSceneStack(newStack);
    }
    scheduleAutoSave();
  }, [getRootScene, setScene, handleSceneChange, setSceneStack, scheduleAutoSave]);

  const handleResetToStart = useCallback(() => {
    const root = getRootScene();
    if (!root.startCamera) return;
    const { viewport: sv, scenePath } = root.startCamera;
    setSelectedNodeIds(new Set());

    if (!scenePath || scenePath.length === 0) {
      setScene(root);
      setViewport(sv);
      setSceneStack(createInitialSceneStack(root, sv));
      return;
    }

    // Build scene stack by following parentNodeId path from root
    const newStack: SceneLevel[] = [{ scene: root, parentNodeId: '', label: 'World', viewportWhenLeft: sv }];
    let current = root;
    for (const nodeId of scenePath) {
      const node = current.nodes.find(n => n.id === nodeId);
      if (!node?.innerScene) break;
      newStack.push({
        scene: node.innerScene,
        parentNodeId: nodeId,
        label: node.text ?? node.type,
        viewportWhenLeft: sv,
      });
      current = node.innerScene;
    }
    const targetScene = newStack[newStack.length - 1].scene;
    setSceneStack(newStack);
    setScene(targetScene);
    setViewport(sv);
  }, [getRootScene, setScene, setSceneStack]);

  // Update selected node properties
  const handleUpdateSelectedNode = useCallback((updates: Partial<import('./types/scene').SceneNode>) => {
    if (selectedNodeIds.size !== 1) return;
    const id = Array.from(selectedNodeIds)[0];
    const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.map(n => n.id === id ? { ...n, ...updates } : n) };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [selectedNodeIds, setScene, handleSceneChange]);

  // Scene audio
  const handleAddAudio = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { alert('Audio file must be under 2 MB.'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const audio: SceneAudio = { src: reader.result as string, volume: 0.7, loop: true };
        const newScene = { ...sceneRef.current, audio };
        setScene(newScene);
        handleSceneChange(newScene, viewportRef.current);
      };
      reader.readAsDataURL(file);
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }, [setScene, handleSceneChange]);

  const handleUpdateSceneAudio = useCallback((audio: SceneAudio | undefined) => {
    const newScene = { ...sceneRef.current, audio };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [setScene, handleSceneChange]);

  // Save / Load / New
  const handleManualSave = useCallback(() => {
    const state: PersistedState = { version: 1, rootScene: getRootScene(), viewport: viewportRef.current, savedAt: Date.now(), assets: assetsRef.current };
    exportToFile(state);
  }, [getRootScene]);

  const handleLoad = useCallback(async () => {
    try {
      const state = await importFromFile();
      const newScene = state.rootScene;
      const newVp = state.viewport ?? makeInitialViewport();
      setScene(newScene);
      setViewport(newVp);
      setSceneStack(createInitialSceneStack(newScene, newVp));
      setSelectedNodeIds(new Set());
      setAssets(state.assets ?? []);
      history.push(newScene, newVp);
      scheduleAutoSave();
    } catch { /* cancelled */ }
  }, [setScene, setSceneStack, history, scheduleAutoSave]);

  const handleRestoreFromSave = useCallback((state: PersistedState) => {
    const newScene = state.rootScene;
    const newVp = state.viewport ?? makeInitialViewport();
    setScene(newScene);
    setViewport(newVp);
    setSceneStack(createInitialSceneStack(newScene, newVp));
    setSelectedNodeIds(new Set());
    setAssets(state.assets ?? []);
    history.push(newScene, newVp);
    scheduleAutoSave();
  }, [setScene, setSceneStack, history, scheduleAutoSave]);

  const handleNew = useCallback(() => {
    if (!confirm('Start a new canvas? Unsaved changes will be lost.')) return;
    const newScene = createScene();
    const newVp = makeInitialViewport();
    setScene(newScene);
    setViewport(newVp);
    setSceneStack(createInitialSceneStack(newScene, newVp));
    setSelectedNodeIds(new Set());
    setAssets([]);
    history.push(newScene, newVp);
    clearLocalStorage();
    void clearIDB();
  }, [setScene, setSceneStack, history]);

  const handleImageImport = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const maxW = 400; const maxH = 300;
        let w = img.naturalWidth; let h = img.naturalHeight;
        if (w > maxW || h > maxH) { const r = Math.min(maxW / w, maxH / h); w = Math.round(w * r); h = Math.round(h * r); }
        const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale - w / 2;
        const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale - h / 2;
        const node = createNode('image', cx, cy, w, h);
        node.imageData = dataUrl;
        node.layerId = activeLayerId || undefined;
        // Thumbnail: fast, synchronous, ready immediately
        node.lod = {
          thumbnail: generateThumbnail(img),
          sourceW: 0,
          sourceH: 0,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
        };

        const newScene = addNode(sceneRef.current, node);
        setScene(newScene);
        handleSceneChange(newScene, viewport);

        // Color-vector LOD: runs in a Web Worker, updates scene when done
        setLodProcessingCount(c => c + 1);
        requestColorVectorization(node, img, 8, (nodeId, lod) => {
          setLodProcessingCount(c => c - 1);
          const cur = sceneRef.current;
          const updated = {
            ...cur,
            nodes: cur.nodes.map(n =>
              n.id === nodeId
                ? { ...n, lod: { ...(n.lod ?? {}), colorLayers: lod.colorLayers, sourceW: lod.sourceW, sourceH: lod.sourceH } }
                : n,
            ),
          };
          setScene(updated);
          scheduleAutoSave();
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    setTool('select');
  }, [viewport, activeLayerId, setScene, handleSceneChange, scheduleAutoSave]);

  // Minimap teleport
  const handleMiniMapTeleport = useCallback((worldX: number, worldY: number) => {
    const vp = viewportRef.current;
    const newVp: Viewport = { ...vp, x: window.innerWidth / 2 - worldX * vp.scale, y: window.innerHeight / 2 - worldY * vp.scale };
    canvasHandleRef.current?.animateViewportTo(newVp, () => {});
  }, []);

  // Camera tour
  const handlePlayTour = useCallback(() => {
    const cameras = scene.cameras;
    if (!cameras || cameras.length === 0) return;
    setTourPlaying(true);
    let i = 0;
    const playNext = () => {
      if (i >= cameras.length) { setTourPlaying(false); return; }
      const cam = cameras[i++];
      canvasHandleRef.current?.animateViewportTo(cam.viewport, () => {
        setTimeout(playNext, cam.duration);
      });
    };
    playNext();
  }, [scene.cameras]);

  const handleAddCamera = useCallback(() => {
    const stack = sceneStackRef.current;
    const scenePath = stack.slice(1).map(e => e.parentNodeId);
    const camera: import('./types/scene').Camera = {
      id: generateId(),
      name: `Camera ${(scene.cameras?.length ?? 0) + 1}`,
      viewport: viewportRef.current,
      scenePath,
      duration: 2000,
      transitionMs: 600,
    };
    const newScene = { ...sceneRef.current, cameras: [...(sceneRef.current.cameras ?? []), camera] };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [scene, setScene, handleSceneChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); setShowExport(true); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleManualSave(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        if (e.shiftKey) canvasHandleRef.current?.ungroupSelected();
        else canvasHandleRef.current?.groupSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        setSelectedNodeIds(new Set(sceneRef.current.nodes.map(n => n.id)));
        return;
      }
      if (e.key === 'Escape') {
        canvasHandleRef.current?.cancelStroke();
        const stack = sceneStackRef.current;
        if (stack.length > 1) navigateTo(stack.length - 2);
        else setSelectedNodeIds(new Set());
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.filter(n => !selectedNodeIds.has(n.id)) };
        setScene(newScene);
        handleSceneChange(newScene, viewport);
        setSelectedNodeIds(new Set());
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
          case 'v': setTool('select'); break;
          case 'z': canvasHandleRef.current?.enterSelected(); break;
          case 'm': setShowMiniMap(v => !v); break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, navigateTo, selectedNodeIds, viewport, setScene, handleSceneChange, handleManualSave]);

  const selectedNodes = scene.nodes.filter(n => selectedNodeIds.has(n.id));
  const singleSelection = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const canVectorize = !!(singleSelection?.type === 'image' && singleSelection.imageData && !singleSelection.isVectorized);
  const hasMultiSelection = selectedNodes.length >= 2;
  const hasSelection = selectedNodes.length >= 1;
  const selectedAreInGroup = selectedNodes.length > 0 && selectedNodes.every(n => !!n.groupId);
  const sceneLayers = ensureLayers(scene);
  const sceneCatalog = buildSceneCatalog(rootSceneRef.current);
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
        symmetry={symmetry}
        stabilizer={stabilizer}
        showReference={showReference}
        activeLayerId={activeLayerId}
        viewerMode={viewerMode}
        onHotspotClick={handleNodeClick}
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
        onVectorize={() => canvasHandleRef.current?.vectorizeSelected()}
        canVectorize={canVectorize}
        pressureEnabled={pressureEnabled}
        setPressureEnabled={setPressureEnabled}
        autoEnterEnabled={autoEnterEnabled}
        setAutoEnterEnabled={setAutoEnterEnabled}
        hasMultiSelection={hasMultiSelection}
        hasSelection={hasSelection}
        selectedAreInGroup={selectedAreInGroup}
        onGroup={() => canvasHandleRef.current?.groupSelected()}
        onUngroup={() => canvasHandleRef.current?.ungroupSelected()}
        symmetry={symmetry}
        setSymmetry={setSymmetry}
        stabilizer={stabilizer}
        setStabilizer={setStabilizer}
        showReference={showReference}
        setShowReference={setShowReference}
        showLibrary={showLibrary}
        setShowLibrary={(b) => setShowLibrary(b)}
        showLayers={showLayers}
        setShowLayers={(b) => setShowLayers(b)}
        showMiniMap={showMiniMap}
        setShowMiniMap={(b) => setShowMiniMap(b)}
        onSaveToLibrary={handleSaveToLibrary}
        onAddCamera={handleAddCamera}
        hasCameras={(scene.cameras?.length ?? 0) > 0}
        onPlayTour={handlePlayTour}
        tourPlaying={tourPlaying}
      />

      {/* Top bar */}
      <div className="fixed top-0 left-14 right-0 h-11 bg-ink/90 backdrop-blur-sm flex items-center px-4 gap-2 z-10">
        <span className="text-accent font-semibold text-sm hidden sm:block">✏ Endless Paper</span>
        <div className="w-px h-5 bg-white/20 hidden sm:block" />

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-none">
          {sceneStack.map((entry, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-gray-500 text-xs flex-shrink-0">›</span>}
              <button
                className={`text-xs px-2 py-1 rounded flex-shrink-0 transition-colors ${i === sceneStack.length - 1 ? 'text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                onClick={() => navigateTo(i)}
                disabled={i === sceneStack.length - 1}
              >{entry.label}</button>
            </React.Fragment>
          ))}
        </div>

        {lodProcessingCount > 0 && <span className="text-[10px] text-gray-400 flex-shrink-0 animate-pulse">⚙ Vectorizing…</span>}
        {projectSizeMB > 15 && <span className="text-[10px] text-orange-400 flex-shrink-0" title="Project is large — export a backup">⚠ {projectSizeMB.toFixed(0)} MB</span>}
        {projectSizeMB > 5 && projectSizeMB <= 15 && <span className="text-[10px] text-yellow-400/80 flex-shrink-0">{projectSizeMB.toFixed(1)} MB</span>}
        {autoSaveFailed && <span className="text-[10px] text-red-400">Auto-save failed: canvas too large. Use File &gt; Save to export.</span>}
        {showSavedFlash && !autoSaveFailed && <span className="text-[10px] text-accent">Saved</span>}

        {/* Start camera */}
        <button onClick={handleSetStartCamera} title="Set as start point for export" className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
          🎯
        </button>
        {getRootScene().startCamera && (
          <button onClick={handleResetToStart} title="Reset to start camera" className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
            ⟳
          </button>
        )}

        {/* Viewer/edit mode toggle */}
        <button
          onClick={() => setViewerMode(v => !v)}
          className={`px-2 py-1 rounded text-xs font-semibold transition-colors flex-shrink-0 ${viewerMode ? 'bg-accent text-white' : 'text-gray-400 hover:text-white border border-white/10'}`}
          title="Toggle viewer mode (hotspots active)"
        >
          {viewerMode ? '▶ View' : '✎ Edit'}
        </button>

        {/* Audio mute */}
        <button onClick={() => setAudioMuted(m => !m)} title={audioMuted ? 'Unmute' : 'Mute'} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
          {audioMuted ? '🔇' : '🔊'}
        </button>

        {/* Properties panel toggle */}
        {singleSelection && (
          <button onClick={() => setShowProperties(v => !v)} title="Node properties" className={`p-1.5 rounded text-xs transition-colors flex-shrink-0 ${showProperties ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
            ⚙
          </button>
        )}

        {/* Undo / Redo */}
        <button className={`p-1.5 rounded transition-colors ${history.canUndo ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 cursor-not-allowed'}`} onClick={handleUndo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
        </button>
        <button className={`p-1.5 rounded transition-colors ${history.canRedo ? 'text-gray-300 hover:text-white hover:bg-white/10' : 'text-gray-600 cursor-not-allowed'}`} onClick={handleRedo} disabled={!history.canRedo} title="Redo (Ctrl+Y)">
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
        </button>

        <span className="text-xs font-mono text-accent min-w-[52px] text-right">{zoomPercent}%</span>

        <button onClick={handleNew} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">New</button>
        <button onClick={handleManualSave} title="Ctrl+S" className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Save</button>
        <button onClick={handleLoad} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Load</button>
        <button onClick={() => setShowSaves(true)} title="Save management" className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Saves</button>
        <button onClick={() => setShowExport(true)} title="Ctrl+E" className="ml-1 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors">Export</button>
      </div>

      {/* Back button */}
      {sceneStack.length > 1 && (
        <div className="fixed bottom-4 right-4 z-20">
          <button onClick={() => navigateTo(sceneStack.length - 2)} title="Escape" className="px-3 py-1.5 rounded-lg bg-ink/80 text-white text-xs hover:bg-ink transition-colors backdrop-blur-sm">
            ← Back to {sceneStack[sceneStack.length - 2]?.label ?? 'World'}
          </button>
        </div>
      )}

      {/* Right panels */}
      {showLibrary && (
        <div className="fixed right-0 top-11 bottom-0 w-56 bg-ink/95 border-l border-white/10 overflow-y-auto z-10 p-3">
          <AssetLibrary assets={assets} onDelete={handleDeleteAsset} onBeginPlace={handlePlaceAsset} />
        </div>
      )}

      {showLayers && !showLibrary && (
        <div className="fixed right-0 top-11 bottom-0 w-56 bg-ink/95 border-l border-white/10 overflow-y-auto z-10 p-3">
          <LayersPanel
            layers={sceneLayers}
            activeLayerId={activeLayerId}
            setActiveLayerId={setActiveLayerId}
            onAddLayer={handleAddLayer}
            onDeleteLayer={handleDeleteLayer}
            onUpdateLayer={handleUpdateLayer}
            onReorderLayer={handleReorderLayer}
          />
        </div>
      )}

      {showProperties && singleSelection && !showLibrary && !showLayers && (
        <PropertiesPanel
          node={singleSelection}
          sceneCatalog={sceneCatalog}
          onUpdate={handleUpdateSelectedNode}
          onAddAudio={handleAddAudio}
          currentSceneAudio={scene.audio}
          onUpdateSceneAudio={handleUpdateSceneAudio}
        />
      )}

      {/* Mini-map */}
      {showMiniMap && (
        <MiniMap
          scene={scene}
          viewport={viewport}
          canvasWidth={window.innerWidth}
          canvasHeight={window.innerHeight}
          onTeleport={handleMiniMapTeleport}
        />
      )}

      {/* Hotspot popup */}
      <PopupDisplay popup={popup} onDismiss={dismissPopup} />

      {showExport && (
        <ExportModal
          state={{ version: 1, rootScene: rootSceneRef.current, viewport: viewportRef.current, savedAt: Date.now(), assets: assetsRef.current }}
          sceneStack={sceneStack}
          onClose={() => setShowExport(false)}
        />
      )}

      {showSaves && (
        <SavesModal
          currentState={{ version: 1, rootScene: rootSceneRef.current, viewport: viewportRef.current, savedAt: Date.now(), assets: assetsRef.current }}
          onClose={() => setShowSaves(false)}
          onRestore={handleRestoreFromSave}
        />
      )}
    </div>
  );
}
