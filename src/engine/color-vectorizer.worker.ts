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

// ── Accurate color: rasterise paths at low-res, average raster pixels inside ──
// imagetracerjs palette drifts (blue→green etc). OffscreenCanvas lets us
// rasterise the exact path mask and sample the original pixels inside it.

const SAMPLE_RES = 160;

function computeLayerColor(
  rasterData: Uint8ClampedArray,
  rasterW: number,
  rasterH: number,
  pathStrings: string[],
  fallbackR: number, fallbackG: number, fallbackB: number,
): { r: number; g: number; b: number } {
  try {
    const scale = SAMPLE_RES / Math.max(rasterW, rasterH);
    const sw = Math.max(1, Math.round(rasterW * scale));
    const sh = Math.max(1, Math.round(rasterH * scale));

    // Rasterise paths into a mask at reduced resolution
    const oc = new OffscreenCanvas(sw, sh);
    const octx = oc.getContext('2d')!;
    octx.scale(scale, scale);
    octx.fillStyle = 'white';
    for (const d of pathStrings) {
      octx.fill(new Path2D(d));
    }
    const mask = octx.getImageData(0, 0, sw, sh).data;

    // 3-D colour histogram (16 levels/channel = 4096 buckets) — gives the
    // dominant colour in the region, not the mean (which desaturates gradients)
    const BINS = 16;
    const binSz = 256 / BINS;
    const hist = new Uint32Array(BINS * BINS * BINS);
    let count = 0;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        if (mask[(py * sw + px) * 4] < 128) continue;
        const rx = Math.min(rasterW - 1, Math.round(px / scale));
        const ry = Math.min(rasterH - 1, Math.round(py / scale));
        const ri = (ry * rasterW + rx) * 4;
        const br = Math.floor(rasterData[ri]     / binSz);
        const bg = Math.floor(rasterData[ri + 1] / binSz);
        const bb = Math.floor(rasterData[ri + 2] / binSz);
        hist[br * BINS * BINS + bg * BINS + bb]++;
        count++;
      }
    }

    if (count === 0) return { r: fallbackR, g: fallbackG, b: fallbackB };

    let maxCount = 0, maxIdx = 0;
    for (let i = 0; i < hist.length; i++) {
      if (hist[i] > maxCount) { maxCount = hist[i]; maxIdx = i; }
    }
    const binB = maxIdx % BINS;
    const binG = Math.floor(maxIdx / BINS) % BINS;
    const binR = Math.floor(maxIdx / (BINS * BINS));
    return {
      r: Math.round((binR + 0.5) * binSz),
      g: Math.round((binG + 0.5) * binSz),
      b: Math.round((binB + 0.5) * binSz),
    };
  } catch {
    return { r: fallbackR, g: fallbackG, b: fallbackB };
  }
}

// ── Main processing ───────────────────────────────────────────────────────────

function process(data: Uint8ClampedArray, w: number, h: number): LayerData[] {
  const imgData = { data, width: w, height: h };

  const options = {
    numberofcolors: 24,
    colorsampling: 2,
    blurradius: 0,
    blurdelta: 20,
    ltres: 0.1,
    qtres: 0.1,
    pathomit: 1,
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

    // Sample actual raster color inside the rasterised path mask
    const { r, g, b } = computeLayerColor(data, w, h, paths, color.r, color.g, color.b);
    layers.push({ r, g, b, a: color.a, paths });
  }

  return layers;
}

// ── Worker entry point ────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  const { nodeId, pixels, width, height } = e.data;
  try {
    const data = new Uint8ClampedArray(pixels);
    if (width < 1 || height < 1 || data.length < width * height * 4) {
      (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
      return;
    }
    const layers = process(data, width, height);
    (self as unknown as Worker).postMessage({ nodeId, layers, sourceW: width, sourceH: height } as WorkerOutput);
  } catch (err) {
    console.error('vectorizer error', err);
    (self as unknown as Worker).postMessage({ nodeId, layers: [], sourceW: width, sourceH: height });
  }
};
