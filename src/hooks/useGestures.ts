import { useCallback, useRef } from 'react';
import { Viewport, ToolType, VectorPath } from '../types/scene';
import { screenToWorld, zoomAt } from '../engine/transform';
import { generateId } from '../engine/scene-graph';

interface Point {
  x: number;
  y: number;
}

export interface GestureCallbacks {
  onPanStart?: () => void;
  onPan?: (dx: number, dy: number) => void;
  onPanEnd?: () => void;
  onZoom?: (viewport: Viewport) => void;
  onStrokeStart?: (worldX: number, worldY: number) => void;
  onStrokeMove?: (worldX: number, worldY: number) => void;
  onStrokeEnd?: (path: VectorPath, minX: number, minY: number, maxX: number, maxY: number) => void;
  onShapeStart?: (worldX: number, worldY: number) => void;
  onShapeMove?: (worldX: number, worldY: number) => void;
  onShapeEnd?: (startX: number, startY: number, endX: number, endY: number) => void;
  onSelect?: (worldX: number, worldY: number) => void;
  onDragStart?: (worldX: number, worldY: number) => void;
  onDragMove?: (dx: number, dy: number) => void;
  onDragEnd?: () => void;
  onErase?: (worldX: number, worldY: number) => void;
  onDoubleClick?: (worldX: number, worldY: number) => void;
}

export interface GestureState {
  livePoints: Point[];
  shapeStart: Point | null;
  shapeEnd: Point | null;
}

export function useGestures(
  getViewport: () => Viewport,
  setViewport: (vp: Viewport) => void,
  getTool: () => ToolType,
  getStrokeColor: () => string,
  getStrokeWidth: () => number,
  callbacks: GestureCallbacks
) {
  const isPanning = useRef(false);
  const isDrawing = useRef(false);
  const isDragging = useRef(false);
  const isSpaceDown = useRef(false);
  const lastPointer = useRef<Point>({ x: 0, y: 0 });
  const rawPoints = useRef<Point[]>([]);
  const livePointsRef = useRef<Point[]>([]);
  const shapeStartRef = useRef<Point | null>(null);
  const shapeEndRef = useRef<Point | null>(null);
  const pointerDownTime = useRef(0);
  const pointerDownPos = useRef<Point>({ x: 0, y: 0 });

  // Touch pinch state — store as plain points to avoid DOM Touch type issues
  const touch1 = useRef<Point | null>(null);
  const touch2 = useRef<Point | null>(null);
  const lastPinchDist = useRef(0);

  // Double click detection
  const lastClickTime = useRef(0);
  const lastClickPos = useRef<Point>({ x: 0, y: 0 });

  const setSpaceDown = useCallback((down: boolean) => {
    isSpaceDown.current = down;
  }, []);

  // Ramer-Douglas-Peucker
  function rdp(points: Point[], tol: number): Point[] {
    if (points.length <= 2) return points;
    let maxDist = 0;
    let maxIdx = 0;
    const start = points[0];
    const end = points[points.length - 1];
    const lineLen = Math.hypot(end.x - start.x, end.y - start.y);

    for (let i = 1; i < points.length - 1; i++) {
      let dist: number;
      if (lineLen < 0.0001) {
        dist = Math.hypot(points[i].x - start.x, points[i].y - start.y);
      } else {
        const t = Math.max(0, Math.min(1,
          ((points[i].x - start.x) * (end.x - start.x) + (points[i].y - start.y) * (end.y - start.y)) / (lineLen * lineLen)
        ));
        dist = Math.hypot(points[i].x - (start.x + t * (end.x - start.x)), points[i].y - (start.y + t * (end.y - start.y)));
      }
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }

    if (maxDist > tol) {
      const left = rdp(points.slice(0, maxIdx + 1), tol);
      const right = rdp(points.slice(maxIdx), tol);
      return [...left.slice(0, -1), ...right];
    }
    return [start, end];
  }

  // Catmull-Rom to SVG cubic bezier
  function pointsToPath(points: Point[]): string {
    if (points.length < 2) return '';
    if (points.length === 2) {
      return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`;
    }

    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }

    return d;
  }

  function getBounds(points: Point[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  }

  const finishStroke = useCallback(() => {
    const points = rawPoints.current;
    if (points.length < 2) {
      rawPoints.current = [];
      livePointsRef.current = [];
      return;
    }

    const viewport = getViewport();
    // Simplify tolerance in world coords
    const tol = 2 / viewport.scale;
    const simplified = rdp(points, tol);
    const d = pointsToPath(simplified);

    if (d) {
      const { minX, minY, maxX, maxY } = getBounds(simplified);
      const path: VectorPath = {
        id: generateId(),
        d,
        stroke: getStrokeColor(),
        strokeWidth: getStrokeWidth(),
        fill: 'none',
        opacity: 1,
      };
      callbacks.onStrokeEnd?.(path, minX, minY, maxX, maxY);
    }

    rawPoints.current = [];
    livePointsRef.current = [];
  }, [getViewport, getStrokeColor, getStrokeWidth, callbacks]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1) {
      // Middle click = pan
      isPanning.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    pointerDownTime.current = Date.now();
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

    if (tool === 'hand' || isSpaceDown.current) {
      isPanning.current = true;
      callbacks.onPanStart?.();
      return;
    }

    if (tool === 'pen') {
      isDrawing.current = true;
      rawPoints.current = [world];
      livePointsRef.current = [world];
      callbacks.onStrokeStart?.(world.x, world.y);
      return;
    }

    if (tool === 'rect' || tool === 'circle') {
      isDrawing.current = true;
      shapeStartRef.current = world;
      shapeEndRef.current = world;
      callbacks.onShapeStart?.(world.x, world.y);
      return;
    }

    if (tool === 'select') {
      callbacks.onSelect?.(world.x, world.y);
      isDragging.current = true;
      callbacks.onDragStart?.(world.x, world.y);
      return;
    }

    if (tool === 'eraser') {
      callbacks.onErase?.(world.x, world.y);
      return;
    }
  }, [getTool, getViewport, callbacks]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    if (isPanning.current) {
      const vp = getViewport();
      setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy });
      callbacks.onPan?.(dx, dy);
      return;
    }

    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    if (isDrawing.current) {
      if (tool === 'pen') {
        rawPoints.current.push(world);
        livePointsRef.current = [...rawPoints.current];
        callbacks.onStrokeMove?.(world.x, world.y);
      } else if (tool === 'rect' || tool === 'circle') {
        shapeEndRef.current = world;
        callbacks.onShapeMove?.(world.x, world.y);
      }
      return;
    }

    if (isDragging.current && tool === 'select') {
      const worldDx = dx / viewport.scale;
      const worldDy = dy / viewport.scale;
      callbacks.onDragMove?.(worldDx, worldDy);
      return;
    }

    if (tool === 'eraser' && e.buttons === 1) {
      callbacks.onErase?.(world.x, world.y);
    }
  }, [getTool, getViewport, setViewport, callbacks]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    if (isPanning.current) {
      isPanning.current = false;
      callbacks.onPanEnd?.();
      return;
    }

    if (isDragging.current) {
      isDragging.current = false;
      callbacks.onDragEnd?.();
    }

    if (isDrawing.current) {
      isDrawing.current = false;
      if (tool === 'pen') {
        finishStroke();
      } else if ((tool === 'rect' || tool === 'circle') && shapeStartRef.current) {
        const start = shapeStartRef.current;
        callbacks.onShapeEnd?.(start.x, start.y, world.x, world.y);
        shapeStartRef.current = null;
        shapeEndRef.current = null;
      }
      return;
    }

    // Double click detection
    const now = Date.now();
    const dist = Math.hypot(e.clientX - lastClickPos.current.x, e.clientY - lastClickPos.current.y);
    if (now - lastClickTime.current < 400 && dist < 10) {
      callbacks.onDoubleClick?.(world.x, world.y);
      lastClickTime.current = 0;
    } else {
      lastClickTime.current = now;
      lastClickPos.current = { x: e.clientX, y: e.clientY };
    }
  }, [getTool, getViewport, finishStroke, callbacks]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const viewport = getViewport();

    // Trackpad pinch gesture sends ctrlKey=true with small deltaY
    // Regular scroll also works for zoom in this app
    const delta = -e.deltaY;
    const newViewport = zoomAt(viewport, e.clientX, e.clientY, delta);
    setViewport(newViewport);
    callbacks.onZoom?.(newViewport);
  }, [getViewport, setViewport, callbacks]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      touch1.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touch2.current = null;
    } else if (e.touches.length >= 2) {
      touch1.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touch2.current = { x: e.touches[1].clientX, y: e.touches[1].clientY };
      const dx = touch2.current.x - touch1.current.x;
      const dy = touch2.current.y - touch1.current.y;
      lastPinchDist.current = Math.hypot(dx, dy);
      // Cancel any drawing
      isDrawing.current = false;
      rawPoints.current = [];
      livePointsRef.current = [];
      isPanning.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    if (e.touches.length >= 2 && touch1.current && touch2.current) {
      const t1: Point = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const t2: Point = { x: e.touches[1].clientX, y: e.touches[1].clientY };

      const newDist = Math.hypot(t2.x - t1.x, t2.y - t1.y);
      const pinchDelta = newDist - lastPinchDist.current;
      lastPinchDist.current = newDist;

      // Pinch center
      const cx = (t1.x + t2.x) / 2;
      const cy = (t1.y + t2.y) / 2;

      // Pan
      const prevCx = (touch1.current.x + touch2.current.x) / 2;
      const prevCy = (touch1.current.y + touch2.current.y) / 2;
      const panDx = cx - prevCx;
      const panDy = cy - prevCy;

      const viewport = getViewport();
      let vp = { ...viewport, x: viewport.x + panDx, y: viewport.y + panDy };

      // Zoom around pinch center
      if (Math.abs(pinchDelta) > 0.5) {
        vp = zoomAt(vp, cx, cy, pinchDelta * 2);
      }

      setViewport(vp);

      touch1.current = t1;
      touch2.current = t2;
    } else if (e.touches.length === 1 && isPanning.current) {
      const t: Point = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      const prev = touch1.current;
      if (prev) {
        const dx = t.x - prev.x;
        const dy = t.y - prev.y;
        const vp = getViewport();
        setViewport({ ...vp, x: vp.x + dx, y: vp.y + dy });
      }
      touch1.current = t;
    }
  }, [getViewport, setViewport]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length < 2) {
      touch2.current = null;
      if (e.touches.length === 0) {
        touch1.current = null;
        isPanning.current = false;
      }
    }
  }, []);

  const getLivePoints = useCallback(() => livePointsRef.current, []);
  const getShapeStart = useCallback(() => shapeStartRef.current, []);
  const getShapeEnd = useCallback(() => shapeEndRef.current, []);

  return {
    setSpaceDown,
    getLivePoints,
    getShapeStart,
    getShapeEnd,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onWheel: handleWheel,
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}
