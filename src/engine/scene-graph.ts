import { Scene, SceneNode, Layer } from '../types/scene';

let _idCounter = 0;
export function generateId(): string {
  return `node_${Date.now()}_${_idCounter++}`;
}

export function createLayer(name: string): Layer {
  return {
    id: `layer_${Date.now()}_${_idCounter++}`,
    name,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

export function createScene(): Scene {
  const baseLayer = createLayer('Layer 1');
  return {
    id: generateId(),
    nodes: [],
    background: '#f8f7f4',
    layers: [baseLayer],
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

export function addNode(scene: Scene, node: SceneNode, layerId?: string): Scene {
  // Ensure scene has at least one layer; assign node to active layer if not set.
  const layers = ensureLayers(scene);
  const targetLayerId = node.layerId ?? layerId ?? layers[0].id;
  const newNode = node.layerId ? node : { ...node, layerId: targetLayerId };
  return {
    ...scene,
    layers,
    nodes: [...scene.nodes, newNode],
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

export function ensureLayers(scene: Scene): Layer[] {
  if (scene.layers && scene.layers.length > 0) return scene.layers;
  return [createLayer('Layer 1')];
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

export function getNodeAtPoint(
  scene: Scene,
  worldX: number,
  worldY: number,
  ignoreLocked = true,
): SceneNode | undefined {
  // Iterate in reverse so top-most nodes are hit first
  const layers = scene.layers;
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const node = scene.nodes[i];
    if (ignoreLocked && layers && node.layerId) {
      const lay = layers.find(l => l.id === node.layerId);
      if (lay && (lay.locked || !lay.visible)) continue;
    }
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
  ignoreLocked = true,
): SceneNode[] {
  const minX = Math.min(x, x + w);
  const maxX = Math.max(x, x + w);
  const minY = Math.min(y, y + h);
  const maxY = Math.max(y, y + h);
  return scene.nodes.filter(n => {
    if (ignoreLocked && scene.layers && n.layerId) {
      const lay = scene.layers.find(l => l.id === n.layerId);
      if (lay && (lay.locked || !lay.visible)) return false;
    }
    return n.x + n.width >= minX && n.x <= maxX && n.y + n.height >= minY && n.y <= maxY;
  });
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

// Walk the root scene and return a flat catalog of all scenes (root + nested),
// each with a breadcrumb path made of node-id chain and a human label.
export interface SceneCatalogEntry {
  scene: Scene;
  scenePath: string[]; // node-id chain from root to this scene
  labels: string[];
}

export function buildSceneCatalog(rootScene: Scene): SceneCatalogEntry[] {
  const out: SceneCatalogEntry[] = [];

  const walk = (scene: Scene, scenePath: string[], labels: string[]) => {
    out.push({ scene, scenePath: [...scenePath], labels: [...labels] });
    for (const n of scene.nodes) {
      if (n.innerScene) {
        walk(n.innerScene, [...scenePath, n.id], [...labels, nodeShortLabel(n)]);
      }
    }
  };
  walk(rootScene, [], ['World']);
  return out;
}

export function nodeShortLabel(node: SceneNode): string {
  if (node.text) return node.text.slice(0, 18) || 'Text';
  switch (node.type) {
    case 'path': return 'Drawing';
    case 'image': return 'Image';
    case 'rect': return 'Rectangle';
    case 'circle': return 'Circle';
    case 'group': return 'Group';
    default: return 'Object';
  }
}

// Walk a scene-id path from the root and return the resolved Scene at each step.
// If a step fails we return what we have so far.
export function resolveSceneByPath(rootScene: Scene, scenePath: string[]): Scene[] {
  const out: Scene[] = [rootScene];
  let cur: Scene = rootScene;
  for (const id of scenePath) {
    const n = cur.nodes.find(nn => nn.id === id);
    if (!n || !n.innerScene) return out;
    cur = n.innerScene;
    out.push(cur);
  }
  return out;
}

// Replace the scene at the end of a given scenePath, returning a new root scene
// whose internal nodes' innerScene are rebuilt accordingly.
export function replaceSceneAtPath(rootScene: Scene, scenePath: string[], newScene: Scene): Scene {
  if (scenePath.length === 0) return newScene;

  const [headId, ...rest] = scenePath;
  return {
    ...rootScene,
    nodes: rootScene.nodes.map(n => {
      if (n.id !== headId || !n.innerScene) return n;
      const updated = replaceSceneAtPath(n.innerScene, rest, newScene);
      return { ...n, innerScene: updated };
    }),
  };
}

// Compute innerScene bounds for a node based on its inner scene's nodes,
// and cache it on the node for later use during smooth zoom.
export function withInnerSceneBoundsCached(node: SceneNode): SceneNode {
  if (!node.innerScene) return node;
  const bb = getBoundingBox(node.innerScene.nodes);
  if (bb.width <= 0 || bb.height <= 0) return node;
  return { ...node, innerSceneBounds: bb };
}

/**
 * Compute the lens transform (inner-world → outer-world coords) for a node's inner scene.
 * Must stay in sync with drawLens() in renderer.ts and computeLensTransform in Canvas.tsx.
 * Returns null only when the fit rect degenerates (zero-area bounding box).
 */
export function computeLensTransform(
  node: SceneNode,
  inner: { nodes: SceneNode[]; bounds?: { width: number; height: number } },
): { s: number; ox: number; oy: number; fitWidth: number; fitHeight: number } | null {
  let fitX: number, fitY: number, fitW: number, fitH: number;

  if (inner.bounds) {
    fitX = -inner.bounds.width / 2;
    fitY = -inner.bounds.height / 2;
    fitW = inner.bounds.width;
    fitH = inner.bounds.height;
  } else if (inner.nodes.length === 0) {
    fitX = -node.width / 2;
    fitY = -node.height / 2;
    fitW = node.width;
    fitH = node.height;
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of inner.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    }
    fitX = minX; fitY = minY; fitW = maxX - minX; fitH = maxY - minY;
    if (fitW <= 0 || fitH <= 0) return null;
  }

  const pad = 0.05;
  let s: number;
  if (node.type === 'circle') {
    s = (1 - pad * 2) / Math.sqrt((fitW / node.width) ** 2 + (fitH / node.height) ** 2);
  } else {
    s = Math.min(node.width * (1 - pad * 2) / fitW, node.height * (1 - pad * 2) / fitH);
  }

  const lv = node.lensView;
  const userZoom = lv?.zoom ?? 1;
  const totalS = s * userZoom;
  const ox = node.x + node.width  / 2 - (fitX + fitW / 2) * totalS + (lv?.panX ?? 0);
  const oy = node.y + node.height / 2 - (fitY + fitH / 2) * totalS + (lv?.panY ?? 0);
  return { s: totalS, ox, oy, fitWidth: fitW, fitHeight: fitH };
}
