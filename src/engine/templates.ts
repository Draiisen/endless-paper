import { Scene } from '../types/scene';
import { createScene, createNode, addNode } from './scene-graph';

export type TemplateName = 'mindmap' | 'storyboard';

export function createTemplate(name: TemplateName, cx: number, cy: number): Scene {
  if (name === 'mindmap') {
    let s = createScene();
    // Central rect
    const center = createNode('rect', cx - 100, cy - 40, 200, 80);
    center.stroke = '#6c63ff'; center.fill = 'rgba(108,99,255,0.12)'; center.strokeWidth = 2;
    s = addNode(s, center);
    // Center label
    const cl = createNode('text', cx - 68, cy - 11, 136, 22);
    cl.text = 'Idée principale'; cl.fontSize = 15; cl.color = '#6c63ff'; cl.fontFamily = 'system-ui, sans-serif';
    s = addNode(s, cl);
    // 4 branches
    const branches = [
      { dx: -280, dy: -150, label: 'Branche A' },
      { dx: 180, dy: -150, label: 'Branche B' },
      { dx: -280, dy: 100, label: 'Branche C' },
      { dx: 180, dy: 100, label: 'Branche D' },
    ];
    for (const b of branches) {
      const br = createNode('circle', cx + b.dx, cy + b.dy, 130, 55);
      br.stroke = '#22c55e'; br.fill = 'rgba(34,197,94,0.08)'; br.strokeWidth = 1.5;
      s = addNode(s, br);
      const bt = createNode('text', cx + b.dx + 15, cy + b.dy + 18, 100, 20);
      bt.text = b.label; bt.fontSize = 13; bt.color = '#22c55e'; bt.fontFamily = 'system-ui, sans-serif';
      s = addNode(s, bt);
    }
    return s;
  }
  if (name === 'storyboard') {
    let s = createScene();
    const W = 260, H = 180, GAP = 28;
    const cols = 2, rows = 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const px = cx - (W + GAP / 2) + col * (W + GAP);
        const py = cy - (H + GAP / 2) + row * (H + GAP);
        const panel = createNode('rect', px, py, W, H);
        panel.stroke = '#475569'; panel.fill = 'rgba(255,255,255,0.03)'; panel.strokeWidth = 2;
        s = addNode(s, panel);
        const lbl = createNode('text', px + 10, py + 10, 100, 18);
        lbl.text = `Scène ${i + 1}`; lbl.fontSize = 12; lbl.color = '#64748b'; lbl.fontFamily = 'system-ui, sans-serif';
        s = addNode(s, lbl);
      }
    }
    return s;
  }
  return createScene();
}
