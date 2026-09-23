import { createServer } from 'node:http';
import { createReadStream, openSync } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DRAW_PREVIEW_PORT || 4195);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
if (process.argv.includes('--background')) {
  let alreadyRunning = false;
  try { alreadyRunning = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).preview === 'dabboba-draw-preview'; } catch {}
  if (!alreadyRunning) {
    const log = openSync(resolve(root, '.preview.log'), 'a');
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: root, detached: true, stdio: ['ignore', log, log], env: process.env });
    child.unref();
  }
  console.log(`Interactive preview: http://127.0.0.1:${port}/`);
} else {
  const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.wav':'audio/wav','.json':'application/json','.woff2':'font/woff2','.ttf':'font/ttf' };
  createServer(async (req, res) => {
    try {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname === '/health') { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({preview:'dabboba-draw-preview'})); return; }
      const path = decodeURIComponent(url.pathname === '/' ? '/preview.html' : url.pathname);
      const file = await realpath(resolve(root, `.${path}`));
      if (!file.startsWith(root + sep) || !mime[extname(file)]) { res.writeHead(403); res.end(); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {'Content-Type':mime[extname(file)],'Content-Length':info.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
    } catch { res.writeHead(404); res.end('Not found'); }
  }).listen(port, '127.0.0.1', () => console.log(`DABBOBA local-only preview http://127.0.0.1:${port}/`));
}
