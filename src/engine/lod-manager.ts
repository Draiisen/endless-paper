import { SceneNode, ColorLayer, VectorPath } from '../types/scene';
import { generateId } from './scene-graph';
import { transformPathCoords } from './svg-path';

// ── Thumbnail ─────────────────────────────────────────────────────────────────

/**
 * Generates a 64×64 JPEG thumbnail from an already-loaded HTMLImageElement.
 * Called synchronously on the main thread right after import.
 */
export function generateThumbnail(img: HTMLImageElement): string {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  return canvas.toDataURL('image/jpeg', 0.65);
}

// ── Color vectorization ───────────────────────────────────────────────────────

interface WorkerOutput {
  nodeId: string;
  layers: Array<{ r: number; g: number; b: number; paths: string[] }>;
  sourceW: number;
  sourceH: number;
}

/**
 * Downsample the image to at most MAX_DIM in either dimension before sending
 * to the worker.  Keeps memory + CPU proportional to image content, not file size.
 */
const MAX_DIM = 480;

function extractPixels(img: HTMLImageElement): { buffer: ArrayBuffer; w: number; h: number } {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const w = Math.round(Math.min(img.naturalWidth, MAX_DIM));
  const h = Math.round(w / aspect);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  // Transfer the underlying buffer — zero-copy pass to worker
  return { buffer: id.data.buffer.slice(0), w, h };
}

/**
 * Launch a background Web Worker to color-vectorize an image node.
 * On completion, calls `onComplete` with the world-space ColorLayers.
 * Returns a cancel function that terminates the worker early.
 */
export function requestColorVectorization(
  node: SceneNode,
  img: HTMLImageElement,
  numColors: number,
  onComplete: (nodeId: string, colorLayers: ColorLayer[]) => void,
): () => void {
  const { buffer, w, h } = extractPixels(img);

  const worker = new Worker(
    new URL('./color-vectorizer.worker.ts', import.meta.url),
    { type: 'module' },
  );

  worker.onmessage = (e: MessageEvent<WorkerOutput>) => {
    worker.terminate();
    const { nodeId, layers, sourceW, sourceH } = e.data;

    const scaleX = node.width / Math.max(1, sourceW);
    const scaleY = node.height / Math.max(1, sourceH);

    const colorLayers: ColorLayer[] = layers.map(layer => {
      const color = `rgb(${layer.r},${layer.g},${layer.b})`;
      const paths: VectorPath[] = layer.paths.map(rawD => ({
        id: generateId(),
        d: transformPathCoords(rawD, (px, py) => ({
          x: node.x + px * scaleX,
          y: node.y + py * scaleY,
        })),
        fill: color,
        stroke: 'none',
        strokeWidth: 0,
        opacity: 1,
      }));
      return { color, paths };
    });

    onComplete(nodeId, colorLayers);
  };

  worker.onerror = () => worker.terminate();

  worker.postMessage(
    { nodeId: node.id, pixels: buffer, width: w, height: h, numColors },
    [buffer],
  );

  return () => worker.terminate();
}
