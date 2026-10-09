// Read-only reproduction of findings in 070c6adb9f386280b60589e0e94b939bd4e3f890.
// Writes synthetic evidence to a specified folder or a new OS temporary folder.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureContrast, contrastRatio, createReport, renderReport } from '../../src/index.js';
import { createDemoServer } from '../../scripts/serve.js';

const outIndex = process.argv.indexOf('--out');
const output = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : await mkdtemp(path.join(tmpdir(), 'contrast-redteam-'));
await mkdir(output, { recursive: true });
const selectedBrowser = process.env.CONTRAST_BROWSER || 'chromium';
const browser = await chromium.launch({ headless: true, ...(selectedBrowser === 'chromium' ? {} : { channel: selectedBrowser }) });
const server = createDemoServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}/demo/`;
const results = [];
const base = '<style>body{margin:0;background:white}#target{display:inline-block;font:32px/2 Arial;padding:20px;margin:20px;color:black;background:white}</style>';
const ready = page => page.locator('#resultPanel:not([data-status="loading"])').waitFor();
const summarize = result => ({ status: result.status, minimumRatio: result.minimumRatio, threshold: result.threshold, foreground: result.foreground, reasons: result.reasons });
async function boundedGate(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The baseline capture ordering could not be established.')), 8000); })]); }
  finally { clearTimeout(timer); }
}

try {
  const cases = [
    { name: 'control', css: '' },
    { name: 'first-line', css: '#target::first-line{color:#ddd}', expectedForegroundContrast: contrastRatio([221,221,221], [255,255,255]) },
    { name: 'stacking-context', css: '.card{position:relative;display:inline-block}.wrapper{isolation:isolate}#target{position:relative;z-index:1}.card::after{content:"";position:absolute;inset:0;z-index:0;background:rgba(255,255,255,.8);pointer-events:none}', expectedForegroundContrast: contrastRatio([204,204,204], [255,255,255]) },
    { name: 'shadow-overlay', css: '', shadow: true, expectedForegroundContrast: contrastRatio([204,204,204], [255,255,255]) },
    { name: 'partial-selection', css: '#target::selection{color:#ddd;background:white}', selection: true },
  ];
  for (const fixture of cases) {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic red-team fixture</title>${base}<style>${fixture.css}</style></head><body><div class="card"><div class="wrapper"><p id="target">Read this evidence</p></div></div><div id="host"></div></body></html>`);
    if (fixture.shadow) await page.locator('#host').evaluate(host => {
      host.attachShadow({ mode: 'open' }).innerHTML = '<style>div{position:fixed;inset:0;z-index:100;background:rgba(255,255,255,.8);pointer-events:none}</style><div></div>';
    });
    if (fixture.selection) await page.locator('#target').evaluate(element => {
      const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1);
      getSelection().removeAllRanges(); getSelection().addRange(range);
    });
    const capture = await captureContrast(page, { selector: '#target' });
    results.push({ name: fixture.name, ...summarize(capture), expectedForegroundContrast: fixture.expectedForegroundContrast, falseClear: fixture.name !== 'control' && capture.status === 'quickcheck-clear' });
    if (fixture.name === 'first-line' && capture.images.original) {
      for (const kind of ['original', 'background']) await writeFile(path.join(output, `first-line-${kind}.png`), Buffer.from(capture.images[kind].split(',')[1], 'base64'));
      await writeFile(path.join(output, 'first-line-report.html'), renderReport(createReport([capture], { url: 'about:blank', selector: '#target' })));
    }
    if (fixture.name === 'control' && capture.status === 'quickcheck-clear') {
      const inconsistent = { ...capture, worstPixel: { x: 999999, y: -42, color: [255,0,0] } };
      const html = renderReport(createReport([inconsistent], { url: 'about:blank', selector: '#target' }));
      results.push({ name: 'inconsistent-worst-pixel', accepted: html.includes('999999') && html.includes('rgb(255, 0, 0)') });
    }
    await page.close();
  }

  // Force the reachable ordering: A restores text between B's state check and shot.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent(`${base}<p id="target">WWWWW</p>`);
  const solo = await captureContrast(page, { selector: '#target' });
  const ownership = new AsyncLocalStorage();
  const takeScreenshot = page.screenshot.bind(page), counts = { A: 0, B: 0 }, trace = [];
  let originals = 0, releaseOriginals, finishA;
  const originalGate = new Promise(resolve => { releaseOriginals = resolve; });
  const aFinished = new Promise(resolve => { finishA = resolve; });
  page.screenshot = async options => {
    const owner = ownership.getStore(), count = ++counts[owner];
    trace.push(`${owner} screenshot ${count} started`);
    if (owner === 'B' && count === 2) await boundedGate(aFinished);
    const bytes = await takeScreenshot(options);
    trace.push(`${owner} screenshot ${count} taken`);
    if (count === 1) { if (++originals === 2) releaseOriginals(); await boundedGate(originalGate); }
    return bytes;
  };
  const a = ownership.run('A', () => captureContrast(page, { selector: '#target' })).then(result => { finishA(); return result; });
  const b = ownership.run('B', () => captureContrast(page, { selector: '#target' }));
  const overlap = await Promise.all([a, b]);
  results.push({ name: 'concurrent-capture', solo: summarize(solo), overlap: overlap.map(summarize), trace, styleAfter: await page.locator('#target').getAttribute('style') });
  await page.close();

  const startup = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let releasePhoto;
  const photoGate = new Promise(resolve => { releasePhoto = resolve; });
  await startup.route('**/repair-workshop.jpg', async route => { await photoGate; await route.continue(); });
  await startup.goto(origin, { waitUntil: 'domcontentloaded' });
  const png = new PNG({ width: 40, height: 40 });
  for (let index = 0; index < png.data.length; index += 4) png.data.set([17,42,88,255], index);
  await startup.locator('#imageUpload').setInputFiles({ name: 'my-campaign-blue.png', mimeType: 'image/png', buffer: PNG.sync.write(png) });
  await startup.waitForFunction(() => document.querySelector('#uploadMessage').textContent.includes('loaded.'));
  const before = await startup.locator('#photoCredit').innerText();
  releasePhoto(); await ready(startup);
  const download = startup.waitForEvent('download'); await startup.locator('#exportJson').click();
  const record = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  results.push({ name: 'startup-upload', beforeCredit: before, afterCredit: await startup.locator('#photoCredit').innerText(), uploadMessage: await startup.locator('#uploadMessage').innerText(), exportedSource: record.source });
  await startup.close();

  const retry = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await retry.goto(origin); await ready(retry);
  let fontRequests = 0;
  await retry.route('**/instrument-sans.ttf', async route => { fontRequests++; await route.abort('failed'); });
  await retry.locator('#exportHtml').click();
  await retry.waitForFunction(() => document.querySelector('#exportMessage').textContent.includes('fetch'));
  const firstError = await retry.locator('#exportMessage').innerText();
  await retry.unroute('**/instrument-sans.ttf');
  retry.on('request', request => { if (request.url().endsWith('instrument-sans.ttf')) fontRequests++; });
  await retry.locator('#exportHtml').click(); await retry.waitForTimeout(150);
  results.push({ name: 'font-retry', firstError, retryError: await retry.locator('#exportMessage').innerText(), fontRequests });
  await retry.close();

  const duplicate = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await duplicate.goto(origin); await ready(duplicate);
  let releaseFont;
  const fontGate = new Promise(resolve => { releaseFont = resolve; });
  await duplicate.route('**/instrument-sans.ttf', async route => { await fontGate; await route.continue(); });
  const downloads = [];
  duplicate.on('download', file => downloads.push(file));
  await duplicate.locator('#exportHtml').click();
  const busyMessage = await duplicate.locator('#exportMessage').innerText();
  await duplicate.locator('#sampleInput').fill('A second report while the first is preparing.');
  await duplicate.waitForTimeout(60);
  const enabledWhileBusy = await duplicate.locator('#exportHtml').isEnabled();
  if (enabledWhileBusy) await duplicate.locator('#exportHtml').click();
  releaseFont();
  await duplicate.waitForFunction(() => document.querySelector('#exportMessage').textContent.includes('saved.'));
  await duplicate.waitForTimeout(200);
  const reportTexts = [];
  for (const file of downloads) {
    const html = await readFile(await file.path(), 'utf8');
    reportTexts.push(html.match(/<span class="sample">([\s\S]*?)<\/span>/)?.[1]);
  }
  results.push({ name: 'duplicate-export', busyMessage, enabledWhileBusy, downloadCount: downloads.length, reportTexts });
  await duplicate.close();

  await writeFile(path.join(output, 'results.json'), `${JSON.stringify({ observedAt: new Date().toISOString(), browser: browser.version(), results }, null, 2)}\n`);
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
