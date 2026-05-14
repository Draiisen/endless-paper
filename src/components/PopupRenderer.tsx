import { useState, useEffect, useRef } from 'react';
import { SceneNode, Viewport } from '../types/scene';
import { renderMarkdown } from '../engine/markdown';

interface ActivePopup {
  node: SceneNode;
  screenX: number;
  screenY: number;
}

interface PopupRendererProps {
  scene: { nodes: SceneNode[] };
  viewport: Viewport;
  viewerMode: boolean;
}

// Returns screen position of node center
function nodeScreenCenter(node: SceneNode, vp: Viewport): { x: number; y: number } {
  return {
    x: (node.x + node.width / 2) * vp.scale + vp.x,
    y: node.y * vp.scale + vp.y - 12,
  };
}

export function useHotspotHandler(viewerMode: boolean) {
  const [popup, setPopup] = useState<ActivePopup | null>(null);

  const handleNodeClick = (node: SceneNode, viewport: Viewport) => {
    if (!viewerMode || !node.hotspot) return false;
    if (node.hotspot.trigger !== 'click') return false;
    const pos = nodeScreenCenter(node, viewport);
    setPopup({ node, screenX: pos.x, screenY: pos.y });
    return true;
  };

  const handleNodeDoubleClick = (node: SceneNode, viewport: Viewport) => {
    if (!viewerMode || !node.hotspot) return false;
    if (node.hotspot.trigger !== 'doubleclick') return false;
    const pos = nodeScreenCenter(node, viewport);
    setPopup({ node, screenX: pos.x, screenY: pos.y });
    return true;
  };

  const dismiss = () => setPopup(null);

  return { popup, handleNodeClick, handleNodeDoubleClick, dismiss };
}

interface TextBubbleProps {
  popup: ActivePopup;
  onDismiss: () => void;
}

function TextBubble({ popup, onDismiss }: TextBubbleProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [onDismiss]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(popup.screenX, window.innerWidth - 220),
    top: Math.max(8, popup.screenY - 80),
    zIndex: 50,
    maxWidth: 220,
  };

  return (
    <div ref={ref} style={style}
      className="bg-ink/95 text-white text-sm rounded-xl shadow-2xl px-4 py-3 border border-white/10 backdrop-blur-sm"
    >
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[-8px] w-0 h-0"
        style={{ borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '8px solid rgba(26,26,46,0.95)' }}
      />
      <p className="leading-relaxed text-gray-200 text-[13px]">{popup.node.hotspot!.content}</p>
      <button onClick={onDismiss} className="absolute top-2 right-2 text-gray-500 hover:text-white text-xs">✕</button>
    </div>
  );
}

interface WindowModalProps {
  popup: ActivePopup;
  onDismiss: () => void;
}

function WindowModal({ popup, onDismiss }: WindowModalProps) {
  const hs = popup.node.hotspot!;
  const w = hs.width ?? 360;
  const h = hs.height ?? 240;
  const html = renderMarkdown(hs.content);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onDismiss}>
      <div
        className="bg-paper rounded-xl shadow-2xl border border-ink/20 flex flex-col overflow-hidden"
        style={{ width: w, maxHeight: h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-ink/90 text-white">
          <span className="font-semibold text-sm truncate">{hs.title || 'Info'}</span>
          <button onClick={onDismiss} className="text-gray-400 hover:text-white ml-2">✕</button>
        </div>
        <div
          className="flex-1 overflow-auto px-4 py-3 text-ink text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}

interface PopupDisplayProps {
  popup: ActivePopup | null;
  onDismiss: () => void;
}

export function PopupDisplay({ popup, onDismiss }: PopupDisplayProps) {
  if (!popup || !popup.node.hotspot) return null;
  if (popup.node.hotspot.type === 'text') {
    return <TextBubble popup={popup} onDismiss={onDismiss} />;
  }
  return <WindowModal popup={popup} onDismiss={onDismiss} />;
}

// Hover hotspot detection for rendering badge on canvas
export function getHotspotNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.filter(n => !!n.hotspot);
}

void (null as unknown as PopupRendererProps);
