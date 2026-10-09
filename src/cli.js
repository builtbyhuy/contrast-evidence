#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureContrast } from './capture.js';
import { createReport, writeReport } from './report.js';

const HELP = `Usage: node src/cli.js --url <http(s) URL> --selector <selector> [options]

Options:
  --viewport <width>x<height>  Repeat for multiple viewport captures (default: 1440x900)
  --out <directory>           Write report.json and standalone index.html (default: ./evidence)
  --browser <name>            chromium, msedge, or chrome (default: chromium)
  --threshold <ratio>         Override the font-derived threshold; range 1–21
  --help                     Show this help without launching a browser

An existing browser is required. No browser is installed or silently substituted.
Exit 0: all quickchecks clear. Exit 1: one or more review flags. Exit 2: unsupported,
input, browser, or capture errors. Review flags are not automatic WCAG failures.
`;

export function parseArgs(argv) {
  const result = { viewports: [], out: './evidence', browser: 'chromium' };
  const seen = new Set();
  const names = new Set(['--url', '--selector', '--viewport', '--out', '--browser', '--threshold']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') { result.help = true; continue; }
    if (!names.has(flag)) throw new Error(`Unknown option: ${flag}`);
    if (flag !== '--viewport' && seen.has(flag)) throw new Error(`Duplicate option: ${flag}`);
    seen.add(flag);
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (flag === '--viewport') {
      const match = /^(\d+)x(\d+)$/i.exec(value);
      if (!match || Number(match[1]) < 1 || Number(match[2]) < 1 || Number(match[1]) > 10000 || Number(match[2]) > 10000) throw new Error('Viewport must be WIDTHxHEIGHT with integer dimensions from 1 to 10000.');
      result.viewports.push({ width: Number(match[1]), height: Number(match[2]) });
    } else if (flag === '--threshold') {
      const threshold = Number(value);
      if (!value.trim() || !Number.isFinite(threshold) || threshold < 1 || threshold > 21) throw new Error('Threshold must be a finite ratio from 1 to 21.');
      result.threshold = threshold;
    } else result[flag.slice(2)] = value;
  }
  if (result.help) return result;
  if (!result.url) throw new Error('--url is required.');
  let url;
  try { url = new URL(result.url); } catch { throw new Error('--url must be an absolute HTTP or HTTPS URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URL credentials are not supported. Use a page that can be visited without embedded credentials.');
  if (!result.selector?.trim()) throw new Error('--selector must be nonempty.');
  if (!result.out.trim()) throw new Error('--out must be nonempty.');
  if (!['chromium', 'msedge', 'chrome'].includes(result.browser)) throw new Error('--browser must be chromium, msedge, or chrome.');
  result.url = url.href;
  if (!result.viewports.length) result.viewports.push({ width: 1440, height: 900 });
  return result;
}

export async function launchBrowser(browserName) {
  let playwright;
  try { playwright = createRequire(import.meta.url)('playwright'); }
  catch { throw new Error('Playwright is unavailable. Install the project dependencies using its documented setup; no browser was installed.'); }
  try {
    return await playwright.chromium.launch({ headless: true, ...(browserName === 'chromium' ? {} : { channel: browserName }) });
  } catch {
    throw new Error(`Could not launch the selected ${browserName} browser. Provide an existing Playwright Chromium, or explicitly choose --browser msedge or --browser chrome if that browser is installed. No browser was installed or substituted.`);
  }
}

function errorMessage(error) {
  return String(error?.message ?? error).split('\n')[0].slice(0, 500);
}

function failedCapture(options, viewport, stage, error) {
  return {
    status: 'unsupported', selector: options.selector, text: '',
    threshold: options.threshold ?? null, font: null, foreground: null,
    viewport: { ...viewport, deviceScaleFactor: 1 }, bounds: null, images: { original: null, background: null },
    capturedAt: new Date().toISOString(),
    method: 'bounding-box-quickcheck',
    reasons: [`${stage === 'navigation' ? 'Page navigation' : 'Element capture'} could not be completed. No quickcheck result was inferred.`],
    error: { stage, message: errorMessage(error) },
    limitations: ['No supported measurement or background image was produced for this viewport.'],
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  let browser;
  try {
    const options = parseArgs(argv);
    if (options.help) { stdout.write(HELP); return 0; }
    browser = await (dependencies.launchBrowser ?? launchBrowser)(options.browser);
    const captures = [];
    for (const viewport of options.viewports) {
      let page;
      let stage = 'capture';
      try {
        page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        stage = 'navigation';
        const response = await page.goto(options.url, { waitUntil: 'load', timeout: 30000 });
        if (response && typeof response.status === 'function' && response.status() >= 400) throw new Error(`The page returned HTTP ${response.status()}; its error response was not evaluated as the target page.`);
        stage = 'capture';
        const capture = await (dependencies.capture ?? captureContrast)(page, {
          selector: options.selector,
          ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
        });
        captures.push({ ...capture, viewport: { ...capture.viewport, ...viewport } });
      } catch (error) {
        captures.push({ ...failedCapture(options, viewport, stage, error), pageUrl: page && typeof page.url === 'function' ? page.url() : options.url });
        stderr.write(`${viewport.width}x${viewport.height}: ${errorMessage(error)}\n`);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
    const report = createReport(captures, {
      url: options.url, selector: options.selector,
      ...(dependencies.now ? { createdAt: dependencies.now().toISOString() } : {}),
    });
    const output = await (dependencies.writeReport ?? writeReport)(report, options.out);
    stdout.write(`${report.summary.status}: ${captures.length} viewport capture${captures.length === 1 ? '' : 's'}.\n`);
    stdout.write(`JSON: ${output.json}\nHTML: ${output.html}\n`);
    if (report.summary.status === 'unsupported') return 2;
    return report.summary.status === 'needs-review' ? 1 : 0;
  } catch (error) {
    stderr.write(`Error: ${errorMessage(error)}\n`);
    return 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
