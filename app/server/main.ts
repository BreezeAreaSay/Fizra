// Сервер тревожной кнопки для своего хостинга.
// Отдаёт собранные страницы, выполняет backend/ и держит WebSocket для живых обновлений.
// Запуск: PORT=3077 DATA_DIR=./data node server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { handler } from '../backend/index';
import { realtime } from '../backend/realtime';
import { registerSocket, unregisterSocket, type ApiEvent, type ApiResponse } from './sdk';

const port = Number(process.env.PORT || 3077);
// По умолчанию слушаем только локально: наружу приложение отдаёт nginx/Caddy с HTTPS.
const host = process.env.HOST || '127.0.0.1';
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY = 64 * 1024;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function send(res: http.ServerResponse, out: ApiResponse): void {
  res.writeHead(out.statusCode, { ...out.headers, 'Cache-Control': 'no-store' });
  res.end(out.body);
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new Error('too large');
  }
  return raw;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  let body: unknown;
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    send(res, { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Некорректный запрос"}' });
    return;
  }
  const event: ApiEvent = { method: req.method || 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body };
  try {
    send(res, await handler(event));
  } catch (err) {
    console.error('API error', event.method, event.path, err);
    send(res, { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: '{"error":"Ошибка сервера"}' });
  }
}

function handleStatic(res: http.ServerResponse, url: URL): void {
  const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.join(publicDir, name);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
    return;
  }
  // Файлы из assets/ с хешем в имени не меняются — их можно кэшировать надолго.
  const cache = name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) void handleApi(req, res, url);
  else if (req.method === 'GET' || req.method === 'HEAD') handleStatic(res, url);
  else {
    res.writeHead(405);
    res.end();
  }
});

// ---------- WebSocket: панель преподавателя получает тревоги мгновенно ----------

type LiveSocket = WebSocket & { alive?: boolean };
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket: LiveSocket) => {
  const id = randomUUID();
  socket.alive = true;
  registerSocket(id, socket);
  socket.send(JSON.stringify({ type: 'connection', connection_id: id }));
  socket.on('pong', () => (socket.alive = true));
  socket.on('close', () => {
    unregisterSocket(id);
    void realtime({ body: JSON.stringify({ type: 'system.disconnected', payload: { connection_id: id } }) });
  });
});

// Пинг раз в 25 секунд: nginx по умолчанию рвёт «молчащие» соединения через минуту.
setInterval(() => {
  for (const client of wss.clients as Set<LiveSocket>) {
    if (!client.alive) client.terminate();
    else {
      client.alive = false;
      client.ping();
    }
  }
}, 25000).unref();

server.listen(port, host, () => {
  console.log(`Тревожная кнопка запущена: http://${host}:${port}/`);
});
