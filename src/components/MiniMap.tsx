import { useEffect, useRef } from 'react';
import { Scene, Viewport } from '../types/scene';
import { renderScene } from '../engine/renderer';
import { getBoundingBox } from '../engine/scene-graph';

interface MiniMapProps {
  scene: Scene;
  viewport: Viewport;
  canvasWidth: number;
  canvasHeight: number;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  onTeleport: (worldX: number, worldY: number) => void;
}

const W = 200;
const H = 140;
const PAD = 24;

export function MiniMap({ scene, viewport, canvasWidth, canvasHeight, pos, onPosChange, onClose, onTeleport }: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

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
    });

    return () => cancelAnimationFrame(rafRef.current);
  }, [scene, viewport, canvasWidth, canvasHeight]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

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

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newX = Math.max(0, Math.min(window.innerWidth - W - 4, dragRef.current.startPosX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - H - 32, dragRef.current.startPosY + dy));
    onPosChange({ x: newX, y: newY });
  };

  const handleDragEnd = () => { dragRef.current = null; };

  return (
    <div
      className="fixed z-20 rounded-lg overflow-hidden shadow-xl border border-white/10 bg-ink/80 backdrop-blur-sm"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Drag handle strip */}
      <div
        className="flex items-center justify-between px-2 bg-white/5 cursor-move select-none"
        style={{ height: 22, touchAction: 'none' }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
      >
        <span className="text-[10px] text-gray-500">⠿ Mini-carte</span>
        <button
          className="text-gray-600 hover:text-gray-300 text-[11px] w-5 h-5 flex items-center justify-center rounded transition-colors"
          onPointerDown={e => e.stopPropagation()}
          onClick={onClose}
          title="Masquer"
        >✕</button>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="block cursor-crosshair"
        onClick={handleClick}
        title="Cliquer pour naviguer"
      />
    </div>
  );
}
