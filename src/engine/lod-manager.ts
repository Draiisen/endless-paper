import { SceneNode, ColorLayer, ImageLOD, VectorPath } from '../types/scene';
import { generateId } from './scene-graph';

// ── Thumbnail ─────────────────────────────────────────────────────────────────

/** 64×64 JPEG, synchronous, called right after image load. */
export function generateThumbnail(img: HTMLImageElement): string {
  const SIZE = 64;
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  c.getContext('2d')!.drawImage(img, 0, 0, SIZE, SIZE);
  return c.toDataURL('image/jpeg', 0.65);
}

// ── Pixel extraction ──────────────────────────────────────────────────────────

/** Downscale to at most MAX_DIM before sending to the worker. */
const MAX_DIM = 480;

function extractPixels(img: HTMLImageElement): { buffer: ArrayBuffer; w: number; h: number } {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const w = Math.round(Math.min(img.naturalWidth, MAX_DIM));
  const h = Math.round(w / aspect);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const id = c.getContext('2d')!.getImageData(0, 0, w, h);
  return { buffer: id.data.buffer.slice(0), w, h };
}

// ── Worker communication ──────────────────────────────────────────────────────

interface WorkerOutput {
  nodeId: string;
  layers: Array<{ r: number; g: number; b: number; paths: string[] }>;
  sourceW: number;
  sourceH: number;
}

/**
 * Launch a Web Worker to color-vectorize an image node.
 *
 * Paths are returned in SOURCE-PIXEL coordinates [0, sourceW] × [0, sourceH].
 * The renderer applies ctx.transform(scaleX, 0, 0, scaleY, node.x, node.y) at
 * draw time, so move / resize just works without touching the stored paths.
 *
 * Returns a cancel function that terminates the worker early.
 */
export function requestColorVectorization(
  node: SceneNode,
  img: HTMLImageElement,
  numColors: number,
  onComplete: (nodeId: string, lod: Pick<ImageLOD, 'colorLayers' | 'sourceW' | 'sourceH'>) => void,
): () => void {
  const { buffer, w, h } = extractPixels(img);

  const worker = new Worker(
    new URL('./color-vectorizer.worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
    worker.terminate();
    const { nodeId, layers, sourceW, sourceH } = e.data;

    // Build ColorLayers keeping paths in source-pixel space.
    // The renderer will apply a canvas transform to map them to world coords.
    const colorLayers: ColorLayer[] = layers.map(layer => {
      const color = `rgb(${layer.r},${layer.g},${layer.b})`;
      const paths: VectorPath[] = layer.paths.map(d => ({
        id: generateId(),
        d,               // ← source-pixel coords, NOT world-space
        fill: color,
        stroke: 'none',
        strokeWidth: 0,
        opacity: 1,
      }));
      return { color, paths };
    });

    onComplete(nodeId, { colorLayers, sourceW, sourceH });
  };

  worker.onerror = () => worker.terminate();

  worker.postMessage(
    { nodeId: node.id, pixels: buffer, width: w, height: h, numColors },
    [buffer],
  );

  return () => worker.terminate();
}
