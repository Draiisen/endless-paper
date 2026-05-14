import { Scene, SceneNode, SceneLevel } from '../types/scene';

export function exportToHTML(rootScene: Scene, _sceneStack: SceneLevel[]): string {
  const sceneData = JSON.stringify(rootScene);

  const rendererJS = `
(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var sceneData = ${sceneData};

  var viewport = { x: 0, y: 0, scale: 1 };
  var sceneStack = [{ scene: sceneData, label: 'World', parentNodeId: null, viewportWhenLeft: { x: 0, y: 0, scale: 1 } }];
  var selectedNode = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    render();
  }

  function currentScene() {
    return sceneStack[sceneStack.length - 1].scene;
  }

  var imageCache = {};

  function getImage(src) {
    if (!imageCache[src]) {
      var img = new Image();
      img.src = src;
      img.onload = function() { render(); };
      imageCache[src] = img;
    }
    return imageCache[src];
  }

  function drawVectorPath(vp) {
    var p = new Path2D(vp.d);
    ctx.globalAlpha = vp.opacity || 1;
    if (vp.fill && vp.fill !== 'none') {
      ctx.fillStyle = vp.fill;
      ctx.fill(p);
    }
    if (vp.stroke && vp.stroke !== 'none') {
      ctx.strokeStyle = vp.stroke;
      ctx.lineWidth = vp.strokeWidth || 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
  }

  function drawNode(node) {
    ctx.save();
    switch (node.type) {
      case 'path':
        if (node.path) drawVectorPath(node.path);
        break;
      case 'image':
        if (node.isVectorized && node.vectorPaths && node.vectorPaths.length) {
          node.vectorPaths.forEach(drawVectorPath);
        } else if (node.imageData) {
          var img = getImage(node.imageData);
          if (img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, node.x, node.y, node.width, node.height);
          } else {
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(node.x, node.y, node.width, node.height);
          }
        }
        break;
      case 'rect':
        ctx.beginPath();
        ctx.rect(node.x, node.y, node.width, node.height);
        if (node.fill && node.fill !== 'none') { ctx.fillStyle = node.fill; ctx.fill(); }
        if (node.stroke && node.stroke !== 'none') { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth || 2; ctx.stroke(); }
        break;
      case 'circle':
        ctx.beginPath();
        ctx.ellipse(node.x + node.width/2, node.y + node.height/2, node.width/2, node.height/2, 0, 0, Math.PI*2);
        if (node.fill && node.fill !== 'none') { ctx.fillStyle = node.fill; ctx.fill(); }
        if (node.stroke && node.stroke !== 'none') { ctx.strokeStyle = node.stroke; ctx.lineWidth = node.strokeWidth || 2; ctx.stroke(); }
        break;
      case 'text':
        if (node.text) {
          var fs = node.fontSize || 16;
          ctx.font = fs + 'px ' + (node.fontFamily || 'system-ui, sans-serif');
          ctx.textBaseline = 'top';
          ctx.fillStyle = node.color || '#1a1a2e';
          var lines = node.text.split('\\n');
          for (var i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], node.x, node.y + i * fs * 1.2);
          }
        }
        break;
    }

    if (node.innerScene && node.innerScene.nodes.length > 0) {
      ctx.strokeStyle = 'rgba(74,144,217,0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4,4]);
      ctx.strokeRect(node.x, node.y, node.width, node.height);
      ctx.setLineDash([]);
    }

    if (selectedNode && selectedNode.id === node.id) {
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5,3]);
      ctx.strokeRect(node.x-4, node.y-4, node.width+8, node.height+8);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  function render() {
    var scene = currentScene();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = scene.background || '#f8f7f4';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.save();
    ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);

    // Grid
    var scale = viewport.scale;
    var gs = scale < 0.5 ? 200 : scale < 2 ? 100 : scale > 10 ? 20 : 50;
    var wl = -viewport.x / scale, wt = -viewport.y / scale;
    var wr = (canvas.width - viewport.x) / scale, wb = (canvas.height - viewport.y) / scale;
    var sx = Math.floor(wl / gs) * gs, sy = Math.floor(wt / gs) * gs;
    ctx.strokeStyle = 'rgba(26,26,46,0.06)';
    ctx.lineWidth = 1 / scale;
    for (var x = sx; x <= wr; x += gs) { ctx.beginPath(); ctx.moveTo(x, wt); ctx.lineTo(x, wb); ctx.stroke(); }
    for (var y = sy; y <= wb; y += gs) { ctx.beginPath(); ctx.moveTo(wl, y); ctx.lineTo(wr, y); ctx.stroke(); }

    scene.nodes.forEach(drawNode);
    ctx.restore();

    updateBreadcrumb();
    updateZoom();
  }

  function updateBreadcrumb() {
    var bc = document.getElementById('breadcrumb');
    bc.innerHTML = sceneStack.map(function(s, i) {
      var span = '<span style="cursor:pointer;padding:2px 6px;border-radius:4px;" onclick="navigateTo(' + i + ')">' + s.label + '</span>';
      return span;
    }).join('<span style="color:#888;margin:0 2px">›</span>');
  }

  function updateZoom() {
    var z = document.getElementById('zoom');
    z.textContent = Math.round(viewport.scale * 100) + '%';
  }

  window.navigateTo = function(index) {
    if (index >= sceneStack.length - 1) return;
    sceneStack[sceneStack.length - 1].viewportWhenLeft = JSON.parse(JSON.stringify(viewport));
    sceneStack = sceneStack.slice(0, index + 1);
    viewport = JSON.parse(JSON.stringify(sceneStack[index].viewportWhenLeft));
    selectedNode = null;
    render();
  };

  function screenToWorld(sx, sy) {
    return { x: (sx - viewport.x) / viewport.scale, y: (sy - viewport.y) / viewport.scale };
  }

  function getNodeAt(wx, wy) {
    var scene = currentScene();
    var nodes = scene.nodes;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      var margin = 5;
      if (wx >= n.x - margin && wx <= n.x + n.width + margin && wy >= n.y - margin && wy <= n.y + n.height + margin) {
        return n;
      }
    }
    return null;
  }

  var isPanning = false;
  var lastMouse = { x: 0, y: 0 };
  var lastClickTime = 0;
  var lastClickPos = { x: 0, y: 0 };
  var dragNode = null;
  var dragOffset = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', function(e) {
    if (e.button === 1 || e.button === 0) {
      isPanning = e.button === 1;
      lastMouse = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);

      if (e.button === 0) {
        var w = screenToWorld(e.clientX, e.clientY);
        var node = getNodeAt(w.x, w.y);
        if (node) {
          selectedNode = node;
          dragNode = node;
          dragOffset = { x: w.x - node.x, y: w.y - node.y };
        } else {
          selectedNode = null;
          dragNode = null;
          isPanning = true;
        }
        render();
      }
    }
  });

  canvas.addEventListener('pointermove', function(e) {
    var dx = e.clientX - lastMouse.x;
    var dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };

    if (isPanning) {
      viewport.x += dx;
      viewport.y += dy;
      render();
    } else if (dragNode && e.buttons === 1) {
      var w = screenToWorld(e.clientX, e.clientY);
      dragNode.x = w.x - dragOffset.x;
      dragNode.y = w.y - dragOffset.y;
      render();
    }
  });

  canvas.addEventListener('pointerup', function(e) {
    isPanning = false;
    dragNode = null;

    var now = Date.now();
    var dist = Math.hypot(e.clientX - lastClickPos.x, e.clientY - lastClickPos.y);
    if (now - lastClickTime < 400 && dist < 10) {
      // Double click — enter inner scene
      var w = screenToWorld(e.clientX, e.clientY);
      var node = getNodeAt(w.x, w.y);
      if (node && node.innerScene && node.innerScene.nodes.length > 0) {
        sceneStack[sceneStack.length - 1].viewportWhenLeft = JSON.parse(JSON.stringify(viewport));
        sceneStack.push({ scene: node.innerScene, label: 'Scene ' + (sceneStack.length), parentNodeId: node.id, viewportWhenLeft: { x: canvas.width/2, y: canvas.height/2, scale: 1 } });
        viewport = { x: canvas.width/2, y: canvas.height/2, scale: 1 };
        selectedNode = null;
        render();
      }
      lastClickTime = 0;
    } else {
      lastClickTime = now;
      lastClickPos = { x: e.clientX, y: e.clientY };
    }
  });

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var delta = -e.deltaY;
    var factor = delta > 0 ? 1.1 : 1/1.1;
    var newScale = Math.max(0.001, Math.min(50000, viewport.scale * factor));
    var actualFactor = newScale / viewport.scale;
    viewport.x = e.clientX - (e.clientX - viewport.x) * actualFactor;
    viewport.y = e.clientY - (e.clientY - viewport.y) * actualFactor;
    viewport.scale = newScale;
    render();
  }, { passive: false });

  // Touch support
  var touch1 = null, touch2 = null, lastPinchDist = 0;
  canvas.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      touch1 = e.touches[0]; touch2 = null; isPanning = true;
    } else if (e.touches.length === 2) {
      touch1 = e.touches[0]; touch2 = e.touches[1];
      lastPinchDist = Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY);
      isPanning = false;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (e.touches.length === 2 && touch1 && touch2) {
      var t1 = e.touches[0], t2 = e.touches[1];
      var newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      var pinchDelta = newDist - lastPinchDist;
      lastPinchDist = newDist;
      var cx = (t1.clientX + t2.clientX) / 2, cy = (t1.clientY + t2.clientY) / 2;
      var pcx = (touch1.clientX + touch2.clientX) / 2, pcy = (touch1.clientY + touch2.clientY) / 2;
      viewport.x += cx - pcx; viewport.y += cy - pcy;
      if (Math.abs(pinchDelta) > 0.5) {
        var factor = pinchDelta > 0 ? 1.02 : 0.98;
        var ns = Math.max(0.001, Math.min(50000, viewport.scale * factor));
        var af = ns / viewport.scale;
        viewport.x = cx - (cx - viewport.x) * af; viewport.y = cy - (cy - viewport.y) * af;
        viewport.scale = ns;
      }
      touch1 = t1; touch2 = t2;
      render();
    } else if (e.touches.length === 1 && isPanning && touch1) {
      var t = e.touches[0];
      viewport.x += t.clientX - touch1.clientX; viewport.y += t.clientY - touch1.clientY;
      touch1 = t; render();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    e.preventDefault();
    if (e.touches.length < 2) { touch2 = null; }
    if (e.touches.length === 0) { touch1 = null; isPanning = false; }
  }, { passive: false });

  window.addEventListener('resize', resize);
  resize();
})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
  <title>Endless Paper — Export</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #f8f7f4; overflow: hidden; font-family: system-ui, sans-serif; }
    #canvas { display: block; touch-action: none; }
    #ui {
      position: fixed; top: 0; left: 0; right: 0;
      display: flex; align-items: center; gap: 12px;
      padding: 8px 16px;
      background: rgba(26, 26, 46, 0.9);
      backdrop-filter: blur(8px);
      color: white;
      font-size: 13px;
      z-index: 10;
    }
    #breadcrumb { flex: 1; display: flex; align-items: center; gap: 4px; }
    #breadcrumb span:hover { background: rgba(255,255,255,0.1); }
    #zoom { color: #4a90d9; font-weight: 600; min-width: 60px; text-align: right; }
    #hint { color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div id="ui">
    <span style="color:#4a90d9;font-weight:700;margin-right:8px">✏ Endless Paper</span>
    <div id="breadcrumb"></div>
    <span id="hint">Double-click to enter scenes · Scroll to zoom · Drag to pan</span>
    <span id="zoom">100%</span>
  </div>
  <canvas id="canvas" style="margin-top:40px"></canvas>
  <script>${rendererJS}</script>
</body>
</html>`;
}

export function downloadHTML(rootScene: Scene, sceneStack: SceneLevel[]): void {
  const html = exportToHTML(rootScene, sceneStack);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'endless-paper-export.html';
  a.click();
  URL.revokeObjectURL(url);
}

export function serializeScene(scene: Scene): string {
  return JSON.stringify(scene, null, 2);
}

export function deserializeScene(json: string): Scene {
  return JSON.parse(json) as Scene;
}

// Generate thumbnail of scene as base64 PNG
export async function generateThumbnail(scene: Scene, width = 200, height = 150): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, width, height);

  // Simple preview - just draw paths
  for (const node of scene.nodes) {
    if (node.type === 'path' && node.path) {
      ctx.save();
      const path2d = new Path2D(node.path.d);
      if (node.path.stroke && node.path.stroke !== 'none') {
        ctx.strokeStyle = node.path.stroke;
        ctx.lineWidth = node.path.strokeWidth;
        ctx.stroke(path2d);
      }
      ctx.restore();
    }
  }

  return canvas.toDataURL('image/png');
}

// Export scene nodes as SVG
export function exportToSVG(scene: Scene, width = 800, height = 600): string {
  let svgContent = '';

  for (const node of scene.nodes) {
    if (node.type === 'path' && node.path) {
      const vp = node.path;
      svgContent += `<path d="${vp.d}" stroke="${vp.stroke}" stroke-width="${vp.strokeWidth}" fill="${vp.fill}" opacity="${vp.opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (node.type === 'rect') {
      svgContent += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${node.fill || 'none'}" stroke="${node.stroke || 'none'}" stroke-width="${node.strokeWidth || 1}"/>`;
    } else if (node.type === 'circle') {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      svgContent += `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${node.fill || 'none'}" stroke="${node.stroke || 'none'}" stroke-width="${node.strokeWidth || 1}"/>`;
    } else if (node.type === 'image' && node.isVectorized && node.vectorPaths) {
      for (const vp of node.vectorPaths) {
        svgContent += `<path d="${vp.d}" stroke="${vp.stroke}" stroke-width="${vp.strokeWidth}" fill="${vp.fill}" opacity="${vp.opacity}"/>`;
      }
    } else if (node.type === 'image' && node.imageData) {
      svgContent += `<image x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" href="${node.imageData}"/>`;
    } else if (node.type === 'text' && node.text) {
      const fontSize = node.fontSize ?? 16;
      const fontFamily = node.fontFamily ?? 'system-ui, sans-serif';
      const color = node.color ?? '#1a1a2e';
      const lines = node.text.split('\n');
      const lh = fontSize * 1.2;
      svgContent += `<text x="${node.x}" y="${node.y + fontSize}" font-size="${fontSize}" font-family="${fontFamily.replace(/"/g, '&quot;')}" fill="${color}">`;
      for (let i = 0; i < lines.length; i++) {
        const xml = lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        svgContent += `<tspan x="${node.x}" dy="${i === 0 ? 0 : lh}">${xml}</tspan>`;
      }
      svgContent += `</text>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${scene.background}"/>
  ${svgContent}
</svg>`;
}

// Helper to get a SceneNode's display name
export function getNodeLabel(node: SceneNode): string {
  switch (node.type) {
    case 'path': return 'Drawing';
    case 'image': return 'Image';
    case 'rect': return 'Rectangle';
    case 'circle': return 'Circle';
    case 'group': return 'Group';
    case 'text': return 'Text';
    default: return 'Object';
  }
}
