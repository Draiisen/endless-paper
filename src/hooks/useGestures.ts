import { useCallback, useRef } from 'react';
import { Viewport, ToolType, VectorPath } from '../types/scene';
import { screenToWorld, zoomAt } from '../engine/transform';
import { generateId } from '../engine/scene-graph';

interface Point {
  x: number;
  y: number;
  p?: number; // pressure (0..1)
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
  onSelect?: (worldX: number, worldY: number, additive: boolean, screenX: number, screenY: number) => void;
  onDragStart?: (worldX: number, worldY: number) => void;
  onDragMove?: (dx: number, dy: number) => void;
  onDragEnd?: () => void;
  onErase?: (worldX: number, worldY: number) => void;
  onDoubleClick?: (worldX: number, worldY: number) => void;
  onMarqueeStart?: (worldX: number, worldY: number) => void;
  onMarqueeMove?: (startX: number, startY: number, endX: number, endY: number) => void;
  onMarqueeEnd?: (startX: number, startY: number, endX: number, endY: number) => void;
  onTextCreate?: (worldX: number, worldY: number, screenX: number, screenY: number) => void;
}

export function useGestures(
  getViewport: () => Viewport,
  setViewport: (vp: Viewport) => void,
  getTool: () => ToolType,
  getStrokeColor: () => string,
  getStrokeWidth: () => number,
  callbacks: GestureCallbacks,
  getPressureSensitive: () => boolean = () => false,
) {
  // Always read latest callbacks via ref so handler identities don't churn.
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const isPanning = useRef(false);
  const isDrawing = useRef(false);
  const isDragging = useRef(false);
  const isMarquee = useRef(false);
  const isSpaceDown = useRef(false);
  const lastPointer = useRef<Point>({ x: 0, y: 0 });
  const rawPoints = useRef<Point[]>([]);
  const livePointsRef = useRef<Point[]>([]);
  const shapeStartRef = useRef<Point | null>(null);
  const shapeEndRef = useRef<Point | null>(null);
  const marqueeStartRef = useRef<Point | null>(null);
  const marqueeEndRef = useRef<Point | null>(null);

  // Active pointers (multi-touch tracking)
  const activePointers = useRef<Map<number, { type: string; x: number; y: number }>>(new Map());
  const lastPinchDist = useRef(0);
  const penIsActive = useRef(false);

  // Double click detection
  const lastClickTime = useRef(0);
  const lastClickPos = useRef<Point>({ x: 0, y: 0 });

  // Owner pointer for the current draw/drag/pan operation.
  const opPointerId = useRef<number | null>(null);

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

  // Catmull-Rom to SVG cubic bezier (centerline path)
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

  // Build a closed filled path that outlines a stroke whose width varies per
  // point with `point.p` pressure.
  function pointsToPressurePath(points: Point[], baseWidth: number): string {
    if (points.length < 2) return '';

    const widthAt = (p: Point) => Math.max(0.4, baseWidth * (p.p ?? 0.5));

    type Vec = { x: number; y: number };
    const left: Vec[] = [];
    const right: Vec[] = [];

    for (let i = 0; i < points.length; i++) {
      const cur = points[i];
      const prev = points[i - 1] ?? cur;
      const next = points[i + 1] ?? cur;

      // Compute average tangent direction at this point
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const tlen = Math.hypot(tx, ty);
      if (tlen < 1e-6) { tx = 1; ty = 0; } else { tx /= tlen; ty /= tlen; }

      // Perpendicular
      const nx = -ty;
      const ny = tx;
      const half = widthAt(cur) / 2;
      left.push({ x: cur.x + nx * half, y: cur.y + ny * half });
      right.push({ x: cur.x - nx * half, y: cur.y - ny * half });
    }

    let d = `M ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`;
    for (let i = 1; i < left.length; i++) {
      d += ` L ${left[i].x.toFixed(2)} ${left[i].y.toFixed(2)}`;
    }
    // Round cap at the end: small bezier across the end normal
    const endC = points[points.length - 1];
    const endR = right[right.length - 1];
    const endL = left[left.length - 1];
    const endHalf = widthAt(endC) / 2;
    // Tangent at end
    const ePrev = points[points.length - 2] ?? endC;
    let etx = endC.x - ePrev.x;
    let ety = endC.y - ePrev.y;
    const elen = Math.hypot(etx, ety);
    if (elen > 1e-6) { etx /= elen; ety /= elen; }
    const eFwdX = endC.x + etx * endHalf;
    const eFwdY = endC.y + ety * endHalf;
    d += ` Q ${eFwdX.toFixed(2)} ${eFwdY.toFixed(2)}, ${endR.x.toFixed(2)} ${endR.y.toFixed(2)}`;
    for (let i = right.length - 2; i >= 0; i--) {
      d += ` L ${right[i].x.toFixed(2)} ${right[i].y.toFixed(2)}`;
    }
    // Round cap at the start
    const startC = points[0];
    const startHalf = widthAt(startC) / 2;
    const sNext = points[1] ?? startC;
    let stx = sNext.x - startC.x;
    let sty = sNext.y - startC.y;
    const slen = Math.hypot(stx, sty);
    if (slen > 1e-6) { stx /= slen; sty /= slen; }
    const sBackX = startC.x - stx * startHalf;
    const sBackY = startC.y - sty * startHalf;
    d += ` Q ${sBackX.toFixed(2)} ${sBackY.toFixed(2)}, ${left[0].x.toFixed(2)} ${left[0].y.toFixed(2)}`;
    d += ' Z';
    void endL;
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
    const tol = 2 / viewport.scale;
    const simplified = rdp(points, tol);
    const usePressure = getPressureSensitive();
    let path: VectorPath;

    if (usePressure) {
      const d = pointsToPressurePath(simplified, getStrokeWidth());
      if (!d) { rawPoints.current = []; livePointsRef.current = []; return; }
      path = {
        id: generateId(),
        d,
        stroke: 'none',
        strokeWidth: getStrokeWidth(),
        fill: getStrokeColor(),
        opacity: 1,
        pressureSensitive: true,
      };
    } else {
      const d = pointsToPath(simplified);
      if (!d) { rawPoints.current = []; livePointsRef.current = []; return; }
      path = {
        id: generateId(),
        d,
        stroke: getStrokeColor(),
        strokeWidth: getStrokeWidth(),
        fill: 'none',
        opacity: 1,
      };
    }

    const { minX, minY, maxX, maxY } = getBounds(simplified);
    callbacksRef.current.onStrokeEnd?.(path, minX, minY, maxX, maxY);

    rawPoints.current = [];
    livePointsRef.current = [];
  }, [getViewport, getStrokeColor, getStrokeWidth, getPressureSensitive]);

  // Public API to abort an in-progress stroke (Esc)
  const cancelStroke = useCallback(() => {
    if (isDrawing.current || isMarquee.current) {
      isDrawing.current = false;
      isMarquee.current = false;
      rawPoints.current = [];
      livePointsRef.current = [];
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      marqueeStartRef.current = null;
      marqueeEndRef.current = null;
      opPointerId.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const target = e.target as HTMLCanvasElement;
    activePointers.current.set(e.pointerId, { type: e.pointerType, x: e.clientX, y: e.clientY });

    if (e.pointerType === 'pen') {
      penIsActive.current = true;
    }

    // Palm rejection: if a pen stroke is active and this is a touch, ignore.
    if (e.pointerType === 'touch' && penIsActive.current) {
      return;
    }

    // Two-finger gestures: enter pinch mode regardless of tool
    if (e.pointerType === 'touch' && activePointers.current.size >= 2) {
      // Cancel any in-progress drawing/dragging
      isDrawing.current = false;
      rawPoints.current = [];
      livePointsRef.current = [];
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      isDragging.current = false;
      isMarquee.current = false;

      const pts = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
      if (pts.length >= 2) {
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        lastPinchDist.current = Math.hypot(dx, dy);
        lastPointer.current = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      }
      return;
    }

    if (e.button === 1) {
      // Middle click = pan
      isPanning.current = true;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      target.setPointerCapture(e.pointerId);
      opPointerId.current = e.pointerId;
      return;
    }

    if (e.button !== 0) return;

    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    lastPointer.current = { x: e.clientX, y: e.clientY };
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    opPointerId.current = e.pointerId;

    if (tool === 'hand' || isSpaceDown.current) {
      isPanning.current = true;
      callbacksRef.current.onPanStart?.();
      return;
    }

    if (tool === 'pen') {
      isDrawing.current = true;
      const p = e.pointerType === 'mouse' ? 0.5 : (e.pressure || 0.5);
      const pt: Point = { x: world.x, y: world.y, p };
      rawPoints.current = [pt];
      livePointsRef.current = [pt];
      callbacksRef.current.onStrokeStart?.(world.x, world.y);
      return;
    }

    if (tool === 'rect' || tool === 'circle') {
      isDrawing.current = true;
      shapeStartRef.current = { x: world.x, y: world.y };
      shapeEndRef.current = { x: world.x, y: world.y };
      callbacksRef.current.onShapeStart?.(world.x, world.y);
      return;
    }

    if (tool === 'select') {
      // Set drag/marquee state BEFORE invoking the select callback so that the
      // callback (which may call beginMarquee) sees the right state.
      isDragging.current = true;
      marqueeStartRef.current = { x: world.x, y: world.y };
      marqueeEndRef.current = { x: world.x, y: world.y };
      const additive = e.shiftKey;
      callbacksRef.current.onSelect?.(world.x, world.y, additive, e.clientX, e.clientY);
      callbacksRef.current.onDragStart?.(world.x, world.y);
      return;
    }

    if (tool === 'eraser') {
      callbacksRef.current.onErase?.(world.x, world.y);
      return;
    }

    if (tool === 'text') {
      callbacksRef.current.onTextCreate?.(world.x, world.y, e.clientX, e.clientY);
      return;
    }
  }, [getTool, getViewport]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const known = activePointers.current.get(e.pointerId);
    if (known) {
      known.x = e.clientX;
      known.y = e.clientY;
    } else {
      // Hover, no down — track movement for eraser hover etc.
    }

    // Two-finger pinch
    if (e.pointerType === 'touch' && activePointers.current.size >= 2) {
      const pts = Array.from(activePointers.current.values()).filter(p => p.type === 'touch');
      if (pts.length >= 2) {
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

        // Pan by midpoint delta
        const panDx = cx - lastPointer.current.x;
        const panDy = cy - lastPointer.current.y;

        const viewport = getViewport();
        let vp = { ...viewport, x: viewport.x + panDx, y: viewport.y + panDy };

        // Zoom by distance delta
        if (lastPinchDist.current > 0) {
          const delta = newDist - lastPinchDist.current;
          if (Math.abs(delta) > 0.5) {
            vp = zoomAt(vp, cx, cy, delta * 2);
          }
        }
        setViewport(vp);
        callbacksRef.current.onZoom?.(vp);

        lastPinchDist.current = newDist;
        lastPointer.current = { x: cx, y: cy };
      }
      return;
    }

    if (e.pointerType === 'touch' && penIsActive.current) {
      return; // palm rejection
    }

    // Only react to the pointer that owns the current operation
    if (opPointerId.current !== null && e.pointerId !== opPointerId.current && (isPanning.current || isDrawing.current || isDragging.current || isMarquee.current)) {
      return;
    }

    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    if (isPanning.current) {
      const vp = getViewport();
      const newVp = { ...vp, x: vp.x + dx, y: vp.y + dy };
      setViewport(newVp);
      callbacksRef.current.onPan?.(dx, dy);
      return;
    }

    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    if (isDrawing.current) {
      if (tool === 'pen') {
        const p = e.pointerType === 'mouse' ? 0.5 : (e.pressure || 0.5);
        rawPoints.current.push({ x: world.x, y: world.y, p });
        livePointsRef.current = rawPoints.current.slice();
        callbacksRef.current.onStrokeMove?.(world.x, world.y);
      } else if (tool === 'rect' || tool === 'circle') {
        shapeEndRef.current = { x: world.x, y: world.y };
        callbacksRef.current.onShapeMove?.(world.x, world.y);
      }
      return;
    }

    if (isMarquee.current) {
      marqueeEndRef.current = { x: world.x, y: world.y };
      const s = marqueeStartRef.current;
      if (s) callbacksRef.current.onMarqueeMove?.(s.x, s.y, world.x, world.y);
      return;
    }

    if (isDragging.current && tool === 'select') {
      const worldDx = dx / viewport.scale;
      const worldDy = dy / viewport.scale;
      callbacksRef.current.onDragMove?.(worldDx, worldDy);
      return;
    }

    if (tool === 'eraser' && e.buttons === 1) {
      callbacksRef.current.onErase?.(world.x, world.y);
    }
  }, [getTool, getViewport, setViewport]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasMyPointer = opPointerId.current === e.pointerId;
    activePointers.current.delete(e.pointerId);

    if (e.pointerType === 'pen') {
      penIsActive.current = false;
    }

    // If a pinch was happening but a finger lifted, exit pinch mode but keep tracking
    if (activePointers.current.size === 1 && lastPinchDist.current > 0) {
      lastPinchDist.current = 0;
      // sync lastPointer to remaining pointer
      const remaining = Array.from(activePointers.current.values())[0];
      if (remaining) lastPointer.current = { x: remaining.x, y: remaining.y };
      return;
    }

    if (!wasMyPointer && (isPanning.current || isDrawing.current || isDragging.current || isMarquee.current)) {
      return;
    }

    const tool = getTool();
    const viewport = getViewport();
    const world = screenToWorld(e.clientX, e.clientY, viewport);

    if (isPanning.current) {
      isPanning.current = false;
      callbacksRef.current.onPanEnd?.();
      opPointerId.current = null;
      return;
    }

    if (isMarquee.current) {
      const s = marqueeStartRef.current;
      const en = marqueeEndRef.current ?? { x: world.x, y: world.y };
      if (s) callbacksRef.current.onMarqueeEnd?.(s.x, s.y, en.x, en.y);
      isMarquee.current = false;
      marqueeStartRef.current = null;
      marqueeEndRef.current = null;
      opPointerId.current = null;
      return;
    }

    if (isDragging.current) {
      isDragging.current = false;
      callbacksRef.current.onDragEnd?.();
      // also clear marquee start (it was only speculative)
      marqueeStartRef.current = null;
      marqueeEndRef.current = null;
    }

    if (isDrawing.current) {
      isDrawing.current = false;
      if (tool === 'pen') {
        finishStroke();
      } else if ((tool === 'rect' || tool === 'circle') && shapeStartRef.current) {
        const start = shapeStartRef.current;
        callbacksRef.current.onShapeEnd?.(start.x, start.y, world.x, world.y);
        shapeStartRef.current = null;
        shapeEndRef.current = null;
      }
      opPointerId.current = null;
      return;
    }

    opPointerId.current = null;

    // Double click / double tap detection
    const now = Date.now();
    const dist = Math.hypot(e.clientX - lastClickPos.current.x, e.clientY - lastClickPos.current.y);
    if (now - lastClickTime.current < 400 && dist < 16) {
      callbacksRef.current.onDoubleClick?.(world.x, world.y);
      lastClickTime.current = 0;
    } else {
      lastClickTime.current = now;
      lastClickPos.current = { x: e.clientX, y: e.clientY };
    }
  }, [getTool, getViewport, finishStroke]);

  const handlePointerCancel = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    activePointers.current.delete(e.pointerId);
    if (opPointerId.current === e.pointerId) {
      isPanning.current = false;
      isDrawing.current = false;
      isDragging.current = false;
      isMarquee.current = false;
      rawPoints.current = [];
      livePointsRef.current = [];
      shapeStartRef.current = null;
      shapeEndRef.current = null;
      marqueeStartRef.current = null;
      marqueeEndRef.current = null;
      opPointerId.current = null;
    }
    if (e.pointerType === 'pen') {
      penIsActive.current = false;
    }
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const viewport = getViewport();
    const delta = -e.deltaY;
    const newViewport = zoomAt(viewport, e.clientX, e.clientY, delta);
    setViewport(newViewport);
    callbacksRef.current.onZoom?.(newViewport);
  }, [getViewport, setViewport]);

  const getLivePoints = useCallback(() => livePointsRef.current, []);
  const getShapeStart = useCallback(() => shapeStartRef.current, []);
  const getShapeEnd = useCallback(() => shapeEndRef.current, []);
  const getMarqueeStart = useCallback(() => marqueeStartRef.current, []);
  const getMarqueeEnd = useCallback(() => marqueeEndRef.current, []);

  // Switches the current select-drag operation into a marquee selection.
  // Called by the canvas when no node was hit on pointerdown.
  const beginMarquee = useCallback(() => {
    if (!isDragging.current) return;
    isMarquee.current = true;
    isDragging.current = false;
    if (marqueeStartRef.current) {
      callbacksRef.current.onMarqueeStart?.(marqueeStartRef.current.x, marqueeStartRef.current.y);
    }
  }, [callbacks]);

  return {
    setSpaceDown,
    cancelStroke,
    beginMarquee,
    getLivePoints,
    getShapeStart,
    getShapeEnd,
    getMarqueeStart,
    getMarqueeEnd,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onPointerLeave: handlePointerCancel,
      onWheel: handleWheel,
    },
  };
}
