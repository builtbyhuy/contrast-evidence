import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = process.env.CONTRAST_BROWSER || 'chromium';
const fixture = `<!doctype html><meta charset="utf-8"><title>Real CLI evidence fixture</title>
<style>body{margin:30px;background:#fff;font-family:Arial,sans-serif}p{display:inline-block;margin:24px 0;padding:12px;background:#fff;font-size:16px}#clear{color:#000}#review{color:#aaa}</style>
<main><p id="clear">Readable evidence text</p><br><p id="review">Inspect this lighter text</p></main>`;

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'src/cli.js'), ...args], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { stdout += text; });
    child.stderr.on('data', text => { stderr += text; });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timed out: ${stderr}`)); }, 45000);
    timer.unref();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

test('real CLI captures two widths, preserves portable evidence, and gives honest exit codes', { timeout: 120000 }, async () => {
  const taskRoot = path.join(tmpdir(), 'contrast-evidence-task');
  await mkdir(taskRoot, { recursive: true });
  const outputRoot = await mkdtemp(path.join(taskRoot, 'integration-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { location: '/target' }); response.end(); return; }
    response.writeHead(request.url === '/404' ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [
      { name: 'clear', route: '/target', selector: '#clear', code: 0, status: 'quickcheck-clear' },
      { name: 'review', route: '/target', selector: '#review', code: 1, status: 'needs-review' },
      { name: 'missing', route: '/target', selector: '#missing', code: 2, status: 'unsupported' },
      { name: 'http404', route: '/404', selector: '#clear', code: 2, status: 'unsupported' },
      { name: 'redirect', route: '/redirect', selector: '#clear', code: 0, status: 'quickcheck-clear' },
    ];
    for (const item of cases) {
      const directory = path.join(outputRoot, item.name);
      const execution = await runCli(['--url', `${origin}${item.route}`, '--selector', item.selector,
        '--viewport', '1440x900', '--viewport', '390x844', '--browser', browser, '--out', directory]);
      assert.equal(execution.code, item.code, `${item.name}: ${execution.stdout}\n${execution.stderr}`);
      const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
      const html = await readFile(path.join(directory, 'index.html'), 'utf8');
      assert.equal(report.summary.status, item.status, item.name);
      assert.equal(report.captures.length, 2, item.name);
      assert.deepEqual(report.captures.map(capture => capture.viewport.width), [1440, 390]);
      assert.ok(report.captures.every(capture => capture.status === item.status));
      assert.match(html, /Bounding-box quickcheck/);
      assert.match(html, /not establish a WCAG failure/);
      assert.ok(!html.includes(outputRoot), 'Portable report must not depend on its original output directory.');
      if (item.status !== 'unsupported') {
        assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 4);
        for (const capture of report.captures) {
          assert.match(capture.images.original, /^data:image\/png;base64,/);
          assert.match(capture.images.background, /^data:image\/png;base64,/);
          assert.ok(capture.capturedAt);
          assert.equal(capture.threshold, 4.5);
          if (item.status === 'quickcheck-clear') assert.equal(capture.minimumRatio, 21);
          else assert.ok(capture.minimumRatio > 2 && capture.minimumRatio < 3);
        }
      } else {
        assert.ok(report.captures.every(capture => capture.minimumRatio === undefined));
        assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 0);
      }
      if (item.name === 'http404') {
        assert.ok(report.captures.every(capture => capture.error?.stage === 'navigation'));
        assert.match(html, /HTTP 404/);
      }
      if (item.name === 'redirect') {
        assert.equal(report.url, `${origin}/redirect`);
        assert.ok(report.captures.every(capture => capture.pageUrl === `${origin}/target`));
        assert.match(html, /followed the requested URL to/);
      }
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    const relative = path.relative(path.resolve(taskRoot), path.resolve(outputRoot));
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    await rm(outputRoot, { recursive: true, force: true });
  }
});
