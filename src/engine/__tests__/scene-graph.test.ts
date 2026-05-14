import { describe, it, expect } from 'vitest';
import {
  createScene,
  createNode,
  addNode,
  removeNode,
  updateNode,
  getBoundingBox,
  buildSceneCatalog,
  ensureInnerScene,
  getNodesInRect,
} from '../scene-graph';
import type { SceneNode } from '../../types/scene';

describe('createScene', () => {
  it('creates a scene with an id and empty nodes', () => {
    const scene = createScene();
    expect(scene.id).toBeTruthy();
    expect(scene.nodes).toHaveLength(0);
    expect(scene.layers).toHaveLength(1);
  });

  it('creates scenes with unique ids', () => {
    const s1 = createScene();
    const s2 = createScene();
    expect(s1.id).not.toBe(s2.id);
  });
});

describe('createNode', () => {
  it('creates a node with correct type and bounds', () => {
    const node = createNode('rect', 10, 20, 100, 50);
    expect(node.type).toBe('rect');
    expect(node.x).toBe(10);
    expect(node.y).toBe(20);
    expect(node.width).toBe(100);
    expect(node.height).toBe(50);
    expect(node.id).toBeTruthy();
  });
});

describe('addNode', () => {
  it('adds a node to the scene', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    const updated = addNode(scene, node);
    expect(updated.nodes).toHaveLength(1);
    expect(updated.nodes[0].id).toBe(node.id);
  });

  it('does not mutate the original scene', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    addNode(scene, node);
    expect(scene.nodes).toHaveLength(0);
  });

  it('assigns layerId when not set', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    const updated = addNode(scene, node);
    expect(updated.nodes[0].layerId).toBeTruthy();
  });
});

describe('removeNode', () => {
  it('removes a node by id', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    const with1 = addNode(scene, node);
    const without = removeNode(with1, node.id);
    expect(without.nodes).toHaveLength(0);
  });

  it('is a no-op for unknown id', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    const with1 = addNode(scene, node);
    const result = removeNode(with1, 'nonexistent');
    expect(result.nodes).toHaveLength(1);
  });
});

describe('updateNode', () => {
  it('updates fields on matching node', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 10, 10);
    const with1 = addNode(scene, node);
    const updated = updateNode(with1, node.id, { x: 99 });
    expect(updated.nodes[0].x).toBe(99);
    expect(updated.nodes[0].y).toBe(0); // unchanged
  });
});

describe('getBoundingBox', () => {
  it('returns zero box for empty array', () => {
    const bb = getBoundingBox([]);
    expect(bb).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('returns correct box for single node', () => {
    const node: SceneNode = { id: '1', type: 'rect', x: 10, y: 20, width: 50, height: 30 };
    const bb = getBoundingBox([node]);
    expect(bb).toEqual({ x: 10, y: 20, width: 50, height: 30 });
  });

  it('computes union for multiple nodes', () => {
    const n1: SceneNode = { id: '1', type: 'rect', x: 0, y: 0, width: 10, height: 10 };
    const n2: SceneNode = { id: '2', type: 'rect', x: 20, y: 5, width: 10, height: 10 };
    const bb = getBoundingBox([n1, n2]);
    expect(bb.x).toBe(0);
    expect(bb.y).toBe(0);
    expect(bb.width).toBe(30); // 0..30
    expect(bb.height).toBe(15); // 0..15
  });
});

describe('getNodesInRect', () => {
  it('returns nodes overlapping the rect', () => {
    const scene = createScene();
    const n1 = createNode('rect', 0, 0, 10, 10);
    const n2 = createNode('rect', 100, 100, 10, 10);
    const s = addNode(addNode(scene, n1), n2);
    const hits = getNodesInRect(s, 0, 0, 15, 15);
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(n1.id);
  });
});

describe('buildSceneCatalog', () => {
  it('includes root scene', () => {
    const scene = createScene();
    const catalog = buildSceneCatalog(scene);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].scene.id).toBe(scene.id);
  });

  it('includes nested inner scenes', () => {
    const scene = createScene();
    const node = createNode('rect', 0, 0, 100, 100);
    const withInner = ensureInnerScene(node);
    const s = addNode(scene, withInner);
    const catalog = buildSceneCatalog(s);
    expect(catalog).toHaveLength(2);
  });
});
