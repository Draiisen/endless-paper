/// <reference lib="webworker" />

export type {}; // make this a module so TS doesn't complain

// ── Message types ────────────────────────────────────────────────────────────

interface WorkerInput {
  nodeId: string;
  pixels: ArrayBuffer; // RGBA, row-major
  width: number;
  height: number;
  numColors: number;   // K for k-means (default 8)
}

interface LayerData {
  r: number; g: number; b: number;
  paths: string[]; // SVG path 'd' strings, in image-pixel coordinates
}

interface WorkerOutput {
  nodeId: string;
  layers: LayerData[];
  sourceW: number;
  sourceH: number;
}

// ── K-means ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

function kMeans(
  data: Uint8ClampedArray,
  pixelCount: number,
  k: number,
  iterations = 14,
): { centroids: RGB[]; assignments: Uint8Array } {
  // Collect opaque pixels (subsample every 3rd pixel for speed)
  const sample: RGB[] = [];
  for (let i = 0; i < pixelCount; i += 3) {
    if (data[i * 4 + 3] >= 128) {
      sample.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
  }
  if (sample.length === 0) {
    return { centroids: [], assignments: new Uint8Array(pixelCount) };
  }

  // k-means++ initialisation: spread centroids across color space for better coverage
  const centroids: RGB[] = [];
  centroids.push([...sample[Math.floor(Math.random() * sample.length)]] as RGB);
  while (centroids.length < Math.min(k, sample.length)) {
    let totalDist = 0;
    const dists = sample.map(p => {
      let minD = Infinity;
      for (const c of centroids) {
        const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2;
        if (d < minD) minD = d;
      }
      totalDist += minD;
      return minD;
    });
    let r = Math.random() * totalDist;
    let chosen = sample.length - 1;
    for (let i = 0; i < dists.length; i++) { r -= dists[i]; if (r <= 0) { chosen = i; break; } }
    centroids.push([...sample[chosen]] as RGB);
  }

  const assignments = new Uint8Array(pixelCount);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign all opaque pixels to nearest centroid
    for (let i = 0; i < pixelCount; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dr = r - centroids[c][0];
        const dg = g - centroids[c][1];
        const db = b - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; best = c; }
      }
      assignments[i] = best;
    }

    // Recompute centroids
    const sums: Array<[number, number, number, number]> = centroids.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pixelCount; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const c = assignments[i];
      sums[c][0] += data[i * 4];
      sums[c][1] += data[i * 4 + 1];
      sums[c][2] += data[i * 4 + 2];
      sums[c][3]++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [
          Math.round(sums[c][0] / sums[c][3]),
          Math.round(sums[c][1] / sums[c][3]),
          Math.round(sums[c][2] / sums[c][3]),
        ];
      }
    }
  }

  return { centroids, assignments };
}

// ── Edge detection ────────────────────────────────────────────────────────────

function buildEdgeGrid(mask: Uint8Array, w: number, h: number): Uint8Array {
  const edges = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // Mark as edge if any 4-neighbour is background
      if (
        (x === 0 || !mask[i - 1]) ||
        (x === w - 1 || !mask[i + 1]) ||
        (y === 0 || !mask[i - w]) ||
        (y === h - 1 || !mask[i + w])
      ) {
        edges[i] = 1;
      }
    }
  }
  return edges;
}

// ── Contour following ─────────────────────────────────────────────────────────

interface Pt { x: number; y: number }

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
          x = nx; y = ny;
          dir = (nd + 5) % 8;
          found = true;
          break;
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
    const l = rdp(pts.slice(0, maxI + 1), tol);
    const r = rdp(pts.slice(maxI), tol);
    return [...l.slice(0, -1), ...r];
  }
  return [s, e];
}

// ── Points → smooth SVG path ──────────────────────────────────────────────────

function ptsToPath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length < 4) {
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
    return d + ' Z';
  }
  // Catmull-Rom → cubic bezier
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d + ' Z';
}

// ── Per-cluster tracing ───────────────────────────────────────────────────────

function traceCluster(
  mask: Uint8Array, w: number, h: number, tol: number,
): string[] {
  const edges = buildEdgeGrid(mask, w, h);
  const visited = new Uint8Array(w * h);
  const paths: string[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edges[i] || visited[i]) continue;
      const contour = traceContour(edges, visited, x, y, w, h);
      if (contour.length < 6) continue;
      const simplified = rdp(contour, tol);
      if (simplified.length < 3) continue;
      const d = ptsToPath(simplified);
      if (d) paths.push(d);
    }
  }
  return paths;
}

// ── Dilate mask to reduce gaps at boundaries ──────────────────────────────────

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] ||
        (x > 0 && mask[i - 1]) ||
        (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) ||
        (y < h - 1 && mask[i + w])) {
        out[i] = 1;
      }
    }
  }
  return out;
}

// ── Count pixels per cluster ──────────────────────────────────────────────────

function countPixels(assignments: Uint8Array, clusterIdx: number, pixelCount: number): number {
  let n = 0;
  for (let i = 0; i < pixelCount; i++) if (assignments[i] === clusterIdx) n++;
  return n;
}

// ── Main processing ───────────────────────────────────────────────────────────

function process(
  data: Uint8ClampedArray,
  w: number, h: number,
  k: number,
): LayerData[] {
  const n = w * h;
  const { centroids, assignments } = kMeans(data, n, k);
  if (centroids.length === 0) return [];

  const minPixels = Math.max(50, n * 0.005); // skip tiny clusters (< 0.5% of image)
  const simplifyTol = Math.max(1.5, Math.min(w, h) / 100);

  const layers: LayerData[] = [];

  for (let c = 0; c < centroids.length; c++) {
    if (countPixels(assignments, c, n) < minPixels) continue;

    // Build mask for this cluster
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] >= 128 && assignments[i] === c) mask[i] = 1;
    }

    // Dilate once to fill single-pixel gaps
    const dilated = dilate(mask, w, h);
    const paths = traceCluster(dilated, w, h, simplifyTol);

    // Limit paths per cluster to avoid huge SVG
    const trimmed = paths.slice(0, 80);
    if (trimmed.length === 0) continue;

    layers.push({ r: centroids[c][0], g: centroids[c][1], b: centroids[c][2], paths: trimmed });
  }

  // Sort: largest area first (background-like colors behind)
  layers.sort((a, b) => b.paths.length - a.paths.length);

  return layers;
}

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { nodeId, pixels, width, height, numColors } = e.data;
  try {
    const data = new Uint8ClampedArray(pixels);
    const layers = process(data, width, height, numColors ?? 8);
    const output: WorkerOutput = { nodeId, layers, sourceW: width, sourceH: height };
    (self as unknown as Worker).postMessage(output);
  } catch {
    const output: WorkerOutput = { nodeId, layers: [], sourceW: width, sourceH: height };
    (self as unknown as Worker).postMessage(output);
  }
};
