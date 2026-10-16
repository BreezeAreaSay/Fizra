// Серверная часть тревожной кнопки.
// Хранит группы, студентов и тревоги и мгновенно рассылает изменения на панель преподавателя.
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { db, json, error } from '@appdeploy/sdk';
import type {
  RouterContext,
  RouterResponse,
  RouterRoutes,
} from '@appdeploy/sdk';
import {
  addSubscription,
  notifySubscribers,
  removeSubscriptions,
} from './realtime-subscribers';

type Group = {
  title: string;
  teacherName: string;
  teacherPhone: string;
  teacherKey: string;
  createdAt: number;
};

type Student = {
  name: string;
  phone: string;
  token: string;
  createdAt: number;
  updatedAt: number;
};

type AlertStatus = 'active' | 'ack' | 'closed' | 'cancelled';

type Alert = {
  studentId: string;
  name: string;
  phone: string;
  test: boolean;
  status: AlertStatus;
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  locatedAt: number | null;
  createdAt: number;
  ackAt: number | null;
  closedAt: number | null;
};

type Location = { lat: number; lon: number; accuracy: number | null };

const GROUPS = 'groups';
// Без похожих символов (0/O, 1/I), чтобы код группы было легко продиктовать.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const ID_RE = /^[a-f0-9-]{36}$/;

// У каждой группы свои таблицы: так чтение списка не растёт вместе с числом групп.
const studentsTable = (code: string) => `students_${code}`;
const alertsTable = (code: string) => `alerts_${code}`;

// ---------- Вспомогательные функции ----------

function bodyOf(ctx: RouterContext): Record<string, unknown> {
  return ctx.body && typeof ctx.body === 'object'
    ? (ctx.body as Record<string, unknown>)
    : {};
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

// Приводим номер к виду +79991234567, как бы его ни ввели.
function normalizePhone(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8'))
    digits = `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
  if (digits.length < 5 || digits.length > 15) return '';
  const international =
    raw.startsWith('+') || (digits.length === 11 && digits.startsWith('7'));
  return international ? `+${digits}` : digits;
}

function parseLocation(value: unknown): Location | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const lat = Number(v.lat);
  const lon = Number(v.lon);
  const accuracy = Number(v.accuracy);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return null;
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    accuracy:
      Number.isFinite(accuracy) && accuracy >= 0
        ? Math.min(Math.round(accuracy), 100000)
        : null,
  };
}

function randomCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

// Сравнение секретов за постоянное время, чтобы ключ нельзя было подобрать по времени ответа.
function safeEqual(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

async function listAll<T>(table: string): Promise<Array<T & { id: string }>> {
  const result: Array<T & { id: string }> = [];
  let nextToken: string | undefined;
  // Ограничиваем чтение: в одной группе не бывает тысяч студентов.
  try {
    for (let page = 0; page < 5; page += 1) {
      const { items, nextToken: next } = await db.list<T>(table, {
        limit: 200,
        nextToken,
      });
      result.push(...(items as Array<T & { id: string }>));
      if (!next) break;
      nextToken = next;
    }
  } catch (err) {
    // В новую группу ещё никто не записывался — таблицы может не быть.
    console.warn(`list ${table} failed`, err);
  }
  return result;
}

async function loadGroup(code: string): Promise<Group | null> {
  if (!CODE_RE.test(code)) return null;
  try {
    const [group] = await db.get<Group>(GROUPS, [code], { consistent: true });
    return group;
  } catch (err) {
    console.warn('load group failed', err);
    return null;
  }
}

// Доступ преподавателя — по секретному ключу из его ссылки на панель.
async function teacherGroup(
  ctx: RouterContext,
): Promise<{ code: string; group: Group } | RouterResponse> {
  const code = String(ctx.params.code || '').toUpperCase();
  const group = await loadGroup(code);
  if (!group) return error('Группа не найдена', 404);
  const key = ctx.query.k ?? bodyOf(ctx).k;
  if (!safeEqual(key, group.teacherKey))
    return error('Нет доступа к панели преподавателя', 403);
  return { code, group };
}

// Студент подтверждает себя токеном, который получил при регистрации.
async function verifiedStudent(
  code: string,
  studentId: unknown,
  token: unknown,
): Promise<Student | null> {
  if (typeof studentId !== 'string' || !ID_RE.test(studentId)) return null;
  const [student] = await db.get<Student>(studentsTable(code), [studentId], {
    consistent: true,
  });
  return student && safeEqual(token, student.token) ? student : null;
}

function publicGroup(code: string, group: Group) {
  return {
    code,
    title: group.title,
    teacherName: group.teacherName,
    teacherPhone: group.teacherPhone,
  };
}

function studentView(id: string, student: Student) {
  return {
    id,
    name: student.name,
    phone: student.phone,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
  };
}

function alertView(id: string, alert: Alert) {
  return { id, ...alert };
}

// Студенту не нужны чужие телефоны — только состояние его тревоги.
function alertStatusView(id: string, alert: Alert) {
  return {
    id,
    status: alert.status,
    test: alert.test,
    hasLocation: alert.lat !== null,
    createdAt: alert.createdAt,
    ackAt: alert.ackAt,
    closedAt: alert.closedAt,
  };
}

async function publishAlert(code: string, id: string, alert: Alert) {
  await notifySubscribers('group', code, {
    kind: 'alert',
    item: alertView(id, alert),
  });
  await notifySubscribers('alert', id, {
    kind: 'status',
    item: alertStatusView(id, alert),
  });
}

async function loadAlert(code: string, id: string): Promise<Alert | null> {
  if (!ID_RE.test(id)) return null;
  const [alert] = await db.get<Alert>(alertsTable(code), [id], {
    consistent: true,
  });
  return alert;
}

async function patchAlert(
  code: string,
  id: string,
  patch: Partial<Alert>,
): Promise<Alert | null> {
  const [updated] = await db.tx.update(
    alertsTable(code),
    [{ id, record: patch }],
    { patch: true },
  );
  if (!updated) return null;
  return loadAlert(code, id);
}

// Тревога студента: проверяем, что она его, и меняем её.
async function studentAlert(ctx: RouterContext) {
  const code = String(ctx.params.code || '').toUpperCase();
  const body = bodyOf(ctx);
  const studentId = body.studentId ?? ctx.query.studentId;
  const token = body.token ?? ctx.query.token;
  if (!(await loadGroup(code))) return error('Группа не найдена', 404);
  if (!(await verifiedStudent(code, studentId, token)))
    return error('Студент не найден', 403);
  const alert = await loadAlert(code, ctx.params.id);
  if (!alert || alert.studentId !== studentId)
    return error('Тревога не найдена', 404);
  return { code, id: ctx.params.id, alert, body };
}

// ---------- Маршруты ----------

export const appRoutes: RouterRoutes = {
  // Преподаватель создаёт группу и получает секретный ключ к своей панели.
  'POST /api/groups': [
    async (ctx) => {
      const body = bodyOf(ctx);
      const teacherPhone = normalizePhone(body.teacherPhone);
      if (!teacherPhone)
        return error('Укажите номер телефона преподавателя', 400);
      const group: Group = {
        title: clean(body.title, 60) || 'Физкультура',
        teacherName: clean(body.teacherName, 60),
        teacherPhone,
        teacherKey: randomBytes(18).toString('base64url'),
        createdAt: Date.now(),
      };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomCode();
        const [id] = await db.tx.add(GROUPS, [{ id: code, ...group }]);
        if (id)
          return json({
            code,
            key: group.teacherKey,
            group: publicGroup(code, group),
          });
      }
      return error('Не удалось создать группу, попробуйте ещё раз', 500);
    },
  ],

  // Студент по QR-коду видит название группы и номер преподавателя.
  'GET /api/groups/:code': [
    async (ctx) => {
      const code = String(ctx.params.code || '').toUpperCase();
      const group = await loadGroup(code);
      if (!group) return error('Группа не найдена', 404);
      return json(publicGroup(code, group));
    },
  ],

  // Всё для панели преподавателя: группа, студенты с телефонами и тревоги.
  'GET /api/groups/:code/dashboard': [
    async (ctx) => {
      const access = await teacherGroup(ctx);
      if ('statusCode' in access) return access;
      const [students, alerts] = await Promise.all([
        listAll<Student>(studentsTable(access.code)),
        listAll<Alert>(alertsTable(access.code)),
      ]);
      return json({
        group: publicGroup(access.code, access.group),
        students: students.map(({ id, ...s }) => studentView(id, s)),
        alerts: alerts.map(({ id, ...a }) => alertView(id, a)),
      });
    },
  ],

  // Регистрация студента (или обновление имени и телефона по его токену).
  'POST /api/groups/:code/students': [
    async (ctx) => {
      const code = String(ctx.params.code || '').toUpperCase();
      if (!(await loadGroup(code))) return error('Группа не найдена', 404);
      const body = bodyOf(ctx);
      const name = clean(body.name, 60);
      const phone = normalizePhone(body.phone);
      if (name.length < 2) return error('Укажите фамилию и имя', 400);
      if (!phone) return error('Укажите свой номер телефона', 400);

      const now = Date.now();
      const existing = await verifiedStudent(code, body.studentId, body.token);
      if (existing) {
        const id = body.studentId as string;
        await db.tx.update(
          studentsTable(code),
          [{ id, record: { name, phone, updatedAt: now } }],
          { patch: true },
        );
        const student = { ...existing, name, phone, updatedAt: now };
        await notifySubscribers('group', code, {
          kind: 'student',
          item: studentView(id, student),
        });
        return json({
          studentId: id,
          token: existing.token,
          student: studentView(id, student),
        });
      }

      const id = randomUUID();
      const student: Student = {
        name,
        phone,
        token: randomBytes(18).toString('base64url'),
        createdAt: now,
        updatedAt: now,
      };
      const [added] = await db.tx.add(studentsTable(code), [
        { id, ...student },
      ]);
      if (!added) return error('Не удалось сохранить, попробуйте ещё раз', 500);
      await notifySubscribers('group', code, {
        kind: 'student',
        item: studentView(id, student),
      });
      return json({
        studentId: id,
        token: student.token,
        student: studentView(id, student),
      });
    },
  ],

  // Преподаватель убирает студента из списка (например, дубль).
  'DELETE /api/groups/:code/students/:id': [
    async (ctx) => {
      const access = await teacherGroup(ctx);
      if ('statusCode' in access) return access;
      if (!ID_RE.test(ctx.params.id)) return error('Студент не найден', 404);
      await db.delete(studentsTable(access.code), [ctx.params.id]);
      await notifySubscribers('group', access.code, {
        kind: 'student_removed',
        id: ctx.params.id,
      });
      return json({ ok: true });
    },
  ],

  // Тревога от студента: сразу появляется на панели преподавателя.
  'POST /api/groups/:code/alerts': [
    async (ctx) => {
      const code = String(ctx.params.code || '').toUpperCase();
      if (!(await loadGroup(code))) return error('Группа не найдена', 404);
      const body = bodyOf(ctx);
      const student = await verifiedStudent(code, body.studentId, body.token);
      if (!student)
        return error('Студент не найден — зарегистрируйтесь заново', 403);

      const now = Date.now();
      const location = parseLocation(body.location);
      const id = randomUUID();
      const alert: Alert = {
        studentId: body.studentId as string,
        name: student.name,
        phone: student.phone,
        test: body.test === true,
        status: 'active',
        lat: location?.lat ?? null,
        lon: location?.lon ?? null,
        accuracy: location?.accuracy ?? null,
        locatedAt: location ? now : null,
        createdAt: now,
        ackAt: null,
        closedAt: null,
      };
      const [added] = await db.tx.add(alertsTable(code), [{ id, ...alert }]);
      if (!added) return error('Не удалось отправить тревогу', 500);
      await notifySubscribers('group', code, {
        kind: 'alert',
        item: alertView(id, alert),
      });
      return json({ alert: alertStatusView(id, alert) });
    },
  ],

  // Студент смотрит, увидел ли преподаватель его тревогу.
  'GET /api/groups/:code/alerts/:id': [
    async (ctx) => {
      const found = await studentAlert(ctx);
      if ('statusCode' in found) return found;
      return json({ alert: alertStatusView(found.id, found.alert) });
    },
  ],

  // Координаты пришли позже тревоги — дописываем их.
  'POST /api/groups/:code/alerts/:id/location': [
    async (ctx) => {
      const found = await studentAlert(ctx);
      if ('statusCode' in found) return found;
      const location = parseLocation(found.body.location);
      if (!location) return error('Нет координат', 400);
      const alert = await patchAlert(found.code, found.id, {
        ...location,
        locatedAt: Date.now(),
      });
      if (!alert) return error('Тревога не найдена', 404);
      await publishAlert(found.code, found.id, alert);
      return json({ alert: alertStatusView(found.id, alert) });
    },
  ],

  // Студент отменяет тревогу: «всё в порядке».
  'POST /api/groups/:code/alerts/:id/cancel': [
    async (ctx) => {
      const found = await studentAlert(ctx);
      if ('statusCode' in found) return found;
      if (
        found.alert.status === 'closed' ||
        found.alert.status === 'cancelled'
      ) {
        return json({ alert: alertStatusView(found.id, found.alert) });
      }
      const alert = await patchAlert(found.code, found.id, {
        status: 'cancelled',
        closedAt: Date.now(),
      });
      if (!alert) return error('Тревога не найдена', 404);
      await publishAlert(found.code, found.id, alert);
      return json({ alert: alertStatusView(found.id, alert) });
    },
  ],

  // Преподаватель нажал «Принял, иду».
  'POST /api/groups/:code/alerts/:id/ack': [
    async (ctx) => {
      const access = await teacherGroup(ctx);
      if ('statusCode' in access) return access;
      const current = await loadAlert(access.code, ctx.params.id);
      if (!current) return error('Тревога не найдена', 404);
      if (current.status !== 'active')
        return json({ alert: alertView(ctx.params.id, current) });
      const alert = await patchAlert(access.code, ctx.params.id, {
        status: 'ack',
        ackAt: Date.now(),
      });
      if (!alert) return error('Тревога не найдена', 404);
      await publishAlert(access.code, ctx.params.id, alert);
      return json({ alert: alertView(ctx.params.id, alert) });
    },
  ],

  // Преподаватель закрывает тревогу — помощь оказана.
  'POST /api/groups/:code/alerts/:id/close': [
    async (ctx) => {
      const access = await teacherGroup(ctx);
      if ('statusCode' in access) return access;
      const current = await loadAlert(access.code, ctx.params.id);
      if (!current) return error('Тревога не найдена', 404);
      if (current.status === 'closed' || current.status === 'cancelled') {
        return json({ alert: alertView(ctx.params.id, current) });
      }
      const alert = await patchAlert(access.code, ctx.params.id, {
        status: 'closed',
        closedAt: Date.now(),
      });
      if (!alert) return error('Тревога не найдена', 404);
      await publishAlert(access.code, ctx.params.id, alert);
      return json({ alert: alertView(ctx.params.id, alert) });
    },
  ],

  // Подписка на живые обновления. Панель группы — только с ключом преподавателя,
  // статус тревоги — только её автору, чтобы телефоны и координаты не видел кто попало.
  'POST /api/subscriptions': [
    async (ctx) => {
      const body = bodyOf(ctx);
      const entityType = clean(body.entity_type, 20);
      const entityId = clean(body.entity_id, 64);
      const connectionId = clean(body.connection_id, 200);
      if (!entityType || !entityId || !connectionId) {
        return error('entity_type, entity_id, connection_id are required', 400);
      }
      const code = String(body.code || entityId).toUpperCase();
      const group = await loadGroup(code);
      if (!group) return error('Группа не найдена', 404);

      if (entityType === 'group') {
        if (
          entityId.toUpperCase() !== code ||
          !safeEqual(body.k, group.teacherKey)
        ) {
          return error('Нет доступа к панели преподавателя', 403);
        }
        await addSubscription('group', code, connectionId);
        return json({ ok: true });
      }
      if (entityType === 'alert') {
        const alert = await loadAlert(code, entityId);
        const student = await verifiedStudent(code, body.studentId, body.token);
        if (!alert || !student || alert.studentId !== body.studentId)
          return error('Тревога не найдена', 404);
        await addSubscription('alert', entityId, connectionId);
        return json({ ok: true });
      }
      return error('Неизвестный тип подписки', 400);
    },
  ],

  'POST /api/subscriptions/remove': [
    async (ctx) => {
      const body = bodyOf(ctx);
      const entityType = clean(body.entity_type, 20);
      const entityId = clean(body.entity_id, 64);
      const connectionId = clean(body.connection_id, 200);
      if (!entityType || !entityId || !connectionId) {
        return error('entity_type, entity_id, connection_id are required', 400);
      }
      const id = entityType === 'group' ? entityId.toUpperCase() : entityId;
      await removeSubscriptions(entityType, id, connectionId);
      return json({ ok: true });
    },
  ],
};
