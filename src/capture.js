import { PNG } from 'pngjs';
import { analyzePixels, parseColor, textThreshold } from './contrast.js';

const LIMITATIONS = Object.freeze([
  'A bounding-box quickcheck below the threshold needs review; it is not an automatic WCAG failure.',
  'Evidence applies only to this element, browser, viewport, crop and captured state.',
  'The entire pixel rectangle is checked, including spaces and padding; review may still find sufficient contrast behind individual letters.',
  'The caller must ensure image backgrounds are stationary; animated image formats cannot be reliably identified from the DOM.',
  'Only monochrome text with normal font style is supported; detected emoji, italic and oblique text are rejected.',
  'Shadow-root text and uncertain paint extending from other elements are outside the supported capture scope.',
  'This tool does not certify accessibility or inspect other interaction states.'
]);

// Give style changes two paint opportunities without weakening pixel identity.
const settlePaint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// A temporary style attribute can itself match author CSS, including :has().
// Record the relevant rendered scene, rather than assuming a mask only removes
// text. Empty target pseudos inherit the three intentionally suppressed paints;
// their background, content and every other computed property still participate.
function paintState(element) {
  const rect = element.getBoundingClientRect();
  const ancestors = new Set(); for (let node = element; node; node = node.parentElement) ancestors.add(node);
  // Chromium also exposes the text-decoration shorthand with its color folded
  // in. Its line/style/thickness longhands remain checked independently.
  const ignored = new Set(['-webkit-text-fill-color', 'text-decoration-color', 'text-decoration', 'caret-color']);
  const rectangle = r => [r.x, r.y, r.width, r.height];
  const styles = (node, pseudo) => {
    const css = getComputedStyle(node, pseudo);
    const maskedSubtree = element.contains(node);
    return [...css].filter(name => !(maskedSubtree && ignored.has(name))).map(name => [name, css.getPropertyValue(name)]);
  };
  return [...document.querySelectorAll('*')].flatMap((node, index) => {
    const r = node.getBoundingClientRect();
    const intersects = r.width > 0 && r.height > 0 && r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
    const outsideEffects = getComputedStyle(node).boxShadow !== 'none' || ['::before', '::after'].some(pseudo => {
      const css = getComputedStyle(node, pseudo); return css.content !== 'none' && css.content !== 'normal';
    });
    if (!ancestors.has(node) && !intersects && !outsideEffects) return [];
    return [{ index, tag: node.tagName, rect: rectangle(r),
      text: [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join(''),
      image: node.tagName === 'IMG' ? { currentSrc: node.currentSrc, complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight } : null,
      style: styles(node), before: styles(node, '::before'), after: styles(node, '::after') }];
  });
}

/** Capture an already-open Playwright Page. This module never launches a browser. */
export async function captureContrast(page, { selector, threshold } = {}) {
  const result = {
    status: 'unsupported', selector: typeof selector === 'string' ? selector : '', text: '',
    threshold: threshold ?? 4.5, font: { sizePx: 0, weight: 400 }, foreground: '',
    viewport: { width: 0, height: 0, deviceScaleFactor: 1 },
    bounds: { x: 0, y: 0, width: 0, height: 0 }, reasons: [],
    sampleSize: { width: 0, height: 0 }, pixelCount: 0,
    pageUrl: '', browserVersion: '', userAgent: '',
    images: { original: '', background: '' }, method: 'bounding-box-quickcheck',
    limitations: [...LIMITATIONS], capturedAt: new Date().toISOString()
  };
  let target;
  let savedStyle;
  let touched = false;
  const unsupported = message => { result.status = 'unsupported'; result.reasons.push(message); return result; };
  if (!page || typeof page.locator !== 'function') return unsupported('An already-open Playwright Page is required.');
  if (!result.selector.trim()) return unsupported('A nonempty selector is required.');
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 1 || threshold > 21)) {
    result.threshold = 4.5;
    return unsupported('Threshold must be a finite number between 1 and 21.');
  }
  try {
    result.pageUrl = page.url(); result.browserVersion = page.context().browser()?.version() ?? 'unknown';
    const environment = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio, userAgent: navigator.userAgent }));
    result.viewport = { width: environment.width, height: environment.height, deviceScaleFactor: environment.deviceScaleFactor };
    result.userAgent = environment.userAgent;
    target = page.locator(selector);
    const count = await target.count();
    if (count !== 1) return unsupported(`Selector must match exactly one element; matched ${count}.`);
    if (!await target.isVisible()) return unsupported('The selected element is not visible.');
    await target.scrollIntoViewIfNeeded({ timeout: 5000 });
    await page.evaluate(() => Promise.race([
      document.fonts.ready.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))
    ]));

    const metadata = await target.evaluate(element => {
      const reasons = [];
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const text = element.textContent.trim();
      const foreground = style.webkitTextFillColor || style.color;
      const sizePx = Number.parseFloat(style.fontSize);
      const weight = Number.parseInt(style.fontWeight, 10) || 400;
      const intersects = r => r.width > 0 && r.height > 0 && r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
      const transparent = color => color === 'rgba(0, 0, 0, 0)' || color === 'transparent';
      const paints = (node, css) => !transparent(css.backgroundColor) || css.backgroundImage !== 'none' || css.boxShadow !== 'none' ||
        ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(k => Number.parseFloat(css[k]) > 0) ||
        ['IMG', 'VIDEO', 'CANVAS', 'IFRAME'].includes(node.tagName) || node.namespaceURI === 'http://www.w3.org/2000/svg' || [...node.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      const activeZ = node => {
        const css = getComputedStyle(node), parentDisplay = node.parentElement ? getComputedStyle(node.parentElement).display : '';
        if (css.zIndex !== 'auto' && (css.position !== 'static' || /flex|grid/.test(parentDisplay))) return Number(css.zIndex);
        return null;
      };
      const layer = (owner, node) => {
        const chain = []; for (let n = node; n && n !== owner; n = n.parentElement) chain.unshift(n);
        for (const n of chain) { const z = activeZ(n); if (z !== null) return z; }
        return 0;
      };
      const pseudoLayer = (owner, node, css) => {
        const chain = []; for (let n = node; n && n !== owner; n = n.parentElement) chain.unshift(n);
        for (const n of chain) { const z = activeZ(n); if (z !== null) return z; }
        return css.zIndex === 'auto' ? 0 : Number(css.zIndex);
      };
      const pseudoBounds = (node, css) => {
        // Only empty, effect-free absolutely placed backgrounds have predictable
        // paint bounds. Everything else needs a stacking proof or manual review.
        if (!['""', "''"].includes(css.content) || !['fixed', 'absolute'].includes(css.position) || css.boxShadow !== 'none' || css.filter !== 'none' || css.transform !== 'none' || [css.translate, css.rotate, css.scale].some(v => v && v !== 'none') || css.outlineStyle !== 'none') return null;
        let origin = { x: -scrollX, y: -scrollY };
        if (css.position === 'fixed') {
          for (let parent = node; parent; parent = parent.parentElement) if (getComputedStyle(parent).transform !== 'none' || getComputedStyle(parent).filter !== 'none') return null;
          origin = { x: 0, y: 0 };
        } else {
          for (let parent = node; parent; parent = parent.parentElement) {
            const parentStyle = getComputedStyle(parent);
            if (parentStyle.transform !== 'none' || parentStyle.filter !== 'none') return null;
            if (parentStyle.position !== 'static') {
              if (parentStyle.display === 'inline') return null;
              const r = parent.getBoundingClientRect(); origin = { x: r.x + parent.clientLeft, y: r.y + parent.clientTop }; break;
            }
          }
        }
        const pixels = name => /^-?[\d.]+px$/.test(css[name]) ? Number.parseFloat(css[name]) : NaN;
        const left = pixels('left') + pixels('marginLeft'), top = pixels('top') + pixels('marginTop');
        let width = pixels('width'), height = pixels('height');
        if (css.boxSizing !== 'border-box') { width += pixels('paddingLeft') + pixels('paddingRight') + pixels('borderLeftWidth') + pixels('borderRightWidth'); height += pixels('paddingTop') + pixels('paddingBottom') + pixels('borderTopWidth') + pixels('borderBottomWidth'); }
        if (![left, top, width, height].every(Number.isFinite)) return null;
        return { left: origin.x + left, right: origin.x + left + width, top: origin.y + top, bottom: origin.y + top + height, width, height };
      };
      const ancestorList = []; for (let n = element; n; n = n.parentElement) ancestorList.push(n);
      if (element.getRootNode() !== document) reasons.push('Shadow-root text requires composed-ancestor inspection and is outside this capture scope.');
      if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') reasons.push('Non-HTML text paint is outside this capture scope.');
      if (!text) reasons.push('The element has no text content.');
      if (/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(text)) reasons.push('Emoji or pictographic glyphs may paint colors different from the CSS foreground.');
      if (['INPUT', 'TEXTAREA', 'SELECT', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO'].includes(element.tagName)) reasons.push('Native controls and non-HTML text are outside the supported capture scope.');
      if ([...element.children].some(child => child.tagName !== 'BR')) reasons.push('Descendant elements or mixed styled text need separate leaf-text captures.');
      const range = document.createRange(); range.selectNodeContents(element);
      if ([...range.getClientRects()].some(r => r.left < rect.left - 0.5 || r.right > rect.right + 0.5 || r.top < rect.top - 0.5 || r.bottom > rect.bottom + 0.5)) reasons.push('Text extends outside the selected element rectangle.');
      if (/hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`) && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)) reasons.push('The selected element clips or scrolls its own text.');
      if (document.readyState !== 'complete' || document.fonts.status !== 'loaded') reasons.push('The document or fonts have not finished loading.');
      if (document.getAnimations().some(animation => animation.playState === 'running')) reasons.push('Running animation makes this capture uncertain.');
      if (rect.width <= 0 || rect.height <= 0 || rect.left < -0.5 || rect.top < -0.5 || rect.right > innerWidth + 0.5 || rect.bottom > innerHeight + 0.5) reasons.push('The complete element rectangle must fit inside the visible viewport after scrolling.');
      if (rect.width > 8000 || rect.height > 8000 || Math.ceil(rect.width) * Math.ceil(rect.height) > 8_000_000) reasons.push('Capture exceeds the supported 8000-pixel dimension or 8-megapixel area limit.');
      for (const node of ancestorList) {
        const css = getComputedStyle(node);
        if (Number(css.opacity) !== 1) reasons.push('Element or ancestor opacity changes the foreground paint.');
        if (css.mixBlendMode !== 'normal' || css.filter !== 'none' || css.backdropFilter !== 'none') reasons.push('Blend modes or filters are outside the supported capture scope.');
        if (css.transform !== 'none' || css.perspective !== 'none' || !['1', 'normal'].includes(css.zoom) || [css.translate, css.rotate, css.scale].some(value => value && value !== 'none')) reasons.push('Transforms, perspective or CSS zoom are outside the supported capture scope.');
        if (css.textShadow !== 'none' || Number.parseFloat(css.webkitTextStrokeWidth) > 0) reasons.push('Text shadow or stroke needs manual review.');
        if (css.fontStyle !== 'normal') reasons.push('Italic or oblique glyph ink can extend outside the supported rectangle.');
        if (css.backgroundClip.includes('text') || css.maskImage !== 'none' || css.clipPath !== 'none') reasons.push('Text clipping, masks or clip paths are outside the supported capture scope.');
        if (node !== element && /hidden|clip|scroll|auto/.test(`${css.overflowX} ${css.overflowY}`)) {
          const r = node.getBoundingClientRect();
          if (rect.left < r.left - 0.5 || rect.right > r.right + 0.5 || rect.top < r.top - 0.5 || rect.bottom > r.bottom + 0.5) reasons.push('An ancestor clips the selected element.');
        }
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(node, pseudo);
          if (ps.content === 'none' || ps.content === 'normal') continue;
          if (!['""', "''"].includes(ps.content)) { reasons.push('Generated pseudo-element text or icons need separate review.'); continue; }
          if (ps.mixBlendMode !== 'normal' || ps.filter !== 'none' || ps.backdropFilter !== 'none' || ps.transform !== 'none' || [ps.translate, ps.rotate, ps.scale].some(value => value && value !== 'none')) reasons.push('A pseudo-element uses an unsupported rendering effect.');
          const painted = !transparent(ps.backgroundColor) || ps.backgroundImage !== 'none' || ps.boxShadow !== 'none' || ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(k => Number.parseFloat(ps[k]) > 0);
          if (painted) {
            const z = ps.zIndex === 'auto' ? 0 : Number(ps.zIndex);
            const behind = ['absolute', 'fixed', 'relative'].includes(ps.position) && (node === element ? z < 0 : layer(node, element) > z);
            if (!behind) reasons.push('A painted pseudo-element is not provably behind the selected text.');
          }
        }
      }
      const nodes = [...document.querySelectorAll('*')];
      if (nodes.length > 5000) reasons.push('The document is too complex for this conservative overlap inspection.');
      else for (const node of nodes) {
        if (ancestorList.includes(node) || element.contains(node)) continue;
        const css = getComputedStyle(node);
        const owner = ancestorList.find(ancestor => ancestor.contains(node));
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(node, pseudo);
          if (ps.content === 'none' || ps.content === 'normal' || ps.display === 'none' || ps.visibility !== 'visible' || Number(ps.opacity) === 0) continue;
          const generatedText = !['""', "''"].includes(ps.content);
          const painted = generatedText || !transparent(ps.backgroundColor) || ps.backgroundImage !== 'none' || ps.boxShadow !== 'none' || ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some(k => Number.parseFloat(ps[k]) > 0);
          if (!painted) continue;
          const bounds = pseudoBounds(node, ps);
          if (bounds && !intersects(bounds)) continue;
          if (!owner || layer(owner, element) <= pseudoLayer(owner, node, ps)) reasons.push('A painted pseudo-element on another element may cover the selected text.');
        }
        if ((css.boxShadow !== 'none' || css.filter !== 'none' || css.backdropFilter !== 'none') && (!owner || layer(owner, element) <= layer(owner, node))) reasons.push('A shadow or filter from another element may extend into the selected text.');
        if (css.visibility !== 'visible' || css.display === 'none' || Number(css.opacity) === 0 || !intersects(node.getBoundingClientRect()) || !paints(node, css)) continue;
        if (!owner || layer(owner, element) <= layer(owner, node)) reasons.push('An overlapping painted element is not provably behind the selected text.');
        if (node.tagName === 'IMG' && (!node.complete || node.naturalWidth === 0)) reasons.push('A background image has not loaded.');
        if (node.tagName === 'VIDEO' || node.tagName === 'CANVAS' || node.tagName === 'IFRAME') reasons.push('Dynamic or embedded overlapping content needs manual review.');
      }
      // Page screenshot clips use viewport coordinates after scrolling. Keep the
      // unrounded rectangle to avoid adding pixels outside the selected element.
      const clip = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      const bounds = { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
      return { text, foreground, font: { sizePx, weight }, bounds, reasons: [...new Set(reasons)],
        geometry: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
        inlineStyle: element.getAttribute('style'), clip };
    });
    result.text = metadata.text; result.foreground = metadata.foreground;
    result.font = metadata.font; result.bounds = metadata.bounds;
    result.threshold = threshold ?? textThreshold(metadata.font.sizePx, metadata.font.weight);
    if (metadata.reasons.length) { result.reasons.push(...metadata.reasons); return result; }
    let color;
    try { color = parseColor(metadata.foreground); }
    catch { return unsupported('The computed foreground is not a supported sRGB color.'); }
    if (color[3] !== 1) return unsupported('A translucent foreground needs manual review.');
    savedStyle = metadata.inlineStyle;
    const options = { clip: metadata.clip, scale: 'css', caret: 'hide', animations: 'disabled', type: 'png' };
    await settlePaint(page);
    const originalPaint = await target.evaluate(paintState);
    const original = await page.screenshot(options);
    result.images.original = `data:image/png;base64,${original.toString('base64')}`;
    touched = true;
    await target.evaluate(element => {
      element.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
      element.style.setProperty('text-decoration-color', 'transparent', 'important');
      element.style.setProperty('caret-color', 'transparent', 'important');
    });
    await settlePaint(page);
    const maskedPaint = await target.evaluate(paintState);
    if (JSON.stringify(originalPaint) !== JSON.stringify(maskedPaint)) return unsupported('Masking text changed computed rendering or background state.');
    const geometry = await target.evaluate(element => {
      const r = element.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
    });
    if (Object.keys(geometry).some(k => Math.abs(geometry[k] - metadata.geometry[k]) > 0.01)) return unsupported('Suppressing text paint changed the element geometry.');
    const background = await page.screenshot(options);
    result.images.background = `data:image/png;base64,${background.toString('base64')}`;
    await target.evaluate((element, saved) => { if (saved === null) element.removeAttribute('style'); else element.setAttribute('style', saved); }, savedStyle);
    touched = false;
    await settlePaint(page);
    const restored = await page.screenshot(options);
    const originalPng = PNG.sync.read(original), restoredPng = PNG.sync.read(restored), backgroundPng = PNG.sync.read(background);
    if (originalPng.width !== restoredPng.width || originalPng.height !== restoredPng.height || !originalPng.data.equals(restoredPng.data)) return unsupported('The rendered state changed between the original and restored captures.');
    if (backgroundPng.width < Math.floor(result.bounds.width) || backgroundPng.width > Math.ceil(result.bounds.width) || backgroundPng.height < Math.floor(result.bounds.height) || backgroundPng.height > Math.ceil(result.bounds.height)) return unsupported('The screenshot pixel dimensions do not match the recorded CSS clip.');
    const analysis = analyzePixels(backgroundPng.data, backgroundPng.width, backgroundPng.height, color, result.threshold);
    result.sampleSize = { width: backgroundPng.width, height: backgroundPng.height }; result.pixelCount = analysis.pixelCount;
    if (originalPng.data.equals(backgroundPng.data) && analysis.status === 'quickcheck-clear') return unsupported('Text paint was not visibly removed; the text may be occluded or unpainted.');
    result.status = analysis.status; result.minimumRatio = analysis.minimumRatio; result.worstPixel = analysis.worstPixel;
    result.reasons.push(result.status === 'quickcheck-clear' ? 'Every sampled background pixel meets the selected threshold for the computed foreground.' : 'At least one background pixel is below the selected threshold; inspect the pixels behind individual letters.');
    return result;
  } catch (error) {
    return unsupported(`Capture could not be completed: ${error.message}`);
  } finally {
    if (touched && target) {
      try { await target.evaluate((element, saved) => { if (saved === null) element.removeAttribute('style'); else element.setAttribute('style', saved); }, savedStyle); }
      catch { result.status = 'unsupported'; result.reasons.push('The element detached before its original inline style could be restored.'); }
    }
  }
}
