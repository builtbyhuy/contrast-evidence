import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePixels, contrastRatio, luminance, parseColor, textThreshold } from '../src/contrast.js';

test('standard black/white contrast is exactly 21:1', () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(luminance([0, 0, 0]), 0);
  assert.equal(luminance([255, 255, 255]), 1);
});

test('near-threshold gray retains the unrounded comparison', () => {
  const result = analyzePixels(Uint8Array.of(119, 119, 119, 255), 1, 1, '#fff');
  assert.ok(result.minimumRatio > 4.47 && result.minimumRatio < 4.48);
  assert.equal(result.status, 'needs-review');
  assert.equal(Number(result.minimumRatio.toFixed(1)), 4.5);
});

test('bright single pixel determines conservative rectangle result', () => {
  const result = analyzePixels(Uint8Array.of(0,0,0,255, 255,255,255,255, 0,0,0,255, 0,0,0,255), 2, 2, '#fff');
  assert.equal(result.status, 'needs-review');
  assert.equal(result.minimumRatio, 1);
  assert.deepEqual(result.worstPixel, { x: 1, y: 0, color: [255,255,255] });
  assert.equal(result.pixelCount, 4);
});

test('large-text threshold includes exact point-to-CSS-pixel conversion', () => {
  assert.equal(textThreshold(24, 400), 3);
  assert.equal(textThreshold(23.999, 400), 4.5);
  assert.equal(textThreshold(14 * 96 / 72, 700), 3);
  assert.equal(textThreshold(18.66, 700), 4.5);
  assert.equal(textThreshold(19, 600), 4.5);
});

test('foreground alpha and incomplete or transparent background are rejected', () => {
  assert.throws(() => analyzePixels(Uint8Array.of(0,0,0,255), 1, 1, 'rgba(255,255,255,0.5)'), /opaque/);
  assert.throws(() => analyzePixels(Uint8Array.of(0,0,0,254), 1, 1, '#fff'), /opaque/);
  assert.throws(() => analyzePixels(Uint8Array.of(0,0,0), 1, 1, '#fff'), /RGBA/);
});

test('sRGB parser rejects malformed or out-of-range inputs', () => {
  assert.deepEqual(parseColor('#abc'), [170,187,204,1]);
  assert.deepEqual(parseColor('rgb(255 0 12 / 1)'), [255,0,12,1]);
  assert.throws(() => parseColor('rgb(300,0,0)'), /range/);
  assert.throws(() => parseColor('color(display-p3 1 0 0)'), /sRGB/);
});
