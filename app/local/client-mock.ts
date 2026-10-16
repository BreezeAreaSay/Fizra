// Локальная заглушка @appdeploy/client: обычный fetch и WebSocket к локальному серверу.
type Handler<T> = (value: T) => void;

async function request(method: string, url: string, data?: unknown) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: data !== undefined && method !== 'GET' ? JSON.stringify(data) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw Object.assign(new Error(body.error || res.statusText), { response: { status: res.status, data: body } });
    }
    return { data: body };
}

export const api = {
    get: (url: string) => request('GET', url),
    post: (url: string, data?: unknown) => request('POST', url, data),
    put: (url: string, data?: unknown) => request('PUT', url, data),
    delete: (url: string, data?: unknown) => request('DELETE', url, data),
};

export const ws = {
    connect() {
        const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
        const handlers = { message: [] as Handler<unknown>[], open: [] as Handler<void>[], close: [] as Handler<void>[], error: [] as Handler<unknown>[] };
        let resolveReady: () => void = () => undefined;
        const conn = {
            connectionId: null as string | null,
            ready: new Promise<void>((r) => (resolveReady = r)),
            onMessage: (fn: Handler<unknown>) => handlers.message.push(fn),
            onOpen: (fn: Handler<void>) => handlers.open.push(fn),
            onClose: (fn: Handler<void>) => handlers.close.push(fn),
            onError: (fn: Handler<unknown>) => handlers.error.push(fn),
            disconnect: () => socket.close(),
        };
        socket.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'connection') {
                conn.connectionId = msg.connection_id;
                handlers.open.forEach((h) => h());
                resolveReady();
                return;
            }
            handlers.message.forEach((h) => h(msg));
        };
        socket.onclose = () => handlers.close.forEach((h) => h());
        socket.onerror = (e) => handlers.error.forEach((h) => h(e));
        return conn;
    },
};
