// Замена @appdeploy/sdk для своего сервера: база данных в JSON-файле и рассылка по WebSocket.
// Серверный код из backend/ работает без изменений — при сборке '@appdeploy/sdk' подменяется этим файлом.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type Rec = Record<string, unknown>;
type Tables = Record<string, Record<string, Rec>>;

// ---------- База данных ----------

const SUBSCRIPTIONS = 'entity_subscriptions';
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const dbFile = path.join(dataDir, 'db.json');
fs.mkdirSync(dataDir, { recursive: true });

function load(): Tables {
  try {
    return JSON.parse(fs.readFileSync(dbFile, 'utf8')) as Tables;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

const tables: Tables = load();
// Подписки живут, только пока открыт WebSocket, — их не храним на диске.
tables[SUBSCRIPTIONS] = {};

// Пишем во временный файл и переименовываем: при сбое старый файл останется целым.
function save(name: string): void {
  if (name === SUBSCRIPTIONS) return;
  const { [SUBSCRIPTIONS]: _skip, ...rest } = tables;
  const tmp = `${dbFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rest));
  fs.renameSync(tmp, dbFile);
}

const table = (name: string) => (tables[name] ??= {});
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function addRecords(name: string, records: Rec[], useChosenId: boolean) {
  const ids = records.map((record) => {
    const { id: chosen, ...rest } = record as Rec & { id?: string };
    const id = useChosenId && chosen ? chosen : randomUUID();
    if (table(name)[id]) return null;
    table(name)[id] = copy(useChosenId ? rest : record);
    return id;
  });
  save(name);
  return ids;
}

function updateRecords(name: string, items: Array<{ id: string; record: Rec }>, patch: boolean) {
  const results = items.map(({ id, record }) => {
    const existing = table(name)[id];
    if (!patch) {
      table(name)[id] = copy(record);
      return true;
    }
    if (!existing) return false;
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) delete existing[key];
      else existing[key] = copy(value);
    }
    return true;
  });
  save(name);
  return results;
}

function deleteRecords(name: string, ids: string[]) {
  const results = ids.map((id) => {
    const existed = id in table(name);
    delete table(name)[id];
    return existed;
  });
  save(name);
  return results;
}

export const db = {
  async add(name: string, records: Rec[]) {
    return addRecords(name, records, false);
  },
  async get(name: string, ids: string[]) {
    return ids.map((id) => (table(name)[id] ? copy(table(name)[id]) : null));
  },
  async list(name: string, options: { limit?: number; nextToken?: string } = {}) {
    const all = Object.entries(table(name)).map(([id, record]) => ({ ...copy(record), id }));
    const start = Number(options.nextToken || 0);
    const limit = options.limit ?? 100;
    return {
      items: all.slice(start, start + limit),
      nextToken: start + limit < all.length ? String(start + limit) : undefined,
    };
  },
  async update(name: string, items: Array<{ id: string; record: Rec }>) {
    return items.map(({ id, record }) => (table(name)[id] ? updateRecords(name, [{ id, record }], false)[0] : false));
  },
  async delete(name: string, ids: string[]) {
    return deleteRecords(name, ids);
  },
  tx: {
    async add(name: string, records: Rec[]) {
      return addRecords(name, records, true);
    },
    async update(name: string, items: Array<{ id: string; record: Rec }>, options: { patch?: boolean } = {}) {
      return updateRecords(name, items, Boolean(options.patch));
    },
    async delete(name: string, ids: string[]) {
      return deleteRecords(name, ids);
    },
  },
};

// ---------- WebSocket ----------

type Socket = { send(data: string): void };
const sockets = new Map<string, Socket>();

export function registerSocket(id: string, socket: Socket): void {
  sockets.set(id, socket);
}

export function unregisterSocket(id: string): void {
  sockets.delete(id);
}

export const ws = {
  async send(ids: string | string[], payload: unknown) {
    const data = JSON.stringify(payload);
    for (const id of Array.isArray(ids) ? ids : [ids]) sockets.get(id)?.send(data);
    return { ok: true };
  },
};

// ---------- Маршрутизация ----------

type Context = { body: unknown; query: Record<string, string>; params: Record<string, string>; event: unknown };
type Middleware = (ctx: Context) => unknown;
export type ApiEvent = { method: string; path: string; query: Record<string, string>; body: unknown };
export type ApiResponse = { statusCode: number; headers: Record<string, string>; body: string };

export function json(data: unknown, status = 200): ApiResponse {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(data) };
}

export function error(message: string, status = 400): ApiResponse {
  return json({ error: message }, status);
}

export function router(routes: Record<string, Middleware[]>) {
  const compiled = Object.entries(routes).map(([pattern, chain]) => {
    const [method, routePath] = pattern.split(' ');
    const names: string[] = [];
    const re = new RegExp(`^${routePath.replace(/:([a-zA-Z]+)/g, (_, name: string) => (names.push(name), '([^/]+)'))}$`);
    return { method, re, names, chain };
  });
  return async (event: ApiEvent): Promise<ApiResponse> => {
    for (const route of compiled) {
      const match = route.method === event.method ? route.re.exec(event.path) : null;
      if (!match) continue;
      const params: Record<string, string> = {};
      route.names.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
      const ctx = { body: event.body, query: event.query, params, event };
      for (const middleware of route.chain) {
        const response = await middleware(ctx);
        if (response) return response as ApiResponse;
      }
    }
    return error('Не найдено', 404);
  };
}
