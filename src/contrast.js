/** Shared sRGB contrast math. Threshold comparison always uses unrounded values. */
export function parseColor(value) {
  if (typeof value !== 'string') throw new TypeError('Color must be a string.');
  const color = value.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(color);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = [...digits].map(c => c + c).join('');
    const channels = [0, 2, 4].map(i => parseInt(digits.slice(i, i + 2), 16));
    return [...channels, digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(color);
  if (!rgb) throw new TypeError('Use an sRGB hex or rgb()/rgba() color.');
  const result = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  if (result.slice(0, 3).some(n => !Number.isFinite(n) || n < 0 || n > 255) || result[3] < 0 || result[3] > 1) throw new RangeError('Color channels are out of range.');
  return result;
}

export function luminance(rgb) {
  const linear = rgb.slice(0, 3).map(c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function textThreshold(fontSizePx, fontWeight = 400) {
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) throw new RangeError('Font size must be positive pixels.');
  const bold = fontWeight === 'bold' || Number(fontWeight) >= 700;
  return fontSizePx >= 24 || (bold && fontSizePx >= 14 * 96 / 72) ? 3 : 4.5;
}

/** Conservative quickcheck over the entire supplied opaque RGBA pixel rectangle. */
export function analyzePixels(data, width, height, foreground, threshold = 4.5) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data.length !== width * height * 4) throw new RangeError('An RGBA buffer and positive dimensions are required.');
  const color = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  if (!Array.isArray(color) || color.length < 3 || color.slice(0, 3).some(c => !Number.isFinite(c) || c < 0 || c > 255) || (color.length > 3 && color[3] !== 1)) throw new TypeError('Foreground must be opaque sRGB.');
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 21) throw new RangeError('Threshold must be between 1 and 21.');
  let minimumRatio = Infinity, worstIndex = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] !== 255) throw new TypeError('Background pixels must be opaque.');
    const ratio = contrastRatio(color, [data[i], data[i + 1], data[i + 2]]);
    if (ratio < minimumRatio) { minimumRatio = ratio; worstIndex = i / 4; }
  }
  const x = worstIndex % width, y = Math.floor(worstIndex / width), offset = worstIndex * 4;
  return {
    status: minimumRatio >= threshold ? 'quickcheck-clear' : 'needs-review',
    minimumRatio, threshold, pixelCount: width * height,
    worstPixel: { x, y, color: [data[offset], data[offset + 1], data[offset + 2]] }
  };
}
