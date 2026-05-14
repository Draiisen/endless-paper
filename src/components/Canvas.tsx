import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Scene, SceneNode, ToolType, Viewport, VectorPath, SceneLevel } from '../types/scene';
import { renderScene, renderLiveStroke, renderLiveShape, imageCache } from '../engine/renderer';
import {
  createNode, addNode, removeNode, updateNode,
  getNodeAtPoint, ensureInnerScene, generateId,
  getNodesInRect,
} from '../engine/scene-graph';
import { screenToWorld } from '../engine/transform';
import { useGestures } from '../hooks/useGestures';
import { vectorizeImage } from '../engine/vectorizer';
import { transformPathCoords } from '../engine/svg-path';

export interface CanvasHandle {
  vectorizeSelected: () => Promise<void>;
  cancelStroke: () => void;
  enterSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  animateViewportTo: (target: Viewport, onComplete: () => void) => void;
}

interface CanvasProps {
  scene: Scene;
  setScene: (s: Scene) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  tool: ToolType;
  setTool: (t: ToolType) => void;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  selectedNodeIds: Set<string>;
  setSelectedNodeIds: (ids: Set<string>) => void;
  sceneStack: SceneLevel[];
  setSceneStack: (stack: SceneLevel[]) => void;
  onSceneChange: (scene: Scene, viewport: Viewport) => void;
  pressureEnabled: boolean;
  autoEnterEnabled: boolean;
}

interface TextEditState {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  value: string;
  fontSize: number;
}

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas({
  scene, setScene,
  viewport, setViewport,
  tool, setTool,
  strokeColor, fillColor, strokeWidth,
  selectedNodeIds, setSelectedNodeIds,
  sceneStack, setSceneStack,
  onSceneChange,
  pressureEnabled,
  autoEnterEnabled,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const needsRenderRef = useRef(true);
  const isDirtyRef = useRef(false);
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [enterHintNodeId, setEnterHintNodeId] = useState<string | null>(null);
  const enterHintNodeIdRef = useRef<string | null>(null);
  useEffect(() => { enterHintNodeIdRef.current = enterHintNodeId; needsRenderRef.current = true; }, [enterHintNodeId]);
  const [autoEnterToast, setAutoEnterToast] = useState<string | null>(null);
  const lastWheelDeltaY = useRef(0);

  // Animation state
  const animatingRef = useRef(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const sceneRef = useRef(scene);
  const viewportRef = useRef(viewport);
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const fillColorRef = useRef(fillColor);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  const sceneStackRef = useRef(sceneStack);
  const pressureEnabledRef = useRef(pressureEnabled);
  const autoEnterEnabledRef = useRef(autoEnterEnabled);

  useEffect(() => { sceneRef.current = scene; needsRenderRef.current = true; }, [scene]);
  useEffect(() => { viewportRef.current = viewport; needsRenderRef.current = true; }, [viewport]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; needsRenderRef.current = true; }, [selectedNodeIds]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);
  useEffect(() => { pressureEnabledRef.current = pressureEnabled; }, [pressureEnabled]);
  useEffect(() => { autoEnterEnabledRef.current = autoEnterEnabled; }, [autoEnterEnabled]);

  const markDirty = useCallback(() => {
    needsRenderRef.current = true;
    isDirtyRef.current = true;
  }, []);

  // Trigger re-render whenever a cached image finishes loading
  useEffect(() => {
    imageCache.setOnLoad(() => { needsRenderRef.current = true; });
    return () => imageCache.setOnLoad(() => {});
  }, []);

  // Drag state
  const draggedNodeIdsRef = useRef<Set<string>>(new Set());
  const dragHasMovedRef = useRef(false);

  // Animate viewport to a target with ease-out cubic
  const animateViewport = useCallback((targetVp: Viewport, duration: number, onComplete: () => void) => {
    const startVp = { ...viewportRef.current };
    const startTime = performance.now();
    animatingRef.current = true;
    setIsAnimating(true);
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = () => {
      const now = performance.now();
      const t = Math.min(1, (now - startTime) / duration);
      const e = ease(t);
      const vp = {
        x: startVp.x + (targetVp.x - startVp.x) * e,
        y: startVp.y + (targetVp.y - startVp.y) * e,
        scale: startVp.scale + (targetVp.scale - startVp.scale) * e,
      };
      setViewport(vp);
      viewportRef.current = vp;
      markDirty();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        animatingRef.current = false;
        setIsAnimating(false);
        onComplete();
      }
    };
    requestAnimationFrame(step);
  }, [setViewport, markDirty]);

  // Compute a viewport that frames the given node so it fills the screen
  const frameNodeViewport = useCallback((node: SceneNode): Viewport => {
    const canvas = canvasRef.current;
    const w = canvas?.width ?? window.innerWidth;
    const h = canvas?.height ?? window.innerHeight;
    const padding = 0.95;
    const scaleX = (w * padding) / Math.max(1, node.width);
    const scaleY = (h * padding) / Math.max(1, node.height);
    const scale = Math.min(scaleX, scaleY);
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    return {
      x: w / 2 - cx * scale,
      y: h / 2 - cy * scale,
      scale,
    };
  }, []);

  const performEnterScene = useCallback((node: SceneNode) => {
    if (animatingRef.current) return;

    const target = frameNodeViewport(node);
    animateViewport(target, 300, () => {
      const updatedNode = ensureInnerScene(node);
      const updatedScene = updateNode(sceneRef.current, node.id, { innerScene: updatedNode.innerScene });
      const stack = sceneStackRef.current;

      const newStack: SceneLevel[] = [
        ...stack.slice(0, -1),
        { ...stack[stack.length - 1], scene: updatedScene, viewportWhenLeft: viewportRef.current },
        {
          scene: updatedNode.innerScene!,
          parentNodeId: node.id,
          label: nodeLabel(node),
          viewportWhenLeft: { x: 0, y: 0, scale: 1 },
        },
      ];

      const canvas = canvasRef.current;
      const w = canvas?.width ?? window.innerWidth;
      const h = canvas?.height ?? window.innerHeight;
      const innerVp = { x: w / 2, y: h / 2, scale: 1 };
      setSceneStack(newStack);
      setScene(updatedNode.innerScene!);
      setViewport(innerVp);
      viewportRef.current = innerVp;
      setSelectedNodeIds(new Set());
      setEnterHintNodeId(null);
      setAutoEnterToast(null);
      markDirty();
    });
  }, [frameNodeViewport, animateViewport, setScene, setViewport, setSceneStack, setSelectedNodeIds, markDirty]);

  // Marquee selection state — also tracked in gestures hook; we only keep this
  // to trigger re-renders / dirty marks while marqueeing.
  const [, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const gestureCallbacks = {
    onPan: useCallback(() => { markDirty(); }, [markDirty]),
    onZoom: useCallback(() => { markDirty(); }, [markDirty]),

    onStrokeEnd: useCallback((path: VectorPath, minX: number, minY: number, maxX: number, maxY: number) => {
      const margin = strokeWidthRef.current;
      const node = createNode('path', minX - margin, minY - margin, (maxX - minX) + margin * 2, (maxY - minY) + margin * 2);
      node.path = path;
      const newScene = addNode(sceneRef.current, node);
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }, [setScene, onSceneChange, markDirty]),

    onStrokeMove: useCallback(() => { markDirty(); }, [markDirty]),

    onShapeEnd: useCallback((startX: number, startY: number, endX: number, endY: number) => {
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);
      if (w < 2 || h < 2) { markDirty(); return; }

      const t = toolRef.current;
      if (t !== 'rect' && t !== 'circle') { markDirty(); return; }
      const node = createNode(t, x, y, w, h);
      node.stroke = strokeColorRef.current;
      node.strokeWidth = strokeWidthRef.current;
      node.fill = fillColorRef.current;
      const newScene = addNode(sceneRef.current, node);
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }, [setScene, onSceneChange, markDirty]),

    onShapeMove: useCallback(() => { markDirty(); }, [markDirty]),

    onSelect: useCallback((worldX: number, worldY: number, additive: boolean) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (node) {
        // If part of a group, select all siblings
        const groupId = node.groupId;
        const groupMembers = groupId
          ? sceneRef.current.nodes.filter(n => n.groupId === groupId).map(n => n.id)
          : [node.id];

        const next = new Set(additive ? selectedNodeIdsRef.current : []);
        const alreadySelected = groupMembers.every(id => next.has(id));
        if (additive && alreadySelected) {
          for (const id of groupMembers) next.delete(id);
        } else {
          for (const id of groupMembers) next.add(id);
        }
        setSelectedNodeIds(next);

        draggedNodeIdsRef.current = new Set(next);
        dragHasMovedRef.current = false;
      } else {
        // Empty space: clear selection (unless additive) and start marquee via gestures
        if (!additive) setSelectedNodeIds(new Set());
        draggedNodeIdsRef.current = new Set();
        gesturesApiRef.current?.beginMarquee();
      }
      markDirty();
    }, [setSelectedNodeIds, markDirty]),

    onDragMove: useCallback((dx: number, dy: number) => {
      if (draggedNodeIdsRef.current.size === 0) return;
      dragHasMovedRef.current = true;
      const ids = draggedNodeIdsRef.current;
      const newScene: Scene = {
        ...sceneRef.current,
        nodes: sceneRef.current.nodes.map(n =>
          ids.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n
        ),
      };
      setScene(newScene);
      markDirty();
    }, [setScene, markDirty]),

    onDragEnd: useCallback(() => {
      if (draggedNodeIdsRef.current.size > 0 && dragHasMovedRef.current) {
        onSceneChange(sceneRef.current, viewportRef.current);
        isDirtyRef.current = false;
      }
      draggedNodeIdsRef.current = new Set();
      dragHasMovedRef.current = false;
    }, [onSceneChange]),

    onErase: useCallback((worldX: number, worldY: number) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (node) {
        const newScene = removeNode(sceneRef.current, node.id);
        setScene(newScene);
        onSceneChange(newScene, viewportRef.current);
        if (selectedNodeIdsRef.current.has(node.id)) {
          const next = new Set(selectedNodeIdsRef.current);
          next.delete(node.id);
          setSelectedNodeIds(next);
        }
        markDirty();
      }
    }, [setScene, onSceneChange, setSelectedNodeIds, markDirty]),

    onDoubleClick: useCallback((worldX: number, worldY: number) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (!node) return;
      performEnterScene(node);
    }, [performEnterScene]),

    onMarqueeStart: useCallback((wx: number, wy: number) => {
      setMarquee({ x: wx, y: wy, w: 0, h: 0 });
      markDirty();
    }, [markDirty]),

    onMarqueeMove: useCallback((sx: number, sy: number, ex: number, ey: number) => {
      setMarquee({ x: sx, y: sy, w: ex - sx, h: ey - sy });
      markDirty();
    }, [markDirty]),

    onMarqueeEnd: useCallback((sx: number, sy: number, ex: number, ey: number) => {
      const hits = getNodesInRect(sceneRef.current, sx, sy, ex - sx, ey - sy);
      const next = new Set(selectedNodeIdsRef.current);
      for (const n of hits) {
        next.add(n.id);
        // include group siblings
        if (n.groupId) {
          for (const s of sceneRef.current.nodes) {
            if (s.groupId === n.groupId) next.add(s.id);
          }
        }
      }
      setSelectedNodeIds(next);
      setMarquee(null);
      markDirty();
    }, [setSelectedNodeIds, markDirty]),

    onTextCreate: useCallback((wx: number, wy: number, sx: number, sy: number) => {
      setTextEdit({ screenX: sx, screenY: sy, worldX: wx, worldY: wy, value: '', fontSize: 18 });
    }, []),
  };

  const gesturesApiRef = useRef<ReturnType<typeof useGestures> | null>(null);
  const gestures = useGestures(
    () => viewportRef.current,
    (vp) => { setViewport(vp); viewportRef.current = vp; markDirty(); },
    () => toolRef.current,
    () => strokeColorRef.current,
    () => strokeWidthRef.current,
    gestureCallbacks,
    () => pressureEnabledRef.current,
  );
  gesturesApiRef.current = gestures;
  const { handlers, getLivePoints, getShapeStart, getShapeEnd, getMarqueeStart, getMarqueeEnd, setSpaceDown, cancelStroke } = gestures;

  // RAF render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      // Read live drawing state directly from gestures each frame
      const liveStrokeActive = getLivePoints().length > 1;
      const ss = getShapeStart();
      const se = getShapeEnd();
      const ms = getMarqueeStart();
      const me = getMarqueeEnd();
      const liveShapeActive = !!(ss && se && (toolRef.current === 'rect' || toolRef.current === 'circle'));

      if (needsRenderRef.current || liveStrokeActive || liveShapeActive || (ms && me)) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderScene(ctx, sceneRef.current, viewportRef.current, {
            highlightSelected: selectedNodeIdsRef.current,
            showGrid: true,
            selectionRect: (ms && me)
              ? { x: Math.min(ms.x, me.x), y: Math.min(ms.y, me.y), width: Math.abs(me.x - ms.x), height: Math.abs(me.y - ms.y) }
              : null,
            enterHintNodeId: enterHintNodeIdRef.current,
          });

          // Draw live stroke
          const pts = getLivePoints();
          if (pts.length > 1) {
            renderLiveStroke(ctx, pts, strokeColorRef.current, strokeWidthRef.current, viewportRef.current, pressureEnabledRef.current);
          }

          if (liveShapeActive && ss && se) {
            renderLiveShape(ctx, ss.x, ss.y, se.x, se.y,
              toolRef.current as 'rect' | 'circle',
              strokeColorRef.current, fillColorRef.current, strokeWidthRef.current,
              viewportRef.current);
          }
        }
        needsRenderRef.current = false;
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  // We want this to be set up exactly once. The ref-based readers always
  // see the latest state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize handler — recompute on actual dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      needsRenderRef.current = true;
    };
    resize();

    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Keyboard: space for pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceDown(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setSpaceDown]);

  // Track previous viewport scale to detect "zooming in"
  const prevScaleRef = useRef(viewport.scale);

  // Auto-enter on deep zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      prevScaleRef.current = viewport.scale;
      return;
    }
    if (!autoEnterEnabledRef.current) {
      setEnterHintNodeId(null);
      setAutoEnterToast(null);
      prevScaleRef.current = viewport.scale;
      return;
    }
    if (animatingRef.current) {
      prevScaleRef.current = viewport.scale;
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    let hintCandidate: SceneNode | null = null;
    let autoCandidate: SceneNode | null = null;

    for (const node of sceneRef.current.nodes) {
      const sw = node.width * viewport.scale;
      const sh = node.height * viewport.scale;
      const ratio = Math.min(sw / w, sh / h);
      if (ratio > 1.5) {
        autoCandidate = node;
        break;
      } else if (ratio > 0.5) {
        hintCandidate = node;
      }
    }

    const zoomingIn = viewport.scale > prevScaleRef.current * 1.0001 || lastWheelDeltaY.current < 0;
    prevScaleRef.current = viewport.scale;

    if (autoCandidate && zoomingIn) {
      lastWheelDeltaY.current = 0;
      performEnterScene(autoCandidate);
      return;
    }

    if (hintCandidate) {
      setEnterHintNodeId(hintCandidate.id);
      setAutoEnterToast(`Press Z to enter ${nodeLabel(hintCandidate)}`);
    } else {
      setEnterHintNodeId(null);
      setAutoEnterToast(null);
    }
  }, [viewport, performEnterScene]);

  // Native wheel listener that also tracks wheel direction for auto-enter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      lastWheelDeltaY.current = e.deltaY;
    };
    canvas.addEventListener('wheel', handler, { passive: true });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  // Drag-and-drop image import
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const dropWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const maxW = 400 / viewportRef.current.scale;
          const maxH = 300 / viewportRef.current.scale;
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          if (w > maxW || h > maxH) {
            const r = Math.min(maxW / w, maxH / h);
            w *= r; h *= r;
          }
          const node = createNode('image', dropWorld.x - w / 2, dropWorld.y - h / 2, w, h);
          node.imageData = dataUrl;
          const newScene = addNode(sceneRef.current, node);
          setScene(newScene);
          onSceneChange(newScene, viewportRef.current);
          markDirty();
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }, [setScene, onSceneChange, markDirty]);

  // Vectorize the selected image node
  const vectorizeSelected = useCallback(async () => {
    const ids = selectedNodeIdsRef.current;
    if (ids.size !== 1) return;
    const nodeId = Array.from(ids)[0];
    const node = sceneRef.current.nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'image' || !node.imageData) return;

    setIsVectorizing(true);
    try {
      const result = await vectorizeImage(node.imageData, { threshold: 128, simplify: 1.5 });
      const { paths, tracedWidth, tracedHeight } = result;
      const sx = node.width / Math.max(1, tracedWidth);
      const sy = node.height / Math.max(1, tracedHeight);

      const transformed: VectorPath[] = paths.map(p => ({
        ...p,
        d: transformPathCoords(p.d, (px, py) => ({
          x: node.x + px * sx,
          y: node.y + py * sy,
        })),
      }));

      const newScene = updateNode(sceneRef.current, nodeId, {
        isVectorized: true,
        vectorPaths: transformed,
      });
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    } finally {
      setIsVectorizing(false);
    }
  }, [setScene, onSceneChange, markDirty]);

  const enterSelected = useCallback(() => {
    const ids = selectedNodeIdsRef.current;
    if (ids.size !== 1) return;
    const id = Array.from(ids)[0];
    const node = sceneRef.current.nodes.find(n => n.id === id);
    if (!node) return;
    performEnterScene(node);
  }, [performEnterScene]);

  const groupSelected = useCallback(() => {
    const ids = selectedNodeIdsRef.current;
    if (ids.size < 2) return;
    const groupId = `g_${generateId()}`;
    let newScene = sceneRef.current;
    for (const id of ids) {
      newScene = updateNode(newScene, id, { groupId });
    }
    setScene(newScene);
    onSceneChange(newScene, viewportRef.current);
    markDirty();
  }, [setScene, onSceneChange, markDirty]);

  const ungroupSelected = useCallback(() => {
    const ids = selectedNodeIdsRef.current;
    if (ids.size === 0) return;
    let newScene = sceneRef.current;
    for (const id of ids) {
      const n = newScene.nodes.find(nn => nn.id === id);
      if (!n) continue;
      newScene = {
        ...newScene,
        nodes: newScene.nodes.map(nn => nn.id === id ? { ...nn, groupId: undefined } : nn),
      };
    }
    setScene(newScene);
    onSceneChange(newScene, viewportRef.current);
    markDirty();
  }, [setScene, onSceneChange, markDirty]);

  useImperativeHandle(ref, () => ({
    vectorizeSelected,
    cancelStroke,
    enterSelected,
    groupSelected,
    ungroupSelected,
    animateViewportTo: (target: Viewport, onComplete: () => void) => {
      animateViewport(target, 250, onComplete);
    },
  }), [vectorizeSelected, cancelStroke, enterSelected, groupSelected, ungroupSelected, animateViewport]);

  const commitTextEdit = useCallback(() => {
    if (!textEdit) return;
    const text = textEdit.value;
    if (text.trim().length > 0) {
      const ctx = canvasRef.current?.getContext('2d');
      const fontSize = textEdit.fontSize;
      let measuredW = 100;
      if (ctx) {
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        const lines = text.split('\n');
        measuredW = Math.max(...lines.map(l => ctx.measureText(l).width));
      }
      const lineCount = text.split('\n').length;
      const measuredH = fontSize * 1.2 * lineCount;
      const node = createNode('text', textEdit.worldX, textEdit.worldY, measuredW + 4, measuredH + 4);
      node.text = text;
      node.fontSize = fontSize;
      node.fontFamily = 'system-ui, sans-serif';
      node.color = strokeColorRef.current;
      const newScene = addNode(sceneRef.current, node);
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }
    setTextEdit(null);
    setTool('select');
  }, [textEdit, setScene, onSceneChange, markDirty, setTool]);

  // Custom cursor for pen+pressure
  const getCursor = (): string => {
    if (textEdit) return 'text';
    switch (tool) {
      case 'hand': return 'grab';
      case 'pen': {
        if (pressureEnabled) {
          // Browsers limit cursor images to ~32px; cap accordingly.
          const r = Math.max(2, Math.min(14, strokeWidth * viewport.scale * 0.5));
          const size = Math.ceil(r * 2 + 4);
          const center = size / 2;
          const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${center}' cy='${center}' r='${r}' fill='none' stroke='%231a1a2e' stroke-width='1.5'/></svg>`;
          return `url("data:image/svg+xml;utf8,${svg}") ${center} ${center}, crosshair`;
        }
        return 'crosshair';
      }
      case 'eraser': return 'cell';
      case 'select': return 'default';
      case 'text': return 'text';
      default: return 'crosshair';
    }
  };

  return (
    <>
      {isVectorizing && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center">
          <div className="bg-ink text-white px-6 py-4 rounded-xl flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <span>Vectorizing image…</span>
          </div>
        </div>
      )}

      {autoEnterToast && (
        <div className="fixed left-1/2 bottom-16 -translate-x-1/2 bg-ink/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm z-30 pointer-events-none animate-pulse">
          {autoEnterToast}
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="fixed inset-0"
        style={{
          cursor: getCursor(),
          touchAction: 'none',
          pointerEvents: isAnimating ? 'none' : 'auto',
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        {...handlers}
      />

      {textEdit && (
        <textarea
          autoFocus
          className="fixed z-40 resize-none bg-white/95 border-2 border-accent rounded shadow-lg px-2 py-1 outline-none"
          style={{
            left: textEdit.screenX,
            top: textEdit.screenY,
            fontSize: `${textEdit.fontSize}px`,
            fontFamily: 'system-ui, sans-serif',
            color: strokeColor,
            minWidth: 80,
            minHeight: 24,
          }}
          value={textEdit.value}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setTextEdit(null);
              setTool('select');
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitTextEdit();
            }
          }}
          onBlur={commitTextEdit}
        />
      )}
    </>
  );
});

function nodeLabel(node: SceneNode): string {
  switch (node.type) {
    case 'path': return 'Drawing';
    case 'image': return 'Image';
    case 'rect': return 'Rectangle';
    case 'circle': return 'Circle';
    case 'text': return 'Text';
    case 'group': return 'Group';
    default: return 'Object';
  }
}
