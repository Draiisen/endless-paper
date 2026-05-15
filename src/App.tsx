import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Scene, ToolType, Viewport, SceneLevel, PersistedState, Asset, Layer, SceneAudio, StartCamera, SymmetryMode, ImageLOD } from './types/scene';
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
import { WelcomeModal } from './components/WelcomeModal';
import { HelpPanel } from './components/HelpPanel';
import { createTemplate, TemplateName } from './engine/templates';

function makeInitialViewport(): Viewport {
  return { x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150, scale: 1 };
}

function createInitialSceneStack(scene: Scene, vp: Viewport): SceneLevel[] {
  return [{ scene, parentNodeId: '', label: 'World', viewportWhenLeft: vp }];
}

/** Re-link a scene stack bottom-up so each parent embeds its child's updated innerScene. */
function rebuildStackFromLeaves(stack: SceneLevel[]): SceneLevel[] {
  if (stack.length <= 1) return stack;
  const out = [...stack];
  for (let i = out.length - 1; i > 0; i--) {
    const parentEntry = out[i - 1];
    const parentNodeId = out[i].parentNodeId;
    out[i - 1] = {
      ...parentEntry,
      scene: {
        ...parentEntry.scene,
        nodes: parentEntry.scene.nodes.map(n => n.id === parentNodeId ? { ...n, innerScene: out[i].scene } : n),
      },
    };
  }
  return out;
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
  const [showMiniMap, setShowMiniMap] = useState(settings.miniMapVisible ?? window.innerWidth >= 640);
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
  const [shareFlash, setShareFlash] = useState<'copied' | 'toobig' | null>(null);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => !localStorage.getItem('ep_welcomed_v1'));
  const [showHelp, setShowHelp] = useState(false);

  const { popup, handleNodeClick, dismiss: dismissPopup } = useHotspotHandler(viewerMode);

  const savedFlashTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const tourStopRef = useRef<(() => void) | null>(null);
  const tourPlayingRef = useRef(false);
  const canvasHandleRef = useRef<CanvasHandle | null>(null);
  const lodCancelsRef = useRef<Set<() => void>>(new Set());
  const clipboardRef = useRef<import('./types/scene').SceneNode[]>([]);

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
    return () => audioManager.stop();
  }, [scene.audio, viewerMode]);

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
    // Push root scene so undo can reconstruct the full stack from any depth
    history.push(newStack[0].scene, vp);
    setSceneStackState(newStack);
    sceneStackRef.current = newStack;
    scheduleAutoSave();
  }, [history, scheduleAutoSave]);

  useEffect(() => { scheduleAutoSave(); }, []); // eslint-disable-line

  // Apply an async color-vectorization result onto whichever scene in the
  // stack still holds the node. Bails out if the node was deleted or the
  // scene was replaced (New / Load) while the worker was running.
  const applyLodResult = useCallback((nodeId: string, lod: Pick<ImageLOD, 'colorLayers' | 'sourceW' | 'sourceH'>) => {
    const stack = sceneStackRef.current;
    let idx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].scene.nodes.some(n => n.id === nodeId)) { idx = i; break; }
    }
    if (idx === -1) return; // node gone — discard stale worker result
    const patched = stack.map((entry, i) => i !== idx ? entry : {
      ...entry,
      scene: {
        ...entry.scene,
        nodes: entry.scene.nodes.map(n => n.id === nodeId
          ? { ...n, lod: { ...(n.lod ?? {}), colorLayers: lod.colorLayers, sourceW: lod.sourceW, sourceH: lod.sourceH } }
          : n),
      },
    });
    const rebuilt = rebuildStackFromLeaves(patched);
    setSceneStack(rebuilt);
    setScene(rebuilt[rebuilt.length - 1].scene);
    scheduleAutoSave();
  }, [setSceneStack, setScene, scheduleAutoSave]);

  // Terminate any in-flight vectorization workers (used on New / Load).
  const cancelAllLod = useCallback(() => {
    for (const fn of lodCancelsRef.current) fn();
    lodCancelsRef.current.clear();
    setLodProcessingCount(0);
  }, []);

  // Terminate workers on unmount without touching state.
  useEffect(() => {
    const cancels = lodCancelsRef.current;
    return () => { for (const fn of cancels) fn(); cancels.clear(); };
  }, []);

  // Navigate from historical root scene down through the current stack's parentNodeId chain.
  // Handles nested scenes correctly: parent scenes are rebuilt from root history entry.
  const applyHistoryEntry = useCallback((entry: { scene: Scene; viewport: Viewport }) => {
    const stack = sceneStackRef.current;
    // entry.scene is the root — follow parentNodeId chain to reach current depth
    let current = entry.scene;
    const newStack: typeof stack = [{ ...stack[0], scene: current }];
    for (let i = 1; i < stack.length; i++) {
      const parentNodeId = stack[i].parentNodeId;
      const child = current.nodes.find(n => n.id === parentNodeId);
      if (!child?.innerScene) break; // inner scene missing in this historical state — stop here
      current = child.innerScene;
      newStack.push({ ...stack[i], scene: current });
    }
    rootSceneRef.current = newStack[0].scene;
    setSceneStackState(newStack);
    sceneStackRef.current = newStack;
    setScene(newStack[newStack.length - 1].scene);
    setViewport(entry.viewport);
    scheduleAutoSave();
  }, [setScene, scheduleAutoSave]);

  const handleUndo = useCallback(() => {
    const entry = history.undo();
    if (entry) applyHistoryEntry(entry);
  }, [history, applyHistoryEntry]);

  const handleRedo = useCallback(() => {
    const entry = history.redo();
    if (entry) applyHistoryEntry(entry);
  }, [history, applyHistoryEntry]);

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

  const handleDropAsset = useCallback((assetId: string, worldX: number, worldY: number) => {
    const asset = assetsRef.current.find(a => a.id === assetId);
    if (!asset) return;
    const bb = asset.boundingBox;
    const offsetX = worldX - bb.width / 2;
    const offsetY = worldY - bb.height / 2;
    const newNodes = asset.nodes.map(n => ({ ...n, id: generateId(), x: n.x + offsetX, y: n.y + offsetY }));
    let newScene = sceneRef.current;
    for (const node of newNodes) newScene = addNode(newScene, node);
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
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

  // Update selected node properties (single selection)
  const handleUpdateSelectedNode = useCallback((updates: Partial<import('./types/scene').SceneNode>) => {
    if (selectedNodeIds.size !== 1) return;
    const id = Array.from(selectedNodeIds)[0];
    const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.map(n => n.id === id ? { ...n, ...updates } : n) };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [selectedNodeIds, setScene, handleSceneChange]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.filter(n => !selectedNodeIds.has(n.id)) };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
    setSelectedNodeIds(new Set());
  }, [selectedNodeIds, setScene, handleSceneChange]);

  const handleDuplicate = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const OFFSET = 20;
    const groupIdMap = new Map<string, string>();
    const duped = sceneRef.current.nodes.filter(n => selectedNodeIds.has(n.id)).map(n => {
      let groupId = n.groupId;
      if (groupId) {
        if (!groupIdMap.has(groupId)) groupIdMap.set(groupId, generateId());
        groupId = groupIdMap.get(groupId)!;
      }
      return { ...n, id: generateId(), x: n.x + OFFSET, y: n.y + OFFSET, groupId };
    });
    const newScene = { ...sceneRef.current, nodes: [...sceneRef.current.nodes, ...duped] };
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
    setSelectedNodeIds(new Set(duped.map(n => n.id)));
  }, [selectedNodeIds, setScene, handleSceneChange]);

  const handleUpdateSelectionFill = useCallback((color: string) => {
    const ids = selectedNodeIds;
    if (ids.size === 0) return;
    const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.map(n => {
      if (!ids.has(n.id)) return n;
      if (n.type === 'path' && n.path) return { ...n, path: { ...n.path, fill: color } };
      if (n.type === 'text') return { ...n, color };
      return { ...n, fill: color };
    })};
    setScene(newScene);
    handleSceneChange(newScene, viewportRef.current);
  }, [selectedNodeIds, setScene, handleSceneChange]);

  const handleUpdateSelectionStroke = useCallback((color: string) => {
    const ids = selectedNodeIds;
    if (ids.size === 0) return;
    const newScene = { ...sceneRef.current, nodes: sceneRef.current.nodes.map(n => {
      if (!ids.has(n.id)) return n;
      if (n.type === 'path' && n.path) return { ...n, path: { ...n.path, stroke: color } };
      return { ...n, stroke: color };
    })};
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
      if (input.parentNode) document.body.removeChild(input);
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

  const handleShare = useCallback(async () => {
    const state: PersistedState = { version: 1, rootScene: getRootScene(), viewport: viewportRef.current, savedAt: Date.now(), assets: assetsRef.current };
    try {
      const json = JSON.stringify(state);
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(new TextEncoder().encode(json));
      writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      // Chunked base64 — spreading a large byte array into fromCharCode
      // overflows the call stack on real-sized scenes.
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const b64 = btoa(binary);
      const url = `${window.location.origin}${window.location.pathname}#share=${encodeURIComponent(b64)}`;
      if (url.length > 100_000) {
        setShareFlash('toobig');
        setTimeout(() => setShareFlash(null), 3000);
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareFlash('copied');
      setTimeout(() => setShareFlash(null), 2500);
    } catch {
      setShareFlash('toobig');
      setTimeout(() => setShareFlash(null), 3000);
    }
  }, [getRootScene]);

  const handleLoad = useCallback(async () => {
    try {
      const state = await importFromFile();
      cancelAllLod();
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
  }, [setScene, setSceneStack, history, scheduleAutoSave, cancelAllLod]);

  const handleRestoreFromSave = useCallback((state: PersistedState) => {
    cancelAllLod();
    const newScene = state.rootScene;
    const newVp = state.viewport ?? makeInitialViewport();
    setScene(newScene);
    setViewport(newVp);
    setSceneStack(createInitialSceneStack(newScene, newVp));
    setSelectedNodeIds(new Set());
    setAssets(state.assets ?? []);
    history.push(newScene, newVp);
    scheduleAutoSave();
  }, [setScene, setSceneStack, history, scheduleAutoSave, cancelAllLod]);

  const handleNew = useCallback(() => {
    if (!confirm('Start a new canvas? Unsaved changes will be lost.')) return;
    cancelAllLod();
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
  }, [setScene, setSceneStack, history, cancelAllLod]);

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
        // Thumbnail: fast, synchronous, ready immediately. If it throws
        // (canvas memory limit, tainted image) the raster still works.
        let thumbnail: string | undefined;
        try { thumbnail = generateThumbnail(img); } catch { thumbnail = undefined; }
        node.lod = {
          thumbnail,
          sourceW: 0,
          sourceH: 0,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
        };

        const newScene = addNode(sceneRef.current, node);
        setScene(newScene);
        handleSceneChange(newScene, viewport);

        // Color-vector LOD: runs in a Web Worker, updates scene when done.
        try {
          setLodProcessingCount(c => c + 1);
          let cancelFn: () => void = () => {};
          cancelFn = requestColorVectorization(node, img, 8, (nodeId, lod) => {
            lodCancelsRef.current.delete(cancelFn);
            setLodProcessingCount(c => Math.max(0, c - 1));
            applyLodResult(nodeId, lod);
          });
          lodCancelsRef.current.add(cancelFn);
        } catch {
          // vectorization could not start — raster fallback is fine
          setLodProcessingCount(c => Math.max(0, c - 1));
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    setTool('select');
  }, [viewport, activeLayerId, setScene, handleSceneChange, applyLodResult]);

  const loadTemplate = useCallback((name: TemplateName) => {
    const cx = (window.innerWidth / 2 - viewport.x) / viewport.scale;
    const cy = (window.innerHeight / 2 - viewport.y) / viewport.scale;
    const newScene = createTemplate(name, cx, cy);
    setScene(newScene);
    handleSceneChange(newScene, viewport);
  }, [viewport, setScene, handleSceneChange]);

  // Minimap teleport
  const handleMiniMapTeleport = useCallback((worldX: number, worldY: number) => {
    const vp = viewportRef.current;
    const newVp: Viewport = { ...vp, x: window.innerWidth / 2 - worldX * vp.scale, y: window.innerHeight / 2 - worldY * vp.scale };
    canvasHandleRef.current?.animateViewportTo(newVp, () => {});
  }, []);

  // Camera tour
  const handlePlayTour = useCallback(() => {
    if (tourPlayingRef.current) {
      tourStopRef.current?.();
      return;
    }
    const cameras = scene.cameras;
    if (!cameras || cameras.length === 0) return;

    let stopped = false;
    tourPlayingRef.current = true;
    tourStopRef.current = () => {
      stopped = true;
      tourPlayingRef.current = false;
      tourStopRef.current = null;
      setTourPlaying(false);
    };

    setTourPlaying(true);
    let i = 0;
    const playNext = () => {
      if (stopped || i >= cameras.length) {
        tourPlayingRef.current = false;
        tourStopRef.current = null;
        setTourPlaying(false);
        return;
      }
      const cam = cameras[i++];
      canvasHandleRef.current?.animateViewportTo(cam.viewport, () => {
        if (!stopped) setTimeout(playNext, cam.duration);
      }, cam.transitionMs ?? 600);
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
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        const copied = sceneRef.current.nodes.filter(n => selectedNodeIds.has(n.id));
        if (copied.length > 0) clipboardRef.current = copied;
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboardRef.current.length === 0) return;
        const OFFSET = 20;
        const groupIdMap = new Map<string, string>();
        const pasted = clipboardRef.current.map(n => {
          let groupId = n.groupId;
          if (groupId) {
            if (!groupIdMap.has(groupId)) groupIdMap.set(groupId, generateId());
            groupId = groupIdMap.get(groupId);
          }
          return { ...n, id: generateId(), x: n.x + OFFSET, y: n.y + OFFSET, groupId };
        });
        const newScene = { ...sceneRef.current, nodes: [...sceneRef.current.nodes, ...pasted] };
        setScene(newScene);
        handleSceneChange(newScene, viewport);
        setSelectedNodeIds(new Set(pasted.map(n => n.id)));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); handleDuplicate(); return; }
      if (e.key === 'Escape') {
        canvasHandleRef.current?.cancelStroke();
        const stack = sceneStackRef.current;
        if (stack.length > 1) navigateTo(stack.length - 2);
        else setSelectedNodeIds(new Set());
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        handleDeleteSelected();
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
  }, [handleUndo, handleRedo, navigateTo, selectedNodeIds, viewport, setScene, handleSceneChange, handleManualSave, handleDeleteSelected, handleDuplicate]);

  const selectedNodes = scene.nodes.filter(n => selectedNodeIds.has(n.id));
  const singleSelection = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const canVectorize = !!(singleSelection?.type === 'image' && singleSelection.imageData && !singleSelection.isVectorized);
  const hasMultiSelection = selectedNodes.length >= 2;
  const hasSelection = selectedNodes.length >= 1;
  const selectedAreInGroup = selectedNodes.length > 0 && selectedNodes.every(n => !!n.groupId);
  const sceneLayers = ensureLayers(scene);
  const sceneCatalog = buildSceneCatalog(rootSceneRef.current);
  const zoomPercent = Math.round(viewport.scale * 100);

  // Selection bar computed values
  const selHasShapes = selectedNodes.some(n => n.type === 'rect' || n.type === 'circle' || n.type === 'path');
  const selAllText = selectedNodes.length > 0 && selectedNodes.every(n => n.type === 'text');
  const selFill = (() => {
    const s = selectedNodes.find(n => n.type === 'rect' || n.type === 'circle');
    if (s?.fill && s.fill !== 'none') return s.fill;
    const p = selectedNodes.find(n => n.type === 'path');
    if (p?.path?.fill && p.path.fill !== 'none') return p.path.fill;
    return '#ffffff';
  })();
  const selStroke = (() => {
    const s = selectedNodes.find(n => n.type === 'rect' || n.type === 'circle');
    if (s?.stroke && s.stroke !== 'none') return s.stroke;
    const p = selectedNodes.find(n => n.type === 'path');
    if (p?.path?.stroke && p.path.stroke !== 'none') return p.path.stroke;
    return '#000000';
  })();
  const selTextColor = selectedNodes.find(n => n.type === 'text')?.color ?? '#1a1a2e';

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
        onDropAsset={handleDropAsset}
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
        collapsed={toolbarCollapsed}
        onToggleCollapsed={() => setToolbarCollapsed(v => !v)}
      />

      {/* Top bar */}
      {(() => {
        const tbLeft = toolbarCollapsed ? 'left-9' : 'left-14';
        return (
          <div className={`fixed top-0 ${tbLeft} right-0 h-12 bg-ink/95 backdrop-blur-sm flex items-center px-3 gap-1.5 z-10`}>

            {/* Desktop title — hidden on mobile */}
            <span className="text-accent font-semibold text-sm hidden sm:block flex-shrink-0">✏ Endless Paper</span>
            <div className="w-px h-5 bg-white/20 hidden sm:block flex-shrink-0" />

            {/* Breadcrumb */}
            <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none min-w-0">
              {sceneStack.map((entry, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-gray-600 text-xs flex-shrink-0">›</span>}
                  <button
                    className={`text-xs px-2 py-2 rounded flex-shrink-0 transition-colors touch-manipulation ${i === sceneStack.length - 1 ? 'text-white font-medium' : 'text-gray-400 active:text-white hover:text-white hover:bg-white/10'}`}
                    onClick={() => navigateTo(i)}
                    disabled={i === sceneStack.length - 1}
                  >{entry.label}</button>
                </React.Fragment>
              ))}
            </div>

            {/* Status indicators — compact */}
            {lodProcessingCount > 0 && <span className="text-[10px] text-gray-400 flex-shrink-0 animate-pulse hidden sm:block">⚙</span>}
            {autoSaveFailed && <span className="text-[10px] text-red-400 flex-shrink-0 hidden sm:block">!</span>}
            {showSavedFlash && !autoSaveFailed && <span className="text-[10px] text-accent flex-shrink-0">✓</span>}

            {/* View/Edit mode toggle — always visible */}
            <button
              onClick={() => setViewerMode(v => !v)}
              className={`px-2.5 py-1.5 rounded text-xs font-semibold transition-colors flex-shrink-0 touch-manipulation ${viewerMode ? 'bg-accent text-white' : 'text-gray-300 active:text-white border border-white/20'}`}
              title="Toggle viewer mode (hotspots active)"
            >{viewerMode ? '▶' : '✎'}</button>

            {/* Undo / Redo — always visible */}
            <button className={`p-2 rounded transition-colors touch-manipulation flex-shrink-0 ${history.canUndo ? 'text-gray-300 active:text-white hover:text-white hover:bg-white/10' : 'text-gray-700 cursor-not-allowed'}`} onClick={handleUndo} disabled={!history.canUndo} title="Undo">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
            </button>
            <button className={`p-2 rounded transition-colors touch-manipulation flex-shrink-0 ${history.canRedo ? 'text-gray-300 active:text-white hover:text-white hover:bg-white/10' : 'text-gray-700 cursor-not-allowed'}`} onClick={handleRedo} disabled={!history.canRedo} title="Redo">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/></svg>
            </button>

            {/* Zoom — desktop only */}
            <span className="text-xs font-mono text-accent min-w-[44px] text-right flex-shrink-0 hidden sm:block">{zoomPercent}%</span>

            {/* Desktop file buttons — hidden on mobile */}
            <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
              {singleSelection && (
                <button onClick={() => setShowProperties(v => !v)} title="Properties" className={`p-1.5 rounded text-xs transition-colors ${showProperties ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>⚙</button>
              )}
              <button onClick={() => setAudioMuted(m => !m)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors">{audioMuted ? '🔇' : '🔊'}</button>
              <button onClick={handleSetStartCamera} className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors">🎯</button>
              {getRootScene().startCamera && <button onClick={handleResetToStart} className="px-2 py-1 rounded text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors">⟳</button>}
              <div className="w-px h-4 bg-white/20 mx-1" />
              <button onClick={handleNew} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">New</button>
              <button onClick={handleManualSave} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Save</button>
              <button onClick={handleLoad} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Load</button>
              <button onClick={() => setShowSaves(true)} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">Saves</button>
              <button onClick={() => setShowExport(true)} className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/80 transition-colors">Export</button>
              <button onClick={handleShare} className="px-2 py-1 rounded text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
                {shareFlash === 'copied' ? '✓' : shareFlash === 'toobig' ? '!' : 'Share'}
              </button>
              <button onClick={() => setShowHelp(true)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors" title="Aide">?</button>
            </div>

            {/* Mobile overflow menu button */}
            <button
              className="sm:hidden p-2 rounded text-gray-300 active:text-white active:bg-white/10 flex-shrink-0 touch-manipulation text-lg leading-none"
              onClick={() => setShowMobileMenu(v => !v)}
              title="More"
            >⋮</button>
          </div>
        );
      })()}

      {/* Mobile overflow menu */}
      {showMobileMenu && (
        <div className="sm:hidden fixed inset-0 z-40" onClick={() => setShowMobileMenu(false)}>
          <div
            className="absolute right-0 top-12 bg-ink/98 border-l border-b border-white/10 rounded-bl-2xl shadow-2xl p-4 flex flex-col gap-3 min-w-[220px]"
            onClick={e => e.stopPropagation()}
          >
            {/* Zoom display */}
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-xs">Zoom</span>
              <span className="text-accent font-mono text-sm">{zoomPercent}%</span>
            </div>

            {/* Status */}
            {lodProcessingCount > 0 && <span className="text-[11px] text-gray-400 animate-pulse">⚙ Vectorizing…</span>}
            {autoSaveFailed && <span className="text-[11px] text-red-400">⚠ Auto-save failed — use Save</span>}
            {projectSizeMB > 5 && <span className={`text-[11px] ${projectSizeMB > 15 ? 'text-orange-400' : 'text-yellow-400/80'}`}>Size: {projectSizeMB.toFixed(1)} MB</span>}

            <div className="h-px bg-white/10" />

            {/* Selection actions */}
            {singleSelection && (
              <button onClick={() => { setShowProperties(v => !v); setShowMobileMenu(false); }}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm touch-manipulation ${showProperties ? 'bg-accent/20 text-accent' : 'text-gray-200 active:bg-white/10'}`}>
                <span>⚙</span><span>Properties</span>
              </button>
            )}

            {/* Mode & audio */}
            <button onClick={() => { setViewerMode(v => !v); setShowMobileMenu(false); }}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm touch-manipulation ${viewerMode ? 'bg-accent/20 text-accent' : 'text-gray-200 active:bg-white/10'}`}>
              <span>{viewerMode ? '▶' : '✎'}</span><span>{viewerMode ? 'Viewer mode ON' : 'Edit mode'}</span>
            </button>

            <button onClick={() => setAudioMuted(m => !m)}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>{audioMuted ? '🔇' : '🔊'}</span><span>{audioMuted ? 'Unmute' : 'Mute audio'}</span>
            </button>

            <div className="h-px bg-white/10" />

            {/* Camera */}
            <button onClick={() => { handleSetStartCamera(); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>🎯</span><span>Set start point</span>
            </button>
            {getRootScene().startCamera && (
              <button onClick={() => { handleResetToStart(); setShowMobileMenu(false); }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
                <span>⟳</span><span>Reset to start</span>
              </button>
            )}

            <div className="h-px bg-white/10" />

            {/* File ops */}
            <button onClick={() => { handleNew(); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>📄</span><span>New canvas</span>
            </button>
            <button onClick={() => { handleManualSave(); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>💾</span><span>Save file</span>
            </button>
            <button onClick={() => { handleLoad(); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>📂</span><span>Load file</span>
            </button>
            <button onClick={() => { setShowSaves(true); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>🗂</span><span>Saved files</span>
            </button>
            <button onClick={() => { setShowExport(true); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-xl bg-accent/20 text-accent text-sm font-semibold active:bg-accent/40 touch-manipulation">
              <span>⬆</span><span>Export</span>
            </button>
            <button onClick={() => { handleShare(); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>🔗</span><span>{shareFlash === 'copied' ? '✓ Link copied!' : shareFlash === 'toobig' ? 'Too large' : 'Copy share link'}</span>
            </button>
            <div className="h-px bg-white/10" />
            <button onClick={() => { setShowHelp(true); setShowMobileMenu(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-gray-200 active:bg-white/10 touch-manipulation">
              <span>❓</span><span>Guide & raccourcis</span>
            </button>
          </div>
        </div>
      )}

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
        <div className="fixed right-0 top-12 bottom-0 w-full sm:w-56 bg-ink/95 border-l border-white/10 overflow-y-auto z-10 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
            <span className="text-white text-xs font-medium">Library</span>
            <button onClick={() => setShowLibrary(false)} className="text-gray-500 active:text-white hover:text-white p-1 rounded touch-manipulation">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <AssetLibrary assets={assets} onDelete={handleDeleteAsset} onBeginPlace={handlePlaceAsset} />
          </div>
        </div>
      )}

      {showLayers && !showLibrary && (
        <div className="fixed right-0 top-12 bottom-0 w-full sm:w-56 bg-ink/95 border-l border-white/10 overflow-y-auto z-10 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
            <span className="text-white text-xs font-medium">Layers</span>
            <button onClick={() => setShowLayers(false)} className="text-gray-500 active:text-white hover:text-white p-1 rounded touch-manipulation">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
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
        </div>
      )}

      {showProperties && singleSelection && !showLibrary && !showLayers && (
        <PropertiesPanel
          node={singleSelection}
          sceneCatalog={sceneCatalog}
          currentSceneId={scene.id}
          onUpdate={handleUpdateSelectedNode}
          onAddAudio={handleAddAudio}
          currentSceneAudio={scene.audio}
          onUpdateSceneAudio={handleUpdateSceneAudio}
          onClose={() => setShowProperties(false)}
        />
      )}

      {/* Unified selection action bar */}
      {hasSelection && !viewerMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 px-2 py-1.5 bg-ink/95 backdrop-blur-sm border border-white/10 rounded-2xl shadow-xl">
          {/* Fill color — shapes & paths */}
          {selHasShapes && (
            <label className="flex items-center gap-1 px-1.5 cursor-pointer" title="Remplissage">
              <span className="text-[11px] text-gray-500 select-none">▣</span>
              <input type="color" value={selFill}
                onChange={e => handleUpdateSelectionFill(e.target.value)}
                className="w-7 h-7 rounded-lg border border-white/20 cursor-pointer bg-transparent p-0" />
            </label>
          )}
          {/* Text color */}
          {selAllText && (
            <label className="flex items-center gap-1 px-1.5 cursor-pointer" title="Couleur du texte">
              <span className="text-[11px] text-gray-500 select-none font-bold">A</span>
              <input type="color" value={selTextColor}
                onChange={e => handleUpdateSelectionFill(e.target.value)}
                className="w-7 h-7 rounded-lg border border-white/20 cursor-pointer bg-transparent p-0" />
            </label>
          )}
          {/* Stroke color — shapes & paths */}
          {selHasShapes && (
            <label className="flex items-center gap-1 px-1.5 cursor-pointer" title="Contour">
              <span className="text-[11px] text-gray-500 select-none">○</span>
              <input type="color" value={selStroke}
                onChange={e => handleUpdateSelectionStroke(e.target.value)}
                className="w-7 h-7 rounded-lg border border-white/20 cursor-pointer bg-transparent p-0" />
            </label>
          )}
          {/* Count badge */}
          {hasMultiSelection && (
            <span className="text-gray-600 text-[10px] px-1 select-none tabular-nums">{selectedNodes.length}</span>
          )}
          <div className="w-px h-5 bg-white/15 mx-0.5" />
          {/* Duplicate */}
          <button onClick={handleDuplicate}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 active:text-white active:bg-white/10 touch-manipulation transition-colors text-base"
            title="Dupliquer (⌘D)">
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
          </button>
          {/* Properties — single only */}
          {singleSelection && (
            <button onClick={() => setShowProperties(v => !v)}
              className={`w-9 h-9 flex items-center justify-center rounded-xl touch-manipulation transition-colors text-sm ${showProperties ? 'bg-accent/20 text-accent' : 'text-gray-400 active:text-white active:bg-white/10'}`}
              title="Propriétés">⚙</button>
          )}
          {/* Delete */}
          <button onClick={handleDeleteSelected}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-red-400/70 active:text-red-300 active:bg-red-400/10 touch-manipulation transition-colors text-base"
            title="Supprimer (Delete)">✕</button>
        </div>
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

      {/* Empty canvas onboarding hint */}
      {scene.nodes.length === 0 && sceneStack.length === 1 && !viewerMode && (
        <div className="fixed inset-0 flex items-center justify-center z-0 pointer-events-none select-none">
          <div className="flex flex-col items-center gap-5 text-center px-6 opacity-70">
            <p className="text-gray-400 text-sm font-medium">Choisissez un point de départ</p>
            <div className="flex gap-3 pointer-events-auto">
              {([
                { key: 'blank', icon: '⬜', label: 'Vierge', desc: 'Canvas vide', color: '#64748b' },
                { key: 'mindmap', icon: '🧠', label: 'Carte mentale', desc: 'Centre + branches', color: '#6c63ff' },
                { key: 'storyboard', icon: '🎬', label: 'Storyboard', desc: '4 panneaux', color: '#22c55e' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => { if (t.key !== 'blank') loadTemplate(t.key as TemplateName); }}
                  className="flex flex-col items-center gap-1.5 w-24 py-3 px-2 rounded-xl border transition-all touch-manipulation active:scale-95"
                  style={{ borderColor: `${t.color}40`, backgroundColor: `${t.color}10` }}
                >
                  <span className="text-2xl">{t.icon}</span>
                  <span className="text-white text-xs font-semibold">{t.label}</span>
                  <span className="text-gray-500 text-[10px]">{t.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-gray-600 text-xs">ou dessinez directement sur le canvas</p>
            <button
              className="text-gray-500 text-xs underline pointer-events-auto touch-manipulation"
              onClick={() => setShowHelp(true)}
            >
              Comment ça marche ?
            </button>
          </div>
        </div>
      )}

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

      {showWelcome && (
        <WelcomeModal onClose={() => {
          localStorage.setItem('ep_welcomed_v1', '1');
          setShowWelcome(false);
        }} />
      )}

      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
    </div>
  );
}
