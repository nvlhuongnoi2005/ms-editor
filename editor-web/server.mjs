import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.cwd();
const types = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' };

const server = createServer((request, response) => {
  const path = normalize(join(root, request.url === '/' ? 'index.html' : request.url.split('?')[0]));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'Content-Type': `${types[extname(path)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  createReadStream(path).pipe(response);
});

const requestedPort = Number(process.env.PORT || 4173);
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    server.listen(0, '127.0.0.1');
    return;
  }
  throw error;
});
server.on('listening', () => {
  const { port } = server.address();
  console.log(`Map Service Editor: http://127.0.0.1:${port}`);
});
server.listen(requestedPort, '127.0.0.1');
