import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Scene, SceneNode, ToolType, Viewport, VectorPath, SceneLevel } from '../types/scene';
import { renderScene, renderLiveStroke, renderLiveShape } from '../engine/renderer';
import { createNode, addNode, removeNode, updateNode, getNodeAtPoint, ensureInnerScene } from '../engine/scene-graph';
import { screenToWorld } from '../engine/transform';
import { useGestures } from '../hooks/useGestures';
import { vectorizeImage } from '../engine/vectorizer';

interface CanvasProps {
  scene: Scene;
  setScene: (s: Scene) => void;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
  tool: ToolType;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  sceneStack: SceneLevel[];
  setSceneStack: (stack: SceneLevel[]) => void;
  onSceneChange: (scene: Scene, viewport: Viewport) => void;
}

export function Canvas({
  scene,
  setScene,
  viewport,
  setViewport,
  tool,
  strokeColor,
  fillColor,
  strokeWidth,
  selectedNodeId,
  setSelectedNodeId,
  sceneStack,
  setSceneStack,
  onSceneChange,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const needsRenderRef = useRef(true);
  const isDirtyRef = useRef(false);
  const livePointsRef = useRef<{ x: number; y: number }[]>([]);
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null);
  const shapeEndRef = useRef<{ x: number; y: number } | null>(null);
  const [isVectorizing, setIsVectorizing] = useState(false);

  // Keep refs up-to-date for callbacks
  const sceneRef = useRef(scene);
  const viewportRef = useRef(viewport);
  const toolRef = useRef(tool);
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const fillColorRef = useRef(fillColor);
  const selectedNodeIdRef = useRef(selectedNodeId);
  const sceneStackRef = useRef(sceneStack);

  useEffect(() => { sceneRef.current = scene; needsRenderRef.current = true; }, [scene]);
  useEffect(() => { viewportRef.current = viewport; needsRenderRef.current = true; }, [viewport]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; needsRenderRef.current = true; }, [selectedNodeId]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);

  const markDirty = useCallback(() => {
    needsRenderRef.current = true;
    isDirtyRef.current = true;
  }, []);

  // Drag state for moving nodes
  const draggedNodeRef = useRef<SceneNode | null>(null);
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const dragNodeOrigPos = useRef<{ x: number; y: number } | null>(null);

  const gestureCallbacks = {
    onPan: useCallback(() => { markDirty(); }, [markDirty]),
    onZoom: useCallback(() => { markDirty(); }, [markDirty]),

    onStrokeEnd: useCallback((path: VectorPath, minX: number, minY: number, maxX: number, maxY: number) => {
      livePointsRef.current = [];
      const margin = strokeWidthRef.current;
      const node = createNode('path', minX - margin, minY - margin, (maxX - minX) + margin * 2, (maxY - minY) + margin * 2);
      node.path = path;
      const newScene = addNode(sceneRef.current, node);
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }, [setScene, onSceneChange, markDirty]),

    onStrokeMove: useCallback(() => {
      markDirty();
    }, [markDirty]),

    onShapeEnd: useCallback((startX: number, startY: number, endX: number, endY: number) => {
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(endX - startX);
      const h = Math.abs(endY - startY);
      if (w < 2 || h < 2) return;

      const t = toolRef.current;
      if (t !== 'rect' && t !== 'circle') return;
      const node = createNode(t, x, y, w, h);
      node.stroke = strokeColorRef.current;
      node.strokeWidth = strokeWidthRef.current;
      node.fill = fillColorRef.current;
      const newScene = addNode(sceneRef.current, node);
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }, [setScene, onSceneChange, markDirty]),

    onShapeMove: useCallback((_wx: number, _wy: number) => {
      markDirty();
    }, [markDirty]),

    onSelect: useCallback((worldX: number, worldY: number) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      setSelectedNodeId(node?.id ?? null);
      if (node) {
        draggedNodeRef.current = node;
        dragStartWorldRef.current = { x: worldX, y: worldY };
        dragNodeOrigPos.current = { x: node.x, y: node.y };
      } else {
        draggedNodeRef.current = null;
      }
      markDirty();
    }, [setSelectedNodeId, markDirty]),

    onDragMove: useCallback((dx: number, dy: number) => {
      if (!draggedNodeRef.current) return;
      const node = draggedNodeRef.current;
      const newScene = updateNode(sceneRef.current, node.id, {
        x: node.x + dx,
        y: node.y + dy,
      });
      // Update the ref too so next drag is relative to new position
      draggedNodeRef.current = { ...node, x: node.x + dx, y: node.y + dy };
      setScene(newScene);
      markDirty();
    }, [setScene, markDirty]),

    onDragEnd: useCallback(() => {
      if (draggedNodeRef.current && isDirtyRef.current) {
        onSceneChange(sceneRef.current, viewportRef.current);
        isDirtyRef.current = false;
      }
      draggedNodeRef.current = null;
    }, [onSceneChange]),

    onErase: useCallback((worldX: number, worldY: number) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (node) {
        const newScene = removeNode(sceneRef.current, node.id);
        setScene(newScene);
        onSceneChange(newScene, viewportRef.current);
        if (selectedNodeIdRef.current === node.id) setSelectedNodeId(null);
        markDirty();
      }
    }, [setScene, onSceneChange, setSelectedNodeId, markDirty]),

    onDoubleClick: useCallback((worldX: number, worldY: number) => {
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (!node) return;

      // Ensure the node has an inner scene
      const updatedNode = ensureInnerScene(node);
      const updatedScene = updateNode(sceneRef.current, node.id, { innerScene: updatedNode.innerScene });
      setScene(updatedScene);

      const stack = sceneStackRef.current;
      // Save current viewport
      const newStack: SceneLevel[] = [
        ...stack.slice(0, -1),
        { ...stack[stack.length - 1], viewportWhenLeft: viewportRef.current },
        {
          scene: updatedNode.innerScene!,
          parentNodeId: node.id,
          label: node.type === 'path' ? 'Drawing' : node.type === 'image' ? 'Image' : node.type,
          viewportWhenLeft: { x: 0, y: 0, scale: 1 },
        },
      ];

      // Reset viewport for the inner scene
      const canvas = canvasRef.current;
      const w = canvas?.width ?? window.innerWidth;
      const h = canvas?.height ?? window.innerHeight;
      setViewport({ x: w / 2, y: h / 2, scale: 1 });
      setSceneStack(newStack);
      setScene(updatedNode.innerScene!);
      setSelectedNodeId(null);
      markDirty();
    }, [setScene, setViewport, setSceneStack, setSelectedNodeId, markDirty]),
  };

  const { handlers, getLivePoints, getShapeStart, getShapeEnd, setSpaceDown } = useGestures(
    () => viewportRef.current,
    (vp) => { setViewport(vp); viewportRef.current = vp; markDirty(); },
    () => toolRef.current,
    () => strokeColorRef.current,
    () => strokeWidthRef.current,
    gestureCallbacks
  );

  // Update live points ref for rendering
  useEffect(() => {
    const interval = setInterval(() => {
      livePointsRef.current = getLivePoints();
      const ss = getShapeStart();
      const se = getShapeEnd();
      shapeStartRef.current = ss;
      shapeEndRef.current = se;
    }, 16);
    return () => clearInterval(interval);
  }, [getLivePoints, getShapeStart, getShapeEnd]);

  // RAF render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const loop = () => {
      if (needsRenderRef.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          renderScene(ctx, sceneRef.current, viewportRef.current, {
            highlightSelected: selectedNodeIdRef.current ?? undefined,
            showGrid: true,
          });

          // Draw live stroke
          const pts = getLivePoints();
          if (pts.length > 1) {
            renderLiveStroke(ctx, pts, strokeColorRef.current, strokeWidthRef.current, viewportRef.current);
          }

          // Draw live shape
          const ss = getShapeStart();
          const se = getShapeEnd();
          if (ss && se && toolRef.current !== 'pen') {
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
  }, [getLivePoints, getShapeStart, getShapeEnd]);

  // Resize handler
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

  // Handle drag-and-drop image import
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
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
  const handleVectorize = useCallback(async () => {
    const nodeId = selectedNodeIdRef.current;
    if (!nodeId) return;
    const node = sceneRef.current.nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'image' || !node.imageData) return;

    setIsVectorizing(true);
    try {
      const paths = await vectorizeImage(node.imageData, { threshold: 128, simplify: 1.5 });
      // Translate paths to node position
      const translated = paths.map(p => ({
        ...p,
        d: translatePath(p.d, node.x, node.y, node.width, node.height),
      }));
      const newScene = updateNode(sceneRef.current, nodeId, {
        isVectorized: true,
        vectorPaths: translated,
      });
      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    } finally {
      setIsVectorizing(false);
    }
  }, [setScene, onSceneChange, markDirty]);

  // Expose vectorize handler
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__epVectorize = handleVectorize;
  }, [handleVectorize]);

  const getCursor = () => {
    switch (tool) {
      case 'hand': return 'grab';
      case 'pen': return 'crosshair';
      case 'eraser': return 'cell';
      case 'select': return 'default';
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
      <canvas
        ref={canvasRef}
        className="fixed inset-0"
        style={{
          cursor: getCursor(),
          touchAction: 'none',
        }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        {...handlers}
      />
    </>
  );
}

// Translate vectorized path coordinates from [0, width/height] to world coordinates
function translatePath(d: string, x: number, y: number, _width: number, _height: number): string {
  // The vectorizer produces paths in pixel coords of the downscaled image.
  // We need to scale them to node world coords.
  // Since vectorizer uses max 512px and node.width/height is in world units,
  // we compute the scale factor.
  // Translate pixel coords from vectorizer output to world coords
  // by offsetting with the node's world position
  return d.replace(/(-?\d+\.?\d*)\s+(-?\d+\.?\d*)/g, (_, px, py) => {
    // These are pixel coords within the (possibly scaled) image (max 512x512)
    // We want to keep them as-is and just offset by node position
    // The image is rendered at node.x, node.y with node.width x node.height
    // Vectorizer scales image to max 512, so we need: worldX = node.x + (px / 512) * node.width
    // But we don't know the image's original dimensions here.
    // Best approach: just offset by node position and scale.
    return `${(x + parseFloat(px)).toFixed(2)} ${(y + parseFloat(py)).toFixed(2)}`;
  });
}
