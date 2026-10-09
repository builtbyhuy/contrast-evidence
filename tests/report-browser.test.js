import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { createReport, renderReport } from '../src/report.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CONTRAST_BROWSER ? { channel: process.env.CONTRAST_BROWSER } : {}) }); });
after(async () => { await browser?.close(); });

function markedReport() {
  const image = new PNG({ width: 120, height: 25 }); image.data.fill(255);
  image.data.set([0, 0, 0, 255], (12 * 120 + 70) * 4);
  const source = `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
  return renderReport(createReport([{
    status: 'needs-review', selector: '#headline', text: 'Inspect the background', threshold: 4.5,
    minimumRatio: 1, foreground: '#000', font: { sizePx: 16, weight: 400 },
    worstPixel: { x: 70, y: 12, color: [0, 0, 0] },
    viewport: { width: 800, height: 600, deviceScaleFactor: 1 }, bounds: { x: 0, y: 0, width: 120, height: 25 },
    sampleSize: { width: 120, height: 25 }, pixelCount: 3000,
    images: { original: source, background: source }, method: 'bounding-box-quickcheck', reasons: [], limitations: [],
  }], { url: 'https://example.com/', selector: '#headline' }));
}

async function withReport(fn) {
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  try { await page.setContent(markedReport()); await fn(page); }
  finally { await page.close(); }
}

test('both retained crops mark the center of the actual weakest background pixel', () => withReport(async page => {
  assert.equal(await page.locator('.worst-marker').count(), 2);
  const frames = await page.locator('.pixel-frame').all();
  for (const frame of frames) {
    const image = await frame.locator('img').boundingBox();
    const marker = await frame.locator('.worst-marker').boundingBox();
    assert.ok(Math.abs(marker.x + marker.width / 2 - image.x - 70.5) < 0.2);
    assert.ok(Math.abs(marker.y + marker.height / 2 - image.y - 12.5) < 0.2);
  }
  assert.equal(await page.locator('script').count(), 0);
}));

test('keyboard zoom enlarges both crops and keeps the pixel markers aligned', () => withReport(async page => {
  const zoom = page.getByRole('checkbox', { name: 'Enlarge both crops to 2×' });
  assert.equal(await zoom.count(), 1);
  await zoom.focus(); await page.keyboard.press('Space');
  assert.equal(await zoom.isChecked(), true);
  for (const frame of await page.locator('.pixel-frame').all()) {
    const image = await frame.locator('img').boundingBox();
    const marker = await frame.locator('.worst-marker').boundingBox();
    assert.equal(image.width, 240); assert.equal(image.height, 50);
    assert.ok(Math.abs(marker.x + marker.width / 2 - image.x - 141) < 0.2);
    assert.ok(Math.abs(marker.y + marker.height / 2 - image.y - 25) < 0.2);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}));
