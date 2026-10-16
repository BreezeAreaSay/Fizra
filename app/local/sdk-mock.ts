// Локальная заглушка @appdeploy/sdk: база данных в памяти и WebSocket через локальный сервер.
// Нужна только для проверки на своём компьютере, на хостинг не отправляется.
import { randomUUID } from 'node:crypto';

type Rec = Record<string, unknown>;
const tables = new Map<string, Map<string, Rec>>();
const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const db = {
    async add(name: string, records: Rec[]) {
        return records.map((r) => {
            const id = randomUUID();
            table(name).set(id, copy(r));
            return id;
        });
    },
    async get(name: string, ids: string[]) {
        return ids.map((id) => (table(name).has(id) ? copy(table(name).get(id)!) : null));
    },
    async list(name: string, options: { limit?: number; nextToken?: string } = {}) {
        const all = [...table(name).entries()].map(([id, r]) => ({ ...copy(r), id }));
        const start = Number(options.nextToken || 0);
        const limit = options.limit ?? 100;
        const items = all.slice(start, start + limit);
        return { items, nextToken: start + limit < all.length ? String(start + limit) : undefined };
    },
    async update(name: string, items: Array<{ id: string; record: Rec }>) {
        return items.map(({ id, record }) => {
            if (!table(name).has(id)) return false;
            table(name).set(id, copy(record));
            return true;
        });
    },
    async delete(name: string, ids: string[]) {
        return ids.map((id) => table(name).delete(id));
    },
    tx: {
        async add(name: string, records: Rec[]) {
            return records.map((r) => {
                const { id: chosen, ...rest } = r as Rec & { id?: string };
                const id = chosen || randomUUID();
                if (table(name).has(id)) return null;
                table(name).set(id, copy(rest));
                return id;
            });
        },
        async update(name: string, items: Array<{ id: string; record: Rec }>, options: { patch?: boolean } = {}) {
            return items.map(({ id, record }) => {
                const existing = table(name).get(id);
                if (options.patch) {
                    if (!existing) return false;
                    const next = { ...existing };
                    for (const [k, v] of Object.entries(record)) {
                        if (v === undefined) delete next[k];
                        else next[k] = copy(v);
                    }
                    table(name).set(id, next);
                    return true;
                }
                table(name).set(id, copy(record));
                return true;
            });
        },
        async delete(name: string, ids: string[]) {
            return ids.map((id) => table(name).delete(id));
        },
    },
};

type Sender = (ids: string[], payload: unknown) => void;
let sender: Sender = () => undefined;
export function setWsSender(fn: Sender) {
    sender = fn;
}
export const ws = {
    async send(ids: string | string[], payload: unknown) {
        sender(Array.isArray(ids) ? ids : [ids], payload);
        return { ok: true };
    },
};

export function json(data: unknown, status = 200) {
    return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export function error(message: string, status = 400) {
    return json({ error: message }, status);
}

type Ctx = { body: unknown; query: Record<string, string>; params: Record<string, string>; event: unknown };
type Mw = (ctx: Ctx) => unknown;

export function router(routes: Record<string, Mw[]>) {
    const compiled = Object.entries(routes).map(([pattern, chain]) => {
        const [method, path] = pattern.split(' ');
        const names: string[] = [];
        const re = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, n) => (names.push(n), '([^/]+)'))}$`);
        return { method, re, names, chain };
    });
    return async (event: { method: string; path: string; query: Record<string, string>; body: unknown }) => {
        for (const route of compiled) {
            const m = route.method === event.method && route.re.exec(event.path);
            if (!m) continue;
            const params: Record<string, string> = {};
            route.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
            const ctx = { body: event.body, query: event.query, params, event };
            for (const mw of route.chain) {
                const res = await mw(ctx);
                if (res) return res;
            }
        }
        return error('Not found', 404);
    };
}
