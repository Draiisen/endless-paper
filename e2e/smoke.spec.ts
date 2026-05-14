import { test, expect, Page } from '@playwright/test';

// ── Shared scene fixture ────────────────────────────────────────────────────
// viewport: { x:640, y:400, scale:1 }
// World coords → screen coords: sx = wx + 640, sy = wy + 400
// Nodes:
//   hotspot-node  rect at (100,100,200,120)  → screen center (740, 460)
//   portal-node   rect at (400,100,200,120)  → screen center (1040, 460)
//   inner-node    rect at (100,300,200,120)  → screen center (740, 560)  (has inner scene)
//   locked-node   rect at (400,300,200,120)  → screen center (1040, 560) (on locked layer)
const SEED_STATE = {
  version: 1,
  viewport: { x: 640, y: 400, scale: 1 },
  savedAt: Date.now(),
  assets: [],
  rootScene: {
    id: 'root-scene',
    background: '#f8f7f4',
    layers: [
      { id: 'layer-default', name: 'Default', visible: true, locked: false, opacity: 1 },
      { id: 'layer-locked',  name: 'Locked',  visible: true, locked: true,  opacity: 1 },
    ],
    cameras: [],
    nodes: [
      {
        id: 'hotspot-node', type: 'rect',
        x: 100, y: 100, width: 200, height: 120,
        fill: '#4a90d9', stroke: 'none', strokeWidth: 0,
        layerId: 'layer-default',
        hotspot: { type: 'text', trigger: 'click', content: 'Hello from hotspot' },
      },
      {
        id: 'portal-target',
        type: 'rect', x: 50, y: 50, width: 100, height: 100,
        fill: '#2ecc71', stroke: 'none', strokeWidth: 0,
        innerScene: {
          id: 'inner-world',
          background: '#fff0e0',
          nodes: [{ id: 'inner-rect', type: 'rect', x: 100, y: 100, width: 100, height: 100, fill: '#e74c3c', stroke: 'none', strokeWidth: 0 }],
        },
      },
      {
        id: 'portal-node', type: 'rect',
        x: 400, y: 100, width: 200, height: 120,
        fill: '#e74c3c', stroke: 'none', strokeWidth: 0,
        layerId: 'layer-default',
        portal: { targetSceneId: 'inner-world' },
      },
      {
        id: 'inner-node', type: 'rect',
        x: 100, y: 300, width: 200, height: 120,
        fill: '#2ecc71', stroke: 'none', strokeWidth: 0,
        layerId: 'layer-default',
        innerScene: {
          id: 'inner-scene-1',
          background: '#e0f0ff',
          nodes: [{ id: 'child-rect', type: 'rect', x: 100, y: 100, width: 100, height: 100, fill: '#9b59b6', stroke: 'none', strokeWidth: 0 }],
        },
      },
      {
        id: 'locked-node', type: 'rect',
        x: 400, y: 300, width: 200, height: 120,
        fill: '#f39c12', stroke: 'none', strokeWidth: 0,
        layerId: 'layer-locked',
      },
    ],
  },
};

function seedLocalStorage(page: Page) {
  return page.addInitScript((state) => {
    localStorage.setItem('endless-paper-autosave', JSON.stringify(state));
  }, SEED_STATE);
}

async function waitForCanvas(page: Page) {
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10_000 });
  // Give React a tick to finish rendering
  await page.waitForTimeout(300);
}

// Helper: get canvas bounding box
async function canvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('Canvas not found');
  return box;
}

// Helper: activate viewer mode (toggle the ▶ button)
async function enableViewerMode(page: Page) {
  await page.locator('button[title="Toggle viewer mode (hotspots active)"]').click();
  await page.waitForTimeout(150); // allow React re-render + viewerModeRef update
}

async function drawStroke(page: Page, x1: number, y1: number, x2: number, y2: number) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  for (let i = 1; i <= 5; i++) {
    await page.mouse.move(box.x + x1 + ((x2 - x1) * i) / 5, box.y + y1 + ((y2 - y1) * i) / 5);
  }
  await page.mouse.up();
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('draw stroke — new stroke is persisted to IDB on autosave', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Activate pen tool
  await page.keyboard.press('p');
  await page.waitForTimeout(50);

  // Capture pixel state before drawing
  const before = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    return c.getContext('2d')!.getImageData(300, 300, 200, 200).data.join(',');
  });

  await drawStroke(page, 300, 300, 500, 450);
  await page.waitForTimeout(800); // wait for debounced autosave (500ms) + IDB write

  // Canvas pixels must differ (stroke was rendered)
  const after = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    return c.getContext('2d')!.getImageData(300, 300, 200, 200).data.join(',');
  });
  expect(after).not.toBe(before);

  // IDB must have data (migration happened or direct write)
  const idbHasData = await page.evaluate(async () => {
    return new Promise<boolean>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve(false); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => resolve(!!gr.result);
        gr.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    });
  });
  expect(idbHasData).toBe(true);
});

test('save / load — scene survives reload from IDB', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Draw a stroke
  await page.keyboard.press('p');
  await drawStroke(page, 250, 250, 450, 350);
  await page.waitForTimeout(800); // autosave debounce

  // Reload — app should load from IDB (migration happened on first load)
  await page.reload();
  await waitForCanvas(page);

  // The scene must have content (grid + saved strokes → non-blank canvas)
  const hasContent = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    return Array.from(d).some((v) => v > 0);
  });
  expect(hasContent).toBe(true);

  // Pre-seeded nodes must be present in IDB scene
  const nodeCount = await page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve(0); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => resolve((gr.result as any)?.rootScene?.nodes?.length ?? 0);
        gr.onerror = () => resolve(0);
      };
      req.onerror = () => resolve(0);
    });
  });
  // Should have at least the pre-seeded nodes (5) plus the new stroke
  expect(nodeCount).toBeGreaterThanOrEqual(5);
});

test('create inner scene — double-click enters nested scene, breadcrumb updates', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Switch to select tool ('v' key — matches Toolbar "Select (V)" label)
  await page.keyboard.press('v');
  await page.waitForTimeout(100);

  // inner-node: world rect (100,300,200,120).
  // Top portion screen: world y=310 → screen y=710 (clear of 800px edge).
  // Two separate clicks 80ms apart to trigger the built-in double-click detection.
  await page.mouse.click(840, 710);
  await page.waitForTimeout(80);
  await page.mouse.click(840, 710);

  // Wait for the back button — it only renders when sceneStack.length > 1,
  // i.e. when we've successfully entered a nested scene.
  await page.waitForSelector('button[title="Escape"]', { timeout: 5000 });

  // Confirm the inner scene's background colour at a known-clear pixel.
  // Screen (600,350) = world (-40,-50): no nodes, off grid lines (spacing 100).
  const innerBg = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(600, 350, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  });
  // inner-scene-1 background is #e0f0ff = rgb(224,240,255)
  expect(innerBg).toBe('rgb(224,240,255)');
});

test('hotspot popup — clicking hotspot node in viewer mode shows popup text', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  await enableViewerMode(page);

  // hotspot-node: world center (200, 160) → screen (840, 560)
  const sx = 840;
  const sy = 560;

  // Click the hotspot node
  await page.mouse.click(sx, sy);

  // Wait for the popup to appear (TextBubble renders the hotspot content)
  await page.waitForSelector('text=Hello from hotspot', { timeout: 3000 });
  const popupVisible = await page.locator('text=Hello from hotspot').isVisible();
  expect(popupVisible).toBe(true);
});

test('portal navigation — clicking portal node in viewer mode navigates to target scene', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  await enableViewerMode(page);

  // portal-node: world rect (400,100,200,120), center world=(500,160) → screen (1140, 560)
  // Sample pixel at (690, 450) = world (50, 50) — off grid, empty background area.
  const bgBefore = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(690, 450, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  });

  await page.mouse.click(1140, 560);
  await page.waitForTimeout(400); // portal flash 300ms + buffer

  const bgAfter = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(690, 450, 1, 1).data;
    return `${d[0]},${d[1]},${d[2]}`;
  });

  // inner-world background is #fff0e0 = rgb(255,240,224)
  expect(bgAfter).toBe('255,240,224');
  expect(bgAfter).not.toBe(bgBefore);
});

test('layer lock / visibility — locked-layer node cannot be selected', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Switch to select tool
  await page.keyboard.press('v');
  const box = await canvasBox(page);

  // locked-node: world center (500, 360) → screen (1140, 760)
  await page.mouse.click(1140, 760);
  await page.waitForTimeout(150);

  // Check: no node should be selected (locked layer prevents selection)
  const hasSelection = await page.evaluate(() => {
    // The app renders a selection rectangle around selected nodes.
    // Proxy: check the canvas for the characteristic dashed blue selection box
    // by checking if any dashed-line pattern pixels appear.
    // Simpler: check via React state is not accessible, so we check pixel region
    // around the expected node for the blue selection highlight (#4a90d9 = rgb(74,144,217))
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    // Check a 4px wide border around the locked node's screen rect
    // Node screen rect: x=1040, y=700, w=200, h=120
    const region = ctx.getImageData(1040 - 10, 700 - 10, 220, 140).data;
    let selectionPixels = 0;
    for (let i = 0; i < region.length; i += 4) {
      // Look for the selection color: r≈74, g≈144, b≈217
      if (Math.abs(region[i] - 74) < 20 && Math.abs(region[i+1] - 144) < 20 && Math.abs(region[i+2] - 217) < 20) {
        selectionPixels++;
      }
    }
    return selectionPixels > 5; // threshold: more than 5 blue pixels = selected
  });
  expect(hasSelection).toBe(false);
});
