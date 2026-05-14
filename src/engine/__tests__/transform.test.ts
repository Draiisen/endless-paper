import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorld, zoomAt, clampScale, MIN_SCALE, MAX_SCALE } from '../transform';
import type { Viewport } from '../../types/scene';

const vp: Viewport = { x: 100, y: 200, scale: 2 };

describe('worldToScreen', () => {
  it('maps world origin to viewport offset', () => {
    const result = worldToScreen(0, 0, vp);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it('maps a world point to screen', () => {
    const result = worldToScreen(10, 5, vp);
    expect(result.x).toBe(120); // 10*2 + 100
    expect(result.y).toBe(210); // 5*2 + 200
  });
});

describe('screenToWorld', () => {
  it('is the inverse of worldToScreen', () => {
    const wx = 50, wy = 30;
    const screen = worldToScreen(wx, wy, vp);
    const back = screenToWorld(screen.x, screen.y, vp);
    expect(back.x).toBeCloseTo(wx);
    expect(back.y).toBeCloseTo(wy);
  });

  it('maps screen origin given viewport offset', () => {
    const result = screenToWorld(100, 200, vp);
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('round-trips at scale 1', () => {
    const v2: Viewport = { x: 0, y: 0, scale: 1 };
    const result = screenToWorld(75, 42, v2);
    expect(result.x).toBe(75);
    expect(result.y).toBe(42);
  });
});

describe('zoomAt', () => {
  it('increases scale when delta > 0', () => {
    const result = zoomAt(vp, 0, 0, 1);
    expect(result.scale).toBeGreaterThan(vp.scale);
  });

  it('decreases scale when delta < 0', () => {
    const result = zoomAt(vp, 0, 0, -1);
    expect(result.scale).toBeLessThan(vp.scale);
  });

  it('zoom is centered at the pivot point', () => {
    const v: Viewport = { x: 0, y: 0, scale: 1 };
    const result = zoomAt(v, 100, 100, 1);
    // The point (100, 100) in screen space should map to the same world coords before and after
    const worldBefore = screenToWorld(100, 100, v);
    const worldAfter = screenToWorld(100, 100, result);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('clamps scale to MIN_SCALE', () => {
    const tiny: Viewport = { x: 0, y: 0, scale: MIN_SCALE * 2 };
    const result = zoomAt(tiny, 0, 0, -1000);
    expect(result.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it('clamps scale to MAX_SCALE', () => {
    const huge: Viewport = { x: 0, y: 0, scale: MAX_SCALE / 2 };
    const result = zoomAt(huge, 0, 0, 1000);
    expect(result.scale).toBeLessThanOrEqual(MAX_SCALE);
  });
});

describe('clampScale', () => {
  it('clamps below min', () => {
    expect(clampScale(0)).toBe(MIN_SCALE);
  });

  it('clamps above max', () => {
    expect(clampScale(Infinity)).toBe(MAX_SCALE);
  });

  it('passes through valid scale', () => {
    expect(clampScale(1.5)).toBe(1.5);
  });
});
