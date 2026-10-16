// Живые обновления через WebSocket: сервер сам присылает новые тревоги и студентов.
import { api, ws } from '@appdeploy/client';

type Connection = ReturnType<typeof ws.connect>;
type UpdateHandler = (
  entityType: string,
  entityId: string,
  data: unknown,
) => void;
type StatusHandler = (online: boolean) => void;

let connection: Connection | null = null;
const updateHandlers = new Set<UpdateHandler>();
const statusHandlers = new Set<StatusHandler>();

function parse(
  raw: unknown,
): {
  type?: string;
  payload?: { entity_type: string; entity_id: string; data: unknown };
} | null {
  if (typeof raw !== 'string') return raw as ReturnType<typeof parse>;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getConnection(): Connection {
  if (connection) return connection;
  const conn = ws.connect();
  conn.onMessage((raw) => {
    const msg = parse(raw);
    if (msg?.type !== 'entity.update' || !msg.payload) return;
    for (const handler of updateHandlers)
      handler(msg.payload.entity_type, msg.payload.entity_id, msg.payload.data);
  });
  conn.onOpen(() => statusHandlers.forEach((h) => h(true)));
  conn.onClose(() => {
    if (connection === conn) connection = null;
    statusHandlers.forEach((h) => h(false));
  });
  connection = conn;
  return conn;
}

export function onUpdate(handler: UpdateHandler): () => void {
  updateHandlers.add(handler);
  return () => updateHandlers.delete(handler);
}

export function onStatus(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  return () => statusHandlers.delete(handler);
}

// Подписка на сущность. Возвращает функцию отписки.
export async function subscribe(
  entityType: 'group' | 'alert',
  entityId: string,
  auth: Record<string, string>,
): Promise<() => void> {
  const conn = getConnection();
  await conn.ready;
  const body = {
    entity_type: entityType,
    entity_id: entityId,
    connection_id: conn.connectionId,
    ...auth,
  };
  await api.post('/api/subscriptions', body);
  return () => {
    api.post('/api/subscriptions/remove', body).catch(() => undefined);
  };
}

// После обрыва (телефон уснул, пропал интернет) открываем новое соединение.
export function reconnect(): void {
  const old = connection;
  connection = null;
  old?.disconnect();
}
