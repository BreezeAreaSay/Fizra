// Замена @appdeploy/client для своего сервера: обычные запросы fetch и WebSocket.
// Адреса относительные, поэтому приложение работает и на поддомене, и по пути вроде /sos/.
type Handler<T> = (value: T) => void;

const resolve = (url: string) => new URL(url.replace(/^\//, ''), document.baseURI).href;

async function request(method: string, url: string, data?: unknown) {
  const res = await fetch(resolve(url), {
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
    const address = new URL('ws', document.baseURI);
    address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(address.href);
    const handlers = {
      message: [] as Handler<unknown>[],
      open: [] as Handler<void>[],
      close: [] as Handler<void>[],
      error: [] as Handler<unknown>[],
    };
    let resolveReady: () => void = () => undefined;
    let rejectReady: (err: unknown) => void = () => undefined;
    const conn = {
      connectionId: null as string | null,
      ready: new Promise<void>((resolveFn, rejectFn) => {
        resolveReady = resolveFn;
        rejectReady = rejectFn;
      }),
      onMessage: (fn: Handler<unknown>) => handlers.message.push(fn),
      onOpen: (fn: Handler<void>) => handlers.open.push(fn),
      onClose: (fn: Handler<void>) => handlers.close.push(fn),
      onError: (fn: Handler<unknown>) => handlers.error.push(fn),
      disconnect: () => socket.close(),
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data as string);
      // Первое сообщение сервера — номер соединения для подписок.
      if (message.type === 'connection') {
        conn.connectionId = message.connection_id;
        handlers.open.forEach((h) => h());
        resolveReady();
        return;
      }
      handlers.message.forEach((h) => h(message));
    };
    socket.onclose = () => {
      rejectReady(new Error('WebSocket закрыт'));
      handlers.close.forEach((h) => h());
    };
    socket.onerror = (event) => handlers.error.forEach((h) => h(event));
    return conn;
  },
};
