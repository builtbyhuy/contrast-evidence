import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { analyzePixels, parseColor } from './contrast.js';

const LABELS = {
  'quickcheck-clear': 'Quickcheck clear',
  'needs-review': 'Needs review',
  unsupported: 'Unsupported',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function safeLink(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

function pngDataUrl(value) {
  if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const encoded = value.slice('data:image/png;base64,'.length);
  if (encoded.length > 48 * 1024 * 1024) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) < 1 || bytes.readUInt32BE(20) < 1) return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width > 8000 || height > 8000 || width * height > 8_000_000) return null;
  return value;
}

function decodePng(value) {
  if (!pngDataUrl(value)) throw new TypeError('PNG evidence must be valid, at most 8000 pixels per side and 8 million pixels total.');
  try { return PNG.sync.read(Buffer.from(value.slice('data:image/png;base64,'.length), 'base64')); }
  catch { throw new TypeError('PNG evidence could not be decoded.'); }
}

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function ratio(value) { return finite(value) ? `${value.toFixed(2)}:1` : 'Not measured'; }
function coordinate(value) { return finite(value) ? String(Number(value.toFixed(3))) : '—'; }
function colorText(value) {
  if (Array.isArray(value)) return `rgb(${value.map(channel => String(channel)).join(', ')})`;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return value ?? 'Not captured';
}

function validateCapture(capture) {
  if (!capture || !Object.hasOwn(LABELS, capture.status)) throw new TypeError('Unknown capture status.');
  if (capture.status === 'unsupported') return capture;
  if (!finite(capture.minimumRatio) || capture.minimumRatio < 1 || capture.minimumRatio > 21 || !finite(capture.threshold) || capture.threshold < 1 || capture.threshold > 21) throw new TypeError('A supported capture requires finite contrast and threshold values from 1 to 21.');
  const expected = capture.minimumRatio >= capture.threshold ? 'quickcheck-clear' : 'needs-review';
  if (capture.status !== expected) throw new TypeError('Capture status disagrees with the unrounded contrast comparison.');
  const original = decodePng(capture.images?.original), background = decodePng(capture.images?.background);
  if (original.width !== background.width || original.height !== background.height) throw new TypeError('Original and background PNG dimensions must match.');
  const foreground = parseColor(capture.foreground);
  if (foreground[3] !== 1) throw new TypeError('A supported capture requires an opaque foreground.');
  if (!finite(capture.font?.sizePx) || capture.font.sizePx <= 0 || !String(capture.text ?? '').trim()) throw new TypeError('A supported capture requires measured font size and nonempty text.');
  if (!finite(capture.viewport?.width) || capture.viewport.width <= 0 || !finite(capture.viewport?.height) || capture.viewport.height <= 0 || !finite(capture.bounds?.width) || capture.bounds.width <= 0 || !finite(capture.bounds?.height) || capture.bounds.height <= 0) throw new TypeError('A supported capture requires positive viewport and element dimensions.');
  if (background.width < Math.floor(capture.bounds.width) || background.width > Math.ceil(capture.bounds.width) || background.height < Math.floor(capture.bounds.height) || background.height > Math.ceil(capture.bounds.height)) throw new TypeError('PNG sample dimensions disagree with the recorded element rectangle.');
  const analysis = analyzePixels(background.data, background.width, background.height, foreground, capture.threshold);
  if (analysis.minimumRatio !== capture.minimumRatio || analysis.status !== capture.status) throw new TypeError('Reported contrast disagrees with the opaque background PNG evidence.');
  if (capture.sampleSize && (capture.sampleSize.width !== background.width || capture.sampleSize.height !== background.height)) throw new TypeError('Reported sample size disagrees with the PNG evidence.');
  if (capture.pixelCount !== undefined && capture.pixelCount !== background.width * background.height) throw new TypeError('Reported pixel count disagrees with the PNG evidence.');
  if (capture.method !== 'bounding-box-quickcheck') throw new TypeError('Unknown measurement method.');
  return { ...capture, worstPixel: analysis.worstPixel, sampleSize: { width: background.width, height: background.height }, pixelCount: analysis.pixelCount };
}

export function createReport(captures, { url, selector, createdAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(captures) || captures.length === 0) throw new TypeError('At least one capture is required.');
  captures = captures.map(validateCapture);
  const counts = Object.fromEntries(Object.keys(LABELS).map(status => [status, captures.filter(capture => capture.status === status).length]));
  const status = counts.unsupported ? 'unsupported' : counts['needs-review'] ? 'needs-review' : 'quickcheck-clear';
  return {
    schemaVersion: 1,
    createdAt,
    url,
    selector,
    method: 'bounding-box-quickcheck',
    summary: { status, captureCount: captures.length, counts },
    methodology: {
      comparison: 'Unrounded minimum contrast ratio compared with the selected threshold.',
      sampling: 'The entire selected text element rectangle is sampled against one computed CSS foreground color; text glyphs are not located individually.',
      interpretation: 'A low minimum is a review flag, not an automatic WCAG failure. A clear quickcheck is not a complete accessibility audit.',
      review: 'The worst pixel may lie outside a glyph. Inspect the original crop, sampled background, rendering assumptions, and capture-specific limitations. Report construction rechecks the background calculation; it does not authenticate capture provenance or prevent fabricated images.',
    },
    captures,
  };
}

function renderImage(value, title, alternative, inspection) {
  const source = pngDataUrl(value);
  const size = inspection?.sampleSize, worst = inspection?.worstPixel;
  const marked = size && worst;
  const content = marked
    ? `<div class="pixel-frame" style="--raster-width:${size.width}px;--fit-width:${340 * size.width / size.height}px"><img src="${source}" alt="${escapeHtml(alternative)}"><span class="worst-marker" aria-hidden="true" style="left:${(worst.x + 0.5) / size.width * 100}%;top:${(worst.y + 0.5) / size.height * 100}%"></span></div>`
    : `<img src="${source}" alt="${escapeHtml(alternative)}">`;
  return `<figure><figcaption>${escapeHtml(title)}</figcaption>${source
    ? `<div class="crop${marked ? ' marked-crop' : ''}">${content}</div>`
    : '<div class="missing">No image captured</div>'}</figure>`;
}

function renderCapture(capture, index) {
  const label = LABELS[capture.status];
  const font = capture.font ?? {};
  const bounds = capture.bounds ?? {};
  const viewport = capture.viewport ?? {};
  const images = capture.images ?? {};
  const worst = capture.worstPixel;
  const inspection = capture.status === 'unsupported' ? null : capture;
  const reasons = Array.isArray(capture.reasons) ? capture.reasons : [];
  const limitations = Array.isArray(capture.limitations) ? capture.limitations : [];
  const exactRatio = finite(capture.minimumRatio) ? `<p class="precision">Exact minimum: <code>${escapeHtml(capture.minimumRatio)}</code>. Decisions use this unrounded value.</p>` : '';
  const actualUrl = safeLink(capture.pageUrl);
  const location = capture.pageUrl ? (actualUrl ? `<a href="${escapeHtml(actualUrl)}" rel="noreferrer">${escapeHtml(capture.pageUrl)}</a>` : escapeHtml(capture.pageUrl)) : 'Not recorded';
  const pixel = worst ? `<dl class="pixel"><div><dt>Worst sampled pixel (PNG)</dt><dd>x ${escapeHtml(coordinate(worst.x))}, y ${escapeHtml(coordinate(worst.y))}</dd></div><div><dt>Sampled color</dt><dd><code>${escapeHtml(colorText(worst.color ?? worst.background))}</code></dd></div></dl>` : '<p class="muted">No worst pixel measured.</p>';
  return `<article class="capture" id="capture-${index + 1}">
    <header class="capture-heading"><div><p class="eyebrow">Capture ${String(index + 1).padStart(2, '0')}</p><h2>${escapeHtml(coordinate(viewport.width))} × ${escapeHtml(coordinate(viewport.height))}<span> CSS pixels</span></h2></div><span class="badge ${capture.status}">${label}</span></header>
    <div class="measurement"><div><span class="muted">Lowest sampled contrast</span><p class="ratio">${escapeHtml(ratio(capture.minimumRatio))}</p>${exactRatio}</div><div class="threshold"><span class="muted">Quickcheck threshold</span><strong>${escapeHtml(ratio(capture.threshold))}</strong></div></div>
    <p class="sample-text">${escapeHtml(capture.text || 'No text captured.')}</p>
    ${inspection ? `<p class="muted">The ring marks the same weakest background pixel in both crops. It may sit between letters; inspect the original text before deciding whether contrast fails.</p><input class="zoom-crops" type="checkbox" id="zoom-${index + 1}"><label class="zoom-label" for="zoom-${index + 1}">Enlarge both crops to 2×</label>` : ''}
    <div class="images">${renderImage(images.original, 'Original element crop', 'Captured original text element', inspection)}${renderImage(images.background, 'Background with text hidden', 'Background pixels used by the bounding-box quickcheck', inspection)}</div>
    ${pixel}
    <details><summary>Capture details</summary><dl class="facts"><div><dt>Selector</dt><dd><code>${escapeHtml(capture.selector)}</code></dd></div><div><dt>Computed foreground</dt><dd><code>${escapeHtml(colorText(capture.foreground))}</code></dd></div><div><dt>Font</dt><dd>${escapeHtml(coordinate(font.sizePx))} px · weight ${escapeHtml(font.weight ?? '—')}</dd></div><div><dt>Element bounds</dt><dd>x ${escapeHtml(coordinate(bounds.x))}, y ${escapeHtml(coordinate(bounds.y))} · ${escapeHtml(coordinate(bounds.width))} × ${escapeHtml(coordinate(bounds.height))}</dd></div><div><dt>Capture time</dt><dd>${escapeHtml(capture.capturedAt ?? 'Not recorded')}</dd></div><div><dt>Actual captured page</dt><dd>${location}</dd></div><div><dt>Browser version</dt><dd>${escapeHtml(capture.browserVersion ?? 'Not recorded')}</dd></div><div><dt>User agent</dt><dd>${escapeHtml(capture.userAgent ?? 'Not recorded')}</dd></div><div><dt>Device pixel ratio</dt><dd>${escapeHtml(coordinate(viewport.deviceScaleFactor))}</dd></div><div><dt>PNG sample dimensions</dt><dd>${escapeHtml(coordinate(capture.sampleSize?.width))} × ${escapeHtml(coordinate(capture.sampleSize?.height))} · ${escapeHtml(capture.pixelCount ?? '—')} pixels</dd></div><div><dt>Method</dt><dd><code>${escapeHtml(capture.method ?? 'bounding-box-quickcheck')}</code></dd></div></dl></details>
    ${reasons.length ? `<section class="notes"><h3>Why this result needs attention</h3><ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></section>` : ''}
    ${capture.error ? `<section class="notes"><h3>Capture error</h3><p><code>${escapeHtml(capture.error.message)}</code></p></section>` : ''}
    ${limitations.length ? `<section class="notes"><h3>Capture limitations</h3><ul>${limitations.map(limitation => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul></section>` : ''}
  </article>`;
}

export function renderReport(report) {
  if (!report?.summary || !Array.isArray(report.captures)) throw new TypeError('A generated report is required.');
  // Recompute classification before rendering; caller-supplied counts cannot create a clear result.
  report = createReport(report.captures, { url: report.url, selector: report.selector, createdAt: report.createdAt });
  const counts = report.summary.counts;
  const headline = report.summary.status === 'quickcheck-clear' ? 'Nothing flagged in this quickcheck.'
    : report.summary.status === 'needs-review' ? 'Inspect the marked backgrounds.' : 'Some captures could not be evaluated.';
  const link = safeLink(report.url);
  const source = link ? `<a href="${escapeHtml(link)}" rel="noreferrer">${escapeHtml(report.url)}</a>` : escapeHtml(report.url);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Contrast Evidence — ${escapeHtml(report.selector)}</title>
<style>
:root{color-scheme:light;--ink:#182235;--muted:#526078;--line:#dce3ee;--paper:#f6f8fc;--accent:#244fe0}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.55}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}a:focus-visible,summary:focus-visible{outline:3px solid #a64f00;outline-offset:4px}main{max-width:1120px;padding:42px 30px 58px;margin:auto}.brand{display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:36px}.mark{background:var(--accent);color:white;border-radius:8px;width:35px;height:35px;display:grid;place-items:center;font-weight:750}.brand strong{font-size:17px;letter-spacing:-.3px}.brand span:last-child{margin-left:auto;color:var(--muted);font-size:12px;letter-spacing:.02em}.eyebrow{font-size:11px;letter-spacing:.02em;font-weight:750;color:var(--muted);margin:0 0 8px}h1{font-family:inherit;font-weight:650;letter-spacing:-1.25px;font-size:clamp(30px,4.2vw,46px);line-height:1.08;margin:0 0 18px;max-width:770px}.intro{max-width:720px;color:var(--muted);font-size:16px}.source{border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:28px;padding:20px 0;display:grid;grid-template-columns:1fr 1fr;gap:16px}.source dt{font-size:11px;letter-spacing:.02em;color:var(--muted);margin-bottom:5px}.source dd{margin:0;overflow-wrap:anywhere}.source .wide{grid-column:1/-1}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.87em;overflow-wrap:anywhere}.summary{display:flex;flex-wrap:wrap;gap:9px;margin:23px 0 29px}.badge{border:1px solid;padding:5px 11px;border-radius:999px;font-size:12px;font-weight:650;white-space:nowrap}.quickcheck-clear{color:#2548a8;background:#edf3ff;border-color:#ccd9f6}.needs-review{color:#714500;background:#fff1ce;border-color:#e7cb89}.unsupported{color:#555464;background:#eeeef3;border-color:#d6d6df}.capture{background:white;border:1px solid var(--line);border-radius:14px;padding:26px;margin:20px 0;box-shadow:0 5px 20px #172c3105}.capture-heading{display:flex;justify-content:space-between;align-items:center;gap:15px}.capture-heading h2{font-size:22px;letter-spacing:-.5px;margin:0;font-weight:650}.capture-heading h2 span{font-size:12px;font-weight:400;letter-spacing:0;color:var(--muted)}.measurement{display:flex;justify-content:space-between;gap:25px;margin:26px 0 16px;border-top:1px solid var(--line);padding-top:21px}.muted{color:var(--muted);font-size:13px}.ratio{font-size:45px;line-height:1.1;letter-spacing:-1.7px;font-weight:600;margin:8px 0}.threshold{text-align:right;min-width:150px}.threshold strong{display:block;font-size:24px;line-height:1.1;margin-top:10px;font-weight:600;letter-spacing:-.6px}.precision{font-size:12px;color:var(--muted);margin:0;max-width:550px}.sample-text{padding:13px 16px;background:#f3f6fc;border-left:3px solid #8daaf3;white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font-size:14px}.images{display:grid;grid-template-columns:1fr 1fr;gap:17px;margin-top:22px}figure{margin:0;min-width:0}figcaption{font-size:12px;font-weight:650;color:var(--muted);margin-bottom:8px}.crop,.missing{min-height:115px;border:1px solid var(--line);border-radius:8px;background:repeating-conic-gradient(#f5f5f5 0% 25%,#fff 0% 50%) 50%/16px 16px;display:flex;align-items:center;justify-content:center;padding:15px;overflow:auto}.crop img{display:block;max-width:100%;height:auto;max-height:340px;object-fit:contain}.missing{font-size:13px;color:var(--muted);background:#f4f6fb}.pixel{display:flex;gap:30px;margin:17px 0 20px}.pixel dt,.facts dt{font-size:11px;color:var(--muted);margin-bottom:4px}.pixel dd,.facts dd{font-size:13px;margin:0;overflow-wrap:anywhere}details{border-top:1px solid var(--line);padding-top:13px}summary{cursor:pointer;font-size:13px;font-weight:650}.facts{display:grid;grid-template-columns:1fr 1fr;gap:15px 22px;margin-bottom:0}.notes{border-top:1px solid var(--line);margin-top:18px;padding-top:14px}.notes h3{font-size:13px;margin:0 0 7px}.notes ul{font-size:13px;padding-left:20px;margin:0;color:var(--muted)}.method{margin-top:33px;padding:25px 0;border-top:1px solid var(--line)}.method h2{font-size:20px;letter-spacing:-.3px;margin:0 0 13px}.method p{max-width:820px;font-size:14px;color:var(--muted)}footer{font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:17px}@media(max-width:650px){main{padding:25px 17px}.brand{margin-bottom:28px}.brand span:last-child{display:none}.source{grid-template-columns:1fr}.capture{padding:18px;border-radius:10px}.capture-heading h2{font-size:19px}.capture-heading h2 span{display:block;margin-top:3px}.badge{font-size:11px;padding:4px 8px}.measurement{gap:15px}.threshold{min-width:115px}.ratio{font-size:36px}.threshold strong{font-size:21px}.images,.facts{grid-template-columns:1fr}.pixel{display:grid;gap:12px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{body{background:white}main{max-width:none;padding:0}.capture{break-inside:avoid;box-shadow:none}details .facts{display:grid}a{color:inherit}}
.crop.marked-crop{display:block;max-height:480px}.pixel-frame{position:relative;width:min(100%,var(--raster-width),var(--fit-width));margin-inline:auto}.crop .pixel-frame img{width:100%;height:auto;max-width:none;max-height:none}.worst-marker{position:absolute;width:14px;height:14px;box-sizing:border-box;border:2px solid #ffdf65;border-radius:50%;box-shadow:0 0 0 1px #182235;transform:translate(-50%,-50%);pointer-events:none}.zoom-label{font-size:13px;margin-left:7px;cursor:pointer}.zoom-crops{accent-color:#244fe0}.zoom-crops:focus-visible{outline:3px solid #a64f00;outline-offset:3px}.zoom-crops:checked~.images .pixel-frame{width:calc(var(--raster-width)*2)}
</style></head><body><main>
<div class="brand"><span class="mark" aria-hidden="true">C</span><strong>Contrast Evidence</strong><span>Portable capture report</span></div>
<header><p class="eyebrow">Bounding-box quickcheck</p><h1>${headline}</h1><p class="intro">Compare a text element with the background captured behind it. Review flags identify places to inspect; they do not establish a WCAG failure.</p></header>
<dl class="source"><div class="wide"><dt>Page</dt><dd>${source}</dd></div><div><dt>Selected element</dt><dd><code>${escapeHtml(report.selector)}</code></dd></div><div><dt>Captured at</dt><dd>${escapeHtml(report.createdAt)} <span class="muted">(ISO timestamp)</span></dd></div></dl>
<div class="summary" aria-label="Capture summary"><span class="badge quickcheck-clear">${escapeHtml(counts['quickcheck-clear'])} clear</span><span class="badge needs-review">${escapeHtml(counts['needs-review'])} to review</span><span class="badge unsupported">${escapeHtml(counts.unsupported)} unsupported</span></div>
${report.captures.map((capture, index) => `${capture.pageUrl && capture.pageUrl !== report.url ? `<p class="muted">Capture ${index + 1} followed the requested URL to ${safeLink(capture.pageUrl) ? `<a href="${escapeHtml(safeLink(capture.pageUrl))}" rel="noreferrer">${escapeHtml(capture.pageUrl)}</a>` : escapeHtml(capture.pageUrl)}.</p>` : ''}${renderCapture(capture, index)}`).join('\n')}
<section class="method"><p class="eyebrow">How to interpret this evidence</p><h2>A conservative signal, with a visible boundary.</h2><p>${escapeHtml(report.methodology?.sampling)}</p><p>${escapeHtml(report.methodology?.review)}</p><p>${escapeHtml(report.methodology?.interpretation)} The displayed ratio is rounded to two decimals; the JSON and decision retain full precision.</p></section>
<footer>Self-contained report. Images are embedded; no remote fonts, scripts, analytics, or assets are requested. Open <code>report.json</code> beside this file for the complete evidence record.</footer>
</main></body></html>`;
}

export async function writeReport(report, directory) {
  const output = path.resolve(directory);
  report = createReport(report.captures, { url: report.url, selector: report.selector, createdAt: report.createdAt });
  const html = renderReport(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'report.json'), json, 'utf8');
  await writeFile(path.join(output, 'index.html'), html, 'utf8');
  return { json: path.join(output, 'report.json'), html: path.join(output, 'index.html') };
}
