import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Serve only a built directory. No write endpoint, directory listing, or SPA fallback. */
export async function createStaticServer(directory) {
  const root = await realpath(directory);
  if (!(await stat(path.join(root, 'index.html'))).isFile()) throw new Error('The build has no index.html.');
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-cache');
    const reply = (status, message, extra = {}) => {
      const body = Buffer.from(`${message}\n`);
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...extra });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host || '')) return reply(403, 'This local game accepts localhost requests only.');
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply(405, 'Only GET and HEAD are supported.', { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent((request.url || '/').split('?')[0]); }
    catch { return reply(400, 'Malformed URL.'); }
    if (!pathname.startsWith('/') || /[\\:\x00-\x1f]/.test(pathname)) return reply(400, 'Invalid path.');
    const segments = pathname.split('/').filter(Boolean);
    if (segments.some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) return reply(403, 'Path is outside the public game.');
    const candidate = path.resolve(root, ...(segments.length ? segments : ['index.html']));
    if (!isWithin(root, candidate)) return reply(403, 'Path is outside the public game.');
    try {
      // Resolve junctions/symlinks too; lexical containment alone is insufficient on Windows.
      const file = await realpath(candidate);
      if (!isWithin(root, file)) return reply(403, 'Path is outside the public game.');
      const details = await stat(file);
      if (!details.isFile()) return reply(404, 'Game asset not found.');
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': details.size,
      };
      if (request.method === 'HEAD') { response.writeHead(200, headers); response.end(); return; }
      const stream = createReadStream(file);
      stream.once('open', () => { response.writeHead(200, headers); stream.pipe(response); });
      stream.once('error', () => { if (!response.headersSent) reply(500, 'Game asset could not be read.'); else response.destroy(); });
      response.once('close', () => stream.destroy());
    } catch (error) {
      reply(error?.code === 'EACCES' ? 403 : 404, 'Game asset not found.');
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) {
    console.error('Usage: node tools/serve.mjs [--port 4180]'); process.exitCode = 1; return;
  }
  const port = args.length ? Number(args[1]) : 4180;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('Choose a port from 1024 to 65535.'); process.exitCode = 1; return; }
  const directory = fileURLToPath(new URL('../dist/', import.meta.url));
  let server;
  try { server = await createStaticServer(directory); }
  catch {
    console.error('The Last Garden production build is missing or unreadable.');
    console.error(`Expected: ${path.join(directory, 'index.html')}`);
    console.error('From the game folder, run npm install and npm run build once, then launch again.');
    process.exitCode = 1; return;
  }
  server.once('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. If The Last Garden is already running, open http://127.0.0.1:${port}/`);
      console.error('Otherwise close the earlier game server, then launch again. Do not stop an unfamiliar process.');
      console.error('An alternate port is available with: node tools/serve.mjs --port 4181');
      console.error('Browser saves are tied to the port; export before moving to another port.');
    } else console.error(`The local server could not start: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('\nTHE LAST GARDEN — local game');
    console.log(`Open http://127.0.0.1:${port}/ in your browser.`);
    console.log('Keep this window open while playing. Press Ctrl+C to stop.');
    console.log('Everything is served from this PC; no game account or live AI service is required.\n');
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping The Last Garden local server.');
    server.close(() => { process.exitCode = 0; });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 1500).unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
