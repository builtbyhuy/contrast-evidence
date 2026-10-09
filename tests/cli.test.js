import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { contrastRatio } from '../src/contrast.js';
import { main, parseArgs } from '../src/cli.js';

const image = new PNG({ width: 120, height: 25 }); image.data.fill(255);
const WHITE = `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
const base = ['--url', 'http://127.0.0.1:8765/demo/', '--selector', '#text'];
function capture(status = 'quickcheck-clear') {
  return { status, selector: '#text', text: 'Hello', threshold: 4.5, minimumRatio: status === 'needs-review' ? contrastRatio([170,170,170],[255,255,255]) : 21,
    foreground: status === 'needs-review' ? '#aaa' : 'rgb(0, 0, 0)', font: { sizePx: 16, weight: 400 }, viewport: { width: 1, height: 1, deviceScaleFactor: 1 },
    bounds: { x: 10, y: 20, width: 120, height: 25 }, images: { original: WHITE, background: WHITE },
    reasons: [], limitations: [], method: 'bounding-box-quickcheck', capturedAt: '2026-10-09T12:00:00.000Z',
  };
}

function dependencies(statuses = ['quickcheck-clear'], navigationError = null) {
  const state = { launches: 0, pageOptions: [], pageClosed: 0, browserClosed: 0, captureOptions: [], stdout: '', stderr: '', report: null };
  const deps = {
    stdout: { write(value) { state.stdout += value; } }, stderr: { write(value) { state.stderr += value; } },
    now: () => new Date('2026-10-09T12:00:01.000Z'),
    async launchBrowser(name) {
      state.launches++; state.browserName = name;
      return { async newPage(options) { state.pageOptions.push(options); return {
        async goto(url) { state.url = url; if (navigationError) throw navigationError; },
        async close() { state.pageClosed++; },
      }; }, async close() { state.browserClosed++; } };
    },
    async capture(page, options) { state.captureOptions.push(options); return capture(statuses[state.captureOptions.length - 1] ?? statuses[0]); },
    async writeReport(report) { state.report = report; return { json: 'report.json', html: 'index.html' }; },
  };
  return { state, deps };
}

test('parser accepts local loopback URLs, explicit browser, repeated viewports and threshold', () => {
  const options = parseArgs([...base, '--viewport', '1440x900', '--viewport', '390x844', '--browser', 'msedge', '--threshold', '3']);
  assert.deepEqual(options.viewports, [{ width: 1440, height: 900 }, { width: 390, height: 844 }]);
  assert.equal(options.browser, 'msedge'); assert.equal(options.threshold, 3);
  assert.deepEqual(parseArgs(base).viewports, [{ width: 1440, height: 900 }]);
  assert.equal(parseArgs(base).threshold, undefined);
});

test('invalid URLs, embedded credentials and malformed options fail before browser launch', async () => {
  const cases = [
    ['--url', 'file:///tmp/site.html', '--selector', '#text'],
    ['--url', 'javascript:alert(1)', '--selector', '#text'],
    ['--url', 'https://user:password@example.com/', '--selector', '#text'],
    [...base, '--viewport', '0x900'], [...base, '--viewport', '390.5x844'],
    [...base, '--threshold', 'NaN'], [...base, '--threshold', '22'],
    [...base, '--browser', 'firefox'], [...base, '--out', ''],
    [...base, '--unknown', 'yes'], [...base, '--url', 'https://example.com/'],
    ['--url', 'https://example.com/', '--selector', '   '],
  ];
  for (const args of cases) {
    assert.throws(() => parseArgs(args));
    const { state, deps } = dependencies();
    assert.equal(await main(args, deps), 2);
    assert.equal(state.launches, 0);
    assert.equal(state.report, null);
  }
});

test('help is read-only and never launches a browser', async () => {
  const { state, deps } = dependencies();
  assert.equal(await main(['--help'], deps), 0);
  assert.equal(state.launches, 0); assert.match(state.stdout, /No browser is installed/);
});

test('each viewport is captured, the font-derived threshold is retained and clear exits zero', async () => {
  const { state, deps } = dependencies();
  assert.equal(await main([...base, '--viewport', '1440x900', '--viewport', '390x844'], deps), 0);
  assert.equal(state.launches, 1); assert.equal(state.pageClosed, 2); assert.equal(state.browserClosed, 1);
  assert.deepEqual(state.report.captures.map(item => item.viewport.width), [1440, 390]);
  assert.ok(state.report.captures.every(item => item.viewport.deviceScaleFactor === 1));
  assert.ok(state.captureOptions.every(item => !Object.hasOwn(item, 'threshold')));
  assert.equal(state.report.createdAt, '2026-10-09T12:00:01.000Z');
});

test('review flags exit one and unsupported captures exit two without a WCAG failure claim', async () => {
  const review = dependencies(['needs-review']);
  assert.equal(await main(base, review.deps), 1);
  assert.equal(review.state.report.summary.status, 'needs-review');
  const unsupported = dependencies(['unsupported']);
  assert.equal(await main(base, unsupported.deps), 2);
  assert.equal(unsupported.state.report.summary.status, 'unsupported');
  assert.doesNotMatch(review.state.stdout, /WCAG failure|\bPASS\b/);
});

test('navigation failures become explicit unsupported evidence and still close resources', async () => {
  const { state, deps } = dependencies([], new Error('Timed out loading the requested page.'));
  assert.equal(await main(base, deps), 2);
  assert.equal(state.report.captures[0].status, 'unsupported');
  assert.equal(state.report.captures[0].threshold, null);
  assert.equal(state.report.captures[0].error.stage, 'navigation');
  assert.equal(state.captureOptions.length, 0); assert.equal(state.pageClosed, 1); assert.equal(state.browserClosed, 1);
});

test('a malformed clear capture is rejected instead of being saved as clear', async () => {
  const { state, deps } = dependencies();
  deps.capture = async () => capture('quickcheck-clear');
  const original = deps.capture;
  deps.capture = async (...args) => ({ ...await original(...args), minimumRatio: NaN });
  assert.equal(await main(base, deps), 2);
  assert.equal(state.report, null); assert.equal(state.browserClosed, 1);
});

test('explicit threshold reaches capture and missing browser returns an actionable error', async () => {
  const custom = dependencies();
  assert.equal(await main([...base, '--threshold', '3', '--browser', 'chrome'], custom.deps), 0);
  assert.equal(custom.state.captureOptions[0].threshold, 3); assert.equal(custom.state.browserName, 'chrome');
  const missing = dependencies();
  missing.deps.launchBrowser = async () => { throw new Error('No selected browser is available.'); };
  assert.equal(await main(base, missing.deps), 2); assert.match(missing.state.stderr, /No selected browser/);
  assert.equal(missing.state.report, null);
});
