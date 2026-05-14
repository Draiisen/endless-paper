import { Viewport } from '../types/scene';

export const MIN_SCALE = 0.001;
export const MAX_SCALE = 50000;

export function worldToScreen(worldX: number, worldY: number, viewport: Viewport): { x: number; y: number } {
  return {
    x: worldX * viewport.scale + viewport.x,
    y: worldY * viewport.scale + viewport.y,
  };
}

export function screenToWorld(screenX: number, screenY: number, viewport: Viewport): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.scale,
    y: (screenY - viewport.y) / viewport.scale,
  };
}

export interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function getViewportBounds(viewport: Viewport, canvasWidth: number, canvasHeight: number): ViewportBounds {
  const topLeft = screenToWorld(0, 0, viewport);
  const bottomRight = screenToWorld(canvasWidth, canvasHeight, viewport);
  return {
    left: topLeft.x,
    top: topLeft.y,
    right: bottomRight.x,
    bottom: bottomRight.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

export function zoomAt(viewport: Viewport, screenX: number, screenY: number, delta: number): Viewport {
  const zoomFactor = delta > 0 ? 1.1 : 1 / 1.1;
  const newScale = clampScale(viewport.scale * zoomFactor);
  const actualFactor = newScale / viewport.scale;

  return {
    x: screenX - (screenX - viewport.x) * actualFactor,
    y: screenY - (screenY - viewport.y) * actualFactor,
    scale: newScale,
  };
}

export function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}
