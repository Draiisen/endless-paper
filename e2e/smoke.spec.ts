import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'fs';

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
          nodes: [],  // empty so computeLensTransform returns null → fallback viewport
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
    localStorage.setItem('ep_welcomed_v1', '1');
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

// Suppress the WelcomeModal for all tests (it would block interactions)
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('ep_welcomed_v1', '1');
  });
});

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

// ── Helpers shared by new tests ──────────────────────────────────────────────

async function getIDBNodeCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
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
}

async function getIDBAssetCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve(0); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => resolve((gr.result as any)?.assets?.length ?? 0);
        gr.onerror = () => resolve(0);
      };
      req.onerror = () => resolve(0);
    });
  });
}

async function idbHasRecord(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
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
}

// ── New tests ─────────────────────────────────────────────────────────────────

test('export .endless.json — Save button downloads valid PersistedState', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);

  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const raw = readFileSync(filePath!, 'utf8');
  const parsed = JSON.parse(raw);

  expect(parsed.version).toBe(1);
  expect(parsed.rootScene).toBeDefined();
  expect(Array.isArray(parsed.rootScene.nodes)).toBe(true);
  expect(parsed.rootScene.nodes.length).toBeGreaterThan(0);
  expect(typeof parsed.savedAt).toBe('number');
  expect(parsed.savedAt).toBeGreaterThan(0);
  expect(Array.isArray(parsed.assets)).toBe(true);
});

test('import .endless.json — Load button restores scene from file', async ({ page }) => {
  await page.goto('/');
  await waitForCanvas(page);

  const importedScene = {
    id: 'imported-scene',
    background: '#ccffcc',
    nodes: [
      { id: 'n1', type: 'rect', x: 10, y: 10, width: 80, height: 60, fill: '#ff6600', stroke: 'none', strokeWidth: 0 },
      { id: 'n2', type: 'rect', x: 200, y: 100, width: 50, height: 50, fill: '#0066ff', stroke: 'none', strokeWidth: 0 },
    ],
  };
  const fileContent = JSON.stringify({
    version: 1,
    rootScene: importedScene,
    viewport: { x: 400, y: 300, scale: 1 },
    savedAt: Date.now(),
    assets: [],
  });

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Load' }).click(),
  ]);
  await fileChooser.setFiles({
    name: 'test.endless.json',
    mimeType: 'application/json',
    buffer: Buffer.from(fileContent),
  });

  await page.waitForTimeout(800); // autosave debounce

  const nodeCount = await getIDBNodeCount(page);
  expect(nodeCount).toBe(2);
});

test('new canvas — clears IDB so reload shows blank scene', async ({ page }) => {
  // No seedLocalStorage here — addInitScript re-runs on reload and would re-seed.
  // Instead: draw a stroke so the IDB gets real content, then click New.
  await page.goto('/');
  await waitForCanvas(page);

  // Draw something to populate IDB
  await page.keyboard.press('p');
  await page.waitForTimeout(50);
  await drawStroke(page, 200, 200, 400, 300);
  await page.waitForTimeout(800); // autosave debounce

  expect(await idbHasRecord(page)).toBe(true);
  expect(await getIDBNodeCount(page)).toBeGreaterThan(0);

  // Click New — confirm the dialog
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForTimeout(100);

  // IDB must be cleared immediately after New
  expect(await idbHasRecord(page)).toBe(false);

  // Reload — no IDB, no localStorage → blank canvas → initial autosave writes 0 nodes
  await page.reload();
  await waitForCanvas(page);
  await page.waitForTimeout(800); // initial autosave fires

  const nodesAfter = await getIDBNodeCount(page);
  expect(nodesAfter).toBe(0);
});

test('asset library — assets persist in IDB after reload', async ({ page }) => {
  const stateWithAsset = {
    ...SEED_STATE,
    savedAt: Date.now(),
    assets: [{
      id: 'asset-1',
      name: 'Test Asset',
      thumbnail: '',
      nodes: [],
      boundingBox: { width: 100, height: 100 },
      createdAt: 1_000_000,
    }],
  };

  await page.addInitScript((state) => {
    localStorage.setItem('endless-paper-autosave', JSON.stringify(state));
  }, stateWithAsset);

  await page.goto('/');
  await waitForCanvas(page);
  await page.waitForTimeout(800); // migration + autosave

  // After first load the asset is in IDB (via migration + autosave)
  expect(await getIDBAssetCount(page)).toBe(1);

  // Reload — must still have 1 asset from IDB
  await page.reload();
  await waitForCanvas(page);
  await page.waitForTimeout(300);

  expect(await getIDBAssetCount(page)).toBe(1);
});

test('ExportModal — HTML download is a valid interactive viewer', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Open export modal via keyboard shortcut
  await page.keyboard.press('Control+e');
  await page.waitForSelector('text=Interactive HTML', { timeout: 3000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('Interactive HTML').click(),
  ]);

  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const content = readFileSync(filePath!, 'utf8');

  expect(content).toContain('<!DOCTYPE html>');
  expect(content).toContain('Endless Paper');
  // The seeded scene ID and node ID must be embedded in the JS data blob
  expect(content).toContain('root-scene');
  expect(content).toContain('hotspot-node');
  // Must have a <canvas> element (the viewer renders onto it)
  expect(content).toContain('<canvas');
});

test('ExportModal — SVG download is valid and contains seeded node fill', async ({ page }) => {
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  await page.keyboard.press('Control+e');
  await page.waitForSelector('text=SVG Vector', { timeout: 3000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('SVG Vector').click(),
  ]);

  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const content = readFileSync(filePath!, 'utf8');

  expect(content).toContain('<svg');
  expect(content).toContain('xmlns="http://www.w3.org/2000/svg"');
  // hotspot-node is a rect with fill="#4a90d9" — must appear in the output
  expect(content).toContain('#4a90d9');
  // portal-node has fill="#e74c3c"
  expect(content).toContain('#e74c3c');
});

// ── World size sheet tests ────────────────────────────────────────────────────

test('world-size sheet — mobile sets 16:9 bounds on root scene', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLocalStorage(page);
  await page.goto('/');
  await waitForCanvas(page);

  // Open ⋮ menu
  await page.click('button[title="More"]');
  await page.waitForTimeout(200);

  // Click the world-size button to open the sheet
  await page.click('[data-testid="mobile-world-size-button"]');
  await page.waitForSelector('[data-testid="world-size-sheet"]', { timeout: 3000 });

  // Choose 16:9
  await page.click('[data-testid="world-size-option-16-9"]');
  await page.waitForTimeout(800); // autosave debounce

  // Sheet should be dismissed
  await expect(page.locator('[data-testid="world-size-sheet"]')).not.toBeVisible();

  // Verify bounds in IDB
  const bounds = await page.evaluate(async () => {
    return new Promise<{ width: number; height: number } | undefined>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve(undefined); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => resolve((gr.result as any)?.rootScene?.bounds);
        gr.onerror = () => resolve(undefined);
      };
      req.onerror = () => resolve(undefined);
    });
  });
  expect(bounds).toEqual({ width: 1920, height: 1080 });
});

test('world-size sheet — inner scene gets own bounds, parent unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  // Mobile-adjusted seed: viewport scaled so inner-node (world 100,300,200,120)
  // is visible on a 390-wide screen.
  // With scale=0.5, x=50, y=200: inner-node center at world(200,360)
  // → screen(200*0.5+50, 360*0.5+200) = (150, 380) — well within 390x800.
  const mobileSeed = {
    ...SEED_STATE,
    viewport: { x: 50, y: 200, scale: 0.5 },
    savedAt: Date.now(),
  };
  await page.addInitScript((state) => {
    localStorage.setItem('endless-paper-autosave', JSON.stringify(state));
    localStorage.setItem('ep_welcomed_v1', '1');
  }, mobileSeed);

  await page.goto('/');
  await waitForCanvas(page);

  // Enter inner-node via double-click (select tool)
  await page.keyboard.press('v');
  await page.waitForTimeout(100);
  // inner-node center at screen (150, 380) with mobile viewport
  await page.mouse.click(150, 380);
  await page.waitForTimeout(80);
  await page.mouse.click(150, 380);
  await page.waitForSelector('button[title="Escape"]', { timeout: 5000 });

  // Inside inner scene — open world-size sheet
  await page.click('button[title="More"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="mobile-world-size-button"]');
  await page.waitForSelector('[data-testid="world-size-sheet"]', { timeout: 3000 });

  // Choose A4 portrait
  await page.click('[data-testid="world-size-option-a4-portrait"]');
  await page.waitForTimeout(100);

  // Go back to parent
  await page.click('button[title="Escape"]');
  await page.waitForTimeout(800); // autosave

  // Check IDB: root has no bounds, inner has A4 portrait
  const result = await page.evaluate(async () => {
    return new Promise<{ rootBounds: any; innerBounds: any }>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve({ rootBounds: 'no-store', innerBounds: null }); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => {
          const state = gr.result as any;
          const rootBounds = state?.rootScene?.bounds;
          const innerNode = state?.rootScene?.nodes?.find((n: any) => n.id === 'inner-node');
          const innerBounds = innerNode?.innerScene?.bounds;
          resolve({ rootBounds, innerBounds });
        };
        gr.onerror = () => resolve({ rootBounds: 'error', innerBounds: null });
      };
      req.onerror = () => resolve({ rootBounds: 'error', innerBounds: null });
    });
  });
  expect(result.rootBounds).toBeUndefined();
  expect(result.innerBounds).toEqual({ width: 2480, height: 3508 });
});

test('world-size sheet — setting ∞ clears bounds on current scene', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Pre-seed with 16:9 bounds already set on root scene
  const stateWith16x9 = {
    ...SEED_STATE,
    rootScene: { ...SEED_STATE.rootScene, bounds: { width: 1920, height: 1080 } },
    savedAt: Date.now(),
  };
  await page.addInitScript((state) => {
    localStorage.setItem('endless-paper-autosave', JSON.stringify(state));
    localStorage.setItem('ep_welcomed_v1', '1');
  }, stateWith16x9);

  await page.goto('/');
  await waitForCanvas(page);

  // Open ⋮ and world-size sheet
  await page.click('button[title="More"]');
  await page.waitForTimeout(200);
  await page.click('[data-testid="mobile-world-size-button"]');
  await page.waitForSelector('[data-testid="world-size-sheet"]', { timeout: 3000 });

  // Verify 16:9 is currently active (has checkmark or accent styling)
  const option16x9 = page.locator('[data-testid="world-size-option-16-9"]');
  await expect(option16x9).toContainText('✓');

  // Choose ∞
  await page.click('[data-testid="world-size-option-none"]');
  await page.waitForTimeout(800); // autosave

  // Bounds should now be undefined in IDB
  const bounds = await page.evaluate(async () => {
    return new Promise<any>((resolve) => {
      const req = indexedDB.open('endless-paper', 1);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) { resolve('no-store'); return; }
        const tx = db.transaction('state', 'readonly');
        const gr = tx.objectStore('state').get('autosave');
        gr.onsuccess = () => resolve((gr.result as any)?.rootScene?.bounds);
        gr.onerror = () => resolve('error');
      };
      req.onerror = () => resolve('error');
    });
  });
  expect(bounds).toBeUndefined();
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
