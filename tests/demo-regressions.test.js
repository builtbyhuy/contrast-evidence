import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { createDemoServer } from '../scripts/serve.js';

let browser, server, base;
before(async () => {
  server = createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/demo/`;
  browser = await chromium.launch({ headless: true, ...(process.env.CONTRAST_BROWSER ? { channel: process.env.CONTRAST_BROWSER } : {}) });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function withPage(run) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try { await run(page); }
  finally { await page.close(); }
}
async function openReady(page) {
  await page.goto(base);
  await page.locator('#resultPanel:not([data-status="loading"])').waitFor();
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('initial asset loading preserves a completed user upload in the exported evidence', () => withPage(async page => {
  const photograph = deferred();
  await page.route('**/repair-workshop.jpg', async route => {
    await photograph.promise;
    await route.continue();
  });
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const image = new PNG({ width: 40, height: 40 });
    image.data.fill(255);
    await page.locator('#imageUpload').setInputFiles({ name: 'user-white.png', mimeType: 'image/png', buffer: PNG.sync.write(image) });
    await page.waitForFunction(() => document.querySelector('#uploadMessage').textContent.includes('user-white.png loaded'));
    await page.locator('#scrim').fill('0');
    photograph.resolve();
    await page.locator('#resultPanel:not([data-status="loading"])').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportJson').click()]);
    const evidence = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(evidence.source.kind, 'local-upload', 'Late example assets must not replace the user-selected image');
    assert.equal(evidence.source.name, 'user-white.png');
    assert.equal(evidence.minimumRatio, 1, 'Opaque white text on the uploaded white background is exactly 1:1');
  } finally { photograph.resolve(); }
}));

test('a report export succeeds when retried after a transient font request failure', () => withPage(async page => {
  await openReady(page);
  let firstRequest = true;
  await page.route('**/instrument-sans.ttf', async route => {
    if (firstRequest) { firstRequest = false; await route.abort('failed'); }
    else await route.continue();
  });
  await page.locator('#exportHtml').click();
  await page.waitForFunction(() => {
    const message = document.querySelector('#exportMessage').textContent;
    return message && !message.startsWith('Preparing') && !document.querySelector('#exportHtml').disabled;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.locator('#exportHtml').click();
  const download = await downloadPromise;
  assert.ok(download, `Retry must save a report after the request recovers; message: ${await page.locator('#exportMessage').textContent()}`);
  const html = await readFile(await download.path(), 'utf8');
  assert.ok(html.includes('data:font/ttf;base64,') || html.includes('data:application/octet-stream;base64,'), 'The recovered report must embed its font');
  assert.ok(html.includes('Good design'));
}));

test('editing controls during report preparation cannot start a duplicate export', () => withPage(async page => {
  await openReady(page);
  const font = deferred();
  await page.route('**/instrument-sans.ttf', async route => {
    await font.promise;
    await route.continue();
  });
  const downloads = [];
  page.on('download', download => downloads.push(download));
  try {
    await page.locator('#exportHtml').click();
    await page.locator('#sampleInput').fill('A changed headline while the report is preparing.');
    await page.waitForFunction(() => document.querySelector('#sampleText').textContent.startsWith('A changed headline'));
    const exportStillDisabled = await page.locator('#exportHtml').isDisabled();
    if (!exportStillDisabled) await page.locator('#exportHtml').click();
    const downloadPromise = page.waitForEvent('download');
    font.resolve();
    await downloadPromise;
    await page.waitForFunction(() => document.querySelector('#exportMessage').textContent.includes('saved'));
    await page.waitForTimeout(100);
    assert.equal(downloads.length, 1, 'One pending save must produce one report, even after controls rerender');
    assert.equal(exportStillDisabled, true, 'The save control must stay disabled while its report is preparing');
    const html = await readFile(await downloads[0].path(), 'utf8');
    assert.ok(html.includes('Good design'), 'The report must retain the snapshot requested before the edit');
    assert.ok(!html.includes('A changed headline'), 'A pending snapshot must not take later control edits');
    assert.equal(await page.locator('#exportHtml').isEnabled(), true, 'A later save must be available after the first one finishes');
  } finally { font.resolve(); }
}));
