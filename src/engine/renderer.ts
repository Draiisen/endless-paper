import { Scene, SceneNode, Viewport, VectorPath } from '../types/scene';
import { LRUImageCache } from './image-cache';

export interface RenderOptions {
  highlightSelected?: string | Set<string>;
  showGrid?: boolean;
  selectionRect?: { x: number; y: number; width: number; height: number } | null;
  enterHintNodeId?: string | null;
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
  const { highlightSelected, showGrid = true, selectionRect, enterHintNodeId } = options;
  const canvas = ctx.canvas;
  const { width, height } = canvas;

  // Clear
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // Apply viewport transform
  ctx.save();
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);

  // Draw grid
  if (showGrid) {
    drawGrid(ctx, viewport, width, height);
  }

  // Draw nodes
  for (const node of scene.nodes) {
    drawNode(ctx, node, highlightSelected, enterHintNodeId === node.id);
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

  ctx.restore();

  // Marquee selection rectangle (drawn in screen space)
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

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number
): void {
  const scale = viewport.scale;

  // Determine grid spacing based on zoom level
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

  // Vertical lines
  for (let x = startX; x <= worldRight; x += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, worldTop);
    ctx.lineTo(x, worldBottom);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = startY; y <= worldBottom; y += gridSpacing) {
    ctx.beginPath();
    ctx.moveTo(worldLeft, y);
    ctx.lineTo(worldRight, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: SceneNode,
  selected?: string | Set<string>,
  showEnterHint = false
): void {
  ctx.save();

  switch (node.type) {
    case 'path':
      if (node.path) {
        drawVectorPath(ctx, node.path);
      }
      break;

    case 'image':
      if (node.isVectorized && node.vectorPaths && node.vectorPaths.length > 0) {
        for (const vp of node.vectorPaths) {
          drawVectorPath(ctx, vp);
        }
      } else if (node.imageData) {
        drawImage(ctx, node);
      }
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

  // Draw inner scene preview (thumbnail)
  if (node.innerScene && node.innerScene.nodes.length > 0) {
    drawInnerScenePreview(ctx, node);
  }

  if (showEnterHint) {
    drawEnterHint(ctx, node);
  }

  // Selection highlight (only show full handles for single selection)
  if (isSelected(selected, node.id)) {
    if (selected instanceof Set && selected.size > 1) {
      drawMemberHighlight(ctx, node);
    } else {
      drawSelectionHandles(ctx, node);
    }
  }

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
  const path2d = new Path2D(vp.d);
  ctx.globalAlpha = vp.opacity;

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

  ctx.globalAlpha = 1;
}

export const imageCache = new LRUImageCache(50);

function drawImage(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  if (!node.imageData) return;

  const img = imageCache.get(node.imageData);

  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, node.x, node.y, node.width, node.height);
  } else {
    // Draw placeholder while loading
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
  // Draw a subtle "zoom in" indicator
  ctx.save();
  ctx.strokeStyle = 'rgba(74, 144, 217, 0.3)';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(node.x, node.y, node.width, node.height);
  ctx.setLineDash([]);

  // Double-click hint icon in corner
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

  // Dashed border
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Corner handles
  const handleSize = 8;
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
    [x + w / 2, y],
    [x + w / 2, y + h],
    [x, y + h / 2],
    [x + w, y + h / 2],
  ];

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 1.5;

  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
  }
}

// Draw a live stroke being drawn (before it's committed)
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
    // Vary line width per segment using pressure
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
      // Quadratic bezier through midpoints for smoother live preview
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

// Draw a live shape (rect/circle) being drawn
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
