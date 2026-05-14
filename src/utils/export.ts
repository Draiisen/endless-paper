import { Scene, SceneNode, SceneLevel } from '../types/scene';

// Prevent </script> and <!-- sequences from breaking the inline <script> block.
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/<\/script>/gi, '<\\/script>')
    .replace(/<!--/g, '<\\!--');
}

// Escape a value for use inside an SVG attribute (double-quoted).
function svgAttr(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function exportToHTML(rootScene: Scene, _sceneStack: SceneLevel[]): string {
  const sceneData = safeJson(rootScene);
  const startCameraData = rootScene.startCamera ? safeJson(rootScene.startCamera.viewport) : 'null';
  const camerasData = rootScene.cameras && rootScene.cameras.length > 0 ? safeJson(rootScene.cameras) : 'null';

  const rendererJS = `
(function() {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d');
  var sceneData = ${sceneData};
  var startCamera = ${startCameraData};
  var sceneCameras = ${camerasData};

  var defaultVp = startCamera || { x: canvas.width / 2 || window.innerWidth / 2, y: canvas.height / 2 || window.innerHeight / 2, scale: 1 };
  var viewport = { x: defaultVp.x, y: defaultVp.y, scale: defaultVp.scale };
  var sceneStack = [{ scene: sceneData, label: 'World', parentNodeId: null, viewportWhenLeft: { x: 0, y: 0, scale: 1 } }];
  var selectedNode = null;
  var activePopup = null;
  var hoverPopupNode = null;

  // DFS: find a scene by id anywhere in the tree
  function findSceneById(scene, id) {
    if (scene.id === id) return scene;
    for (var i = 0; i < scene.nodes.length; i++) {
      if (scene.nodes[i].innerScene) {
        var found = findSceneById(scene.nodes[i].innerScene, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Return only nodes on visible layers (or nodes with no layerId)
  function visibleNodes(scene) {
    if (!scene.layers || scene.layers.length === 0) return scene.nodes;
    var visible = {};
    for (var i = 0; i < scene.layers.length; i++) {
      if (scene.layers[i].visible !== false) visible[scene.layers[i].id] = true;
    }
    return scene.nodes.filter(function(n) { return !n.layerId || visible[n.layerId]; });
  }

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

  function drawNode(node, layerAlpha) {
    if (node.isReference) return;
    var nodeAlpha = (node.layerId && layerAlpha && layerAlpha[node.layerId] !== undefined) ? layerAlpha[node.layerId] : 1;
    ctx.save();
    if (nodeAlpha !== 1) ctx.globalAlpha = nodeAlpha;
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

    var layerAlpha = {};
    if (scene.layers) {
      for (var li = 0; li < scene.layers.length; li++) {
        var ld = scene.layers[li];
        layerAlpha[ld.id] = ld.opacity !== undefined ? ld.opacity : 1;
      }
    }
    visibleNodes(scene).forEach(function(n) { drawNode(n, layerAlpha); });
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

  function showHotspotPopup(node, screenX, screenY) {
    dismissPopup();
    var hs = node.hotspot;
    if (!hs) return;
    var el;
    if (hs.type === 'text') {
      el = document.createElement('div');
      el.style.cssText = 'position:fixed;z-index:100;background:rgba(26,26,46,0.95);color:#fff;padding:12px 16px;border-radius:10px;max-width:320px;font-size:14px;line-height:1.5;box-shadow:0 4px 20px rgba(0,0,0,0.4);backdrop-filter:blur(8px);';
      if (hs.title) { var h = document.createElement('div'); h.style.cssText='font-weight:700;margin-bottom:6px;font-size:15px;'; h.textContent=hs.title; el.appendChild(h); }
      var p = document.createElement('div'); p.textContent = hs.content; el.appendChild(p);
      var close = document.createElement('button'); close.textContent='×'; close.style.cssText='position:absolute;top:6px;right:10px;background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;line-height:1;'; close.onclick=dismissPopup; el.appendChild(close);
      el.style.left = Math.min(screenX + 12, window.innerWidth - 340) + 'px';
      el.style.top = Math.max(10, screenY - 20) + 'px';
    } else {
      // Window modal
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;';
      overlay.onclick = function(ev) { if (ev.target === overlay) dismissPopup(); };
      el = document.createElement('div');
      el.style.cssText = 'background:rgba(26,26,46,0.98);color:#fff;padding:24px;border-radius:12px;max-width:' + (hs.width || 400) + 'px;width:90%;max-height:' + (hs.height || 500) + 'px;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.6);position:relative;';
      if (hs.title) { var h2 = document.createElement('h2'); h2.style.cssText='margin:0 0 12px;font-size:18px;'; h2.textContent=hs.title; el.appendChild(h2); }
      var p2 = document.createElement('div'); p2.style.cssText='font-size:14px;line-height:1.6;'; p2.textContent = hs.content; el.appendChild(p2);
      var close2 = document.createElement('button'); close2.textContent='Close'; close2.style.cssText='margin-top:16px;padding:8px 20px;background:#4a90d9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;'; close2.onclick=dismissPopup; el.appendChild(close2);
      overlay.appendChild(el);
      document.body.appendChild(overlay);
      activePopup = overlay;
      return;
    }
    document.body.appendChild(el);
    activePopup = el;
  }

  function dismissPopup() {
    if (activePopup) { activePopup.remove(); activePopup = null; }
  }

  canvas.addEventListener('pointerdown', function(e) {
    if (e.button === 1 || e.button === 0) {
      isPanning = e.button === 1;
      lastMouse = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);

      if (e.button === 0) {
        var w = screenToWorld(e.clientX, e.clientY);
        var node = getNodeAt(w.x, w.y);
        if (node) {
          // Portal navigation
          if (node.portal && node.portal.targetSceneId) {
            var target = findSceneById(sceneData, node.portal.targetSceneId);
            if (target) {
              sceneStack[sceneStack.length - 1].viewportWhenLeft = JSON.parse(JSON.stringify(viewport));
              var portalVp = node.portal.targetCamera || { x: canvas.width/2, y: canvas.height/2, scale: 1 };
              sceneStack.push({ scene: target, label: 'Portal', parentNodeId: node.id, viewportWhenLeft: portalVp });
              viewport = JSON.parse(JSON.stringify(portalVp));
              selectedNode = null;
              render();
              return;
            }
          }
          // Hotspot click handler
          if (node.hotspot && node.hotspot.trigger === 'click') {
            showHotspotPopup(node, e.clientX, e.clientY);
            render();
            return;
          }
          selectedNode = node;
          dragNode = node;
          dragOffset = { x: w.x - node.x, y: w.y - node.y };
        } else {
          dismissPopup();
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
      var ww = screenToWorld(e.clientX, e.clientY);
      dragNode.x = ww.x - dragOffset.x;
      dragNode.y = ww.y - dragOffset.y;
      render();
    } else {
      // Hover hotspots
      var hw = screenToWorld(e.clientX, e.clientY);
      var hoverNode = getNodeAt(hw.x, hw.y);
      if (hoverNode && hoverNode.hotspot && hoverNode.hotspot.trigger === 'hover') {
        if (hoverNode !== hoverPopupNode) {
          hoverPopupNode = hoverNode;
          showHotspotPopup(hoverNode, e.clientX, e.clientY);
        }
      } else if (hoverPopupNode) {
        hoverPopupNode = null;
        dismissPopup();
      }
    }
  });

  canvas.addEventListener('pointerup', function(e) {
    isPanning = false;
    dragNode = null;

    var now = Date.now();
    var dist = Math.hypot(e.clientX - lastClickPos.x, e.clientY - lastClickPos.y);
    if (now - lastClickTime < 400 && dist < 10) {
      // Double click — enter inner scene or hotspot doubleclick
      var w = screenToWorld(e.clientX, e.clientY);
      var node = getNodeAt(w.x, w.y);
      if (node && node.hotspot && node.hotspot.trigger === 'doubleclick') {
        showHotspotPopup(node, e.clientX, e.clientY);
      } else if (node && node.innerScene && node.innerScene.nodes.length > 0) {
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

  // Camera tour
  var tourIndex = 0;
  var tourRunning = false;

  function navigateToScenePath(path) {
    sceneStack = [{ scene: sceneData, label: 'World', parentNodeId: null, viewportWhenLeft: { x: 0, y: 0, scale: 1 } }];
    var cur = sceneData;
    for (var pi = 0; pi < path.length; pi++) {
      var nid = path[pi];
      var pn = null;
      for (var ni = 0; ni < cur.nodes.length; ni++) {
        if (cur.nodes[ni].id === nid) { pn = cur.nodes[ni]; break; }
      }
      if (!pn || !pn.innerScene) break;
      sceneStack.push({ scene: pn.innerScene, label: pn.text || 'Scene', parentNodeId: nid, viewportWhenLeft: { x: 0, y: 0, scale: 1 } });
      cur = pn.innerScene;
    }
  }

  function easeInOut(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
  function animateViewportTo(targetVp, durationMs, onDone) {
    var start = JSON.parse(JSON.stringify(viewport));
    var startTime = Date.now();
    function step() {
      var elapsed = Date.now() - startTime;
      var t = Math.min(1, elapsed / durationMs);
      var e = easeInOut(t);
      viewport.x = start.x + (targetVp.x - start.x) * e;
      viewport.y = start.y + (targetVp.y - start.y) * e;
      viewport.scale = start.scale + (targetVp.scale - start.scale) * e;
      render();
      if (t < 1) { requestAnimationFrame(step); } else if (onDone) { onDone(); }
    }
    requestAnimationFrame(step);
  }
  window.playTour = function() {
    if (!sceneCameras || sceneCameras.length === 0) return;
    if (tourRunning) { tourRunning = false; return; }
    tourRunning = true;
    tourIndex = 0;
    var btn = document.getElementById('tour-btn');
    function playNext() {
      if (!tourRunning || tourIndex >= sceneCameras.length) {
        tourRunning = false;
        if (btn) btn.textContent = '▶ Play';
        return;
      }
      var cam = sceneCameras[tourIndex++];
      if (btn) btn.textContent = '■ Stop';
      if (cam.scenePath && cam.scenePath.length > 0) {
        navigateToScenePath(cam.scenePath);
      } else if (sceneStack.length > 1) {
        sceneStack = [{ scene: sceneData, label: 'World', parentNodeId: null, viewportWhenLeft: { x: 0, y: 0, scale: 1 } }];
      }
      animateViewportTo(cam.viewport, cam.transitionMs || 600, function() {
        setTimeout(playNext, cam.duration || 2000);
      });
    }
    playNext();
  };

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
    ${camerasData !== 'null' ? `<button id="tour-btn" onclick="playTour()" style="padding:4px 12px;background:#4a90d9;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">▶ Play</button>` : ''}
    <span id="zoom">100%</span>
  </div>
  <canvas id="canvas" style="margin-top:40px"></canvas>
  <script>${rendererJS}</script>
</body>
</html>`;
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function downloadHTML(rootScene: Scene, sceneStack: SceneLevel[]): void {
  const html = exportToHTML(rootScene, sceneStack);
  const blob = new Blob([html], { type: 'text/html' });
  triggerDownload(URL.createObjectURL(blob), 'endless-paper-export.html');
}

export function downloadJSON(rootScene: Scene): void {
  const json = JSON.stringify(rootScene, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  triggerDownload(URL.createObjectURL(blob), 'endless-paper.json');
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
      const path2d: Path2D = new Path2D(node.path.d);
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

// Export scene nodes as SVG (attribute values are svgAttr-escaped)
export function exportToSVG(scene: Scene, width = 800, height = 600): string {
  let svgContent = '';

  for (const node of scene.nodes) {
    if (node.isReference) continue; // skip tracing overlays
    if (node.type === 'path' && node.path) {
      const vp = node.path;
      svgContent += `<path d="${svgAttr(vp.d)}" stroke="${svgAttr(vp.stroke)}" stroke-width="${svgAttr(vp.strokeWidth)}" fill="${svgAttr(vp.fill)}" opacity="${svgAttr(vp.opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else if (node.type === 'rect') {
      svgContent += `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${svgAttr(node.fill ?? 'none')}" stroke="${svgAttr(node.stroke ?? 'none')}" stroke-width="${node.strokeWidth ?? 1}"/>`;
    } else if (node.type === 'circle') {
      const cx = node.x + node.width / 2;
      const cy = node.y + node.height / 2;
      svgContent += `<ellipse cx="${cx}" cy="${cy}" rx="${node.width / 2}" ry="${node.height / 2}" fill="${svgAttr(node.fill ?? 'none')}" stroke="${svgAttr(node.stroke ?? 'none')}" stroke-width="${node.strokeWidth ?? 1}"/>`;
    } else if (node.type === 'image' && node.isVectorized && node.vectorPaths) {
      for (const vp of node.vectorPaths) {
        svgContent += `<path d="${svgAttr(vp.d)}" stroke="${svgAttr(vp.stroke)}" stroke-width="${svgAttr(vp.strokeWidth)}" fill="${svgAttr(vp.fill)}" opacity="${svgAttr(vp.opacity)}"/>`;
      }
    } else if (node.type === 'image' && node.imageData) {
      // imageData is a data URI; escape & only (no quotes expected in data URIs)
      svgContent += `<image x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" href="${svgAttr(node.imageData)}"/>`;
    } else if (node.type === 'text' && node.text) {
      const fontSize = node.fontSize ?? 16;
      const fontFamily = node.fontFamily ?? 'system-ui, sans-serif';
      const color = node.color ?? '#1a1a2e';
      const lines = node.text.split('\n');
      const lh = fontSize * 1.2;
      svgContent += `<text x="${node.x}" y="${node.y + fontSize}" font-size="${fontSize}" font-family="${svgAttr(fontFamily)}" fill="${svgAttr(color)}">`;
      for (let i = 0; i < lines.length; i++) {
        const xml = lines[i].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        svgContent += `<tspan x="${node.x}" dy="${i === 0 ? 0 : lh}">${xml}</tspan>`;
      }
      svgContent += `</text>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${svgAttr(scene.background)}"/>
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
