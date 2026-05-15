import { useEffect, useRef } from 'react';
import { Scene, Viewport } from '../types/scene';
import { renderScene } from '../engine/renderer';
import { getBoundingBox } from '../engine/scene-graph';

interface MiniMapProps {
  scene: Scene;
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
  onTeleport: (worldX: number, worldY: number) => void;
}

const W = 200;
const H = 140;
const PAD = 24;

export function MiniMap({ scene, viewport, canvasWidth, canvasHeight, onTeleport }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      // Compute mini viewport that fits scene content (or a default area)
      const nodes = scene.nodes;
      let wx = -400, wy = -300, ww = 800, wh = 600;
      if (nodes.length > 0) {
        const bb = getBoundingBox(nodes);
        wx = bb.x - PAD;
        wy = bb.y - PAD;
        ww = Math.max(bb.width + PAD * 2, 100);
        wh = Math.max(bb.height + PAD * 2, 80);
      }

      // Scale to fit W x H
      const scaleX = W / ww;
      const scaleY = H / wh;
      const miniScale = Math.min(scaleX, scaleY);
      const miniVp: Viewport = {
        x: -wx * miniScale + (W - ww * miniScale) / 2,
        y: -wy * miniScale + (H - wh * miniScale) / 2,
        scale: miniScale,
      };

      // Draw scene at minimap scale
      renderScene(ctx, scene, miniVp, { showGrid: false });

      // Draw viewport rectangle
      const vx = ((-viewport.x / viewport.scale) - wx) * miniScale + miniVp.x - (wx * miniScale - miniVp.x) + wx * miniScale;
      const vy = ((-viewport.y / viewport.scale) - wy) * miniScale + miniVp.y - (wy * miniScale - miniVp.y) + wy * miniScale;

      // Viewport bounds in world space
      const vwLeft = -viewport.x / viewport.scale;
      const vwTop = -viewport.y / viewport.scale;
      const vwRight = (canvasWidth - viewport.x) / viewport.scale;
      const vwBottom = (canvasHeight - viewport.y) / viewport.scale;

      const toMini = (wx2: number, wy2: number) => ({
        x: miniVp.x + (wx2 - (-miniVp.x / miniScale)) * miniScale,
        y: miniVp.y + (wy2 - (-miniVp.y / miniScale)) * miniScale,
      });

      const tl = toMini(vwLeft, vwTop);
      const br = toMini(vwRight, vwBottom);
      const rw = br.x - tl.x;
      const rh = br.y - tl.y;

      ctx.save();
      ctx.strokeStyle = 'rgba(74,144,217,0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(tl.x, tl.y, rw, rh);
      ctx.fillStyle = 'rgba(74,144,217,0.08)';
      ctx.fillRect(tl.x, tl.y, rw, rh);
      ctx.restore();

      void vx; void vy;
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [scene, viewport, canvasWidth, canvasHeight]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Find what world point this mini-map pixel corresponds to
    const nodes = scene.nodes;
    let wx = -400, wy = -300, ww = 800, wh = 600;
    if (nodes.length > 0) {
      const bb = getBoundingBox(nodes);
      wx = bb.x - PAD;
      wy = bb.y - PAD;
      ww = Math.max(bb.width + PAD * 2, 100);
      wh = Math.max(bb.height + PAD * 2, 80);
    }
    const scaleX = W / ww;
    const scaleY = H / wh;
    const miniScale = Math.min(scaleX, scaleY);
    const ox = (W - ww * miniScale) / 2;
    const oy = (H - wh * miniScale) / 2;

    const worldX = (cx - ox) / miniScale + wx;
    const worldY = (cy - oy) / miniScale + wy;
    onTeleport(worldX, worldY);
  };

  return (
    <div className="fixed bottom-24 left-16 z-20 rounded-lg overflow-hidden shadow-xl border border-white/10 bg-ink/80 backdrop-blur-sm">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block cursor-crosshair"
        onClick={handleClick}
        title="Click to navigate"
      />
    </div>
  );
}
