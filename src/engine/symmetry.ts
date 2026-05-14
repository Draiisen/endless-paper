import { SymmetryMode } from '../types/scene';
import { transformPathCoords } from './svg-path';

// Returns transform functions that map a stroke around a center.
export function symmetryTransforms(mode: SymmetryMode, cx: number, cy: number): Array<(x: number, y: number) => { x: number; y: number }> {
  if (mode === 'off') return [];
  const out: Array<(x: number, y: number) => { x: number; y: number }> = [];
  if (mode === 'vertical') {
    out.push((x, y) => ({ x: 2 * cx - x, y }));
  } else if (mode === 'horizontal') {
    out.push((x, y) => ({ x, y: 2 * cy - y }));
  } else if (mode === 'both') {
    out.push((x, y) => ({ x: 2 * cx - x, y }));
    out.push((x, y) => ({ x, y: 2 * cy - y }));
    out.push((x, y) => ({ x: 2 * cx - x, y: 2 * cy - y }));
  } else if (mode === 'radial4' || mode === 'radial6' || mode === 'radial8') {
    const n = mode === 'radial4' ? 4 : mode === 'radial6' ? 6 : 8;
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      out.push((x, y) => {
        const dx = x - cx, dy = y - cy;
        return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
      });
    }
  }
  return out;
}

export function mirroredPaths(d: string, mode: SymmetryMode, cx: number, cy: number): string[] {
  return symmetryTransforms(mode, cx, cy).map(fn => transformPathCoords(d, fn));
}

// Given live points (world coords), produce mirrored point arrays for live preview.
export function mirroredPoints<T extends { x: number; y: number }>(points: T[], mode: SymmetryMode, cx: number, cy: number): T[][] {
  return symmetryTransforms(mode, cx, cy).map(fn => points.map(p => ({ ...p, ...fn(p.x, p.y) })));
}
