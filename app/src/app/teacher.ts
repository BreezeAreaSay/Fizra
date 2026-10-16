// Панель преподавателя: список студентов с телефонами и тревоги в реальном времени.
import qrcode from 'qrcode-generator';
import {
  $,
  copyText,
  errorMessage,
  formatAccuracy,
  formatDateTime,
  formatPhone,
  formatTime,
  mapUrl,
  render,
  timeAgo,
} from './common';
import {
  ackAlert,
  closeAlert,
  getDashboard,
  removeStudent,
  type Alert,
  type Group,
  type Student,
} from './backend';
import {
  askNotificationPermission,
  beep,
  keepScreenOn,
  setSiren,
  setTitleAlarm,
  soundUnlocked,
  systemNotify,
  unlockSound,
  vibrate,
} from './alarm';
import { onStatus, onUpdate, reconnect, subscribe } from './realtime';
import { rememberTeacherGroup } from './home';

const TEMPLATE = `
<main class="page page-wide">
    <section id="screenLoading" class="screen"><p class="hint">Загрузка панели…</p></section>

    <section id="screenError" class="screen" hidden>
        <h1>Панель не открылась</h1>
        <p id="errorText"></p>
        <a class="btn" href="#/">На главную</a>
    </section>

    <div id="dashboard" hidden>
        <header class="dash-head">
            <div>
                <p class="brand">Панель преподавателя</p>
                <h1 id="groupTitle"></h1>
                <p class="hint" id="groupMeta"></p>
            </div>
            <span id="conn" class="conn" role="status">● на связи</span>
        </header>

        <section class="banner" id="alarmBanner">
            <div>
                <b>Чтобы не пропустить тревогу</b>
                <p class="hint">Включите звук и уведомления и держите страницу открытой во время занятия. Студент также отправит SMS на ваш номер.</p>
            </div>
            <button id="enableAlarm" class="btn btn-primary" type="button">Включить звук и уведомления</button>
        </section>
        <p id="alarmStatus" class="hint alarm-status" hidden></p>

        <div class="dash-grid">
            <div class="dash-main">
                <section>
                    <h2>Тревоги <span class="count" id="activeCount"></span></h2>
                    <div id="activeAlerts" class="alerts"></div>
                    <p id="noAlerts" class="empty">Тревог нет — всё спокойно.</p>
                </section>

                <section>
                    <h2>Студенты <span class="count" id="studentCount"></span></h2>
                    <ul id="studentList" class="students"></ul>
                    <p id="noStudents" class="empty">Пока никто не подключился. Покажите студентам QR-код.</p>
                </section>

                <section>
                    <h2>Журнал</h2>
                    <ul id="history" class="history"></ul>
                    <p id="noHistory" class="empty">Здесь появятся закрытые тревоги.</p>
                </section>
            </div>

            <aside class="dash-side">
                <section class="card">
                    <h2>QR-код для студентов</h2>
                    <div class="poster">
                        <h3>Тревожная кнопка</h3>
                        <p class="poster-group" id="posterGroup"></p>
                        <div class="qr" id="qr"></div>
                        <p>Стало плохо на занятии?<br>Отсканируй QR-код и нажми <b>SOS</b>.</p>
                        <p class="poster-code">Код группы: <b id="posterCode"></b></p>
                    </div>
                    <input id="studentLink" readonly aria-label="Ссылка для студентов">
                    <div class="row">
                        <button id="copyStudent" class="btn" type="button">Скопировать ссылку</button>
                        <button id="printQr" class="btn" type="button">Распечатать</button>
                    </div>
                </section>

                <section class="card">
                    <h2>Ссылка на эту панель</h2>
                    <p class="hint">Сохраните её — по ней открываются список и тревоги. Не показывайте студентам.</p>
                    <input id="panelLink" readonly aria-label="Ссылка на панель преподавателя">
                    <button id="copyPanel" class="btn" type="button">Скопировать ссылку на панель</button>
                </section>
            </aside>
        </div>
    </div>
</main>
`;

const STATUS_BADGE: Record<Alert['status'], string> = {
  active: 'Нужна помощь',
  ack: 'Вы приняли',
  closed: 'Закрыта',
  cancelled: 'Отменена студентом',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function renderTeacher(code: string, key: string): () => void {
  const app = render(TEMPLATE);
  const cleanups: Array<() => void> = [];
  const students = new Map<string, Student>();
  const alerts = new Map<string, Alert>();
  let unsubscribeGroup: (() => void) | null = null;
  let online = true;
  let disposed = false;

  // ---------- Отрисовка ----------

  function renderAlertCard(alert: Alert): HTMLElement {
    const card = el(
      'article',
      `alert alert-${alert.status}${alert.test ? ' alert-test' : ''}`,
    );
    const head = el('div', 'alert-head');
    head.append(
      el('b', 'alert-name', alert.name),
      el('span', 'badge', alert.test ? 'Проверка' : STATUS_BADGE[alert.status]),
    );
    card.append(head);
    card.append(
      el(
        'p',
        'alert-meta',
        `${formatTime(alert.createdAt)} · ${timeAgo(alert.createdAt)}`,
      ),
    );

    const phone = el('a', 'alert-phone', `📞 ${formatPhone(alert.phone)}`);
    phone.href = `tel:${alert.phone}`;
    card.append(phone);

    if (alert.lat !== null && alert.lon !== null) {
      const geo = el('p', 'alert-geo');
      const link = el('a', '', '📍 Открыть место на карте');
      link.href = mapUrl(alert.lat, alert.lon);
      link.target = '_blank';
      link.rel = 'noopener';
      geo.append(link, ` ${formatAccuracy(alert.accuracy)}`);
      card.append(geo);
      const d = 0.0025;
      const map = el('iframe', 'alert-map');
      map.title = `Место: ${alert.name}`;
      map.loading = 'lazy';
      map.src = `https://www.openstreetmap.org/export/embed.html?bbox=${alert.lon - d},${alert.lat - d / 2},${alert.lon + d},${alert.lat + d / 2}&layer=mapnik&marker=${alert.lat},${alert.lon}`;
      card.append(map);
    } else {
      card.append(
        el(
          'p',
          'alert-geo',
          '📍 Место пока не определено — студент мог не разрешить геолокацию.',
        ),
      );
    }

    const actions = el('div', 'alert-actions');
    if (alert.status === 'active') {
      const ack = el(
        'button',
        'btn btn-primary',
        alert.test ? 'Вижу проверку' : 'Принял, иду',
      );
      ack.type = 'button';
      ack.addEventListener(
        'click',
        () => void act(() => ackAlert(code, key, alert.id), ack),
      );
      actions.append(ack);
    }
    const close = el('button', 'btn', 'Закрыть тревогу');
    close.type = 'button';
    close.addEventListener(
      'click',
      () => void act(() => closeAlert(code, key, alert.id), close),
    );
    actions.append(close);
    card.append(actions);
    return card;
  }

  function renderAlerts(): void {
    const all = [...alerts.values()].sort((a, b) => b.createdAt - a.createdAt);
    const open = all.filter((a) => a.status === 'active' || a.status === 'ack');
    const closed = all
      .filter((a) => a.status === 'closed' || a.status === 'cancelled')
      .slice(0, 30);

    $('#activeAlerts', app).replaceChildren(...open.map(renderAlertCard));
    $('#noAlerts', app).hidden = open.length > 0;
    $('#activeCount', app).textContent = open.length ? String(open.length) : '';

    $('#history', app).replaceChildren(
      ...closed.map((a) => {
        const item = el('li');
        const status = a.test
          ? 'проверка'
          : STATUS_BADGE[a.status].toLowerCase();
        item.append(
          el('span', 'hint', formatDateTime(a.createdAt)),
          ` ${a.name} — ${status}`,
        );
        return item;
      }),
    );
    $('#noHistory', app).hidden = closed.length > 0;

    const urgent = open.filter((a) => a.status === 'active' && !a.test).length;
    setSiren(urgent > 0 && soundUnlocked());
    setTitleAlarm(urgent);
  }

  function renderStudents(): void {
    const list = [...students.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'ru'),
    );
    $('#studentList', app).replaceChildren(
      ...list.map((s) => {
        const item = el('li', 'student');
        const info = el('div', 'student-info');
        info.append(
          el('b', '', s.name),
          el('span', 'hint', `подключился ${formatDateTime(s.createdAt)}`),
        );
        const phone = el('a', 'student-phone', formatPhone(s.phone));
        phone.href = `tel:${s.phone}`;
        const remove = el('button', 'icon-btn', '✕');
        remove.type = 'button';
        remove.title = 'Убрать из списка';
        remove.setAttribute('aria-label', `Убрать ${s.name} из списка`);
        remove.addEventListener('click', async () => {
          if (!confirm(`Убрать ${s.name} из списка группы?`)) return;
          try {
            await removeStudent(code, key, s.id);
            students.delete(s.id);
            renderStudents();
          } catch (err) {
            window.alert(errorMessage(err));
          }
        });
        item.append(info, phone, remove);
        return item;
      }),
    );
    $('#noStudents', app).hidden = list.length > 0;
    $('#studentCount', app).textContent = list.length
      ? String(list.length)
      : '';
  }

  async function act(
    request: () => Promise<Alert>,
    button: HTMLButtonElement,
  ): Promise<void> {
    button.disabled = true;
    try {
      const updated = await request();
      alerts.set(updated.id, updated);
      renderAlerts();
    } catch (err) {
      button.disabled = false;
      window.alert(errorMessage(err));
    }
  }

  // ---------- Новые события ----------

  function onNewAlert(alert: Alert): void {
    if (alert.test) {
      beep(0.3);
      systemNotify(
        'Проверка тревожной кнопки',
        `${alert.name} проверил(а) связь — всё работает.`,
        alert.id,
      );
      return;
    }
    vibrate();
    const where =
      alert.lat !== null
        ? 'Место на карте — на панели.'
        : 'Место определяется…';
    systemNotify(
      `🆘 ${alert.name}: нужна помощь`,
      `${formatPhone(alert.phone)}. ${where}`,
      alert.id,
    );
  }

  cleanups.push(
    onUpdate((entityType, entityId, data) => {
      if (entityType !== 'group' || entityId !== code) return;
      const update = data as {
        kind: string;
        item?: Student & Alert;
        id?: string;
      };
      if (update.kind === 'student' && update.item) {
        students.set(update.item.id, update.item);
        renderStudents();
      } else if (update.kind === 'student_removed' && update.id) {
        students.delete(update.id);
        renderStudents();
      } else if (update.kind === 'alert' && update.item) {
        const isNew = !alerts.has(update.item.id);
        alerts.set(update.item.id, update.item);
        renderAlerts();
        if (isNew) onNewAlert(update.item);
      }
    }),
  );

  // ---------- Загрузка и живое соединение ----------

  async function load(): Promise<Group> {
    const data = await getDashboard(code, key);
    students.clear();
    alerts.clear();
    data.students.forEach((s) => students.set(s.id, s));
    data.alerts.forEach((a) => alerts.set(a.id, a));
    renderStudents();
    renderAlerts();
    return data.group;
  }

  async function connect(): Promise<void> {
    unsubscribeGroup?.();
    unsubscribeGroup = await subscribe('group', code, { k: key });
  }

  // Соединение оборвалось (телефон уснул, пропал интернет): переподключаемся и перечитываем данные.
  let resyncTimer: number | null = null;
  function scheduleResync(delay: number): void {
    if (resyncTimer !== null || disposed) return;
    resyncTimer = window.setTimeout(async () => {
      resyncTimer = null;
      if (disposed) return;
      try {
        reconnect();
        await connect();
        await load();
        setOnline(true);
      } catch {
        scheduleResync(5000);
      }
    }, delay);
  }

  function setOnline(value: boolean): void {
    online = value;
    const conn = $('#conn', app);
    conn.textContent = value ? '● на связи' : '● нет связи — переподключаюсь';
    conn.classList.toggle('conn-off', !value);
  }

  cleanups.push(
    onStatus((isOnline) => {
      if (disposed) return;
      if (!isOnline) {
        setOnline(false);
        scheduleResync(2000);
      }
    }),
  );

  const onVisible = () => {
    if (document.visibilityState === 'visible' && !online) scheduleResync(0);
  };
  document.addEventListener('visibilitychange', onVisible);
  cleanups.push(() =>
    document.removeEventListener('visibilitychange', onVisible),
  );

  const ticker = window.setInterval(renderAlerts, 20000); // обновляем «N мин назад»
  cleanups.push(() => clearInterval(ticker));

  // ---------- Кнопки ----------

  $('#enableAlarm', app).addEventListener('click', async () => {
    unlockSound();
    beep(0.25);
    const permission = await askNotificationPermission();
    const screenOn = await keepScreenOn();
    renderAlerts();
    const parts = ['🔊 Звук включён'];
    if (permission === 'granted') parts.push('🔔 уведомления включены');
    else if (permission === 'denied')
      parts.push('🔕 уведомления запрещены в настройках браузера');
    else
      parts.push(
        '🔕 этот браузер не показывает уведомления — следите за звуком',
      );
    if (screenOn) parts.push('💡 экран не будет гаснуть');
    const status = $('#alarmStatus', app);
    status.textContent = parts.join(' · ');
    status.hidden = false;
    $('#alarmBanner', app).hidden = true;
  });

  $('#copyStudent', app).addEventListener('click', (e) =>
    copyText(
      $<HTMLInputElement>('#studentLink', app),
      e.currentTarget as HTMLButtonElement,
    ),
  );
  $('#copyPanel', app).addEventListener('click', (e) =>
    copyText(
      $<HTMLInputElement>('#panelLink', app),
      e.currentTarget as HTMLButtonElement,
    ),
  );
  $('#printQr', app).addEventListener('click', () => window.print());

  // ---------- Старт ----------

  void (async () => {
    let group: Group;
    try {
      group = await load();
    } catch (err) {
      $('#errorText', app).textContent = errorMessage(err);
      $('#screenLoading', app).hidden = true;
      $('#screenError', app).hidden = false;
      return;
    }
    rememberTeacherGroup({ code, key, title: group.title });

    $('#groupTitle', app).textContent = group.title;
    const teacher = group.teacherName ? `${group.teacherName} · ` : '';
    $('#groupMeta', app).textContent =
      `${teacher}SMS приходят на ${formatPhone(group.teacherPhone)} · код группы ${code}`;
    $('#posterGroup', app).textContent = group.title;
    $('#posterCode', app).textContent = code;

    const base = `${location.origin}${location.pathname}`;
    const studentLink = `${base}#/s/${code}`;
    $<HTMLInputElement>('#studentLink', app).value = studentLink;
    $<HTMLInputElement>('#panelLink', app).value = `${base}#/t/${code}/${key}`;
    const qr = qrcode(0, 'M');
    qr.addData(studentLink);
    qr.make();
    $('#qr', app).innerHTML = qr.createSvgTag({
      cellSize: 8,
      margin: 2,
      scalable: true,
    });

    $('#screenLoading', app).hidden = true;
    $('#dashboard', app).hidden = false;

    try {
      await connect();
    } catch {
      setOnline(false);
      scheduleResync(3000);
    }
  })();

  return () => {
    disposed = true;
    if (resyncTimer !== null) clearTimeout(resyncTimer);
    unsubscribeGroup?.();
    setSiren(false);
    setTitleAlarm(0);
    cleanups.forEach((fn) => fn());
  };
}
