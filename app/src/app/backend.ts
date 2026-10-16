// Запросы к серверу. Все вызовы идут через api из @appdeploy/client.
import { api } from '@appdeploy/client';

export type Group = {
  code: string;
  title: string;
  teacherName: string;
  teacherPhone: string;
};

export type Student = {
  id: string;
  name: string;
  phone: string;
  createdAt: number;
  updatedAt: number;
};

export type AlertStatus = 'active' | 'ack' | 'closed' | 'cancelled';

export type Alert = {
  id: string;
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

// То, что студент знает о своей тревоге (без чужих данных).
export type AlertState = {
  id: string;
  status: AlertStatus;
  test: boolean;
  hasLocation: boolean;
  createdAt: number;
  ackAt: number | null;
  closedAt: number | null;
};

export type Location = { lat: number; lon: number; accuracy: number };

export type StudentAuth = { studentId: string; token: string };

const teacher = (key: string) => `k=${encodeURIComponent(key)}`;

export async function createGroup(input: {
  title: string;
  teacherName: string;
  teacherPhone: string;
}) {
  const { data } = await api.post('/api/groups', input);
  return data as { code: string; key: string; group: Group };
}

export async function getGroup(code: string) {
  const { data } = await api.get(`/api/groups/${code}`);
  return data as Group;
}

export async function getDashboard(code: string, key: string) {
  const { data } = await api.get(
    `/api/groups/${code}/dashboard?${teacher(key)}`,
  );
  return data as { group: Group; students: Student[]; alerts: Alert[] };
}

export async function registerStudent(
  code: string,
  input: { name: string; phone: string } & Partial<StudentAuth>,
) {
  const { data } = await api.post(`/api/groups/${code}/students`, input);
  return data as StudentAuth & { student: Student };
}

export async function removeStudent(
  code: string,
  key: string,
  studentId: string,
) {
  await api.delete(`/api/groups/${code}/students/${studentId}?${teacher(key)}`);
}

export async function sendAlert(
  code: string,
  auth: StudentAuth,
  location: Location | null,
  test: boolean,
) {
  const { data } = await api.post(`/api/groups/${code}/alerts`, {
    ...auth,
    location,
    test,
  });
  return (data as { alert: AlertState }).alert;
}

export async function getAlertState(
  code: string,
  alertId: string,
  auth: StudentAuth,
) {
  const query = `studentId=${encodeURIComponent(auth.studentId)}&token=${encodeURIComponent(auth.token)}`;
  const { data } = await api.get(
    `/api/groups/${code}/alerts/${alertId}?${query}`,
  );
  return (data as { alert: AlertState }).alert;
}

export async function sendAlertLocation(
  code: string,
  alertId: string,
  auth: StudentAuth,
  location: Location,
) {
  const { data } = await api.post(
    `/api/groups/${code}/alerts/${alertId}/location`,
    { ...auth, location },
  );
  return (data as { alert: AlertState }).alert;
}

export async function cancelAlert(
  code: string,
  alertId: string,
  auth: StudentAuth,
) {
  const { data } = await api.post(
    `/api/groups/${code}/alerts/${alertId}/cancel`,
    auth,
  );
  return (data as { alert: AlertState }).alert;
}

export async function ackAlert(code: string, key: string, alertId: string) {
  const { data } = await api.post(
    `/api/groups/${code}/alerts/${alertId}/ack?${teacher(key)}`,
    { k: key },
  );
  return (data as { alert: Alert }).alert;
}

export async function closeAlert(code: string, key: string, alertId: string) {
  const { data } = await api.post(
    `/api/groups/${code}/alerts/${alertId}/close?${teacher(key)}`,
    { k: key },
  );
  return (data as { alert: Alert }).alert;
}
