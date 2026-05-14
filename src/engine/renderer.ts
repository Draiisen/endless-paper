import { Scene, SceneNode, Viewport, VectorPath, Layer } from '../types/scene';
import { LRUImageCache } from './image-cache';
import { samplePath, pointAtLength, totalPathLength } from './svg-path';

// Path2D LRU cache — avoids recreating Path2D objects every frame
const path2dCache = new Map<string, Path2D>();
function getPath2D(d: string): Path2D {
  let p = path2dCache.get(d);
  if (!p) {
    p = new Path2D(d);
    path2dCache.set(d, p);
    if (path2dCache.size > 500) {
      const keys = Array.from(path2dCache.keys()).slice(0, 100);
      for (const k of keys) path2dCache.delete(k);
    }
  }
  return p;
}

export interface RenderOptions {
  highlightSelected?: string | Set<string>;
  showGrid?: boolean;
  selectionRect?: { x: number; y: number; width: number; height: number } | null;
  enterHintNodeId?: string | null;
  showReference?: boolean;
  // For drawing the start-camera pin in world space
  startCameraPin?: { x: number; y: number } | null;
  // Symmetry center (world coords) — drawn as crosshair
  symmetryCenter?: { x: number; y: number } | null;
  // For path edit mode
  pathEditNodeId?: string | null;
  pathEditAnchors?: { x: number; y: number; inX?: number; inY?: number; outX?: number; outY?: number; moveTo?: boolean }[];
  // Animation time tick (ms). When > 0 the renderer applies focus animations.
  animationTime?: number;
  // Marks viewer (presentation) mode — hides editor chrome (enter hints, hotspot badges, portal markers, etc are drawn differently)
  viewerMode?: boolean;
}

function isNodeVisible(node: SceneNode, worldLeft: number, worldTop: number, worldRight: number, worldBottom: number): boolean {
  return node.x < worldRight && node.x + node.width > worldLeft &&
         node.y < worldBottom && node.y + node.height > worldTop;
}

function isSelected(highlight: string | Set<string> | undefined, id: string): boolean {
  if (!highlight) return false;
  if (typeof highlight === 'string') return highlight === id;
  return highlight.has(id);
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  viewport: Viewport,
  options: RenderOptions = {}
): void {
  const { highlightSelected, showGrid = true, selectionRect, enterHintNodeId, showReference = true, startCameraPin, symmetryCenter, pathEditNodeId, pathEditAnchors, animationTime = 0, viewerMode = false } = options;
  const canvas = ctx.canvas;
  const { width, height } = canvas;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.save();
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);

  // Compute world bounds for culling
  const worldLeft = (-viewport.x) / viewport.scale;
  const worldTop = (-viewport.y) / viewport.scale;
  const worldRight = (width - viewport.x) / viewport.scale;
  const worldBottom = (height - viewport.y) / viewport.scale;

  if (showGrid) {
    drawGrid(ctx, viewport, width, height);
  }

  // Build per-layer ordering. If no layers, treat as one default layer order = node insertion.
  const layers: Layer[] = scene.layers && scene.layers.length > 0
    ? scene.layers
    : [{ id: '__default', name: 'Default', visible: true, locked: false, opacity: 1 }];

  // Group nodes by layer, preserving insertion order
  const nodesByLayer = new Map<string, SceneNode[]>();
  for (const layer of layers) nodesByLayer.set(layer.id, []);
  const orphanNodes: SceneNode[] = [];
  for (const n of scene.nodes) {
    const lid = n.layerId ?? layers[0].id;
    const arr = nodesByLayer.get(lid);
    if (arr) arr.push(n);
    else orphanNodes.push(n);
  }
  if (orphanNodes.length > 0) {
    nodesByLayer.set(layers[0].id, [...(nodesByLayer.get(layers[0].id) ?? []), ...orphanNodes]);
  }

  // Reference nodes always render first (under everything), regardless of layer order
  if (showReference) {
    for (const layer of layers) {
      if (!layer.visible) continue;
      const arr = nodesByLayer.get(layer.id) ?? [];
      for (const node of arr) {
        if (!node.isReference) continue;
        if (!isNodeVisible(node, worldLeft, worldTop, worldRight, worldBottom)) continue;
        ctx.globalAlpha = layer.opacity * 0.35;
        drawNode(ctx, node, highlightSelected, false, animationTime, viewport.scale, viewerMode);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Draw layers in order — bottom (index 0) drawn first, top last.
  for (const layer of layers) {
    if (!layer.visible) continue;
    const arr = nodesByLayer.get(layer.id) ?? [];
    if (layer.opacity < 0.999) ctx.globalAlpha = layer.opacity;
    for (const node of arr) {
      if (node.isReference) continue;
      if (!isNodeVisible(node, worldLeft, worldTop, worldRight, worldBottom)) continue;
      drawNode(ctx, node, highlightSelected, enterHintNodeId === node.id, animationTime, viewport.scale, viewerMode);
    }
    ctx.globalAlpha = 1;
  }

  // Selection bounding box (union of all selected) drawn once at the end
  if (highlightSelected instanceof Set && highlightSelected.size > 1) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of scene.nodes) {
      if (highlightSelected.has(n.id)) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.width);
        maxY = Math.max(maxY, n.y + n.height);
      }
    }
    if (isFinite(minX)) {
      drawSelectionRectOutline(ctx, minX, minY, maxX - minX, maxY - minY);
    }
  }

  // Start-camera pin
  if (startCameraPin && !viewerMode) {
    drawStartPin(ctx, startCameraPin.x, startCameraPin.y, viewport.scale);
  }

  // Symmetry crosshair
  if (symmetryCenter) {
    drawSymmetryCenter(ctx, symmetryCenter.x, symmetryCenter.y, viewport.scale);
  }

  // Bezier path edit overlay
  if (pathEditNodeId && pathEditAnchors && pathEditAnchors.length > 0) {
    drawPathEditAnchors(ctx, pathEditAnchors, viewport.scale);
  }

  ctx.restore();

  if (selectionRect) {
    ctx.save();
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
    ctx.strokeStyle = '#4a90d9';
    ctx.lineWidth = 1 / viewport.scale;
    ctx.fillStyle = 'rgba(74, 144, 217, 0.08)';
    ctx.setLineDash([6 / viewport.scale, 4 / viewport.scale]);
    ctx.fillRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
    ctx.strokeRect(selectionRect.x, selectionRect.y, selectionRect.width, selectionRect.height);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawSelectionRectOutline(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  ctx.save();
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x - 6, y - 6, w + 12, h + 12);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawStartPin(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  const r = 14 / scale;
  ctx.strokeStyle = '#e63946';
  ctx.fillStyle = 'rgba(230, 57, 70, 0.18)';
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSymmetryCenter(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save();
  const r = 12 / scale;
  ctx.strokeStyle = 'rgba(230, 57, 70, 0.7)';
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.beginPath();
  ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPathEditAnchors(
  ctx: CanvasRenderingContext2D,
  anchors: { x: number; y: number; inX?: number; inY?: number; outX?: number; outY?: number; moveTo?: boolean }[],
  scale: number,
): void {
  ctx.save();
  const handleR = 4 / scale;
  const anchorR = 5 / scale;
  ctx.lineWidth = 1 / scale;

  // Handles first
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.6)';
  for (const a of anchors) {
    if (a.inX !== undefined && a.inY !== undefined) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.inX, a.inY); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.inX, a.inY, handleR, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
    }
    if (a.outX !== undefined && a.outY !== undefined) {
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.outX, a.outY); ctx.stroke();
      ctx.beginPath(); ctx.arc(a.outX, a.outY, handleR, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.stroke();
    }
  }

  // Anchors
  ctx.strokeStyle = '#4a90d9';
  ctx.fillStyle = '#ffffff';
  for (const a of anchors) {
    ctx.fillRect(a.x - anchorR, a.y - anchorR, anchorR * 2, anchorR * 2);
    ctx.strokeRect(a.x - anchorR, a.y - anchorR, anchorR * 2, anchorR * 2);
  }
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): void {
  const scale = viewport.scale;

  let gridSpacing = 50;
  if (scale < 0.1) gridSpacing = 500;
  else if (scale < 0.5) gridSpacing = 200;
  else if (scale < 2) gridSpacing = 100;
  else if (scale > 10) gridSpacing = 20;

  const worldLeft = (-viewport.x) / scale;
  const worldTop = (-viewport.y) / scale;
  const worldRight = (canvasWidth - viewport.x) / scale;
  const worldBottom = (canvasHeight - viewport.y) / scale;

  const startX = Math.floor(worldLeft / gridSpacing) * gridSpacing;
  const startY = Math.floor(worldTop / gridSpacing) * gridSpacing;

  ctx.save();
  ctx.strokeStyle = 'rgba(26, 26, 46, 0.06)';
  ctx.lineWidth = 1 / scale;

  for (let x = startX; x <= worldRight; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
    ctx.stroke();
  }

  for (let y = startY; y <= worldBottom; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
    ctx.stroke();
  }

  ctx.restore();
}

function getAnimationTransform(
  node: SceneNode,
  animationTime: number,
  inFocus: boolean,
): { tx: number; ty: number; rot: number; scale: number; alpha: number } | null {
  if (!node.animation || !inFocus || animationTime <= 0) return null;
  const a = node.animation;
  const t = (animationTime / 1000) * (a.speed || 1) * Math.PI * 2;
  const sinT = Math.sin(t);
  switch (a.type) {
    case 'pulse':
      return { tx: 0, ty: 0, rot: 0, scale: 1 + a.intensity * 0.5 * (0.5 + 0.5 * sinT), alpha: 1 };
    case 'wobble':
      return { tx: 0, ty: 0, rot: a.intensity * (Math.PI / 180) * sinT, scale: 1, alpha: 1 };
    case 'float':
      return { tx: 0, ty: a.intensity * 8 * sinT, rot: 0, scale: 1, alpha: 1 };
    case 'fade':
      return { tx: 0, ty: 0, rot: 0, scale: 1, alpha: 1 - a.intensity * 0.5 * (0.5 + 0.5 * sinT) };
  }
  return null;
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  selected?: string | Set<string>,
  showEnterHint = false,
  animationTime = 0,
  viewportScale = 1,
  viewerMode = false,
): void {
  ctx.save();

  // Determine focus: node screen size > 30% of viewport min dim approximation.
  // We pass viewportScale; canvas size approximated via global var (not ideal). Use a heuristic threshold.
  const screenSize = Math.min(node.width, node.height) * viewportScale;
  const inFocus = screenSize > Math.min(window.innerWidth, window.innerHeight) * 0.30;

  const anim = getAnimationTransform(node, animationTime, inFocus);
  if (anim) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    ctx.translate(cx + anim.tx, cy + anim.ty);
    ctx.rotate(anim.rot);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = anim.alpha;
  }

  switch (node.type) {
    case 'path':
      if (node.path) {
        drawVectorPath(ctx, node.path);
      }
      break;

    case 'image':
      drawImageLOD(ctx, node, viewportScale);
      break;

    case 'rect':
      drawRect(ctx, node);
      break;

    case 'circle':
      drawCircle(ctx, node);
      break;

    case 'text':
      drawText(ctx, node);
      break;

    case 'group':
      drawGroupOutline(ctx, node);
      break;
  }

  // Text along path
  if (node.path && node.textAlongPath) {
    drawTextAlongPath(ctx, node.path, node.textAlongPath);
  }

  // Inner scene preview
  if (node.innerScene && node.innerScene.nodes.length > 0) {
    drawInnerScenePreview(ctx, node);
  }

  if (showEnterHint && !viewerMode) {
    drawEnterHint(ctx, node);
  }

  // Hotspot badge
  if (node.hotspot && !viewerMode) {
    drawHotspotBadge(ctx, node, viewportScale);
  }

  // Portal marker
  if (node.portal) {
    drawPortalOutline(ctx, node, viewportScale);
  }

  if (isSelected(selected, node.id)) {
    if (selected instanceof Set && selected.size > 1) {
      drawMemberHighlight(ctx, node);
    } else {
      drawSelectionHandles(ctx, node);
    }
  }

  ctx.restore();
}

function drawTextAlongPath(
  ctx: CanvasRenderingContext2D,
  path: VectorPath,
  tap: { text: string; fontSize: number; fontFamily: string; color: string },
): void {
  const samples = samplePath(path.d, 30);
  const total = totalPathLength(samples);
  if (total <= 0 || !tap.text) return;

  ctx.save();
  ctx.font = `${tap.fontSize}px ${tap.fontFamily || 'system-ui, sans-serif'}`;
  ctx.fillStyle = tap.color || '#1a1a2e';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // Compute total text length
  const widths = [];
  let textW = 0;
  for (const ch of tap.text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    textW += w;
  }
  if (textW > total) textW = total;
  let dist = (total - textW) / 2;
  if (dist < 0) dist = 0;

  for (let i = 0; i < tap.text.length; i++) {
    const ch = tap.text[i];
    const w = widths[i];
    const p = pointAtLength(samples, dist + w / 2);
    if (!p) break;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    dist += w;
    if (dist > total) break;
  }
  ctx.restore();
}

function drawHotspotBadge(ctx: CanvasRenderingContext2D, node: SceneNode, scale: number): void {
  ctx.save();
  const r = 7 / scale;
  const cx = node.x + node.width - r - 2 / scale;
  const cy = node.y + r + 2 / scale;
  ctx.fillStyle = '#4a90d9';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${10 / scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('i', cx, cy + 0.5 / scale);
  ctx.restore();
}

function drawPortalOutline(ctx: CanvasRenderingContext2D, node: SceneNode, scale: number): void {
  ctx.save();
  ctx.strokeStyle = '#9d4edd';
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.strokeRect(node.x - 2 / scale, node.y - 2 / scale, node.width + 4 / scale, node.height + 4 / scale);
  ctx.setLineDash([]);
  // Portal icon in top-left
  const r = 8 / scale;
  const cx = node.x + r + 2 / scale;
  const cy = node.y + r + 2 / scale;
  ctx.fillStyle = '#9d4edd';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `${11 / scale}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('↗', cx, cy);
  ctx.restore();
}

function drawMemberHighlight(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(node.x - 2, node.y - 2, node.width + 4, node.height + 4);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  if (!node.text) return;
  const fontSize = node.fontSize ?? 16;
  const fontFamily = node.fontFamily ?? 'system-ui, sans-serif';
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = node.color ?? '#1a1a2e';
  const lines = node.text.split('\n');
  const lineHeight = fontSize * 1.2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], node.x, node.y + i * lineHeight);
  }
}

function drawEnterHint(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.7)';
  ctx.fillStyle = 'rgba(74, 144, 217, 0.08)';
  ctx.lineWidth = 2;
  ctx.fillRect(node.x, node.y, node.width, node.height);
  ctx.strokeRect(node.x, node.y, node.width, node.height);
  const label = 'Enter →';
  const fontSize = Math.max(12, Math.min(24, Math.min(node.width, node.height) * 0.12));
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(74, 144, 217, 0.9)';
  ctx.fillText(label, node.x + node.width / 2, node.y + node.height / 2);
  ctx.restore();
}

function drawVectorPath(ctx: CanvasRenderingContext2D, vp: VectorPath): void {
  const path2d = getPath2D(vp.d);
  ctx.globalAlpha = (ctx.globalAlpha) * vp.opacity;

  if (vp.fill && vp.fill !== 'none') {
    ctx.fillStyle = vp.fill;
    ctx.fill(path2d);
  }

  if (vp.stroke && vp.stroke !== 'none') {
    ctx.strokeStyle = vp.stroke;
    ctx.lineWidth = vp.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path2d);
  }
}

export const imageCache = new LRUImageCache(50);

/**
 * LOD thresholds (in screen pixels, i.e. node.width * viewportScale):
 *   < 70px  → thumbnail (fast, low detail)
 *   70-350px → raster original  (faithful)
 *   > 350px  → color vectors if available (crisp at any zoom)
 * Legacy monochrome vectorPaths are used as a fallback when colorLayers not yet ready.
 */
function drawImageLOD(ctx: CanvasRenderingContext2D, node: SceneNode, viewportScale: number): void {
  const screenW = node.width * viewportScale;

  // ── High zoom: colour vectors ────────────────────────────────────────────
  if (screenW > 350 && node.lod?.colorLayers && node.lod.colorLayers.length > 0) {
    for (const layer of node.lod.colorLayers) {
      ctx.fillStyle = layer.color;
      for (const vp of layer.paths) {
        ctx.fill(getPath2D(vp.d));
      }
    }
    return;
  }

  // ── Low zoom: thumbnail ───────────────────────────────────────────────────
  if (screenW < 70 && node.lod?.thumbnail) {
    const img = imageCache.get(node.lod.thumbnail);
    if (img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, node.x, node.y, node.width, node.height);
      return;
    }
  }

  // ── Legacy monochrome vectorization (manual "Vectorize" button) ───────────
  if (node.isVectorized && node.vectorPaths && node.vectorPaths.length > 0) {
    for (const vp of node.vectorPaths) drawVectorPath(ctx, vp);
    return;
  }

  // ── Default: draw the original raster ────────────────────────────────────
  if (node.imageData) drawImage(ctx, node);
}

function drawImage(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  if (!node.imageData) return;

  const img = imageCache.get(node.imageData);

  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, node.x, node.y, node.width, node.height);
  } else {
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(node.x, node.y, node.width, node.height);
  }
}

function drawRect(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.beginPath();
  ctx.rect(node.x, node.y, node.width, node.height);

  if (node.fill && node.fill !== 'none') {
    ctx.fillStyle = node.fill;
    ctx.fill();
  }

  if (node.stroke && node.stroke !== 'none') {
    ctx.strokeStyle = node.stroke;
    ctx.lineWidth = node.strokeWidth ?? 2;
    ctx.stroke();
  }
}

function drawCircle(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const rx = node.width / 2;
  const ry = node.height / 2;

  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);

  if (node.fill && node.fill !== 'none') {
    ctx.fillStyle = node.fill;
    ctx.fill();
  }

  if (node.stroke && node.stroke !== 'none') {
    ctx.strokeStyle = node.stroke;
    ctx.lineWidth = node.strokeWidth ?? 2;
    ctx.stroke();
  }
}

function drawGroupOutline(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.5)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(node.x, node.y, node.width, node.height);
  ctx.setLineDash([]);
}

function drawInnerScenePreview(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(node.x, node.y, node.width, node.height);
  ctx.setLineDash([]);

  const iconSize = Math.min(16, node.width * 0.1, node.height * 0.1);
  if (iconSize > 4) {
    ctx.fillStyle = 'rgba(74, 144, 217, 0.5)';
    ctx.font = `${iconSize}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('⬡', node.x + node.width - 2, node.y + 2);
  }
  ctx.restore();
}

function drawSelectionHandles(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  const padding = 4;
  const x = node.x - padding;
  const y = node.y - padding;
  const w = node.width + padding * 2;
  const h = node.height + padding * 2;

  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  const handleSize = 8;
  const corners = [
    [x, y], [x + w, y], [x, y + h], [x + w, y + h],
    [x + w / 2, y], [x + w / 2, y + h],
    [x, y + h / 2], [x + w, y + h / 2],
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;

  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
  }
}

export function renderLiveStroke(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number; p?: number }[],
  stroke: string,
  strokeWidth: number,
  viewport: Viewport,
  pressureSensitive = false
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
  ctx.strokeStyle = stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;

  if (pressureSensitive) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const pa = a.p ?? 0.5;
      const pb = b.p ?? 0.5;
      const w = strokeWidth * ((pa + pb) / 2) * 2;
      ctx.lineWidth = Math.max(0.5, w);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  } else {
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const cx = points[i].x;
        const cy = points[i].y;
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(cx, cy, mx, my);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function renderLiveShape(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  shapeType: 'rect' | 'circle',
  stroke: string,
  fill: string,
  strokeWidth: number,
  viewport: Viewport
): void {
  ctx.save();
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill !== 'none' ? fill : 'transparent';
  ctx.lineWidth = strokeWidth;
  ctx.globalAlpha = 0.7;

  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  if (shapeType === 'rect') {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    if (fill !== 'none') ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (fill !== 'none') ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

// Render a single node into a fresh offscreen context — used for asset thumbnails.
export function renderNodesToDataUrl(nodes: SceneNode[], maxDim = 128, padding = 8, background = 'transparent'): string {
  if (nodes.length === 0) return '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const scale = Math.min((maxDim - padding * 2) / w, (maxDim - padding * 2) / h);
  const cw = Math.max(8, Math.round(w * scale + padding * 2));
  const ch = Math.max(8, Math.round(h * scale + padding * 2));

  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  if (background !== 'transparent') {
    ctx.fillStyle = background; ctx.fillRect(0, 0, cw, ch);
  }
  ctx.translate(padding - minX * scale, padding - minY * scale);
  ctx.scale(scale, scale);
  for (const n of nodes) {
    drawNode(ctx, n, undefined, false, 0, 1, true);
  }
  return canvas.toDataURL('image/png');
}
