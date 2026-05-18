/// <reference lib="webworker" />

import { potrace, init } from 'esm-potrace-wasm';

export type {};

interface WorkerInput {
  nodeId: string;
  pixels: ArrayBuffer;
  width: number;
  height: number;
  numColors: number;
}

interface LayerData {
  r: number; g: number; b: number; a: number;
  paths: string[];
}

interface WorkerOutput {
  nodeId: string;
  layers: LayerData[];
  sourceW: number;
  sourceH: number;
}

interface PaletteColor { r: number; g: number; b: number; a: number; }

// ── Step 1: Median-cut color quantization ─────────────────────────────────────
function buildPalette(data: Uint8ClampedArray, numColors: number): PaletteColor[] {
  const totalPixels = data.length / 4;
  const step = Math.max(1, Math.floor(totalPixels / 12000));
  const samples: PaletteColor[] = [];

  for (let i = 0; i < totalPixels; i += step) {
    const o = i * 4;
    if (data[o + 3] < 20) continue;
    samples.push({ r: data[o], g: data[o + 1], b: data[o + 2], a: data[o + 3] });
  }

  if (samples.length === 0) return [{ r: 128, g: 128, b: 128, a: 255 }];

  type Bucket = PaletteColor[];
  let buckets: Bucket[] = [samples];

  while (buckets.length < numColors) {
    let bestIdx = -1, bestRange = -1;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.length < 2) continue;
      let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
      for (const p of b) {
        if (p.r < rMin) rMin = p.r; if (p.r > rMax) rMax = p.r;
        if (p.g < gMin) gMin = p.g; if (p.g > gMax) gMax = p.g;
        if (p.b < bMin) bMin = p.b; if (p.b > bMax) bMax = p.b;
      }
      const range = Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
      if (range > bestRange) { bestRange = range; bestIdx = i; }
    }
    if (bestIdx === -1 || bestRange <= 1) break;

    const bucket = buckets[bestIdx];
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (const p of bucket) {
      if (p.r < rMin) rMin = p.r; if (p.r > rMax) rMax = p.r;
      if (p.g < gMin) gMin = p.g; if (p.g > gMax) gMax = p.g;
      if (p.b < bMin) bMin = p.b; if (p.b > bMax) bMax = p.b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    const ch: 'r' | 'g' | 'b' =
      rRange >= gRange && rRange >= bRange ? 'r' :
      gRange >= bRange ? 'g' : 'b';

    bucket.sort((a, b) => a[ch] - b[ch]);
    const mid = Math.floor(bucket.length / 2);
    buckets.splice(bestIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }

  return buckets.map(bucket => {
    const n = bucket.length;
    return {
      r: Math.round(bucket.reduce((s, p) => s + p.r, 0) / n),
      g: Math.round(bucket.reduce((s, p) => s + p.g, 0) / n),
      b: Math.round(bucket.reduce((s, p) => s + p.b, 0) / n),
      a: Math.round(bucket.reduce((s, p) => s + p.a, 0) / n),
    };
  });
}

// ── Step 2: Pre-quantize ──────────────────────────────────────────────────────
function preQuantize(data: Uint8ClampedArray, palette: PaletteColor[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 20) {
      out[i + 3] = 0;
      continue;
    }
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let bestDist = Infinity, best = palette[0];
    for (const c of palette) {
      const dr = r - c.r, dg = g - c.g, db = b - c.b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    out[i] = best.r; out[i + 1] = best.g; out[i + 2] = best.b; out[i + 3] = a;
  }
  return out;
}

// ── Step 3: Count pixels per palette entry (for layer ordering) ───────────────
function countByColor(quantized: Uint8ClampedArray, palette: PaletteColor[]): number[] {
  const counts = new Array(palette.length).fill(0);
  const map = new Map<number, number>();
  for (let j = 0; j < palette.length; j++) {
    map.set((palette[j].r << 16) | (palette[j].g << 8) | palette[j].b, j);
  }
  for (let i = 0; i < quantized.length; i += 4) {
    if (quantized[i + 3] < 20) continue;
    const key = (quantized[i] << 16) | (quantized[i + 1] << 8) | quantized[i + 2];
    const idx = map.get(key);
    if (idx !== undefined) counts[idx]++;
  }
  return counts;
}

// ── Step 4: SVG path extraction ───────────────────────────────────────────────
// Potrace emits paths in Y-up coordinates and wraps them in a
// transform="scale(1,-1) translate(0,-H)" group. When we extract
// only the `d` attributes, we must flip Y so paths land in the
// Y-down canvas coordinate space expected by the renderer.

function flipYInPath(d: string, h: number): string {
  // Insert spaces around command letters so we can tokenize uniformly.
  const normalized = d.replace(/([MLCQZmlcqz])/g, ' $1 ').replace(/,/g, ' ').trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i].toUpperCase();
    if (cmd === 'M' || cmd === 'L') {
      const x = tokens[++i]; const y = +tokens[++i];
      out.push(`${cmd}${x} ${(h - y).toFixed(3)}`);
    } else if (cmd === 'C') {
      const x1 = tokens[++i]; const y1 = +tokens[++i];
      const x2 = tokens[++i]; const y2 = +tokens[++i];
      const x  = tokens[++i]; const y  = +tokens[++i];
      out.push(`C${x1} ${(h-y1).toFixed(3)} ${x2} ${(h-y2).toFixed(3)} ${x} ${(h-y).toFixed(3)}`);
    } else if (cmd === 'Q') {
      const x1 = tokens[++i]; const y1 = +tokens[++i];
      const x  = tokens[++i]; const y  = +tokens[++i];
      out.push(`Q${x1} ${(h-y1).toFixed(3)} ${x} ${(h-y).toFixed(3)}`);
    } else if (cmd === 'Z') {
      out.push('Z');
    } else {
      out.push(tokens[i]);
    }
    i++;
  }
  return out.join(' ');
}

function extractPaths(svg: string, sourceH: number): string[] {
  // Detect whether Potrace applied a Y-flip transform in the SVG wrapper.
  const hasYFlip = /scale\s*\(\s*1\s*,\s*-1\s*\)/.test(svg);
  const paths: string[] = [];
  const re = /\bd="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    paths.push(hasYFlip ? flipYInPath(m[1], sourceH) : m[1]);
  }
  return paths;
}

// ── Step 5: Potrace per-color layer ───────────────────────────────────────────
async function process(data: Uint8ClampedArray, w: number, h: number, numColors: number): Promise<LayerData[]> {
  const palette = buildPalette(data, numColors);
  const quantized = preQuantize(data, palette);

  // Sort colors by pixel count descending so largest-area layers come first.
  const counts = countByColor(quantized, palette);
  const sortedIndices = palette.map((_, i) => i).sort((a, b) => counts[b] - counts[a]);

  const layers: LayerData[] = [];

  for (const pi of sortedIndices) {
    const color = palette[pi];
    if (color.a < 64) continue;

    const colorKey = (color.r << 16) | (color.g << 8) | color.b;

    // Build binary mask: this color → black foreground, everything else → white.
    const maskData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < quantized.length; i += 4) {
      const isFg = quantized[i + 3] >= 20 &&
        ((quantized[i] << 16) | (quantized[i + 1] << 8) | quantized[i + 2]) === colorKey;
      const v = isFg ? 0 : 255;
      maskData[i] = v; maskData[i + 1] = v; maskData[i + 2] = v; maskData[i + 3] = 255;
    }

    const imageData = new ImageData(maskData, w, h);

    let svg: string;
    try {
      svg = await potrace(imageData, {
        turdsize: 2,
        alphamax: 1.0,
        opticurve: 1,
        opttolerance: 0.2,
      });
    } catch {
      continue;
    }

    const paths = extractPaths(svg, h);
    if (paths.length === 0) continue;

    layers.push({ r: color.r, g: color.g, b: color.b, a: color.a, paths });
  }

  return layers;
}

// ── Entry point ───────────────────────────────────────────────────────────────
let initialized = false;

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { nodeId, pixels, width, height, numColors } = e.data;
  try {
    if (!initialized) {
      await init();
      initialized = true;
    }

    const data = new Uint8ClampedArray(pixels);
    if (width < 1 || height < 1 || data.length < width * height * 4) {
      (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
      return;
    }

    const layers = await process(data, width, height, numColors ?? 32);
    (self as unknown as Worker).postMessage({ nodeId, layers, sourceW: width, sourceH: height } as WorkerOutput);
  } catch (err) {
    console.error('vectorizer error', err);
    (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
  }
};
