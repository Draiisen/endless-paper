/// <reference lib="webworker" />

export type {}; // make this a module so TS doesn't complain

interface WorkerInput {
  nodeId: string;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  numColors: number;
}

interface LayerData {
  r: number; g: number; b: number;
  paths: string[];
}

interface WorkerOutput {
  nodeId: string;
  layers: LayerData[];
  sourceW: number;
  sourceH: number;
}

// ── CIE LAB color space ───────────────────────────────────────────────────────
// Perceptually uniform: equal distances → equal perceived color differences.
// Using LAB for k-means gives far better color groupings than RGB.

type LAB = [number, number, number]; // L, a, b

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function rgbToLab(r: number, g: number, b: number): LAB {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  // sRGB D65 → XYZ
  const X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;
  // XYZ → LAB (D65 white point)
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDist2(a: LAB, b: LAB): number {
  return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
}

// ── K-means in LAB space ──────────────────────────────────────────────────────

function kMeans(
  data: Uint8ClampedArray,
  pixelCount: number,
  k: number,
  iterations = 16,
): { centroidsRgb: [number,number,number][]; assignments: Uint8Array } {
  // Build LAB sample (subsample for speed)
  type Sample = { lab: LAB; r: number; g: number; b: number };
  const sample: Sample[] = [];
  for (let i = 0; i < pixelCount; i += 4) {
    if (data[i * 4 + 3] >= 128) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      sample.push({ lab: rgbToLab(r, g, b), r, g, b });
    }
  }
  if (sample.length === 0) {
    return { centroidsRgb: [], assignments: new Uint8Array(pixelCount) };
  }

  // k-means++ initialisation in LAB space
  const centroids: LAB[] = [];
  centroids.push([...sample[Math.floor(Math.random() * sample.length)].lab] as LAB);
  while (centroids.length < Math.min(k, sample.length)) {
    let totalDist = 0;
    const dists = sample.map(s => {
      let minD = Infinity;
      for (const c of centroids) { const d = labDist2(s.lab, c); if (d < minD) minD = d; }
      totalDist += minD;
      return minD;
    });
    let r = Math.random() * totalDist, chosen = sample.length - 1;
    for (let i = 0; i < dists.length; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centroids.push([...sample[chosen].lab] as LAB);
  }

  // All-pixel LAB values (no subsampling for assignment)
  const allLab: LAB[] = new Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] >= 128) {
      allLab[i] = rgbToLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    } else {
      allLab[i] = [0, 0, 0];
    }
  }

  const assignments = new Uint8Array(pixelCount);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < pixelCount; i++) {
      if (data[i * 4 + 3] < 128) continue;
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = labDist2(allLab[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      assignments[i] = best;
    }
    // Recompute centroids in LAB
    const sums: Array<[number,number,number,number]> = centroids.map(() => [0,0,0,0]);
    for (let i = 0; i < pixelCount; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const c = assignments[i];
      sums[c][0] += allLab[i][0]; sums[c][1] += allLab[i][1];
      sums[c][2] += allLab[i][2]; sums[c][3]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [sums[c][0]/sums[c][3], sums[c][1]/sums[c][3], sums[c][2]/sums[c][3]];
      }
    }
  }

  // Convert centroids back to RGB for rendering
  const centroidsRgb: [number,number,number][] = centroids.map(() => [0,0,0]);
  const rgbAccum: Array<[number,number,number,number]> = centroids.map(() => [0,0,0,0]);
  for (let i = 0; i < pixelCount; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const c = assignments[i];
    rgbAccum[c][0] += data[i * 4]; rgbAccum[c][1] += data[i * 4 + 1];
    rgbAccum[c][2] += data[i * 4 + 2]; rgbAccum[c][3]++;
  }
  for (let c = 0; c < centroids.length; c++) {
    if (rgbAccum[c][3] > 0) {
      centroidsRgb[c] = [
        Math.round(rgbAccum[c][0] / rgbAccum[c][3]),
        Math.round(rgbAccum[c][1] / rgbAccum[c][3]),
        Math.round(rgbAccum[c][2] / rgbAccum[c][3]),
      ];
    }
  }

  return { centroidsRgb, assignments };
}

// ── Box blur (3 passes → Gaussian approximation) ──────────────────────────────
// Blurring the binary mask turns staircase pixel edges into smooth gradients.
// The isoline of the resulting float field is a smooth curve.

function smoothMask(mask: Uint8Array, w: number, h: number, radius = 2): Float32Array {
  let curr = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) curr[i] = mask[i];
  const temp = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx >= 0 && nx < w) { sum += curr[y * w + nx]; n++; }
        }
        temp[y * w + x] = sum / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny >= 0 && ny < h) { sum += temp[ny * w + x]; n++; }
        }
        curr[y * w + x] = sum / n;
      }
    }
  }
  return curr;
}

// ── Sub-pixel contour refinement ──────────────────────────────────────────────
// Each pixel-centre contour point is nudged towards the exact 0.5 isoline
// of the blurred field using the local gradient. This gives sub-pixel accuracy
// without requiring a full marching-squares implementation.

interface Pt { x: number; y: number }

function refinePoint(px: number, py: number, field: Float32Array, w: number, h: number): Pt {
  const x = Math.max(1, Math.min(w - 2, px));
  const y = Math.max(1, Math.min(h - 2, py));
  const v = field[y * w + x];
  const gx = (field[y * w + x + 1] - field[y * w + x - 1]) * 0.5;
  const gy = (field[(y + 1) * w + x] - field[(y - 1) * w + x]) * 0.5;
  const g2 = gx * gx + gy * gy;
  if (g2 < 1e-6) return { x: px, y: py };
  const t = (v - 0.5) / g2;
  return { x: px - gx * t, y: py - gy * t };
}

// ── Edge detection on float field ─────────────────────────────────────────────

function buildEdgeGrid(field: Float32Array, w: number, h: number): Uint8Array {
  // Threshold float field, then mark pixels whose neighbourhood crosses 0.5
  const edges = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (field[i] < 0.5) continue;
      if (
        (x === 0 || field[i - 1] < 0.5) ||
        (x === w - 1 || field[i + 1] < 0.5) ||
        (y === 0 || field[i - w] < 0.5) ||
        (y === h - 1 || field[i + w] < 0.5)
      ) {
        edges[i] = 1;
      }
    }
  }
  return edges;
}

// ── Contour following ─────────────────────────────────────────────────────────

const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

function traceContour(
  edges: Uint8Array, visited: Uint8Array,
  sx: number, sy: number, w: number, h: number,
): Pt[] {
  const pts: Pt[] = [];
  let x = sx, y = sy, dir = 0;
  const maxSteps = w * h;
  let steps = 0;
  while (steps++ < maxSteps) {
    const i = y * w + x;
    if (visited[i]) break;
    visited[i] = 1;
    pts.push({ x, y });
    let found = false;
    for (let d = 0; d < 8; d++) {
      const nd = (dir + d) % 8;
      const nx = x + DIRS[nd][0], ny = y + DIRS[nd][1];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const ni = ny * w + nx;
        if (edges[ni] && !visited[ni]) {
          x = nx; y = ny; dir = (nd + 5) % 8; found = true; break;
        }
      }
    }
    if (!found) break;
  }
  return pts;
}

// ── Ramer-Douglas-Peucker simplification ─────────────────────────────────────

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const s = pts[0], e = pts[pts.length - 1];
  const len2 = (e.x - s.x) ** 2 + (e.y - s.y) ** 2;
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    let d: number;
    if (len2 === 0) {
      d = Math.hypot(pts[i].x - s.x, pts[i].y - s.y);
    } else {
      const t = ((pts[i].x - s.x) * (e.x - s.x) + (pts[i].y - s.y) * (e.y - s.y)) / len2;
      d = Math.hypot(pts[i].x - s.x - t * (e.x - s.x), pts[i].y - s.y - t * (e.y - s.y));
    }
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD > tol) {
    return [...rdp(pts.slice(0, maxI + 1), tol).slice(0, -1), ...rdp(pts.slice(maxI), tol)];
  }
  return [s, e];
}

// ── Points → smooth SVG path (Catmull-Rom → cubic Bezier) ────────────────────

function ptsToPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  if (pts.length < 4) {
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(2)} ${pts[i].y.toFixed(2)}`;
    return d + ' Z';
  }
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i];
    const p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6, cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6, cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d + ' Z';
}

// ── Per-cluster tracing ───────────────────────────────────────────────────────

function traceCluster(
  mask: Uint8Array, w: number, h: number, tol: number,
): string[] {
  const field = smoothMask(mask, w, h, 2);
  const edges = buildEdgeGrid(field, w, h);
  const visited = new Uint8Array(w * h);
  const paths: string[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edges[i] || visited[i]) continue;
      const contour = traceContour(edges, visited, x, y, w, h);
      if (contour.length < 6) continue;

      // Refine each pixel-centre point to the exact sub-pixel isoline location
      const refined = contour.map(p => refinePoint(p.x, p.y, field, w, h));

      const simplified = rdp(refined, tol);
      if (simplified.length < 3) continue;
      const d = ptsToPath(simplified);
      if (d) paths.push(d);
    }
  }
  return paths;
}

// ── Count pixels per cluster ──────────────────────────────────────────────────

function countPixels(assignments: Uint8Array, clusterIdx: number, n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) if (assignments[i] === clusterIdx) count++;
  return count;
}

// ── Main processing ───────────────────────────────────────────────────────────

function process(data: Uint8ClampedArray, w: number, h: number, k: number): LayerData[] {
  const n = w * h;
  const { centroidsRgb, assignments } = kMeans(data, n, k);
  if (centroidsRgb.length === 0) return [];

  const minPixels = Math.max(15, n * 0.001); // keep details down to 0.1% of image
  // Fine tolerance: blur already smooths, so we can keep more geometry detail
  const simplifyTol = Math.max(0.5, Math.min(w, h) / 400);

  const layers: Array<LayerData & { pixelCount: number }> = [];

  for (let c = 0; c < centroidsRgb.length; c++) {
    const pixelCount = countPixels(assignments, c, n);
    if (pixelCount < minPixels) continue;

    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] >= 128 && assignments[i] === c) mask[i] = 1;
    }

    const paths = traceCluster(mask, w, h, simplifyTol);
    const trimmed = paths.slice(0, 150);
    if (trimmed.length === 0) continue;

    layers.push({ r: centroidsRgb[c][0], g: centroidsRgb[c][1], b: centroidsRgb[c][2], paths: trimmed, pixelCount });
  }

  layers.sort((a, b) => b.pixelCount - a.pixelCount);
  return layers.map(({ r, g, b, paths }) => ({ r, g, b, paths }));
}

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { nodeId, pixels, width, height, numColors } = e.data;
  try {
    const data = new Uint8ClampedArray(pixels);
    if (width < 1 || height < 1 || data.length < width * height * 4) {
      (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
      return;
    }
    const layers = process(data, width, height, numColors ?? 14);
    (self as unknown as Worker).postMessage({ nodeId, layers, sourceW: width, sourceH: height } as WorkerOutput);
  } catch {
    (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height } as WorkerOutput);
  }
};
