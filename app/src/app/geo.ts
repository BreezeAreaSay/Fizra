// Геолокация телефона. Координаты определяем заранее, чтобы при нажатии SOS не ждать GPS.
import { formatAccuracy, isIOS } from './common';

export type Fix = { lat: number; lon: number; accuracy: number; at: number };
export type GeoState =
  | 'idle'
  | 'locating'
  | 'ok'
  | 'denied'
  | 'error'
  | 'unsupported';

const FRESH_MS = 2 * 60 * 1000; // координаты свежее 2 минут считаем актуальными

let fix: Fix | null = null;
let listener: ((state: GeoState) => void) | null = null;

export function onGeoChange(
  callback: ((state: GeoState) => void) | null,
): void {
  listener = callback;
}

function setState(state: GeoState): void {
  listener?.(state);
}

export function freshFix(): Fix | null {
  return fix && Date.now() - fix.at < FRESH_MS ? fix : null;
}

export function geoText(state: GeoState): string {
  switch (state) {
    case 'ok':
      return `📍 Местоположение определено, точность ${formatAccuracy(fix?.accuracy ?? null)}`;
    case 'locating':
      return '📍 Определяю местоположение…';
    case 'idle':
      return '📍 Геолокация ещё не разрешена';
    case 'denied':
      return isIOS
        ? '⚠️ Доступ к геолокации запрещён — тревога уйдёт без места на карте. Включи: Настройки → Конфиденциальность → Службы геолокации → Safari.'
        : '⚠️ Доступ к геолокации запрещён — тревога уйдёт без места на карте. Разреши его в настройках сайта (значок слева от адреса).';
    case 'error':
      return '⚠️ Не удалось определить местоположение (нет сигнала). Тревога всё равно уйдёт.';
    case 'unsupported':
      return '⚠️ Этот браузер не умеет определять местоположение. Тревога всё равно уйдёт.';
  }
}

export function locate(timeout = 10000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      resolve(null);
      return;
    }
    if (!freshFix()) setState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        fix = {
          lat: latitude,
          lon: longitude,
          accuracy: Math.round(accuracy),
          at: Date.now(),
        };
        setState('ok');
        resolve(fix);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setState('denied');
        else setState(freshFix() ? 'ok' : 'error');
        resolve(freshFix());
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

export async function warmUpLocation(): Promise<void> {
  if (!('geolocation' in navigator)) return setState('unsupported');
  let state = 'unknown';
  try {
    state = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    // Старые браузеры не умеют проверять разрешения — просто пробуем.
  }
  if (state === 'denied') setState('denied');
  else if (state === 'prompt') setState('idle');
  else void locate();
}
