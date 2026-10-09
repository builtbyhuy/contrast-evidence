import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { captureContrast } from '../src/capture.js';

let browser;
before(async () => { browser = await chromium.launch({ headless: true, ...(process.env.CONTRAST_BROWSER ? { channel: process.env.CONTRAST_BROWSER } : {}) }); });
after(async () => { await browser?.close(); });
const base = '<style>body{margin:0;background:white}#target{font:32px/2 Arial;display:inline-block;padding:20px;color:black;background:white;margin:20px}</style>';
async function withPage(html, run) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  try { await page.setContent(base + html); await run(page); }
  finally { await page.close(); }
}
function assertUnsupported(result) {
  assert.equal(result.status, 'unsupported', JSON.stringify({ ...result, images: {} }));
  assert.equal(result.minimumRatio, undefined);
  assert(result.reasons.length);
}

// Missing pseudo admission would certify the parent's black foreground while
// the browser paints #ddd, or would use a large-text threshold for 16px text.
for (const rule of ['::first-line{color:#ddd}', '::first-letter{color:#ddd}', '::first-line{font-size:16px}', '::first-letter{font-style:italic}']) {
  test(`text pseudo ${rule} requires unsupported capture`, () => withPage(`<style>#target${rule}</style><p id="target">WWWWW</p>`, async page => {
    assertUnsupported(await captureContrast(page, { selector: '#target' }));
    assert.equal(await page.locator('#target').getAttribute('style'), null);
  }));
}

for (const type of ['selection', 'highlight', 'static highlight']) {
  test(`a partial active ${type} cannot remain in a certified background`, () => withPage(`<style>${type === 'selection' ? '#target::selection' : '::highlight(review)'}{color:#ddd;background:white}</style><p id="target">WWWWW</p>`, async page => {
    await page.locator('#target').evaluate((element, kind) => {
      const range = document.createRange(); range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1);
      if (kind === 'selection') { getSelection().removeAllRanges(); getSelection().addRange(range); }
      else {
        const selected = kind === 'static highlight' ? new StaticRange({ startContainer: element.firstChild, startOffset: 0, endContainer: element.firstChild, endOffset: 1 }) : range;
        CSS.highlights.set('review', new Highlight(selected));
      }
    }, type);
    assertUnsupported(await captureContrast(page, { selector: '#target' }));
    assert.equal(await page.locator('#target').getAttribute('style'), null);
  }));
}

// These zero-level stacking contexts trap the child's z-index:1 below the
// later parent pseudo at z-index:0. Forgetting a context falsely certifies 21:1.
for (const context of ['isolation:isolate', 'contain:paint', 'will-change:transform', 'position:sticky;top:0', 'position:fixed;top:0']) {
  test(`${context} cannot let a child z-index escape above an overlay`, () => withPage(`<style>.card{position:relative;display:inline-block}.wrapper{${context}}#target{position:relative;z-index:1}.card::after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.8);z-index:0;pointer-events:none}</style><div class="card"><div class="wrapper"><p id="target">WWWWW</p></div></div>`, async page => {
    assertUnsupported(await captureContrast(page, { selector: '#target' }));
  }));
}

for (const mode of ['open', 'closed']) {
  test(`an ${mode} shadow overlay cannot silently certify light-DOM text`, () => withPage('<p id="target">WWWWW</p><div id="host"></div>', async page => {
    await page.locator('#host').evaluate((host, mode) => {
      host.attachShadow({ mode }).innerHTML = '<style>#cover{position:fixed;inset:0;background:rgba(255,255,255,.8);pointer-events:none;z-index:100}</style><div id="cover"></div>';
    }, mode);
    assertUnsupported(await captureContrast(page, { selector: '#target' }));
    assert.equal(await page.locator('#target').getAttribute('style'), null);
  }));
}

test('overlapping same-Page calls reject the second before it can disturb the first', () => withPage('<p id="target">WWWWW</p>', async page => {
  const screenshot = page.screenshot.bind(page);
  let firstScreenshot = true, entered, release;
  const paused = new Promise(resolve => { entered = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  // Only delay a real screenshot; all paint, masking and pixels remain real.
  page.screenshot = async options => {
    if (firstScreenshot) { firstScreenshot = false; entered(); await resume; }
    return screenshot(options);
  };
  const first = captureContrast(page, { selector: '#target' });
  await paused;
  let second;
  try { second = await captureContrast(page, { selector: '#target' }); }
  finally { release(); }
  const completed = await first;
  assertUnsupported(second);
  assert.equal(completed.status, 'quickcheck-clear');
  assert.equal(completed.minimumRatio, 21);
  assert.equal(await page.locator('#target').getAttribute('style'), null);
  assert.equal((await captureContrast(page, { selector: '#target' })).status, 'quickcheck-clear');
}));

test('unselected highlights elsewhere preserve ordinary supported text', () => withPage('<p id="target">WWWWW</p><p id="other" style="position:absolute;top:300px">Elsewhere</p>', async page => {
  await page.locator('#other').evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    getSelection().removeAllRanges(); getSelection().addRange(range);
    CSS.highlights.set('other', new Highlight(range));
  });
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'quickcheck-clear', JSON.stringify({ ...result, images: {} })); assert.equal(result.minimumRatio, 21);
}));

test('a proven behind pseudo remains supported without an intervening stacking context', () => withPage('<style>.card{position:relative;display:inline-block}#target{position:relative;z-index:1}.card::after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.8);z-index:0;pointer-events:none}</style><div class="card"><div class="wrapper"><p id="target">WWWWW</p></div></div>', async page => {
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'quickcheck-clear', JSON.stringify({ ...result, images: {} })); assert.equal(result.minimumRatio, 21);
}));

test('browser-owned control shadow roots elsewhere do not block plain HTML', () => withPage('<p id="target">WWWWW</p><input type="range" style="position:absolute;top:300px">', async page => {
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'quickcheck-clear', JSON.stringify({ ...result, images: {} })); assert.equal(result.minimumRatio, 21);
}));

test('a foreground change after metadata cannot certify stale black against stable gray paint', () => withPage('<style>#target.changed{color:#ddd}</style><p id="target">WWWWW</p>', async page => {
  const locate = page.locator.bind(page);
  let observedMetadata = false;
  // Delay only the first real metadata result. The DOM change is complete before
  // original paint is sampled, and every screenshot and later paint is real.
  page.locator = selector => {
    const locator = locate(selector);
    return new Proxy(locator, { get(target, key) {
      if (key === 'evaluate') return async (fn, argument) => {
        const result = await target.evaluate(fn, argument);
        if (!observedMetadata) {
          observedMetadata = true;
          await target.evaluate(element => element.classList.add('changed'));
        }
        return result;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const result = await captureContrast(page, { selector: '#target' });
  assertUnsupported(result);
  assert.equal(await locate('#target').evaluate(element => getComputedStyle(element).color), 'rgb(221, 221, 221)');
  assert.equal(await locate('#target').getAttribute('style'), null);
}));

test('captured text preserves the word boundary at a visible BR line break', () => withPage('<p id="target">Bring your bike<br>back to life.</p>', async page => {
  const result = await captureContrast(page, { selector: '#target' });
  assert.equal(result.status, 'quickcheck-clear', JSON.stringify({ ...result, images: {} }));
  assert.equal(result.text, 'Bring your bike\nback to life.');
  assert.equal(result.minimumRatio, 21);
}));
