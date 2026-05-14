import { Scene, SceneNode, Viewport, VectorPath } from '../types/scene';

export interface RenderOptions {
  highlightSelected?: string;
  showGrid?: boolean;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  viewport: Viewport,
  options: RenderOptions = {}
): void {
  const { highlightSelected, showGrid = true } = options;
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
    drawNode(ctx, node, highlightSelected);
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
  selectedId?: string
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

    case 'group':
      // Groups render their bounding box
      drawGroupOutline(ctx, node);
      break;
  }

  // Draw inner scene preview (thumbnail)
  if (node.innerScene && node.innerScene.nodes.length > 0) {
    drawInnerScenePreview(ctx, node);
  }

  // Selection highlight
  if (selectedId === node.id) {
    drawSelectionHandles(ctx, node);
  }

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

const imageCache = new Map<string, HTMLImageElement>();

function drawImage(ctx: CanvasRenderingContext2D, node: SceneNode): void {
  if (!node.imageData) return;

  let img = imageCache.get(node.imageData);
  if (!img) {
    img = new Image();
    img.src = node.imageData;
    imageCache.set(node.imageData, img);
  }

  if (img.complete && img.naturalWidth > 0) {
    ctx.drawImage(img, node.x, node.y, node.width, node.height);
  } else {
    // Draw placeholder while loading
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(node.x, node.y, node.width, node.height);
    img.onload = () => {
      // The rAF loop will repaint
    };
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
  points: { x: number; y: number }[],
  stroke: string,
  strokeWidth: number,
  viewport: Viewport
): void {
  if (points.length < 2) return;

  ctx.save();
  ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.8;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
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
