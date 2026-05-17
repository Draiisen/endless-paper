/// <reference lib="webworker" />

// @ts-ignore — imagetracerjs is a CJS module without types
import ImageTracer from 'imagetracerjs';

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

interface Segment {
  type: 'L' | 'Q';
  x1: number; y1: number;
  x2: number; y2: number;
  x3?: number; y3?: number;
}

interface PaletteColor { r: number; g: number; b: number; a: number; }

// Median-cut color quantization — gives exact colors, no palette drift.
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
    let bestIdx = -1;
    let bestRange = -1;

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

function segmentsToPath(segments: Segment[]): string {
  if (segments.length === 0) return '';
  let d = `M ${segments[0].x1.toFixed(2)} ${segments[0].y1.toFixed(2)}`;
  for (const s of segments) {
    if (s.type === 'L') {
      d += ` L ${s.x2.toFixed(2)} ${s.y2.toFixed(2)}`;
    } else {
      d += ` Q ${s.x2.toFixed(2)} ${s.y2.toFixed(2)} ${s.x3!.toFixed(2)} ${s.y3!.toFixed(2)}`;
    }
  }
  return d + ' Z';
}

function process(data: Uint8ClampedArray, w: number, h: number, numColors: number): LayerData[] {
  const imgData = { data, width: w, height: h };

  // Build our own palette so colors are exact — no imagetracerjs quantization drift.
  const palette = buildPalette(data, numColors);

  const options = {
    colorsampling: 0,   // use provided palette, do not re-quantize
    pal: palette,
    blurradius: 0,
    ltres: 0.1,
    qtres: 0.1,
    pathomit: 2,
    rightangleenhance: true,
  };

  const tracedata = ImageTracer.imagedataToTracedata(imgData, options);

  const layers: LayerData[] = [];
  for (let li = 0; li < tracedata.layers.length; li++) {
    const color = tracedata.palette[li];
    if (!color || color.a < 64) continue;

    const paths: string[] = [];
    for (const pathObj of tracedata.layers[li]) {
      if (!pathObj.segments || pathObj.segments.length < 2) continue;
      const d = segmentsToPath(pathObj.segments);
      if (d) paths.push(d);
    }

    if (paths.length === 0) continue;
    layers.push({ r: color.r, g: color.g, b: color.b, a: color.a, paths });
  }

  return layers;
}

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { nodeId, pixels, width, height, numColors } = e.data;
  try {
    const data = new Uint8ClampedArray(pixels);
    if (width < 1 || height < 1 || data.length < width * height * 4) {
      (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
      return;
    }
    const layers = process(data, width, height, numColors ?? 24);
    (self as unknown as Worker).postMessage({ nodeId, layers, sourceW: width, sourceH: height } as WorkerOutput);
  } catch (err) {
    console.error('vectorizer error', err);
    (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
  }
};
