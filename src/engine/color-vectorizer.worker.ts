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

// ── Convert imagetracerjs segments to SVG path string ─────────────────────────

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

// ── Refine palette color by sampling raster inside each path's bbox ───────────
// imagetracerjs palette is already close to correct; we refine it by blending
// with the median raster sample from a 3×3 grid inside the path bounding box.
// This corrects small drift while the palette anchors us to the right hue.

interface TracePath { segments: Segment[] }

function refinedLayerColor(
  data: Uint8ClampedArray, w: number, h: number,
  layerPaths: TracePath[],
  paletteR: number, paletteG: number, paletteB: number,
): { r: number; g: number; b: number } {
  const samples: Array<[number, number, number]> = [];

  for (const pathObj of layerPaths) {
    const segs = pathObj.segments;
    if (!segs || segs.length < 2) continue;

    // Bounding box of all segment points
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of segs) {
      minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2);
      minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2);
      if (s.x3 !== undefined) {
        minX = Math.min(minX, s.x3!); maxX = Math.max(maxX, s.x3!);
        minY = Math.min(minY, s.y3!); maxY = Math.max(maxY, s.y3!);
      }
    }
    if (!isFinite(minX)) continue;

    // 3×3 grid in the inner 60% of bbox — avoids boundary pixels
    const padX = (maxX - minX) * 0.2;
    const padY = (maxY - minY) * 0.2;
    for (let gi = 0; gi < 3; gi++) {
      for (let gj = 0; gj < 3; gj++) {
        const px = Math.round(minX + padX + ((maxX - minX - 2 * padX) * gi) / 2);
        const py = Math.round(minY + padY + ((maxY - minY - 2 * padY) * gj) / 2);
        if (px >= 0 && px < w && py >= 0 && py < h) {
          const i = (py * w + px) * 4;
          samples.push([data[i], data[i + 1], data[i + 2]]);
        }
      }
    }
  }

  if (samples.length === 0) return { r: paletteR, g: paletteG, b: paletteB };

  // Component-wise median — robust against samples that fell in wrong region
  const rs = samples.map(s => s[0]).sort((a, b) => a - b);
  const gs = samples.map(s => s[1]).sort((a, b) => a - b);
  const bs = samples.map(s => s[2]).sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const sampR = rs[mid], sampG = gs[mid], sampB = bs[mid];

  // Blend: 60% raster sample + 40% palette — palette anchors the hue,
  // raster corrects quantisation drift
  return {
    r: Math.round(sampR * 0.6 + paletteR * 0.4),
    g: Math.round(sampG * 0.6 + paletteG * 0.4),
    b: Math.round(sampB * 0.6 + paletteB * 0.4),
  };
}

// ── Main processing ───────────────────────────────────────────────────────────

function process(
  data: Uint8ClampedArray,
  w: number, h: number,
): LayerData[] {
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

    const { r, g, b } = refinedLayerColor(
      data, w, h, tracedata.layers[li], color.r, color.g, color.b,
    );
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
