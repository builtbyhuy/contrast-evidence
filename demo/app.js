import { parseColor, textThreshold, analyzePixels } from '../src/contrast.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const canvas = $('backgroundCanvas');
const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
const defaults = Object.freeze({ background: 'photo', view: 'wide', foreground: '#ffffff', size: 52, weight: 700, font: 'sans', scrim: 12, crop: 50, gradientStart: '#bcd5fa', gradientEnd: '#213e91', text: 'Good design\nstands up to\na closer look.' });
const state = { ...defaults, image: null, source: null };
const bundledSource = { name: 'repair-workshop.jpg', kind: 'bundled-photo', creator: 'Rehook Bike', url: 'https://www.pexels.com/photo/close-up-of-fixing-a-bicycle-10263877/', license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/' };
let bundledImage;
let evidence;
let scheduled = false;
let uploadGeneration = 0;
let loading = true;
let fontDataPromise;
let colorInputInvalid = false;

function unsupported(message) {
  evidence = null;
  $('resultPanel').dataset.status = 'unsupported';
  $('resultLabel').textContent = 'Check unavailable';
  $('resultTitle').textContent = 'Adjust the preview to check it';
  $('statusIcon').textContent = '?';
  $('minimumRatio').textContent = '—';
  $('previewRatio').textContent = '—';
  $('previewStatus').textContent = 'Check unavailable';
  $('previewStatus').parentElement.dataset.status = 'unsupported';
  $('pixelLegend').hidden = true;
  $('resultDescription').textContent = message;
  $('overlaySuggestion').hidden = true;
  $('exportHtml').disabled = true;
  $('exportJson').disabled = true;
  ['areaOutline', 'worstMarker', 'areaTag'].forEach(id => $(id).hidden = true);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; render(); });
}

function render() {
  if (loading) return;
  if (!context) return unsupported('This browser cannot read the preview pixels. Use a browser with Canvas 2D support.');
  try {
    stage.dataset.view = state.view;
    const availableWidth = Math.floor(stage.parentElement.getBoundingClientRect().width);
    const stageWidth = state.view === 'narrow' ? Math.min(availableWidth, window.innerWidth <= 680 ? 290 : 340) : availableWidth;
    stage.style.width = `${stageWidth}px`;
    const stageHeight = Math.round(stage.getBoundingClientRect().height);
    if (stageWidth < 1 || stageHeight < 1) return unsupported('The preview is not visible. Make the window wider and try again.');
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(stageWidth * scale);
    canvas.height = Math.round(stageHeight * scale);
    context.setTransform(canvas.width / stageWidth, 0, 0, canvas.height / stageHeight, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, stageWidth, stageHeight);
    if (state.background === 'photo') {
      if (!state.image) return unsupported('The photograph has not loaded. Choose another image or try the gradient.');
      const cover = Math.max(stageWidth / state.image.naturalWidth, stageHeight / state.image.naturalHeight);
      const width = state.image.naturalWidth * cover, height = state.image.naturalHeight * cover;
      context.drawImage(state.image, (stageWidth - width) / 2, (stageHeight - height) * state.crop / 100, width, height);
    } else {
      const gradient = context.createLinearGradient(0, 0, stageWidth, stageHeight);
      gradient.addColorStop(0, state.gradientStart);
      gradient.addColorStop(1, state.gradientEnd);
      context.fillStyle = gradient;
      context.fillRect(0, 0, stageWidth, stageHeight);
    }
    context.fillStyle = `rgba(0,0,0,${state.scrim / 100})`;
    context.fillRect(0, 0, stageWidth, stageHeight);

    const text = $('sampleText');
    text.textContent = state.text;
    text.style.color = state.foreground;
    text.style.fontSize = `${state.size}px`;
    text.style.fontWeight = String(state.weight);
    text.style.fontFamily = state.font === 'serif' ? 'Georgia, serif' : '"Instrument Sans", sans-serif';
    text.style.letterSpacing = state.size >= 28 ? '-0.025em' : '0';
    const fontSize = Number.parseFloat(getComputedStyle(text).fontSize);
    const threshold = textThreshold(fontSize, state.weight);
    $('thresholdLabel').textContent = `Target: ${threshold}:1 for ${threshold === 3 ? 'large' : 'normal'} text`;
    $('previewDimensions').textContent = `${stageWidth} × ${stageHeight} px · ${state.view === 'wide' ? 'wide' : 'narrow'} crop`;
    if (colorInputInvalid) return unsupported('Enter a valid six-digit text color, such as #ffffff. The preview shows the last valid color; it cannot be exported as a new check.');
    if (!state.text.trim()) return unsupported('Add some text to check. The background alone has no text contrast result.');
    if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(state.text)) return unsupported('Emoji can render in several colors, so this single text-color check does not support them. Use ordinary text, including Vietnamese characters, for a supported check.');
    const stageRect = stage.getBoundingClientRect(), textRect = text.getBoundingClientRect();
    if (textRect.top < stageRect.top || textRect.bottom > stageRect.bottom || textRect.left < stageRect.left || textRect.right > stageRect.right) {
      return unsupported('The text does not fit inside the preview. Reduce its size or shorten it before checking.');
    }
    const sx = canvas.width / stageWidth, sy = canvas.height / stageHeight;
    const region = {
      x: Math.max(0, Math.floor((textRect.left - stageRect.left) * sx)),
      y: Math.max(0, Math.floor((textRect.top - stageRect.top) * sy)),
      width: 0, height: 0
    };
    region.width = Math.min(canvas.width, Math.ceil((textRect.right - stageRect.left) * sx)) - region.x;
    region.height = Math.min(canvas.height, Math.ceil((textRect.bottom - stageRect.top) * sy)) - region.y;
    if (region.width < 1 || region.height < 1) return unsupported('This text has no visible area to check. Add a readable text sample.');
    const pixels = context.getImageData(region.x, region.y, region.width, region.height);
    const result = analyzePixels(pixels.data, region.width, region.height, parseColor(state.foreground), threshold);
    const regionCss = { x: region.x / sx, y: region.y / sy, width: region.width / sx, height: region.height / sy };
    evidence = {
      schema: 'contrast-evidence-playground/v1',
      capturedAt: new Date().toISOString(),
      method: 'Conservative minimum of opaque sRGB background pixels across the DOM text bounding rectangle. Includes gaps between letters and lines; no glyph mask or OCR.',
      scope: 'Controlled local canvas background and opaque DOM text. This result applies only to the recorded preview, text size, crop and overlay.',
      ...result,
      conclusion: result.status === 'needs-review' ? 'The bounding-box minimum is below the text threshold. Inspect behind the actual letters; this is not an automatic WCAG failure.' : 'All sampled background pixels in this rectangle meet the text threshold. This is not a full accessibility or WCAG conformance assessment.',
      settings: { ...state, image: undefined, source: undefined },
      source: state.background === 'photo' ? { ...state.source } : { kind: 'generated-gradient', name: 'Local diagonal gradient' },
      preview: { width: stageWidth, height: stageHeight, bitmapWidth: canvas.width, bitmapHeight: canvas.height, devicePixelRatio: scale },
      region, regionCss,
      worstPixelInPreview: { x: (region.x + result.worstPixel.x + .5) / sx, y: (region.y + result.worstPixel.y + .5) / sy },
      font: { family: state.font === 'serif' ? 'Georgia' : 'Instrument Sans', sizePx: fontSize, weight: state.weight, lineHeightPx: Number.parseFloat(getComputedStyle(text).lineHeight), letterSpacingPx: Number.parseFloat(getComputedStyle(text).letterSpacing) || 0 },
      renderedLines: renderedLines(text)
    };
    showResult(result);
    showArea(regionCss, evidence.worstPixelInPreview);
  } catch (error) {
    unsupported('The preview could not be checked. Choose a supported local image or reset the example.');
    console.error('Contrast preview check unavailable:', error);
  }
}

function renderedLines(element) {
  const node = element.firstChild;
  if (!node || node.nodeType !== Node.TEXT_NODE) return [];
  const lines = [];
  let current = '', currentTop = null, offset = 0;
  for (const character of node.textContent) {
    if (character === '\n') { lines.push(current); current = ''; currentTop = null; offset++; continue; }
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + character.length);
    const rect = range.getBoundingClientRect();
    if (currentTop !== null && Math.abs(rect.top - currentTop) > 2) { lines.push(current); current = ''; }
    currentTop = rect.top;
    current += character;
    offset += character.length;
  }
  lines.push(current);
  return lines;
}

function showArea(region, worst) {
  const shown = $('showMarker').checked;
  for (const id of ['areaOutline', 'worstMarker', 'areaTag']) $(id).hidden = !shown;
  Object.assign($('areaOutline').style, { left: `${region.x}px`, top: `${region.y}px`, width: `${region.width}px`, height: `${region.height}px` });
  Object.assign($('worstMarker').style, { left: `${worst.x}px`, top: `${worst.y}px` });
  Object.assign($('areaTag').style, { left: `${region.x}px`, top: `${Math.max(5, region.y - 25)}px` });
}

function showResult(result) {
  const clear = result.status === 'quickcheck-clear';
  $('resultPanel').dataset.status = result.status;
  $('resultLabel').textContent = clear ? 'Quick check clear' : 'Needs review';
  $('resultTitle').textContent = clear ? 'This area clears the quick check' : 'A spot needs a closer look';
  $('statusIcon').textContent = clear ? '✓' : '!';
  // The rounded display never determines the result. The shared math compares full precision.
  const shownRatio = result.minimumRatio.toFixed(2);
  $('minimumRatio').textContent = `${shownRatio}:1`;
  $('previewRatio').textContent = `${shownRatio}:1`;
  $('previewStatus').textContent = clear ? 'Quick check clear' : 'Needs review';
  $('previewStatus').parentElement.dataset.status = result.status;
  $('pixelLegend').hidden = false;
  $('textSwatch').style.backgroundColor = state.foreground;
  $('spotSwatch').style.backgroundColor = `rgb(${result.worstPixel.color.join(',')})`;
  $('textColorLabel').textContent = state.foreground;
  $('spotColorLabel').textContent = `rgb(${result.worstPixel.color.join(', ')})`;
  $('minimumRatio').title = `Unrounded minimum: ${result.minimumRatio}:1`;
  const threshold = result.threshold;
  $('resultDescription').textContent = clear
    ? `Every sampled background pixel in this text area meets ${threshold}:1 for the current text. Changing the crop, size or overlay can change the result. This is a local check, not a full accessibility review.`
    : `The lowest contrast in this text area is below ${threshold}:1. The marked spot may be between letters. Inspect behind the actual letters before deciding whether the text fails.`;
  $('overlaySuggestion').hidden = clear || state.scrim >= 70 || state.foreground !== '#ffffff';
  $('exportHtml').disabled = false;
  $('exportJson').disabled = false;
}

function syncControls() {
  $('sampleInput').value = state.text;
  $('foregroundColor').value = state.foreground;
  if (!colorInputInvalid) {
    $('foregroundHex').value = state.foreground;
    $('foregroundHex').removeAttribute('aria-invalid');
    $('colorError').textContent = '';
  }
  $('fontStyle').value = state.font;
  $('fontWeight').value = String(state.weight);
  for (const [id, key, suffix] of [['fontSize', 'size', ' px'], ['scrim', 'scrim', '%'], ['cropPosition', 'crop', '%']]) {
    const input = $(id);
    input.value = String(state[key]);
    input.style.setProperty('--fill', `${(Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
    $(id === 'fontSize' ? 'sizeValue' : id === 'scrim' ? 'scrimValue' : 'cropValue').textContent = `${state[key]}${suffix}`;
  }
  $('gradientStart').value = state.gradientStart;
  $('gradientEnd').value = state.gradientEnd;
  document.querySelectorAll('[data-background]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.background === state.background)));
  document.querySelectorAll('button[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
  $('photoControls').hidden = state.background !== 'photo';
  $('gradientControls').hidden = state.background !== 'gradient';
  $('photoCredit').replaceChildren();
  if (state.background === 'photo' && state.source?.kind === 'bundled-photo') {
    const credit = document.createElement('a');
    credit.href = bundledSource.url;
    credit.textContent = 'Rehook Bike / Pexels';
    $('photoCredit').append('Photo: ', credit, '. Sample text is for demonstration.');
  } else if (state.background === 'photo') {
    $('photoCredit').textContent = `${state.source?.name || 'Your image'} · loaded locally. No upload to a server.`;
  } else {
    $('photoCredit').textContent = 'Generated here in your browser. Sample text is for demonstration.';
  }
}

$('controls').addEventListener('submit', event => event.preventDefault());
for (const button of document.querySelectorAll('[data-background]')) button.addEventListener('click', () => { state.background = button.dataset.background; syncControls(); schedule(); });
for (const button of document.querySelectorAll('button[data-view]')) button.addEventListener('click', () => { state.view = button.dataset.view; syncControls(); schedule(); });
for (const [id, key] of [['fontSize', 'size'], ['fontWeight', 'weight'], ['scrim', 'scrim'], ['cropPosition', 'crop']]) $(id).addEventListener('input', event => { state[key] = Number(event.target.value); syncControls(); schedule(); });
for (const [id, key] of [['gradientStart', 'gradientStart'], ['gradientEnd', 'gradientEnd'], ['fontStyle', 'font']]) $(id).addEventListener('input', event => { state[key] = event.target.value; schedule(); });
$('sampleInput').addEventListener('input', event => { state.text = event.target.value; schedule(); });
$('foregroundColor').addEventListener('input', event => { colorInputInvalid = false; state.foreground = event.target.value; $('foregroundHex').value = state.foreground; $('foregroundHex').removeAttribute('aria-invalid'); $('colorError').textContent = ''; schedule(); });
$('foregroundHex').addEventListener('input', event => {
  const candidate = event.target.value.trim();
  if (!/^#[\da-f]{6}$/i.test(candidate)) {
    colorInputInvalid = true;
    event.target.setAttribute('aria-invalid', 'true');
    $('colorError').textContent = 'Use a six-digit hex color, such as #ffffff. The preview keeps the last valid color.';
    schedule();
    return;
  }
  colorInputInvalid = false;
  event.target.removeAttribute('aria-invalid');
  $('colorError').textContent = '';
  state.foreground = candidate.toLowerCase();
  $('foregroundColor').value = state.foreground;
  schedule();
});
$('showMarker').addEventListener('change', schedule);
$('resetButton').addEventListener('click', () => {
  uploadGeneration++;
  colorInputInvalid = false;
  Object.assign(state, defaults, { image: bundledImage || null, source: bundledSource });
  $('imageUpload').value = '';
  $('uploadMessage').textContent = '';
  $('exportMessage').textContent = '';
  $('showMarker').checked = true;
  syncControls();
  schedule();
});
$('overlaySuggestion').addEventListener('click', () => { state.scrim = Math.min(85, Math.max(48, state.scrim + 20)); syncControls(); schedule(); });

function inspectRaster(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  if (bytes.length >= 24 && bytes[0] === 137 && ascii(1, 3) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (ascii(offset + 4, 4) === 'acTL') throw new Error('Animated PNG files are not supported. Choose a static PNG, JPEG or WebP.');
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
    return { mime: 'image/png', width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 <= bytes.length) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mime: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const kind = ascii(12, 4);
    if (kind === 'VP8X') {
      if (bytes[20] & 2) throw new Error('Animated WebP files are not supported. Choose a static image.');
      return { mime: 'image/webp', width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { mime: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L' && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1 };
    }
  }
  throw new Error('This file is not a supported static PNG, JPEG or WebP. SVG, GIF and other formats are not accepted.');
}

$('imageUpload').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const generation = ++uploadGeneration;
  $('uploadMessage').textContent = 'Reading your image locally…';
  try {
    if (!file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB. The current preview has been kept.');
    if (!['image/png', 'image/jpeg', 'image/webp', ''].includes(file.type)) throw new Error('Choose a static PNG, JPEG or WebP. SVG, GIF and other formats are not accepted.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dimensions = inspectRaster(bytes);
    if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 6000 || dimensions.height > 6000 || dimensions.width * dimensions.height > 16_000_000) throw new Error('Choose an image up to 16 megapixels and 6,000 pixels per side. The current preview has been kept.');
    const url = URL.createObjectURL(new Blob([bytes], { type: dimensions.mime }));
    const image = new Image();
    image.src = url;
    try { await image.decode(); } finally { URL.revokeObjectURL(url); }
    if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 6000 || image.naturalHeight > 6000 || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('The decoded image exceeds the supported dimensions. Choose a smaller image.');
    if (generation !== uploadGeneration) return;
    state.image = image;
    state.source = { name: file.name, kind: 'local-upload', mime: dimensions.mime, width: image.naturalWidth, height: image.naturalHeight, bytes: file.size, rights: 'User-supplied image; license not verified by this tool.' };
    state.background = 'photo';
    $('uploadMessage').textContent = `${file.name} loaded. It stays in this browser.`;
    syncControls();
    schedule();
  } catch (error) {
    if (generation === uploadGeneration) $('uploadMessage').textContent = error.message || 'This image could not be decoded. Choose another static PNG, JPEG or WebP.';
  } finally {
    if (generation === uploadGeneration) event.target.value = '';
  }
});

function snapshot() {
  if (!evidence) throw new Error('There is no supported check to export yet.');
  const crop = document.createElement('canvas');
  crop.width = evidence.region.width;
  crop.height = evidence.region.height;
  crop.getContext('2d').drawImage(canvas, evidence.region.x, evidence.region.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return { ...evidence, backgroundPng: canvas.toDataURL('image/png'), checkedBackgroundPng: crop.toDataURL('image/png') };
}

function download(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
async function embeddedFont() {
  if (!fontDataPromise) fontDataPromise = fetch('assets/instrument-sans.ttf').then(response => {
    if (!response.ok) throw new Error('The report font could not be loaded. Check that the demo assets are available.');
    return response.blob();
  }).then(blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }));
  return fontDataPromise;
}

async function reportHtml(record) {
  const [font, fontLicense] = await Promise.all([embeddedFont(), fetch('assets/instrument-sans-OFL.txt').then(response => {
    if (!response.ok) throw new Error('The font license could not be loaded. Try exporting JSON instead.');
    return response.text();
  })]);
  const source = record.source;
  const sourceText = source.kind === 'bundled-photo' ? `Photo: <a href="${escapeHtml(source.url)}">${escapeHtml(source.creator)} / Pexels</a> · <a href="${escapeHtml(source.licenseUrl)}">Pexels License</a>` : `${escapeHtml(source.name)} — ${source.kind === 'local-upload' ? 'user-supplied image; its license was not verified' : 'generated locally'}`;
  const box = record.regionCss;
  const px = record.preview.width;
  const css = `@font-face{font-family:Instrument Sans;src:url('${font}') format('truetype');font-weight:400 700}*{box-sizing:border-box}body{margin:0;background:#f3f5f4;color:#20282b;font-family:'Instrument Sans',sans-serif;padding:40px 24px}main{max-width:960px;margin:auto}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:30px}h1{font-size:35px;letter-spacing:-1.3px;margin:0 0 10px}p{font-size:14px;line-height:1.75;max-width:75ch}a{color:#2146d0}.badge{display:inline-block;border:1px solid #bdc9ce;padding:7px 11px;border-radius:5px;font-size:12px;white-space:nowrap}.scene{position:relative;width:min(100%,${px}px);aspect-ratio:${px}/${record.preview.height};container-type:inline-size;overflow:hidden;background:#fff;border-radius:6px}.scene>img{display:block;width:100%;height:100%}.sample{position:absolute;left:${box.x / px * 100}%;top:${box.y / record.preview.height * 100}%;font-size:${record.font.sizePx / px * 100}cqw;font-family:${record.font.family === 'Georgia' ? 'Georgia,serif' : "'Instrument Sans',sans-serif"};font-weight:${record.font.weight};line-height:${record.font.lineHeightPx / record.font.sizePx};letter-spacing:${record.font.letterSpacingPx / px * 100}cqw;color:${record.settings.foreground};white-space:pre;margin:0}.area{position:absolute;left:${box.x / px * 100}%;top:${box.y / record.preview.height * 100}%;width:${box.width / px * 100}%;height:${box.height / record.preview.height * 100}%;border:1px dashed #f1d96c;pointer-events:none}.marker{position:absolute;left:${record.worstPixelInPreview.x / px * 100}%;top:${record.worstPixelInPreview.y / record.preview.height * 100}%;width:14px;height:14px;border:2px solid #f1d96c;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 1px #20282b}.result{background:${record.status === 'quickcheck-clear' ? '#e7f2ec' : '#fff5d7'};padding:22px;margin:25px 0;border-radius:6px}.ratio{font-size:38px;letter-spacing:-1.5px}pre{overflow-wrap:anywhere}.facts{display:grid;grid-template-columns:1fr 1fr;gap:15px;border-top:1px solid #cbd6da;margin-top:28px;padding-top:20px}.facts dt{font-size:11px;color:#53636d;margin-bottom:6px}.facts dd{font-size:14px;margin:0;overflow-wrap:anywhere}footer{border-top:1px solid #cbd6da;padding-top:20px;margin-top:30px;font-size:11px;color:#53636d}.crop{max-width:100%;border:1px solid #cbd6da}details{margin-top:25px}summary{cursor:pointer;font-size:13px;padding:10px 0}code{overflow-wrap:anywhere}@media(max-width:600px){body{padding:25px 16px}header{display:block}.badge{margin-top:10px}h1{font-size:29px}pre{overflow-wrap:anywhere}.facts{grid-template-columns:1fr}}`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Contrast evidence — ${escapeHtml(record.status)}</title><style>${css}</style></head><body><main><header><div><h1>Contrast evidence</h1><p>Recorded ${escapeHtml(new Date(record.capturedAt).toISOString())}</p></div><span class="badge">${record.status === 'quickcheck-clear' ? 'Quick check clear' : 'Needs review'}</span></header><div class="scene"><img src="${record.backgroundPng}" alt="Recorded background from the contrast check"><span class="sample">${escapeHtml(record.renderedLines.join('\n'))}</span><span class="area"></span><span class="marker"></span></div><div class="result"><span class="ratio">${record.minimumRatio.toFixed(2)}:1</span><p>Lowest background contrast in the text area. Target: ${record.threshold}:1.</p><p>${escapeHtml(record.conclusion)}</p></div><dl class="facts"><div><dt>Preview dimensions</dt><dd>${record.preview.width} × ${record.preview.height} CSS pixels</dd></div><div><dt>Text</dt><dd>${escapeHtml(record.font.family)}, ${record.font.sizePx}px, weight ${record.font.weight}; ${escapeHtml(record.settings.foreground)}</dd></div><div><dt>Checked area</dt><dd>${record.region.width} × ${record.region.height} background pixels; ${record.pixelCount.toLocaleString('en')} pixels sampled</dd></div><div><dt>Lowest-contrast pixel</dt><dd>rgb(${record.worstPixel.color.join(', ')}); at ${record.worstPixel.x}, ${record.worstPixel.y} within the checked area</dd></div><div><dt>Dark overlay</dt><dd>${record.settings.scrim}%</dd></div><div><dt>Source</dt><dd>${sourceText}</dd></div></dl><details><summary>Inspect the sampled background</summary><p>This rectangle includes spaces between letters and lines. Its weakest pixel may not sit behind a letter.</p><img class="crop" src="${record.checkedBackgroundPng}" alt="Only the sampled background, without text"><p><strong>Unrounded ratio:</strong> <code>${record.minimumRatio}</code></p></details><footer><p>${escapeHtml(record.method)}</p><p>This export records the original check dimensions. Changing the source, crop, font or text requires a new check. The scaled illustration is for review; the measurements are from the recorded preview.</p><p>Created with <a href="https://github.com/builtbyhuy/contrast-evidence">Contrast Evidence</a>. Instrument Sans by the Instrument Sans Project Authors, licensed under SIL OFL 1.1.</p><details><summary>Embedded font license</summary><pre style="white-space:pre-wrap;font-size:10px;line-height:1.6">${escapeHtml(fontLicense)}</pre></details></footer></main></body></html>`;
}

$('exportJson').addEventListener('click', () => {
  try { render(); download(JSON.stringify(snapshot(), null, 2), 'application/json', 'contrast-evidence.json'); $('exportMessage').textContent = 'Evidence JSON saved. It includes the recorded background and checked crop.'; }
  catch (error) { $('exportMessage').textContent = error.message; }
});
$('exportHtml').addEventListener('click', async () => {
  const button = $('exportHtml');
  try {
    render();
    const record = snapshot();
    button.disabled = true;
    $('exportMessage').textContent = 'Preparing your self-contained report…';
    const html = await reportHtml(record);
    download(html, 'text/html', 'contrast-evidence.html');
    $('exportMessage').textContent = 'Visual report saved. Open it in any modern browser; it needs no connection.';
  } catch (error) { $('exportMessage').textContent = error.message || 'The report could not be created. Try exporting JSON.'; }
  finally { button.disabled = !evidence; }
});

new ResizeObserver(schedule).observe(stage.parentElement);
window.addEventListener('resize', schedule);
syncControls();
try {
  bundledImage = new Image();
  bundledImage.src = 'assets/repair-workshop.jpg';
  await Promise.all([bundledImage.decode(), document.fonts.load('700 52px "Instrument Sans"')]);
  state.image = bundledImage;
  state.source = bundledSource;
} catch (error) {
  $('uploadMessage').textContent = 'The example photo could not be loaded. Choose your own image or select Gradient.';
  console.error('Example assets unavailable:', error);
} finally {
  loading = false;
  syncControls();
  schedule();
}
