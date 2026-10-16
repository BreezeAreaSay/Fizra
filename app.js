// Тревожная кнопка для занятий физкультурой.
// Сервера нет: страница берёт координаты телефона и открывает SMS преподавателю
// с готовым текстом и ссылкой на Яндекс.Карты. Студенту остаётся нажать «Отправить».
import { normalizePhone, formatPhone } from './phone.js';

const STORAGE_KEY = 'sos-fizra';
const FRESH_MS = 2 * 60 * 1000; // координаты свежее 2 минут считаем актуальными
const $ = (id) => document.getElementById(id);
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);

// ---------- Настройки группы и имя студента ----------

function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, name }));
  } catch {
    // Приватный режим браузера: просто не запомним.
  }
}

const params = new URLSearchParams(location.search);
const saved = readStorage();

// Настройки приходят в ссылке от преподавателя: ?p=телефон&g=группа&n=как подписать преподавателя.
// Запоминаем их, чтобы кнопка работала и при открытии страницы без параметров.
const config = params.has('p')
  ? { phone: normalizePhone(params.get('p')), group: clean(params.get('g')), teacher: clean(params.get('n')) }
  : { phone: saved.phone || '', group: saved.group || '', teacher: saved.teacher || '' };
let name = saved.name || '';
if (config.phone) writeStorage();

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function show(screenId) {
  for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== screenId;
  window.scrollTo(0, 0);
}

// ---------- Геолокация ----------

let fix = null; // последние координаты: { lat, lon, accuracy, at }

function freshFix() {
  return fix && Date.now() - fix.at < FRESH_MS ? fix : null;
}

function formatAccuracy(meters) {
  // Неразрывный пробел, чтобы «м» не переносилась на новую строку.
  return meters >= 1000 ? `±${(meters / 1000).toFixed(1).replace('.', ',')}\u00a0км` : `±${meters}\u00a0м`;
}

const GEO_TEXT = {
  idle: '📍 Геолокация ещё не разрешена',
  locating: '📍 Определяю местоположение…',
  denied: isIOS
    ? '⚠️ Доступ к геолокации запрещён — SMS уйдёт без места на карте. Включи: Настройки → Конфиденциальность → Службы геолокации → Safari.'
    : '⚠️ Доступ к геолокации запрещён — SMS уйдёт без места на карте. Разреши его в настройках сайта (значок слева от адреса).',
  error: '⚠️ Не удалось определить местоположение (нет сигнала). SMS всё равно уйдёт.',
  unsupported: '⚠️ Этот браузер не умеет определять местоположение. SMS всё равно уйдёт.',
};

function setGeo(state) {
  const line = $('geoLine');
  line.textContent = state === 'ok' ? `📍 Местоположение определено, точность ${formatAccuracy(fix.accuracy)}` : GEO_TEXT[state];
  line.classList.toggle('geo-warn', ['denied', 'error', 'unsupported'].includes(state));
  $('geoAllow').hidden = state !== 'idle';
}

function locate(timeout = 10000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      setGeo('unsupported');
      resolve(null);
      return;
    }
    if (!freshFix()) setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        fix = { lat: latitude, lon: longitude, accuracy: Math.round(accuracy), at: Date.now() };
        setGeo('ok');
        resolve(fix);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setGeo('denied');
        else setGeo(freshFix() ? 'ok' : 'error');
        resolve(freshFix());
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

// Заранее узнаём координаты, чтобы в момент нажатия SMS открылась сразу, без ожидания GPS.
async function warmUpLocation() {
  if (!('geolocation' in navigator)) return setGeo('unsupported');
  let state = 'unknown';
  try {
    state = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    // Старые браузеры не умеют проверять разрешения — просто пробуем.
  }
  if (state === 'denied') setGeo('denied');
  else if (state === 'prompt') setGeo('idle');
  else locate();
}

// ---------- Текст SMS ----------

function buildMessage(where, test) {
  const who = config.group ? `${name}, ${config.group}` : name;
  const head = test ? `Проверка тревожной кнопки (${who}): всё в порядке.` : `SOS! ${who}: мне плохо, нужна помощь.`;
  const place = where
    ? `Я здесь: https://yandex.ru/maps/?pt=${where.lon.toFixed(6)},${where.lat.toFixed(6)}&z=18&l=map (точность ${formatAccuracy(where.accuracy)})`
    : 'Место определить не удалось.';
  return `${head} ${place}`;
}

function smsUrl(text) {
  // iPhone ждёт текст после «&body=», Android — после «?body=».
  return `sms:${config.phone}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
}

// ---------- Экран отправки ----------

let sendMode = { test: false };

const SEND_TEXT = {
  ready: ['Открываю сообщение…', 'Если «Сообщения» не открылись, нажми кнопку ниже.', 'Отправить SMS преподавателю'],
  locating: [
    'Определяю, где ты…',
    'Обычно это несколько секунд. Можно не ждать и отправить без места на карте.',
    'Отправить без геолокации',
  ],
  located: ['Место определено', 'Нажми кнопку — откроется SMS с точкой на карте.', 'Отправить SMS преподавателю'],
  failed: ['Место определить не удалось', 'Отправь SMS без него — преподаватель всё равно узнает, что нужна помощь.', 'Отправить SMS'],
  opened: ['Нажми «Отправить» в сообщении', 'Если SMS не открылась, нажми кнопку ещё раз.', 'Открыть SMS ещё раз'],
};

function renderSend(state, where) {
  const [title, text, label] = SEND_TEXT[state];
  const message = buildMessage(where, sendMode.test);
  $('sendTitle').textContent = sendMode.test ? `Проверка. ${title}` : title;
  $('sendText').textContent = text;
  $('smsLink').textContent = label;
  $('smsLink').classList.toggle('btn-primary', state !== 'locating');
  $('smsLink').href = smsUrl(message);
  $('smsPreview').textContent = message;
}

function startSend(test) {
  sendMode = { test };
  show('screenSend');
  const ready = freshFix();
  if (ready) {
    renderSend('ready', ready);
    // Координаты уже есть — открываем SMS прямо сейчас, пока браузер считает это нажатием пользователя.
    location.href = $('smsLink').href;
    return;
  }
  const current = sendMode;
  renderSend('locating', null);
  locate().then((where) => {
    if (sendMode !== current || $('screenSend').hidden) return; // ушли с экрана или начали заново
    renderSend(where ? 'located' : 'failed', where);
  });
}

// ---------- Главный экран ----------

function renderMain() {
  $('whoName').textContent = name;
  const to = config.teacher ? `${config.teacher}, ${formatPhone(config.phone)}` : formatPhone(config.phone);
  $('recipientLine').textContent = `${config.group ? `Группа ${config.group} · ` : ''}SMS получит: ${to}`;
  for (const id of ['callTeacher', 'callTeacher2']) $(id).href = `tel:${config.phone}`;

  // Подсказку «добавить на экран» показываем только для своей системы и только в браузере.
  $('installHint').hidden = isStandalone;
  const os = isIOS ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : null;
  for (const p of document.querySelectorAll('#installHint [data-os]')) p.hidden = os !== null && p.dataset.os !== os;
}

$('nameForm').addEventListener('submit', (event) => {
  event.preventDefault();
  name = clean($('nameInput').value);
  if (!name) return;
  writeStorage();
  renderMain();
  show('screenMain');
  locate(); // спрашиваем доступ к геолокации сейчас, в спокойной обстановке
});

$('editName').addEventListener('click', () => {
  $('nameInput').value = name;
  show('screenName');
  $('nameInput').focus();
});

$('geoAllow').addEventListener('click', () => locate());
$('sosButton').addEventListener('click', () => startSend(false));
$('testButton').addEventListener('click', () => startSend(true));
$('smsLink').addEventListener('click', () => {
  setTimeout(() => renderSend('opened', freshFix()), 300);
});
$('backButton').addEventListener('click', () => {
  sendMode = { test: false };
  show('screenMain');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('screenMain').hidden) warmUpLocation();
});
setInterval(() => {
  if (document.visibilityState === 'visible' && !$('screenMain').hidden && fix) locate();
}, 60 * 1000);

// ---------- Старт ----------

if (!config.phone) {
  show('screenNoConfig');
} else if (!name) {
  show('screenName');
} else {
  renderMain();
  show('screenMain');
  warmUpLocation();
}

// Кэшируем страницу, чтобы кнопка открывалась и без интернета (GPS и SMS его не требуют).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
