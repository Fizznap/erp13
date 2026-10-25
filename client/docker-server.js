import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import handler from './.output/server/index.mjs';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(process.cwd(), '.output/public');

// Serve static files from .output/public
async function serveStatic(urlPath, res) {
  // Strip query string
  const cleanPath = urlPath.split('?')[0];
  // Prevent path traversal
  if (cleanPath.includes('..')) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  const filePath = join(PUBLIC_DIR, cleanPath === '/' ? 'index.html' : cleanPath.slice(1));
  try {
    await stat(filePath);
  } catch {
    return false;
  }
  const ext = filePath.split('.').pop();
  const contentTypes = {
    js: 'application/javascript',
    css: 'text/css',
    ico: 'image/x-icon',
    txt: 'text/plain',
    xml: 'application/xml',
    html: 'text/html',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    svg: 'image/svg+xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
  };
  res.writeHead(200, {
    'content-type': contentTypes[ext] || 'application/octet-stream',
    'cache-control': 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

    // Serve static assets first
    const isStatic = await serveStatic(url.pathname, res);
    if (isStatic) return;

    const init = {
      method: req.method,
      headers: req.headers,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
    }

    const cfRequest = new Request(url.toString(), init);
    // Nitro cloudflare-module handler expects (request, env, context)
    const response = await handler.fetch(cfRequest, {}, { waitUntil: () => {} });

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
  } catch (error) {
    console.error('SSR error:', error);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Snippet frontend listening on http://0.0.0.0:${PORT}`);
});
