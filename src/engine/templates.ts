import { Scene } from '../types/scene';
import { createScene, createNode, addNode } from './scene-graph';

export type TemplateName = 'mindmap' | 'storyboard' | 'presentation';

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
  if (name === 'presentation') {
    let s = createScene();
    const W = 560, H = 315, GAP = 48;
    const slides = [
      { title: 'Titre', body: 'Sous-titre ou accroche ici', accent: '#6c63ff' },
      { title: 'Contenu', body: '• Point 1\n• Point 2\n• Point 3', accent: '#22c55e' },
      { title: 'Conclusion', body: 'Votre message final ici', accent: '#f59e0b' },
    ];
    slides.forEach((slide, i) => {
      const px = cx - ((slides.length - 1) * (W + GAP)) / 2 + i * (W + GAP);
      const frame = createNode('rect', px - W / 2, cy - H / 2, W, H);
      frame.stroke = slide.accent; frame.fill = `${slide.accent}08`; frame.strokeWidth = 2;
      s = addNode(s, frame);
      const num = createNode('text', px - W / 2 + 16, cy - H / 2 + 14, 40, 16);
      num.text = `${i + 1}/${slides.length}`; num.fontSize = 11; num.color = `${slide.accent}80`; num.fontFamily = 'system-ui, sans-serif';
      s = addNode(s, num);
      const title = createNode('text', px - W / 2 + 32, cy - H / 2 + H * 0.28, W - 64, 36);
      title.text = slide.title; title.fontSize = 26; title.fontWeight = 'bold'; title.color = '#f8fafc'; title.fontFamily = 'system-ui, sans-serif';
      s = addNode(s, title);
      const body = createNode('text', px - W / 2 + 32, cy - H / 2 + H * 0.55, W - 64, 80);
      body.text = slide.body; body.fontSize = 14; body.color = '#94a3b8'; body.fontFamily = 'system-ui, sans-serif';
      s = addNode(s, body);
    });
    return s;
  }
  return createScene();
}
