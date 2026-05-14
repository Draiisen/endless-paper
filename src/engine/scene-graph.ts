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

export function getNodeAtPoint(scene: Scene, worldX: number, worldY: number): SceneNode | undefined {
  // Iterate in reverse order so top-most nodes are hit first
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const node = scene.nodes[i];
    if (hitTest(node, worldX, worldY)) {
      return node;
    }
  }
  return undefined;
}

function hitTest(node: SceneNode, worldX: number, worldY: number): boolean {
  const margin = Math.max(5, (node.strokeWidth ?? 1) / 2 + 2);
  return (
    worldX >= node.x - margin &&
    worldX <= node.x + node.width + margin &&
    worldY >= node.y - margin &&
    worldY <= node.y + node.height + margin
  );
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
