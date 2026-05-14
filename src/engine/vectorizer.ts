import { VectorPath } from '../types/scene';
import { generateId } from './scene-graph';

export interface VectorizerOptions {
  threshold?: number;   // 0-255, default 128
  simplify?: number;    // path simplification tolerance, default 2
  color?: string;       // output color, default '#1a1a2e'
}

export interface VectorizeResult {
  paths: VectorPath[];
  tracedWidth: number;
  tracedHeight: number;
}

export async function vectorizeImage(
  imageData: string,
  options: VectorizerOptions = {}
): Promise<VectorizeResult> {
  const { threshold = 128, simplify = 2, color = '#1a1a2e' } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxSize = 512;
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // Downscale large images for performance
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);

        const imagePixels = ctx.getImageData(0, 0, w, h);
        const paths = tracePaths(imagePixels, threshold, simplify, color);
        resolve({ paths, tracedWidth: w, tracedHeight: h });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = imageData;
  });
}

function toBinaryGrid(imagePixels: ImageData, threshold: number): Uint8Array {
  const { width, height, data } = imagePixels;
  const grid = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];

    // Grayscale using luminance weights
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // If alpha is low, treat as white (background)
    const effective = a < 128 ? 255 : gray;
    grid[i] = effective < threshold ? 1 : 0;
  }

  return grid;
}

function getEdgeGrid(binary: Uint8Array, width: number, height: number): Uint8Array {
  const edges = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!binary[idx]) continue;

      // Check if any neighbor is 0 (background) — if so, this is an edge
      const neighbors = [
        x > 0 ? binary[idx - 1] : 0,
        x < width - 1 ? binary[idx + 1] : 0,
        y > 0 ? binary[idx - width] : 0,
        y < height - 1 ? binary[idx + width] : 0,
      ];

      if (neighbors.some((n) => n === 0)) {
        edges[idx] = 1;
      }
    }
  }

  return edges;
}

interface Point {
  x: number;
  y: number;
}

function traceContour(
  edges: Uint8Array,
  visited: Uint8Array,
  startX: number,
  startY: number,
  width: number,
  height: number
): Point[] {
  const points: Point[] = [];
  const dirs = [
    [1, 0], [1, 1], [0, 1], [-1, 1],
    [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  let x = startX;
  let y = startY;
  let dir = 0;

  const maxSteps = width * height;
  let steps = 0;

  while (steps < maxSteps) {
    const idx = y * width + x;
    if (visited[idx]) break;
    visited[idx] = 1;
    points.push({ x, y });

    // Find next edge pixel
    let found = false;
    for (let d = 0; d < 8; d++) {
      const nd = (dir + d) % 8;
      const nx = x + dirs[nd][0];
      const ny = y + dirs[nd][1];

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nidx = ny * width + nx;
        if (edges[nidx] && !visited[nidx]) {
          x = nx;
          y = ny;
          dir = (nd + 5) % 8; // turn back slightly for next search
          found = true;
          break;
        }
      }
    }

    if (!found) break;
    steps++;
  }

  return points;
}

function rdpSimplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const start = points[0];
  const end = points[points.length - 1];
  const lineLen = Math.hypot(end.x - start.x, end.y - start.y);

  for (let i = 1; i < points.length - 1; i++) {
    let dist: number;
    if (lineLen === 0) {
      dist = Math.hypot(points[i].x - start.x, points[i].y - start.y);
    } else {
      const t = ((points[i].x - start.x) * (end.x - start.x) + (points[i].y - start.y) * (end.y - start.y)) / (lineLen * lineLen);
      const projX = start.x + t * (end.x - start.x);
      const projY = start.y + t * (end.y - start.y);
      dist = Math.hypot(points[i].x - projX, points[i].y - projY);
    }

    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = rdpSimplify(points.slice(0, maxIdx + 1), tolerance);
    const right = rdpSimplify(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function pointsToSvgPath(points: Point[]): string {
  if (points.length < 2) return '';

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  if (points.length < 4) {
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`;
    }
    return d;
  }

  // Catmull-Rom to cubic bezier conversion
  for (let i = 1; i < points.length - 2; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  d += ' Z';
  return d;
}

function tracePaths(
  imagePixels: ImageData,
  threshold: number,
  simplify: number,
  color: string
): VectorPath[] {
  const { width, height } = imagePixels;
  const binary = toBinaryGrid(imagePixels, threshold);
  const edges = getEdgeGrid(binary, width, height);
  const visited = new Uint8Array(width * height);
  const paths: VectorPath[] = [];

  const minPoints = 5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!edges[idx] || visited[idx]) continue;

      const contour = traceContour(edges, visited, x, y, width, height);

      if (contour.length < minPoints) continue;

      // Simplify
      const simplified = rdpSimplify(contour, simplify);

      if (simplified.length < 2) continue;

      const d = pointsToSvgPath(simplified);
      if (!d) continue;

      paths.push({
        id: generateId(),
        d,
        stroke: color,
        strokeWidth: 1,
        fill: color,
        opacity: 1,
      });
    }
  }

  return paths;
}
