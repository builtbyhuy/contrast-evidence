import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { contrastRatio } from '../src/contrast.js';
import { createReport, renderReport, writeReport } from '../src/report.js';

const image = new PNG({ width: 120, height: 25 }); image.data.fill(255);
const WHITE = `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
const GRAY_RATIO = contrastRatio([170, 170, 170], [255, 255, 255]);
function capture(overrides = {}) {
  return {
    status: 'quickcheck-clear', selector: '.headline', text: 'Readable headline', threshold: 4.5,
    minimumRatio: 21, worstPixel: { x: 0, y: 0, color: [255, 255, 255] },
    font: { sizePx: 16, weight: 400 }, foreground: 'rgb(0, 0, 0)',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 }, bounds: { x: 10, y: 20, width: 120, height: 25 },
    reasons: [], images: { original: WHITE, background: WHITE }, method: 'bounding-box-quickcheck',
    capturedAt: '2026-10-09T12:00:00.000Z', limitations: ['The rectangle is sampled without a text-glyph mask.'],
    ...overrides,
  };
}
function report(captures = [capture()], options = {}) {
  return createReport(captures, { url: 'https://example.com/', selector: '.headline', createdAt: '2026-10-09T12:00:01.000Z', ...options });
}

test('full precision drives the outcome even when the displayed ratio rounds to the threshold', () => {
  const minimum = contrastRatio([119, 119, 119], [255, 255, 255]);
  assert.ok(minimum > 4.47 && minimum < 4.48);
  const measured = capture({ status: 'needs-review', foreground: '#777', minimumRatio: minimum, threshold: 4.48 });
  const result = report([measured]);
  assert.equal(result.summary.status, 'needs-review');
  assert.equal(result.captures[0].minimumRatio, minimum);
  const html = renderReport(result);
  assert.match(html, /4\.48:1/);
  assert.ok(html.includes(`Exact minimum: <code>${minimum}</code>`));
  assert.match(html, /not establish a WCAG failure/);
});

test('missing or forged clear evidence cannot produce a clear report', () => {
  const invalid = [
    { minimumRatio: NaN }, { minimumRatio: undefined }, { threshold: undefined }, { threshold: Infinity },
    { minimumRatio: 4.49999 }, { images: { original: WHITE, background: null } },
    { images: { original: WHITE, background: 'data:image/png;base64,bogus' } },
    { foreground: 'rgba(0, 0, 0, 0.5)' }, { text: '' }, { bounds: { width: 0, height: 20 } },
  ];
  for (const overrides of invalid) assert.throws(() => report([capture(overrides)]), undefined, JSON.stringify(overrides));
  assert.throws(() => report([capture({ status: 'PASS' })]), /Unknown capture status/);
});

test('HTML rendering recomputes counts and status instead of trusting an injected summary', () => {
  const result = report([capture({ status: 'needs-review', foreground: '#aaa', minimumRatio: GRAY_RATIO })]);
  result.summary = { status: 'quickcheck-clear', captureCount: 100, counts: { 'quickcheck-clear': 100, 'needs-review': 0, unsupported: 0 } };
  const html = renderReport(result);
  assert.match(html, /Inspect the marked backgrounds/);
  assert.match(html, />0 clear<\/span>/);
  assert.match(html, />1 to review<\/span>/);
});

test('untrusted labels, text, URLs and errors are escaped and unsafe image sources are rejected', () => {
  const payload = '\"><script>alert(1)</script><img src=x onerror=alert(2)>';
  const malicious = capture({ status: 'unsupported', selector: payload, text: payload,
    foreground: payload, font: { sizePx: 16, weight: payload }, reasons: [payload],
    limitations: [payload], error: { message: payload },
    images: { original: `data:image/png;base64,abcd\" onerror=alert(3)`, background: 'data:image/svg+xml,<svg onload=alert(4)>' },
  });
  const html = renderReport(report([malicious], { selector: payload, url: `javascript:alert(5)${payload}` }));
  assert.doesNotMatch(html, /<script\b|<svg\b|<img\b/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /default-src 'none'/);
});

test('supported evidence images are embedded and no remote script, font or image is required', () => {
  const html = renderReport(report());
  assert.equal((html.match(/src="data:image\/png;base64,/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<script\b|<link\b|src="https?:|@import|url\(/i);
  assert.match(html, /2026-10-09T12:00:00\.000Z/);
  assert.match(html, /Device pixel ratio/);
});

test('unsupported captures have priority and remain visible beside review captures', () => {
  const result = report([capture({ status: 'needs-review', foreground: '#aaa', minimumRatio: GRAY_RATIO }), capture({ status: 'unsupported', minimumRatio: undefined, images: {} })]);
  assert.equal(result.summary.status, 'unsupported');
  assert.deepEqual(result.summary.counts, { 'quickcheck-clear': 0, 'needs-review': 1, unsupported: 1 });
  assert.match(renderReport(result), /No image captured/);
});

test('background pixels are reanalyzed so a forged white-on-white clear result is rejected', () => {
  assert.throws(() => report([capture({ foreground: '#fff', minimumRatio: 21 })]), /background PNG evidence/);
  assert.throws(() => report([capture({ minimumRatio: 20 })]), /background PNG evidence/);
  assert.throws(() => report([capture({ sampleSize: { width: 1, height: 1 } })]), /sample size/);
  assert.throws(() => report([capture({ pixelCount: 1 })]), /pixel count/);
});

test('PNG dimensions are bounded before decoding and malformed original evidence is rejected', () => {
  const huge = Buffer.from(WHITE.split(',')[1], 'base64'); huge.writeUInt32BE(8001, 16);
  assert.throws(() => report([capture({ images: { original: WHITE, background: `data:image/png;base64,${huge.toString('base64')}` } })]), /8000 pixels/);
  const excessiveArea = Buffer.from(WHITE.split(',')[1], 'base64'); excessiveArea.writeUInt32BE(4000, 16); excessiveArea.writeUInt32BE(3000, 20);
  assert.throws(() => report([capture({ images: { original: WHITE, background: `data:image/png;base64,${excessiveArea.toString('base64')}` } })]), /8 million pixels/);
  const corrupt = Buffer.from(WHITE.split(',')[1], 'base64'); corrupt[40] ^= 255;
  assert.throws(() => report([capture({ images: { original: `data:image/png;base64,${corrupt.toString('base64')}`, background: WHITE } })]), /could not be decoded/);
});

test('saved JSON and HTML retain the same evidence in a relocatable folder', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'contrast-evidence-report-'));
  try {
    const result = report();
    const files = await writeReport(result, temporary);
    const retained = JSON.parse(await readFile(files.json, 'utf8'));
    assert.deepEqual(retained, result);
    const html = await readFile(files.html, 'utf8');
    assert.match(html, /Original element crop/);
    assert.ok(!html.includes(temporary));
  } finally {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(temporary));
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    await rm(temporary, { recursive: true, force: true });
  }
});
