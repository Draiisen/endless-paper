import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Scene, SceneNode, ToolType, Viewport, VectorPath, SceneLevel } from '../types/scene';
import { renderScene, renderLiveStroke, renderLiveShape, imageCache } from '../engine/renderer';
import {
  createNode, addNode, removeNode, updateNode,
  getNodeAtPoint, ensureInnerScene, generateId,
  getNodesInRect, getBoundingBox,
} from '../engine/scene-graph';
import { screenToWorld } from '../engine/transform';
import { useGestures } from '../hooks/useGestures';
import { vectorizeImage } from '../engine/vectorizer';
import { transformPathCoords, parsePathToAnchors, anchorsToPath, PathAnchor } from '../engine/svg-path';
import { mirroredPaths, mirroredPoints, symmetryTransforms } from '../engine/symmetry';

/** Returns the 8 selection handle positions (world coords) for a node, matching renderer layout. */
function getResizeHandlePositions(node: import('../types/scene').SceneNode): [number, number][] {
  const p = 4; // padding matching drawSelectionHandles
  const x = node.x - p, y = node.y - p;
  const w = node.width + p * 2, h = node.height + p * 2;
  return [
    [x, y], [x + w, y], [x, y + h], [x + w, y + h],   // corners: TL, TR, BL, BR
    [x + w / 2, y], [x + w / 2, y + h],                 // top/bottom center
    [x, y + h / 2], [x + w, y + h / 2],                 // left/right center
  ];
}

/** DFS search for a scene by id in the root scene tree. */
function findSceneById(root: import('../types/scene').Scene, targetId: string): import('../types/scene').Scene | null {
  if (root.id === targetId) return root;
  for (const node of root.nodes) {
    if (node.innerScene) {
      const found = findSceneById(node.innerScene, targetId);
      if (found) return found;
    }
  }
  return null;
}

/** Find which node in the given scene tree hosts the specified inner scene id. */
function findNodeHostingScene(root: import('../types/scene').Scene, targetSceneId: string): import('../types/scene').SceneNode | null {
  for (const node of root.nodes) {
    if (node.innerScene?.id === targetSceneId) return node;
    if (node.innerScene) {
      const found = findNodeHostingScene(node.innerScene, targetSceneId);
      if (found) return found;
    }
  }
  return null;
}

export interface CanvasHandle {
  vectorizeSelected: () => Promise<void>;
  cancelStroke: () => void;
  enterSelected: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  animateViewportTo: (target: Viewport, onComplete: () => void, durationMs?: number) => void;
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
  symmetry?: import('../types/scene').SymmetryMode;
  stabilizer?: number;
  showReference?: boolean;
  activeLayerId?: string;
  viewerMode?: boolean;
  onHotspotClick?: (node: SceneNode, viewport: Viewport) => boolean;
  onDropAsset?: (assetId: string, worldX: number, worldY: number) => void;
}

interface TextEditState {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  value: string;
  fontSize: number;
  editingNodeId?: string; // set when editing an existing text node
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
  symmetry = 'off',
  stabilizer = 0,
  showReference = true,
  activeLayerId,
  viewerMode = false,
  onHotspotClick,
  onDropAsset,
}, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const needsRenderRef = useRef(true);
  const isDirtyRef = useRef(false);
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const textCommittedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textEditContainerRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    handleIdx: number; nodeId: string;
    origX: number; origY: number; origW: number; origH: number;
    accumDx: number; accumDy: number;
  } | null>(null);
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
  const symmetryRef = useRef(symmetry);
  const stabilizerRef = useRef(stabilizer);
  const viewerModeRef = useRef(viewerMode);
  const showReferenceRef = useRef(showReference);
  const activeLayerIdRef = useRef(activeLayerId);
  // Symmetry center in world coords — defaults to viewport center
  const symmCenterRef = useRef({ x: 0, y: 0 });

  // Path edit state
  const pathAnchorsRef = useRef<PathAnchor[]>([]);
  const pathEditNodeIdRef = useRef<string | null>(null);
  const dragAnchorIdxRef = useRef<number | null>(null);
  const dragAnchorPartRef = useRef<'anchor' | 'in' | 'out'>('anchor');
  const selectedAnchorIdxRef = useRef<number | null>(null);

  // Portal / scene-enter flash state
  const isPortalingRef = useRef(false);
  const enterFlashRef = useRef(0); // 0..1 fade progress (drives white flash on scene entry)

  // Auto-exit zoom debounce
  const lastAutoExitTimeRef = useRef(0);

  useEffect(() => { sceneRef.current = scene; needsRenderRef.current = true; }, [scene]);
  useEffect(() => {
    viewportRef.current = viewport;
    needsRenderRef.current = true;
    // Update symmetry center to current viewport center
    const canvas = canvasRef.current;
    const w = canvas?.width ?? window.innerWidth;
    const h = canvas?.height ?? window.innerHeight;
    symmCenterRef.current = {
      x: (w / 2 - viewport.x) / viewport.scale,
      y: (h / 2 - viewport.y) / viewport.scale,
    };
  }, [viewport]);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { strokeColorRef.current = strokeColor; }, [strokeColor]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { fillColorRef.current = fillColor; }, [fillColor]);
  useEffect(() => { selectedNodeIdsRef.current = selectedNodeIds; needsRenderRef.current = true; }, [selectedNodeIds]);
  useEffect(() => { sceneStackRef.current = sceneStack; }, [sceneStack]);
  useEffect(() => { pressureEnabledRef.current = pressureEnabled; }, [pressureEnabled]);
  useEffect(() => { autoEnterEnabledRef.current = autoEnterEnabled; }, [autoEnterEnabled]);
  useEffect(() => { symmetryRef.current = symmetry; }, [symmetry]);
  useEffect(() => { stabilizerRef.current = stabilizer; }, [stabilizer]);
  useEffect(() => { viewerModeRef.current = viewerMode; needsRenderRef.current = true; }, [viewerMode]);
  useEffect(() => { showReferenceRef.current = showReference; needsRenderRef.current = true; }, [showReference]);
  useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);

  // Explicitly focus the textarea when a text edit session opens (autoFocus alone fails on iOS)
  const textEditKey = textEdit ? `${textEdit.worldX.toFixed(0)}-${textEdit.worldY.toFixed(0)}` : null;
  useEffect(() => {
    if (!textEditKey) return;
    const raf = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [textEditKey]);

  // When tool switches to pathedit and single path node is selected, parse anchors
  useEffect(() => {
    if (tool === 'pathedit') {
      const ids = Array.from(selectedNodeIds);
      if (ids.length === 1) {
        const node = sceneRef.current.nodes.find(n => n.id === ids[0]);
        if (node?.type === 'path' && node.path) {
          pathAnchorsRef.current = parsePathToAnchors(node.path.d);
          pathEditNodeIdRef.current = node.id;
          dragAnchorIdxRef.current = null;
          selectedAnchorIdxRef.current = null;
          needsRenderRef.current = true;
          return;
        }
      }
      pathAnchorsRef.current = [];
      pathEditNodeIdRef.current = null;
    } else if (pathEditNodeIdRef.current) {
      // Switching away from pathedit — commit any anchor changes
      const anchors = pathAnchorsRef.current;
      const nodeId = pathEditNodeIdRef.current;
      if (anchors.length > 0) {
        const d = anchorsToPath(anchors);
        if (d) {
          const node = sceneRef.current.nodes.find(n => n.id === nodeId);
          if (node?.path) {
            const newPath = { ...node.path, d };
            const newScene = updateNode(sceneRef.current, nodeId, { path: newPath });
            setScene(newScene);
            onSceneChange(newScene, viewportRef.current);
          }
        }
      }
      pathAnchorsRef.current = [];
      pathEditNodeIdRef.current = null;
      dragAnchorIdxRef.current = null;
      selectedAnchorIdxRef.current = null;
      needsRenderRef.current = true;
    }
  }, [tool, selectedNodeIds, setScene, onSceneChange]);

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
      // Prevent auto-exit from firing on the scale drop caused by this programmatic reset.
      // Brief white flash to mask the hard scene switch
      enterFlashRef.current = 1;
      const fadeStart = performance.now();
      const fadeStep = () => {
        const elapsed = performance.now() - fadeStart;
        enterFlashRef.current = Math.max(0, 1 - elapsed / 300);
        needsRenderRef.current = true;
        if (enterFlashRef.current > 0) requestAnimationFrame(fadeStep);
      };
      requestAnimationFrame(fadeStep);

      lastAutoExitTimeRef.current = Date.now();
      prevScaleRef.current = 1;
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
      const symm = symmetryRef.current;
      const cx = symmCenterRef.current.x;
      const cy = symmCenterRef.current.y;
      const node = createNode('path', minX - margin, minY - margin, (maxX - minX) + margin * 2, (maxY - minY) + margin * 2);
      node.path = path;
      if (activeLayerIdRef.current) node.layerId = activeLayerIdRef.current;
      let newScene = addNode(sceneRef.current, node);

      // Symmetry: create mirrored path nodes with correctly transformed bboxes
      if (symm !== 'off') {
        const mirroredDs = mirroredPaths(path.d, symm, cx, cy);
        const transforms = symmetryTransforms(symm, cx, cy);
        for (let mi = 0; mi < mirroredDs.length; mi++) {
          const d = mirroredDs[mi];
          const fn = transforms[mi];
          // Transform the four corners of the original bbox through the symmetry transform
          const corners = [
            fn(minX, minY), fn(maxX, minY), fn(minX, maxY), fn(maxX, maxY),
          ];
          const mMinX = Math.min(...corners.map(c => c.x));
          const mMaxX = Math.max(...corners.map(c => c.x));
          const mMinY = Math.min(...corners.map(c => c.y));
          const mMaxY = Math.max(...corners.map(c => c.y));
          const mirrorPath: VectorPath = { ...path, id: generateId(), d };
          const mNode = createNode('path', mMinX - margin, mMinY - margin, (mMaxX - mMinX) + margin * 2, (mMaxY - mMinY) + margin * 2);
          mNode.path = mirrorPath;
          if (activeLayerIdRef.current) mNode.layerId = activeLayerIdRef.current;
          newScene = addNode(newScene, mNode);
        }
      }

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
      if (activeLayerIdRef.current) node.layerId = activeLayerIdRef.current;
      let newScene = addNode(sceneRef.current, node);

      // Symmetry: reflect shape bounding box
      const symm = symmetryRef.current;
      const cx = symmCenterRef.current.x;
      const cy = symmCenterRef.current.y;
      if (symm !== 'off') {
        // Reflect shape center and create mirrored node
        const shapeCx = x + w / 2;
        const shapeCy = y + h / 2;
        const transforms = (symm === 'vertical') ? [{ nx: 2 * cx - shapeCx, ny: shapeCy }]
          : (symm === 'horizontal') ? [{ nx: shapeCx, ny: 2 * cy - shapeCy }]
          : (symm === 'both') ? [
              { nx: 2 * cx - shapeCx, ny: shapeCy },
              { nx: shapeCx, ny: 2 * cy - shapeCy },
              { nx: 2 * cx - shapeCx, ny: 2 * cy - shapeCy },
            ]
          : [];
        for (const tr of transforms) {
          const mNode = createNode(t, tr.nx - w / 2, tr.ny - h / 2, w, h);
          mNode.stroke = strokeColorRef.current;
          mNode.strokeWidth = strokeWidthRef.current;
          mNode.fill = fillColorRef.current;
          if (activeLayerIdRef.current) mNode.layerId = activeLayerIdRef.current;
          newScene = addNode(newScene, mNode);
        }
      }

      setScene(newScene);
      onSceneChange(newScene, viewportRef.current);
      markDirty();
    }, [setScene, onSceneChange, markDirty]),

    onShapeMove: useCallback(() => { markDirty(); }, [markDirty]),

    onSelect: useCallback((worldX: number, worldY: number, additive: boolean) => {
      // Pathedit: hit-test handles then anchors (handles are on top visually)
      if (toolRef.current === 'pathedit' && pathAnchorsRef.current.length > 0) {
        const hitR = Math.max(7, 9 / viewportRef.current.scale);
        const anchors = pathAnchorsRef.current;
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          if (a.inX !== undefined && a.inY !== undefined &&
              Math.hypot(worldX - a.inX, worldY - a.inY) <= hitR) {
            dragAnchorIdxRef.current = i; dragAnchorPartRef.current = 'in';
            selectedAnchorIdxRef.current = i; needsRenderRef.current = true; return;
          }
          if (a.outX !== undefined && a.outY !== undefined &&
              Math.hypot(worldX - a.outX, worldY - a.outY) <= hitR) {
            dragAnchorIdxRef.current = i; dragAnchorPartRef.current = 'out';
            selectedAnchorIdxRef.current = i; needsRenderRef.current = true; return;
          }
        }
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          if (Math.hypot(worldX - a.x, worldY - a.y) <= hitR) {
            dragAnchorIdxRef.current = i; dragAnchorPartRef.current = 'anchor';
            selectedAnchorIdxRef.current = i; needsRenderRef.current = true; return;
          }
        }
        // Clicked empty space in pathedit — clear drag state but don't deselect
        dragAnchorIdxRef.current = null;
        return;
      }

      // Check if the click lands on a resize handle of the single selected node.
      const selIds = selectedNodeIdsRef.current;
      if (selIds.size === 1) {
        const selNode = sceneRef.current.nodes.find(n => n.id === Array.from(selIds)[0]);
        if (selNode) {
          const hitR = Math.max(6, 8 / viewportRef.current.scale);
          const handles = getResizeHandlePositions(selNode);
          for (let i = 0; i < handles.length; i++) {
            const [hx, hy] = handles[i];
            if (Math.abs(worldX - hx) <= hitR && Math.abs(worldY - hy) <= hitR) {
              resizeStateRef.current = {
                handleIdx: i, nodeId: selNode.id,
                origX: selNode.x, origY: selNode.y,
                origW: selNode.width, origH: selNode.height,
                accumDx: 0, accumDy: 0,
              };
              draggedNodeIdsRef.current = new Set(); // prevent move logic
              return;
            }
          }
        }
      }
      const node = getNodeAtPoint(sceneRef.current, worldX, worldY);
      if (node) {
        // Check hotspot (click trigger) — only when viewerMode
        if (node.hotspot && node.hotspot.trigger === 'click' && onHotspotClick) {
          const handled = onHotspotClick(node, viewportRef.current);
          if (handled) { markDirty(); return; }
        }

        // Check portal navigation — only active in viewer mode
        if (viewerModeRef.current && node.portal?.targetSceneId) {
          const rootScene = sceneStackRef.current[0]?.scene ?? sceneRef.current;
          const targetScene = findSceneById(rootScene, node.portal.targetSceneId);
          if (targetScene) {
            const containerNode = findNodeHostingScene(rootScene, node.portal.targetSceneId);
            isPortalingRef.current = true;
            needsRenderRef.current = true;
            setTimeout(() => { isPortalingRef.current = false; needsRenderRef.current = true; }, 300);
            const canvas = canvasRef.current;
            const w = canvas?.width ?? window.innerWidth;
            const h = canvas?.height ?? window.innerHeight;
            const innerVp = node.portal.targetCamera ?? { x: w / 2, y: h / 2, scale: 1 };
            const currentStack = sceneStackRef.current;
            const newStack: SceneLevel[] = [
              ...currentStack.slice(0, -1),
              { ...currentStack[currentStack.length - 1], viewportWhenLeft: viewportRef.current },
              {
                scene: targetScene,
                parentNodeId: containerNode?.id ?? node.id,
                label: 'Portal',
                viewportWhenLeft: innerVp,
              },
            ];
            setSceneStack(newStack);
            setScene(targetScene);
            setViewport(innerVp);
            viewportRef.current = innerVp;
            setSelectedNodeIds(new Set());
            markDirty();
            return;
          }
        }

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
    }, [setSelectedNodeIds, markDirty, onHotspotClick, setScene, setViewport, setSceneStack]),

    onDragMove: useCallback((dx: number, dy: number) => {
      // Pathedit anchor drag
      if (toolRef.current === 'pathedit' && dragAnchorIdxRef.current !== null) {
        const idx = dragAnchorIdxRef.current;
        const part = dragAnchorPartRef.current;
        const anchors = pathAnchorsRef.current.map((a, i) => i !== idx ? a : { ...a });
        const a = anchors[idx];
        if (part === 'anchor') {
          const hdxi = a.inX !== undefined ? a.inX - a.x : undefined;
          const hdyi = a.inY !== undefined ? a.inY - a.y : undefined;
          const hdxo = a.outX !== undefined ? a.outX - a.x : undefined;
          const hdyo = a.outY !== undefined ? a.outY - a.y : undefined;
          a.x += dx; a.y += dy;
          if (hdxi !== undefined) { a.inX = a.x + hdxi; a.inY = a.y + (hdyi ?? 0); }
          if (hdxo !== undefined) { a.outX = a.x + hdxo; a.outY = a.y + (hdyo ?? 0); }
        } else if (part === 'in') {
          a.inX = (a.inX ?? a.x) + dx; a.inY = (a.inY ?? a.y) + dy;
          // Mirror out handle to maintain smooth curve (Shift = break symmetry)
          if (!shiftKeyRef.current && a.outX !== undefined && a.outY !== undefined) {
            const odx = a.outX - a.x; const ody = a.outY - a.y;
            const outLen = Math.hypot(odx, ody);
            const mirDx = a.x - a.inX; const mirDy = a.y - a.inY;
            const mirLen = Math.hypot(mirDx, mirDy);
            if (mirLen > 0 && outLen > 0) {
              a.outX = a.x + (mirDx / mirLen) * outLen;
              a.outY = a.y + (mirDy / mirLen) * outLen;
            }
          }
        } else {
          a.outX = (a.outX ?? a.x) + dx; a.outY = (a.outY ?? a.y) + dy;
          // Mirror in handle to maintain smooth curve (Shift = break symmetry)
          if (!shiftKeyRef.current && a.inX !== undefined && a.inY !== undefined) {
            const inDx = a.inX - a.x; const inDy = a.inY - a.y;
            const inLen = Math.hypot(inDx, inDy);
            const mirDx = a.x - a.outX; const mirDy = a.y - a.outY;
            const mirLen = Math.hypot(mirDx, mirDy);
            if (mirLen > 0 && inLen > 0) {
              a.inX = a.x + (mirDx / mirLen) * inLen;
              a.inY = a.y + (mirDy / mirLen) * inLen;
            }
          }
        }
        pathAnchorsRef.current = anchors;
        markDirty();
        return;
      }

      // Resize mode: one of the selection handles is being dragged
      if (resizeStateRef.current) {
        const rs = resizeStateRef.current;
        rs.accumDx += dx;
        rs.accumDy += dy;
        const { handleIdx, nodeId, origX, origY, origW, origH, accumDx, accumDy } = rs;
        const MIN = 10;
        let nx = origX, ny = origY, nw = origW, nh = origH;
        // TL=0 TR=1 BL=2 BR=3 TC=4 BC=5 LC=6 RC=7
        if (handleIdx === 0) { nx = origX + accumDx; nw = origW - accumDx; ny = origY + accumDy; nh = origH - accumDy; }
        else if (handleIdx === 1) { nw = origW + accumDx; ny = origY + accumDy; nh = origH - accumDy; }
        else if (handleIdx === 2) { nx = origX + accumDx; nw = origW - accumDx; nh = origH + accumDy; }
        else if (handleIdx === 3) { nw = origW + accumDx; nh = origH + accumDy; }
        else if (handleIdx === 4) { ny = origY + accumDy; nh = origH - accumDy; }
        else if (handleIdx === 5) { nh = origH + accumDy; }
        else if (handleIdx === 6) { nx = origX + accumDx; nw = origW - accumDx; }
        else if (handleIdx === 7) { nw = origW + accumDx; }
        // Shift constrains aspect ratio for corner handles (0-3)
        if (shiftKeyRef.current && handleIdx <= 3 && origW > 0 && origH > 0) {
          const aspect = origW / origH;
          const dw = nw - origW, dh = nh - origH;
          if (Math.abs(dw / origW) >= Math.abs(dh / origH)) {
            nh = nw / aspect;
            if (handleIdx === 0 || handleIdx === 2) ny = origY + (origH - nh);
          } else {
            nw = nh * aspect;
            if (handleIdx === 0 || handleIdx === 1) nx = origX + (origW - nw);
          }
        }
        if (nw < MIN) { if (nx !== origX) nx = origX + origW - MIN; nw = MIN; }
        if (nh < MIN) { if (ny !== origY) ny = origY + origH - MIN; nh = MIN; }
        const newScene = {
          ...sceneRef.current,
          nodes: sceneRef.current.nodes.map(n => n.id === nodeId ? { ...n, x: nx, y: ny, width: nw, height: nh } : n),
        };
        setScene(newScene);
        markDirty();
        return;
      }
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
      // Pathedit: commit anchor changes to scene
      if (toolRef.current === 'pathedit' && dragAnchorIdxRef.current !== null) {
        dragAnchorIdxRef.current = null;
        const anchors = pathAnchorsRef.current;
        const nodeId = pathEditNodeIdRef.current;
        if (anchors.length > 0 && nodeId) {
          const d = anchorsToPath(anchors);
          if (d) {
            const node = sceneRef.current.nodes.find(n => n.id === nodeId);
            if (node?.path) {
              const newScene = updateNode(sceneRef.current, nodeId, { path: { ...node.path, d } });
              setScene(newScene);
              onSceneChange(newScene, viewportRef.current);
            }
          }
        }
        return;
      }

      if (resizeStateRef.current) {
        onSceneChange(sceneRef.current, viewportRef.current);
        resizeStateRef.current = null;
        return;
      }
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
      // Check hotspot (doubleclick trigger)
      if (node.hotspot && node.hotspot.trigger === 'doubleclick' && onHotspotClick) {
        const handled = onHotspotClick(node, viewportRef.current);
        if (handled) return;
      }
      // Double-clicking a text node opens the inline editor
      if (node.type === 'text') {
        const vp = viewportRef.current;
        const sx = node.x * vp.scale + vp.x;
        const sy = node.y * vp.scale + vp.y;
        textCommittedRef.current = false;
        setTextEdit({
          screenX: sx, screenY: sy,
          worldX: node.x, worldY: node.y,
          value: node.text ?? '',
          fontSize: node.fontSize ?? 16,
          editingNodeId: node.id,
        });
        return;
      }
      performEnterScene(node);
    }, [performEnterScene, onHotspotClick]),

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
      textCommittedRef.current = false;
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
    () => stabilizerRef.current,
    () => viewerModeRef.current,
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

      const hasAnimatedNodes = sceneRef.current.nodes.some(n => n.animation);
      const now = Date.now();
      const hasVectorFading = sceneRef.current.nodes.some(n => n.lod?.vectorLoadedAt && (now - n.lod.vectorLoadedAt) < 650);
      if (needsRenderRef.current || liveStrokeActive || liveShapeActive || (ms && me) || hasAnimatedNodes || hasVectorFading) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const symmMode = symmetryRef.current;
          const symmCx = symmCenterRef.current.x;
          const symmCy = symmCenterRef.current.y;

          const rootStartCam = sceneStackRef.current[0]?.scene?.startCamera;
          const startCameraPin = rootStartCam ? (() => {
            const vp = rootStartCam.viewport;
            const w = canvas.width;
            const h = canvas.height;
            return { x: (w / 2 - vp.x) / vp.scale, y: (h / 2 - vp.y) / vp.scale };
          })() : null;

          renderScene(ctx, sceneRef.current, viewportRef.current, {
            highlightSelected: selectedNodeIdsRef.current,
            showGrid: true,
            selectionRect: (ms && me)
              ? { x: Math.min(ms.x, me.x), y: Math.min(ms.y, me.y), width: Math.abs(me.x - ms.x), height: Math.abs(me.y - ms.y) }
              : null,
            enterHintNodeId: enterHintNodeIdRef.current,
            viewerMode: viewerModeRef.current,
            showReference: showReferenceRef.current,
            symmetryCenter: symmMode !== 'off' ? { x: symmCx, y: symmCy } : null,
            pathEditNodeId: pathEditNodeIdRef.current,
            pathEditAnchors: pathAnchorsRef.current.length > 0 ? pathAnchorsRef.current : undefined,
            pathEditSelectedAnchorIdx: selectedAnchorIdxRef.current,
            animationTime: Date.now(),
            startCameraPin,
          });

          // Draw live stroke (and mirrored previews)
          const pts = getLivePoints();
          if (pts.length > 1) {
            renderLiveStroke(ctx, pts, strokeColorRef.current, strokeWidthRef.current, viewportRef.current, pressureEnabledRef.current);
            // Mirrored live strokes
            if (symmMode !== 'off') {
              const mirPtSets = mirroredPoints(pts, symmMode, symmCx, symmCy);
              for (const mPts of mirPtSets) {
                if (mPts.length > 1) {
                  renderLiveStroke(ctx, mPts, strokeColorRef.current, strokeWidthRef.current, viewportRef.current, pressureEnabledRef.current);
                }
              }
            }
          }

          if (liveShapeActive && ss && se) {
            renderLiveShape(ctx, ss.x, ss.y, se.x, se.y,
              toolRef.current as 'rect' | 'circle',
              strokeColorRef.current, fillColorRef.current, strokeWidthRef.current,
              viewportRef.current);
          }

          // Portal flash overlay
          if (isPortalingRef.current) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
          }

          // Scene-entry flash (fades out over 300ms)
          if (enterFlashRef.current > 0) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = `rgba(255, 255, 255, ${enterFlashRef.current * 0.6})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
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

  const shiftKeyRef = useRef(false);

  // Keyboard: space for pan + shift tracking for constrained resize
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        setSpaceDown(true);
      }
      if (e.key === 'Shift') shiftKeyRef.current = true;

      // Delete selected anchor in pathedit mode
      if ((e.key === 'Delete' || e.key === 'Backspace') &&
          toolRef.current === 'pathedit' &&
          selectedAnchorIdxRef.current !== null &&
          !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const idx = selectedAnchorIdxRef.current;
        const anchors = [...pathAnchorsRef.current];
        if (anchors.length > 1) {
          anchors.splice(idx, 1);
          pathAnchorsRef.current = anchors;
          selectedAnchorIdxRef.current = Math.min(idx, anchors.length - 1);
          dragAnchorIdxRef.current = null;
          needsRenderRef.current = true;
          // Commit immediately
          const nodeId = pathEditNodeIdRef.current;
          if (nodeId) {
            const d = anchorsToPath(anchors);
            if (d) {
              const node = sceneRef.current.nodes.find(n => n.id === nodeId);
              if (node?.path) {
                const newScene = updateNode(sceneRef.current, nodeId, { path: { ...node.path, d } });
                setScene(newScene);
                onSceneChange(newScene, viewportRef.current);
              }
            }
          }
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
      if (e.key === 'Shift') shiftKeyRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [setSpaceDown, setScene, onSceneChange]);

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
      } else if (ratio > 0.25) {
        hintCandidate = node;
      }
    }

    const zoomingIn = viewport.scale > prevScaleRef.current * 1.0001 || lastWheelDeltaY.current < 0;
    const zoomingOut = viewport.scale < prevScaleRef.current * 0.9999 || lastWheelDeltaY.current > 0;
    prevScaleRef.current = viewport.scale;
    lastWheelDeltaY.current = 0; // consume — don't carry over to next viewport change (e.g. pan or teleport)

    if (autoCandidate && zoomingIn) {
      lastWheelDeltaY.current = 0;
      performEnterScene(autoCandidate);
      return;
    }

    // Auto-exit: if zoomed out enough that scene occupies < 30% of viewport area
    const stack = sceneStackRef.current;
    if (zoomingOut && stack.length > 1) {
      const now = Date.now();
      if (now - lastAutoExitTimeRef.current > 1000) {
        const nodes = sceneRef.current.nodes;
        if (nodes.length > 0) {
          const bb = getBoundingBox(nodes);
          const screenW = bb.width * viewport.scale;
          const screenH = bb.height * viewport.scale;
          const sceneScreenArea = screenW * screenH;
          const viewportArea = w * h;
          if (sceneScreenArea > 0 && sceneScreenArea < viewportArea * 0.30) {
            lastAutoExitTimeRef.current = now;
            const parentEntry = stack[stack.length - 2];
            const newStack = stack.slice(0, -1);
            setScene(parentEntry.scene);
            setViewport(parentEntry.viewportWhenLeft);
            viewportRef.current = parentEntry.viewportWhenLeft;
            setSceneStack(newStack);
            setSelectedNodeIds(new Set());
            setEnterHintNodeId(null);
            setAutoEnterToast(null);
            markDirty();
            return;
          }
        }
      }
    }

    if (hintCandidate) {
      setEnterHintNodeId(hintCandidate.id);
      setAutoEnterToast(`Press Z to enter ${nodeLabel(hintCandidate)}`);
    } else {
      setEnterHintNodeId(null);
      setAutoEnterToast(null);
    }
  }, [viewport, performEnterScene, setScene, setViewport, setSceneStack, setSelectedNodeIds, markDirty]);

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

    // Asset library drag
    const assetId = e.dataTransfer.getData('application/x-endless-asset');
    if (assetId && onDropAsset) {
      const dropWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);
      onDropAsset(assetId, dropWorld.x, dropWorld.y);
      return;
    }

    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;

    const dropWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);

    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const img = new Image();
        img.onerror = () => {
          setDropError('Impossible de charger cette image.');
          setTimeout(() => setDropError(null), 3500);
        };
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
          if (activeLayerIdRef.current) node.layerId = activeLayerIdRef.current;
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
    animateViewportTo: (target: Viewport, onComplete: () => void, durationMs?: number) => {
      animateViewport(target, durationMs ?? 600, onComplete);
    },
  }), [vectorizeSelected, cancelStroke, enterSelected, groupSelected, ungroupSelected, animateViewport]);

  const commitTextEdit = useCallback(() => {
    // Enter triggers a commit then unmounts the textarea, whose blur fires a
    // second commit — this guard stops a duplicate text node being created.
    if (!textEdit || textCommittedRef.current) return;
    textCommittedRef.current = true;
    const text = textEdit.value;
    const ctx = canvasRef.current?.getContext('2d');
    const fontSize = textEdit.fontSize;
    let measuredW = 100;
    if (ctx && text.trim().length > 0) {
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      measuredW = Math.max(...text.split('\n').map(l => ctx.measureText(l).width));
    }
    const lineCount = Math.max(1, text.split('\n').length);
    const measuredH = fontSize * 1.2 * lineCount;

    if (textEdit.editingNodeId) {
      // Update existing text node in place (double-click to edit flow)
      if (text.trim().length > 0) {
        const newScene = {
          ...sceneRef.current,
          nodes: sceneRef.current.nodes.map(n => n.id === textEdit.editingNodeId
            ? { ...n, text, width: measuredW + 4, height: measuredH + 4 }
            : n),
        };
        setScene(newScene);
        onSceneChange(newScene, viewportRef.current);
        markDirty();
      }
      // If empty, leave the node as-is (don't delete on empty edit)
    } else if (text.trim().length > 0) {
      // Create new text node
      const node = createNode('text', textEdit.worldX, textEdit.worldY, measuredW + 4, measuredH + 4);
      node.text = text;
      node.fontSize = fontSize;
      node.fontFamily = 'system-ui, sans-serif';
      node.color = strokeColorRef.current;
      if (activeLayerIdRef.current) node.layerId = activeLayerIdRef.current;
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
      case 'pathedit': return 'crosshair';
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

      {dropError && (
        <div className="fixed left-1/2 top-20 -translate-x-1/2 bg-red-600/90 text-white text-xs px-4 py-2 rounded-full backdrop-blur-sm z-30 pointer-events-none">
          {dropError}
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
        <div
          ref={textEditContainerRef}
          className="fixed z-40 flex flex-col gap-1"
          style={{
            left: Math.min(textEdit.screenX, window.innerWidth - 240),
            top: Math.max(56, textEdit.screenY - 44),
          }}
        >
          {/* Toolbar: font sizes + Done + Cancel */}
          <div className="flex items-center gap-1 bg-ink/90 rounded-lg px-2 py-1 shadow-lg border border-white/10 self-start">
            {[12, 18, 24, 36, 48, 64].map(s => (
              <button
                key={s}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono touch-manipulation transition-colors ${textEdit.fontSize === s ? 'bg-accent text-white' : 'text-gray-300 hover:text-white active:text-white'}`}
                onPointerDown={e => { e.preventDefault(); setTextEdit(t => t ? { ...t, fontSize: s } : t); }}
              >{s}</button>
            ))}
            <div className="w-px h-4 bg-white/20 mx-0.5 flex-shrink-0" />
            <button
              className="px-2 py-0.5 rounded bg-accent text-white text-[11px] font-bold touch-manipulation flex-shrink-0"
              onPointerDown={e => { e.preventDefault(); commitTextEdit(); }}
              title="Valider (Entrée)"
            >✓</button>
            <button
              className="px-1.5 py-0.5 rounded text-gray-400 hover:text-white text-[11px] touch-manipulation flex-shrink-0"
              onPointerDown={e => { e.preventDefault(); setTextEdit(null); setTool('select'); }}
              title="Annuler (Échap)"
            >✕</button>
          </div>
          <textarea
            ref={textareaRef}
            className="resize-none bg-white/95 border-2 border-accent rounded shadow-lg px-2 py-1 outline-none"
            style={{
              fontSize: `${textEdit.fontSize}px`,
              fontFamily: 'system-ui, sans-serif',
              color: strokeColor,
              minWidth: 120,
              minHeight: 36,
              maxWidth: window.innerWidth - 48,
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
            onBlur={() => {
              // Delay so focus can move within the container (e.g. font size buttons)
              // without triggering a premature commit. Also protects against mobile
              // keyboard-open events that briefly fire blur.
              setTimeout(() => {
                if (textEditContainerRef.current?.contains(document.activeElement)) return;
                if (!textCommittedRef.current) commitTextEdit();
              }, 250);
            }}
          />
        </div>
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
