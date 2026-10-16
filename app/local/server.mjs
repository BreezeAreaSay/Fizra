// Локальный сервер: отдаёт собранный фронтенд, выполняет backend/index.ts и держит WebSocket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8790);

await build({
    entryPoints: [path.join(here, 'entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: path.join(here, '.build/backend.mjs'),
    alias: { '@appdeploy/sdk': path.join(here, 'sdk-mock.ts') },
    logLevel: 'warning',
});
const backend = await import(path.join(here, '.build/backend.mjs') + `?t=${Date.now()}`);

const sockets = new Map();
backend.setWsSender((ids, payload) => {
    for (const id of ids) sockets.get(id)?.send(JSON.stringify(payload));
});

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const dist = path.join(here, '.dist');

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const event = {
            method: req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            body: raw ? JSON.parse(raw) : undefined,
            headers: req.headers,
        };
        const out = await backend.handler(event);
        res.writeHead(out.statusCode, out.headers);
        res.end(out.body);
        return;
    }
    let file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket) => {
    const id = randomUUID();
    sockets.set(id, socket);
    socket.send(JSON.stringify({ type: 'connection', connection_id: id }));
    socket.on('close', async () => {
        sockets.delete(id);
        await backend.realtime({ body: JSON.stringify({ type: 'system.disconnected', payload: { connection_id: id } }) });
    });
});

server.listen(port, '127.0.0.1', () => console.log(`ready http://localhost:${port}/`));
