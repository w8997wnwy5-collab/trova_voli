#!/usr/bin/env node
// Minimal static server for previewing ./out like GitHub Pages does (base path, 404.html, index.html).
// Usage: node scripts/serve-static.mjs [port]   (env PAGES_BASE_PATH, default /trova_voli)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve('out');
const base = process.env.PAGES_BASE_PATH ?? '/trova_voli';
const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2' };

function send(res, file, status = 200) {
  res.writeHead(status, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (base && rel === base) {
    res.writeHead(301, { Location: `${base}/` }).end();
    return;
  }
  if (base && !rel.startsWith(`${base}/`)) return send(res, path.join(root, '404.html'), 404);
  rel = rel.slice(base.length);
  const file = path.join(root, rel);
  if (!file.startsWith(root)) return send(res, path.join(root, '404.html'), 404);
  const candidates = [file, path.join(file, 'index.html'), `${file}.html`];
  const found = candidates.find((f) => existsSync(f) && statSync(f).isFile());
  if (found) return send(res, found);
  send(res, path.join(root, '404.html'), 404);
}).listen(port, () => console.log(`Serving ./out at http://localhost:${port}${base}/`));
