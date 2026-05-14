import { Scene, SceneNode } from '../types/scene';

let _idCounter = 0;
export function generateId(): string {
  return `node_${Date.now()}_${_idCounter++}`;
}

export function createScene(): Scene {
  return {
    id: generateId(),
    nodes: [],
    background: '#f8f7f4',
  };
}

export function createNode(
  type: SceneNode['type'],
  x: number,
  y: number,
  width: number,
  height: number
): SceneNode {
  return {
    id: generateId(),
    type,
    x,
    y,
    width,
    height,
  };
}

export function addNode(scene: Scene, node: SceneNode): Scene {
  return {
    ...scene,
    nodes: [...scene.nodes, node],
  };
}

export function removeNode(scene: Scene, nodeId: string): Scene {
  return {
    ...scene,
    nodes: scene.nodes.filter((n) => n.id !== nodeId),
  };
}

export function updateNode(scene: Scene, nodeId: string, updates: Partial<SceneNode>): Scene {
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
  };
}

export function getNode(scene: Scene, nodeId: string): SceneNode | undefined {
  return scene.nodes.find((n) => n.id === nodeId);
}

// Offscreen canvas used solely for path hit testing.
let _hitCtx: CanvasRenderingContext2D | null = null;
function getHitCtx(): CanvasRenderingContext2D | null {
  if (_hitCtx) return _hitCtx;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  _hitCtx = c.getContext('2d');
  return _hitCtx;
}

export function getNodeAtPoint(scene: Scene, worldX: number, worldY: number): SceneNode | undefined {
  // Iterate in reverse so top-most nodes are hit first
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const node = scene.nodes[i];
    if (hitTest(node, worldX, worldY)) {
      return node;
    }
  }
  return undefined;
}

function bboxHit(node: SceneNode, worldX: number, worldY: number, margin = 5): boolean {
  return (
    worldX >= node.x - margin &&
    worldX <= node.x + node.width + margin &&
    worldY >= node.y - margin &&
    worldY <= node.y + node.height + margin
  );
}

function hitTest(node: SceneNode, worldX: number, worldY: number): boolean {
  switch (node.type) {
    case 'path': {
      // Quick bbox reject first
      const sw = node.path?.strokeWidth ?? 2;
      const tol = Math.max(4, sw * 1.5);
      if (!bboxHit(node, worldX, worldY, tol)) return false;
      const ctx = getHitCtx();
      if (!ctx || !node.path) {
        return bboxHit(node, worldX, worldY);
      }
      try {
        const p = new Path2D(node.path.d);
        ctx.lineWidth = tol;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (ctx.isPointInStroke(p, worldX, worldY)) return true;
        // If the path is filled, also test inside
        if (node.path.fill && node.path.fill !== 'none') {
          if (ctx.isPointInPath(p, worldX, worldY)) return true;
        }
        return false;
      } catch {
        return bboxHit(node, worldX, worldY);
      }
    }
    case 'circle': {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      const rx = Math.max(1, node.width / 2);
      const ry = Math.max(1, node.height / 2);
      const dx = (worldX - cx) / rx;
      const dy = (worldY - cy) / ry;
      const sq = dx * dx + dy * dy;
      const filled = node.fill && node.fill !== 'none';
      if (filled) return sq <= 1;
      // ring: hit when near edge
      const sw = node.strokeWidth ?? 2;
      const inner = Math.max(0, 1 - (sw + 4) / Math.min(rx, ry));
      return sq <= 1 && sq >= inner * inner;
    }
    case 'rect':
    case 'image':
    case 'text':
    case 'group':
    default: {
      const margin = Math.max(5, (node.strokeWidth ?? 1) / 2 + 2);
      return bboxHit(node, worldX, worldY, margin);
    }
  }
}

export function getNodesInRect(
  scene: Scene,
  x: number, y: number, w: number, h: number,
): SceneNode[] {
  const minX = Math.min(x, x + w);
  const maxX = Math.max(x, x + w);
  const minY = Math.min(y, y + h);
  const maxY = Math.max(y, y + h);
  return scene.nodes.filter(n => (
    n.x + n.width >= minX &&
    n.x <= maxX &&
    n.y + n.height >= minY &&
    n.y <= maxY
  ));
}

export function getGroupSiblings(scene: Scene, nodeId: string): SceneNode[] {
  const node = scene.nodes.find(n => n.id === nodeId);
  if (!node || !node.groupId) return node ? [node] : [];
  return scene.nodes.filter(n => n.groupId === node.groupId);
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getBoundingBox(nodes: SceneNode[]): BoundingBox {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function ensureInnerScene(node: SceneNode): SceneNode {
  if (node.innerScene) return node;
  return {
    ...node,
    innerScene: createScene(),
  };
}
