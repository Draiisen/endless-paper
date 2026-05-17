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

// ── Two-pass colour sampling via OffscreenCanvas ──────────────────────────────
// Pass 1: mean of all pixels inside the rasterised path mask.
// Pass 2: mean of only pixels within L2-distance 50 of pass-1 mean.
// This filters out boundary pixels that bleed in from adjacent regions,
// giving the true dominant colour of the region regardless of palette drift.

const SAMPLE_RES = 160;

function computeLayerColor(
  rasterData: Uint8ClampedArray,
  rasterW: number, rasterH: number,
  pathStrings: string[],
  fallbackR: number, fallbackG: number, fallbackB: number,
): { r: number; g: number; b: number } {
  try {
    const scale = SAMPLE_RES / Math.max(rasterW, rasterH);
    const sw = Math.max(1, Math.round(rasterW * scale));
    const sh = Math.max(1, Math.round(rasterH * scale));

    const oc = new OffscreenCanvas(sw, sh);
    const octx = oc.getContext('2d')!;
    octx.scale(scale, scale);
    octx.fillStyle = 'white';
    for (const d of pathStrings) octx.fill(new Path2D(d));
    const mask = octx.getImageData(0, 0, sw, sh).data;

    // Pass 1 — overall mean
    let mr = 0, mg = 0, mb = 0, mc = 0;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        if (mask[(py * sw + px) * 4] < 128) continue;
        const rx = Math.min(rasterW - 1, Math.round(px / scale));
        const ry = Math.min(rasterH - 1, Math.round(py / scale));
        const ri = (ry * rasterW + rx) * 4;
        mr += rasterData[ri]; mg += rasterData[ri + 1]; mb += rasterData[ri + 2]; mc++;
      }
    }
    if (mc === 0) return { r: fallbackR, g: fallbackG, b: fallbackB };
    mr /= mc; mg /= mc; mb /= mc;

    // Pass 2 — mean of pixels within L2 = 50 of pass-1 mean
    // (removes edge pixels from neighbouring colour regions)
    const T2 = 50 * 50;
    let fr = 0, fg = 0, fb = 0, fc = 0;
    for (let py = 0; py < sh; py++) {
      for (let px = 0; px < sw; px++) {
        if (mask[(py * sw + px) * 4] < 128) continue;
        const rx = Math.min(rasterW - 1, Math.round(px / scale));
        const ry = Math.min(rasterH - 1, Math.round(py / scale));
        const ri = (ry * rasterW + rx) * 4;
        const dr = rasterData[ri] - mr;
        const dg = rasterData[ri + 1] - mg;
        const db = rasterData[ri + 2] - mb;
        if (dr * dr + dg * dg + db * db < T2) {
          fr += rasterData[ri]; fg += rasterData[ri + 1]; fb += rasterData[ri + 2]; fc++;
        }
      }
    }

    if (fc === 0) return { r: Math.round(mr), g: Math.round(mg), b: Math.round(mb) };
    return { r: Math.round(fr / fc), g: Math.round(fg / fc), b: Math.round(fb / fc) };
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
