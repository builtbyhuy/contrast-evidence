import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8' };
export function createDemoServer() { return http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, 'http://localhost');
    let requested = decodeURIComponent(parsed.pathname);
    if (requested === '/') { res.writeHead(302, { Location: '/demo/' }); res.end(); return; }
    if (requested.endsWith('/')) requested += 'index.html';
    const resolved = path.resolve(root, '.' + requested);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(p => p.startsWith('.') || p === 'node_modules')) throw new Error('Unavailable path');
    const content = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
}); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => console.log(`Contrast Evidence: http://127.0.0.1:${server.address().port}/demo/`));
}
