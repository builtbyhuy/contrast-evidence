import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { captureContrast } from '../src/capture.js';

let browser;
const html = await readFile(new URL('./fixtures/capture.html', import.meta.url), 'utf8');
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CONTRAST_BROWSER ? { channel: process.env.CONTRAST_BROWSER } : {}) }); });
after(async () => { await browser?.close(); });
async function withPage(fn) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  try { await page.setContent(html, { waitUntil: 'load' }); await fn(page); }
  finally { await page.close(); }
}
test('opaque text yields serializable exact-clip evidence and restores exact inline style', () => withPage(async page => {
  const previous = await page.locator('#clear').getAttribute('style');
  const beforeRect = await page.locator('#clear').boundingBox();
  const result = await captureContrast(page, { selector: '#clear' });
  assert.equal(result.status, 'quickcheck-clear'); assert.equal(result.threshold, 3);
  assert(result.minimumRatio > 18); assert.equal(result.font.sizePx, 24);
  assert.equal(result.viewport.deviceScaleFactor, 2);
  assert.equal(result.pageUrl, 'about:blank'); assert(result.browserVersion); assert(result.userAgent.includes('Mozilla'));
  assert.equal(await page.locator('#clear').getAttribute('style'), previous);
  assert.deepEqual(await page.locator('#clear').boundingBox(), beforeRect);
  for (const value of Object.values(result.images)) {
    assert(value.startsWith('data:image/png;base64,'));
    const png = PNG.sync.read(Buffer.from(value.split(',')[1], 'base64'));
    assert(png.width >= Math.floor(result.bounds.width) && png.width <= Math.ceil(result.bounds.width));
    assert(png.height >= Math.floor(result.bounds.height) && png.height <= Math.ceil(result.bounds.height));
    assert.deepEqual(result.sampleSize, { width: png.width, height: png.height });
    assert.equal(result.pixelCount, png.width * png.height);
    assert(result.worstPixel.x >= 0 && result.worstPixel.x < png.width);
    assert(result.worstPixel.y >= 0 && result.worstPixel.y < png.height);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
}));
test('below-fold text is scrolled into view and captured in document coordinates', () => withPage(async page => {
  assert((await page.locator('#below-fold').boundingBox()).y > 600);
  const result = await captureContrast(page, { selector: '#below-fold' });
  assert.equal(result.status, 'quickcheck-clear'); assert(result.bounds.y > 1800);
  const rect = await page.locator('#below-fold').boundingBox();
  assert(rect.y >= 0 && rect.y + rect.height <= 600.5);
  assert.equal(await page.locator('#below-fold').getAttribute('style'), null);
}));
test('background-only capture preserves a provably-behind pseudo scrim', () => withPage(async page => {
  const result = await captureContrast(page, { selector: '#pseudo' });
  assert.equal(result.status, 'quickcheck-clear', JSON.stringify({ ...result, images: {} })); assert(result.minimumRatio > 15);
  const background = PNG.sync.read(Buffer.from(result.images.background.split(',')[1], 'base64'));
  assert(background.data[0] < 30); assert.equal(await page.locator('#pseudo').getAttribute('style'), null);
}));
test('low bounding-box contrast remains needs-review, with no automatic fail', () => withPage(async page => {
  const result = await captureContrast(page, { selector: '#review' });
  assert.equal(result.status, 'needs-review'); assert.equal(result.threshold, 4.5);
  assert.equal(result.minimumRatio, 1); assert(result.reasons.some(reason => reason.includes('individual letters')));
}));
test('uncertain rendering returns unsupported without leaving inline mutations', () => withPage(async page => {
  for (const selector of ['#opacity', '#ancestor-opacity', '#mixed', '#transform', '#occluded', '#clipped', '#uncertain-pseudo']) {
    const original = await page.locator(selector).getAttribute('style');
    const result = await captureContrast(page, { selector });
    assert.equal(result.status, 'unsupported', `${selector}: ${JSON.stringify(result)}`);
    assert(result.reasons.length); assert.equal(result.minimumRatio, undefined);
    assert.equal(await page.locator(selector).getAttribute('style'), original);
  }
}));
test('individual transforms and text painting beyond the rectangle are unsupported', () => withPage(async page => {
  for (const style of ['scale:.5', 'translate:1px', 'rotate:1deg', 'text-indent:-30px', 'white-space:nowrap;width:30px;overflow:hidden', 'height:15px;overflow:hidden', 'font-style:italic', 'color:rgba(255,255,255,.5)', 'filter:blur(1px)', 'mix-blend-mode:multiply', 'text-shadow:1px 1px white']) {
    await page.locator('#clear').evaluate((element, value) => element.setAttribute('style', value), style);
    const result = await captureContrast(page, { selector: '#clear' });
    assert.equal(result.status, 'unsupported', `${style}: ${JSON.stringify(result)}`);
    assert.equal(await page.locator('#clear').getAttribute('style'), style);
  }
}));
test('colored emoji is unsupported while ordinary Vietnamese text can be measured', () => withPage(async page => {
  for (const text of ['Ride 🚲 safely', 'Flag 🇻🇳', 'Key 1️⃣']) {
    await page.locator('#clear').evaluate((element, value) => { element.textContent = value; }, text);
    const result = await captureContrast(page, { selector: '#clear' });
    assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('glyphs')));
  }
  await page.locator('#clear').evaluate(element => { element.textContent = 'Sửa xe đạp'; });
  assert.equal((await captureContrast(page, { selector: '#clear' })).status, 'quickcheck-clear');
}));
test('a changed restored screenshot becomes unsupported rather than a false clear', () => withPage(async page => {
  const previous = await page.locator('#clear').getAttribute('style');
  const originalScreenshot = page.screenshot.bind(page); let calls = 0;
  page.screenshot = async options => {
    if (++calls === 3) await page.locator('#clear').evaluate(element => { element.classList.remove('dark'); element.classList.add('light'); });
    return originalScreenshot(options);
  };
  const result = await captureContrast(page, { selector: '#clear' });
  assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('rendered state changed')));
  assert.equal(await page.locator('#clear').getAttribute('style'), previous);
}));
test('screenshot failure restores original inline style in finally', () => withPage(async page => {
  const previous = await page.locator('#clear').getAttribute('style');
  const originalScreenshot = page.screenshot.bind(page); let calls = 0;
  page.screenshot = async options => { if (++calls === 2) throw new Error('Fixture background screenshot failure'); return originalScreenshot(options); };
  const result = await captureContrast(page, { selector: '#clear' });
  assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('Fixture background screenshot failure')));
  assert.equal(await page.locator('#clear').getAttribute('style'), previous);
}));
test('missing or multiple targets and invalid thresholds are explicit unsupported results', () => withPage(async page => {
  for (const options of [{ selector: '#missing' }, { selector: 'h2' }, { selector: '#clear', threshold: 22 }, { selector: '' }]) {
    const result = await captureContrast(page, options); assert.equal(result.status, 'unsupported'); assert(result.reasons.length);
  }
}));
test('oversized captures are rejected before taking any screenshot', () => withPage(async page => {
  let screenshots = 0; page.screenshot = async () => { screenshots++; throw new Error('An oversized capture must not allocate a PNG.'); };
  for (const style of ['width:8001px', 'width:4000px;height:2100px']) {
    await page.locator('#clear').evaluate((element, value) => element.setAttribute('style', value), style);
    const result = await captureContrast(page, { selector: '#clear' });
    assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('8-megapixel')));
    assert.equal(result.pixelCount, 0); assert.equal(screenshots, 0);
  }
}));
test('style-attribute-dependent backgrounds cannot produce a false clear', () => withPage(async page => {
  await page.setContent('<style>#target{color:white;background:white;display:inline-block;padding:20px;font:16px Arial}#target[style]{background:black}</style><p id="target">Originally white on white</p>');
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('computed rendering')));
  assert.equal(result.minimumRatio, undefined); assert.equal(await page.locator('#target').getAttribute('style'), null);
  assert.equal(await page.locator('#target').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 255, 255)');
}));
test(':has masking effects on ancestors, siblings and pseudos fail closed', () => withPage(async page => {
  for (const rule of ['body:has(#target[style]){background:black}', 'body:has(#target[style]) .underlay{background:black}', 'body:has(#target[style]) .card::before{background:black}']) {
    await page.setContent(`<style>body{margin:0;background:white}.card{position:relative;display:inline-block}.underlay,.card::before{position:absolute;inset:0;background:white}.card::before{content:""}#target{position:relative;z-index:1;color:white;display:inline-block;padding:20px;font:16px Arial}${rule}</style><div class="card"><div class="underlay"></div><p id="target">Originally white on white</p></div>`);
    const result = await captureContrast(page, { selector: '#target' });
    assert.equal(result.status, 'unsupported', `${rule}: ${JSON.stringify({ ...result, images: {} })}`);
    assert(result.reasons.some(reason => reason.includes('computed rendering'))); assert.equal(result.minimumRatio, undefined);
    assert.equal(await page.locator('#target').getAttribute('style'), null);
  }
}));
test('a zero-size owner with a covering pseudo overlay is unsupported', () => withPage(async page => {
  await page.setContent('<style>body{background:black}#target{display:inline-block;padding:20px;color:white;line-height:2}#ghost{width:0;height:0}#ghost::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,.95);z-index:20;pointer-events:none}</style><span id="target">Covered text</span><div id="ghost"></div>');
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('another element')));
  assert.equal(result.minimumRatio, undefined);
}));
test('shadow-root text cannot bypass host rendering effects', () => withPage(async page => {
  await page.setContent('<div id="host" style="opacity:.5"></div>');
  await page.locator('#host').evaluate(host => { host.attachShadow({ mode: 'open' }).innerHTML = '<style>p{display:inline-block;padding:20px;font-size:16px;color:black;background:white}</style><p id="shadow">Shadow text</p>'; });
  const result = await captureContrast(page, { selector: '#shadow' });
  assert.equal(result.status, 'unsupported'); assert(result.reasons.some(reason => reason.includes('Shadow-root')));
  assert.equal(result.minimumRatio, undefined);
}));
test('SVG paint cannot be inferred from an HTML CSS foreground color', () => withPage(async page => {
  await page.setContent('<svg width="400" height="100" style="background:black"><text id="svg-text" x="20" y="50" fill="black" style="color:white;font:24px Arial">SVG uses fill</text></svg>');
  const selected = await captureContrast(page, { selector: '#svg-text' });
  assert.equal(selected.status, 'unsupported'); assert(selected.reasons.some(reason => reason.includes('Non-HTML')));
  await page.setContent('<style>body{background:black}#target{color:white;display:inline-block;padding:20px;line-height:2}svg{position:fixed;inset:0;z-index:20;overflow:visible;pointer-events:none}</style><span id="target">Covered HTML text</span><svg width="0" height="0"><rect width="800" height="600" fill="black" fill-opacity=".95"/></svg>');
  const covered = await captureContrast(page, { selector: '#target' });
  assert.equal(covered.status, 'unsupported'); assert.equal(covered.minimumRatio, undefined);
}));
