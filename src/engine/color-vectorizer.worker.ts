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
    layers.push({ r: color.r, g: color.g, b: color.b, a: color.a, paths });
  }

  return layers;
}

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
