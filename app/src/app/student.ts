// Экран студента: регистрация по QR-коду и большая кнопка SOS.
import {
  $,
  clean,
  errorMessage,
  formatAccuracy,
  formatPhone,
  isIOS,
  mapUrl,
  normalizePhone,
  render,
  show,
  smsUrl,
  storage,
} from './common';
import {
  cancelAlert,
  getAlertState,
  getGroup,
  registerStudent,
  sendAlert,
  sendAlertLocation,
  type AlertState,
  type Group,
  type StudentAuth,
} from './backend';
import {
  freshFix,
  geoText,
  locate,
  onGeoChange,
  warmUpLocation,
  type Fix,
} from './geo';
import { onUpdate, subscribe } from './realtime';
import { LAST_STUDENT_KEY } from './home';

type Profile = StudentAuth & { name: string; phone: string };
type SavedAlert = { id: string; test: boolean };

const groupKey = (code: string) => `sos.group.${code}`;
const profileKey = (code: string) => `sos.student.${code}`;
const alertKey = (code: string) => `sos.alert.${code}`;

const TEMPLATE = `
<main class="page">
    <section id="screenLoading" class="screen"><p class="hint">Загрузка…</p></section>

    <section id="screenError" class="screen" hidden>
        <h1 id="errorTitle">Группа не найдена</h1>
        <p id="errorText">Проверь QR-код или попроси у преподавателя новую ссылку.</p>
        <a class="btn" href="#/">На главную</a>
    </section>

    <section id="screenRegister" class="screen" hidden>
        <h1>Тревожная кнопка</h1>
        <p class="group-line" id="registerGroup"></p>
        <p>Если на занятии станет плохо, нажми кнопку — преподаватель сразу увидит тревогу и место на карте.</p>
        <form id="registerForm" class="form" novalidate>
            <label>Фамилия и имя
                <input id="nameInput" maxlength="60" autocomplete="name" placeholder="Иванов Иван">
            </label>
            <label>Твой телефон
                <input id="phoneInput" type="tel" autocomplete="tel" placeholder="+7 999 123-45-67">
            </label>
            <p class="hint">Телефон увидит только преподаватель — чтобы связаться с тобой.</p>
            <p id="registerError" class="error" role="alert" hidden></p>
            <button id="registerButton" class="btn btn-primary btn-big" type="submit">Готово</button>
        </form>
        <p class="hint">После этого телефон спросит доступ к геолокации — разреши его.</p>
    </section>

    <section id="screenMain" class="screen" hidden>
        <p class="who"><span id="whoName"></span> · <button id="editProfile" class="link" type="button">изменить</button></p>
        <p class="hint" id="groupLine"></p>

        <button id="sosButton" class="sos" type="button" aria-describedby="sosHint">
            <span class="sos-title">SOS</span>
            <span class="sos-sub">Мне плохо</span>
        </button>
        <p class="hint" id="sosHint">Нажми — преподаватель сразу увидит тревогу и твоё место на карте</p>

        <p id="geoLine" class="geo"></p>
        <button id="geoAllow" class="btn btn-small" type="button" hidden>Разрешить геолокацию</button>

        <div class="row">
            <a class="btn callTeacher" href="#">📞 Преподаватель</a>
            <a class="btn btn-danger btn-compact" href="tel:112">📞 112</a>
        </div>

        <button id="testButton" class="link" type="button">Проверить, что всё работает</button>

        <details class="install" id="installHint">
            <summary>Добавить кнопку на экран телефона</summary>
            <p data-os="ios">Safari: «Поделиться» → «На экран „Домой“».</p>
            <p data-os="android">Chrome: меню ⋮ → «Добавить на главный экран».</p>
        </details>
    </section>

    <section id="screenAlert" class="screen" hidden>
        <div class="status-card" id="statusCard">
            <h1 id="alertTitle"></h1>
            <p id="alertText"></p>
            <p id="alertGeo" class="geo"></p>
        </div>

        <a id="smsLink" class="btn btn-primary" href="#">Отправить SMS преподавателю</a>
        <p class="preview" id="smsPreview"></p>

        <div class="row">
            <a class="btn callTeacher" href="#">📞 Преподаватель</a>
            <a class="btn btn-danger btn-compact" href="tel:112">📞 112</a>
        </div>

        <details class="tips">
            <summary>Пока ждёшь помощь</summary>
            <ul>
                <li>Сядь или ляг там, где безопасно, и не уходи с места.</li>
                <li>Позови кого-нибудь рядом — не оставайся один.</li>
                <li>Если становится хуже, болит в груди, трудно дышать или темнеет в глазах — сразу звони 112.</li>
            </ul>
        </details>

        <button id="cancelAlert" class="link" type="button">Отменить — всё в порядке</button>
        <button id="alertDone" class="btn btn-primary" type="button" hidden>Готово</button>
    </section>
</main>
`;

export function renderStudent(code: string): () => void {
  const app = render(TEMPLATE);
  const cleanups: Array<() => void> = [];
  let group: Group | null = storage.get<Group | null>(groupKey(code), null);
  let profile = storage.get<Profile | null>(profileKey(code), null);

  // Состояние текущей тревоги на экране.
  let current: SavedAlert | null = null;
  let state: AlertState | null = null;
  let sendFailed = false;
  let geoFailed = false;
  let smsOpened = false;
  let smsFix: Fix | null = null;
  let unsubscribeAlert: (() => void) | null = null;

  // ---------- Геолокация ----------

  onGeoChange((geo) => {
    $('#geoLine', app).textContent = geoText(geo);
    $('#geoLine', app).classList.toggle(
      'geo-warn',
      ['denied', 'error', 'unsupported'].includes(geo),
    );
    $('#geoAllow', app).hidden = geo !== 'idle';
  });
  cleanups.push(() => onGeoChange(null));
  $('#geoAllow', app).addEventListener('click', () => void locate());

  const onVisible = () => {
    if (document.visibilityState === 'visible' && !$('#screenMain', app).hidden)
      void warmUpLocation();
  };
  document.addEventListener('visibilitychange', onVisible);
  cleanups.push(() =>
    document.removeEventListener('visibilitychange', onVisible),
  );

  // ---------- Регистрация ----------

  function showRegister(): void {
    $('#registerGroup', app).textContent = group ? groupTitle(group) : '';
    $<HTMLInputElement>('#nameInput', app).value = profile?.name ?? '';
    $<HTMLInputElement>('#phoneInput', app).value = profile
      ? formatPhone(profile.phone)
      : '';
    show(app, 'screenRegister');
  }

  $<HTMLFormElement>('#registerForm', app).addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();
      const errorBox = $('#registerError', app);
      const button = $<HTMLButtonElement>('#registerButton', app);
      const name = clean($<HTMLInputElement>('#nameInput', app).value);
      const phone = normalizePhone(
        $<HTMLInputElement>('#phoneInput', app).value,
      );
      const problem =
        name.length < 2
          ? 'Напиши фамилию и имя.'
          : !phone
            ? 'Проверь номер телефона.'
            : '';
      errorBox.textContent = problem;
      errorBox.hidden = !problem;
      if (problem) return;

      button.disabled = true;
      button.textContent = 'Сохраняю…';
      try {
        const auth = profile
          ? { studentId: profile.studentId, token: profile.token }
          : {};
        const result = await registerStudent(code, { name, phone, ...auth });
        profile = {
          studentId: result.studentId,
          token: result.token,
          name,
          phone,
        };
        storage.set(profileKey(code), profile);
        showMain();
        void locate(); // спрашиваем доступ к геолокации сейчас, в спокойной обстановке
      } catch (err) {
        errorBox.textContent = errorMessage(err);
        errorBox.hidden = false;
      } finally {
        button.disabled = false;
        button.textContent = 'Готово';
      }
    },
  );

  // ---------- Главный экран ----------

  function groupTitle(g: Group): string {
    const teacher = g.teacherName
      ? `преподаватель ${g.teacherName}`
      : 'преподаватель';
    return `${g.title} · ${teacher}`;
  }

  function showMain(): void {
    if (!group || !profile) return;
    $('#whoName', app).textContent = profile.name;
    $('#groupLine', app).textContent = groupTitle(group);
    for (const link of app.querySelectorAll<HTMLAnchorElement>('.callTeacher'))
      link.href = `tel:${group.teacherPhone}`;
    const standalone = matchMedia('(display-mode: standalone)').matches;
    $('#installHint', app).hidden = standalone;
    const os = isIOS
      ? 'ios'
      : /Android/i.test(navigator.userAgent)
        ? 'android'
        : null;
    for (const p of app.querySelectorAll<HTMLElement>('#installHint [data-os]'))
      p.hidden = os !== null && p.dataset.os !== os;
    show(app, 'screenMain');
    void warmUpLocation();
  }

  $('#editProfile', app).addEventListener('click', showRegister);
  $('#sosButton', app).addEventListener('click', () => void startAlert(false));
  $('#testButton', app).addEventListener('click', () => void startAlert(true));

  // ---------- Тревога ----------

  function smsText(fix: Fix | null, test: boolean): string {
    if (!profile) return '';
    const who = group ? `${profile.name}, ${group.title}` : profile.name;
    const head = test
      ? `Проверка тревожной кнопки (${who}): всё в порядке.`
      : `SOS! ${who}: мне плохо, нужна помощь.`;
    const place = fix
      ? `Я здесь: ${mapUrl(fix.lat, fix.lon)} (точность ${formatAccuracy(fix.accuracy)})`
      : 'Место определить не удалось.';
    return `${head} ${place}`;
  }

  function renderAlert(): void {
    if (!current || !group) return;
    const test = current.test;
    let title: string;
    let text: string;
    if (sendFailed && !state) {
      title = 'Не получилось отправить через интернет';
      text = smsOpened
        ? 'В открывшемся сообщении нажми «Отправить». Или позвони.'
        : 'Нажми зелёную кнопку — отправь SMS преподавателю. Или позвони.';
    } else if (!state) {
      title = 'Отправляю тревогу…';
      text = 'Секунду.';
    } else if (state.status === 'ack') {
      title = 'Преподаватель увидел тревогу и идёт к тебе';
      text = 'Оставайся на месте.';
    } else if (state.status === 'closed') {
      title = 'Тревога закрыта';
      text = 'Преподаватель отметил, что помощь оказана.';
    } else if (state.status === 'cancelled') {
      title = 'Тревога отменена';
      text = 'Преподаватель видит, что всё в порядке.';
    } else if (test) {
      title = 'Проверка отправлена ✓';
      text =
        'Преподаватель увидит её на панели с пометкой «Проверка». Всё работает.';
    } else {
      title = 'Тревога отправлена ✓';
      text = smsOpened
        ? 'Преподаватель уже видит её на своей панели. В открывшемся сообщении нажми «Отправить».'
        : 'Преподаватель уже видит её на своей панели. Отправь ещё и SMS — на случай, если у неё нет интернета.';
    }
    $('#alertTitle', app).textContent =
      test && !title.startsWith('Проверка') ? `Проверка. ${title}` : title;
    $('#alertText', app).textContent = text;

    const closed = state?.status === 'closed' || state?.status === 'cancelled';
    const card = $('#statusCard', app);
    card.className = `status-card ${sendFailed && !state ? 'status-failed' : state?.status === 'ack' || closed ? 'status-ok' : 'status-sent'}`;

    const fix = smsFix ?? freshFix();
    const accuracy = fix ? ` (${formatAccuracy(fix.accuracy)})` : '';
    const geo = $('#alertGeo', app);
    if (state?.hasLocation)
      geo.textContent = `📍 Место на карте передано преподавателю${accuracy}`;
    else if (sendFailed && fix)
      geo.textContent = `📍 Место на карте добавлено в SMS${accuracy}`;
    else if (geoFailed)
      geo.textContent =
        '⚠️ Место определить не удалось — преподаватель всё равно знает, что нужна помощь.';
    else if (fix) geo.textContent = '📍 Передаю место на карте…';
    else geo.textContent = '📍 Определяю место…';

    const sms = $<HTMLAnchorElement>('#smsLink', app);
    const message = smsText(fix, test);
    sms.href = smsUrl(group.teacherPhone, message);
    sms.textContent = smsOpened
      ? 'Открыть SMS ещё раз'
      : 'Отправить SMS преподавателю';
    sms.classList.toggle('btn-primary', !smsOpened || (sendFailed && !state));
    sms.hidden = closed;
    $('#smsPreview', app).textContent = message;
    $('#smsPreview', app).hidden = closed;

    $('#cancelAlert', app).hidden = closed || !state || test;
    $('#alertDone', app).hidden = !closed && !(test && state !== null);
  }

  function applyState(next: AlertState): void {
    state = next;
    if (next.status === 'closed' || next.status === 'cancelled')
      storage.remove(alertKey(code));
    renderAlert();
  }

  async function watchAlert(id: string): Promise<void> {
    unsubscribeAlert?.();
    unsubscribeAlert = null;
    if (!profile) return;
    try {
      unsubscribeAlert = await subscribe('alert', id, {
        code,
        studentId: profile.studentId,
        token: profile.token,
      });
    } catch {
      // Без живых обновлений тревога всё равно у преподавателя — просто не увидим «иду».
    }
  }

  cleanups.push(
    onUpdate((entityType, entityId, data) => {
      const item = (data as { item?: AlertState }).item;
      if (entityType === 'alert' && current && entityId === current.id && item)
        applyState(item);
    }),
  );
  cleanups.push(() => unsubscribeAlert?.());

  async function startAlert(test: boolean): Promise<void> {
    if (!profile || !group) return;
    const fix = freshFix();
    current = { id: '', test };
    state = null;
    sendFailed = false;
    geoFailed = false;
    smsOpened = false;
    smsFix = fix;
    show(app, 'screenAlert');
    renderAlert();

    const auth = { studentId: profile.studentId, token: profile.token };
    const location = fix
      ? { lat: fix.lat, lon: fix.lon, accuracy: fix.accuracy }
      : null;
    // Второй канал — SMS. Открываем её сами, пока браузер ещё считает это нажатием на SOS.
    const tappedAt = Date.now();
    const openSmsIfQuick = () => {
      if (Date.now() - tappedAt < 4000) openSms();
    };
    try {
      const created = await sendAlert(code, auth, location, test);
      current = { id: created.id, test };
      if (!test) storage.set(alertKey(code), current);
      applyState(created);
      void watchAlert(created.id);
      if (fix) openSmsIfQuick();
    } catch (err) {
      if (
        (err as { response?: { status?: number } }).response?.status === 403
      ) {
        // Преподаватель удалил студента из списка — нужно зарегистрироваться заново.
        storage.remove(profileKey(code));
        profile = null;
        showRegister();
        $('#registerError', app).textContent =
          'Тебя нет в списке группы — зарегистрируйся ещё раз и снова нажми SOS.';
        $('#registerError', app).hidden = false;
        openSmsIfQuick(); // SMS преподавателю всё равно уходит
        return;
      }
      sendFailed = true;
      renderAlert();
      openSmsIfQuick();
    }

    // Координат не было — определяем и дописываем к тревоге и SMS.
    if (!fix) {
      const found = await locate();
      if (!found) {
        geoFailed = true;
        return renderAlert();
      }
      smsFix = found;
      if (current.id && profile) {
        try {
          applyState(
            await sendAlertLocation(code, current.id, auth, {
              lat: found.lat,
              lon: found.lon,
              accuracy: found.accuracy,
            }),
          );
        } catch {
          renderAlert();
        }
      } else {
        renderAlert();
      }
    }
  }

  $('#cancelAlert', app).addEventListener('click', async () => {
    if (!current?.id || !profile) return;
    if (!confirm('Отменить тревогу? Преподаватель увидит, что всё в порядке.'))
      return;
    try {
      applyState(
        await cancelAlert(code, current.id, {
          studentId: profile.studentId,
          token: profile.token,
        }),
      );
    } catch (err) {
      window.alert(errorMessage(err));
    }
  });

  $('#alertDone', app).addEventListener('click', () => {
    unsubscribeAlert?.();
    unsubscribeAlert = null;
    current = null;
    state = null;
    storage.remove(alertKey(code));
    showMain();
  });

  function openSms(): void {
    smsOpened = true;
    const href = $<HTMLAnchorElement>('#smsLink', app).href;
    renderAlert();
    location.href = href;
  }

  $('#smsLink', app).addEventListener('click', (event) => {
    event.preventDefault();
    openSms();
  });

  // Вернулись из «Сообщений» — обновляем статус тревоги и живую подписку.
  const onReturn = async () => {
    if (
      document.visibilityState !== 'visible' ||
      !current?.id ||
      !profile ||
      $('#screenAlert', app).hidden
    )
      return;
    try {
      applyState(await getAlertState(code, current.id, profile));
      void watchAlert(current.id);
    } catch {
      // Нет связи — оставляем как есть.
    }
  };
  document.addEventListener('visibilitychange', onReturn);
  cleanups.push(() =>
    document.removeEventListener('visibilitychange', onReturn),
  );

  // ---------- Старт ----------

  void (async () => {
    try {
      group = await getGroup(code);
      storage.set(groupKey(code), group);
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status === 404 || !group) {
        $('#errorTitle', app).textContent =
          status === 404 ? 'Группа не найдена' : 'Нет связи с сервером';
        $('#errorText', app).textContent =
          status === 404
            ? 'Проверь QR-код или попроси у преподавателя новую ссылку.'
            : 'Проверь интернет и открой ссылку ещё раз. Если плохо прямо сейчас — звони 112.';
        show(app, 'screenError');
        return;
      }
      // Нет интернета, но группа уже знакома — кнопка работает через SMS.
    }
    storage.set(LAST_STUDENT_KEY, code);
    if (!profile) return showRegister();

    const saved = storage.get<SavedAlert | null>(alertKey(code), null);
    if (saved) {
      current = saved;
      show(app, 'screenAlert');
      try {
        applyState(await getAlertState(code, saved.id, profile));
        void watchAlert(saved.id);
        return;
      } catch {
        storage.remove(alertKey(code));
        current = null;
      }
    }
    showMain();
  })();

  return () => cleanups.forEach((fn) => fn());
}
