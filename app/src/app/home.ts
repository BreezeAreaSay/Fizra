// Главная страница и создание группы преподавателем.
import {
  $,
  clean,
  errorMessage,
  normalizePhone,
  render,
  routeTo,
  storage,
} from './common';
import { createGroup } from './backend';

export type SavedGroup = { code: string; key: string; title: string };

export const TEACHER_GROUPS_KEY = 'sos.teacherGroups';
export const LAST_STUDENT_KEY = 'sos.lastStudentGroup';

export function rememberTeacherGroup(group: SavedGroup): void {
  const list = storage
    .get<SavedGroup[]>(TEACHER_GROUPS_KEY, [])
    .filter((g) => g.code !== group.code);
  storage.set(TEACHER_GROUPS_KEY, [group, ...list].slice(0, 10));
}

export function forgetTeacherGroup(code: string): void {
  const list = storage
    .get<SavedGroup[]>(TEACHER_GROUPS_KEY, [])
    .filter((g) => g.code !== code);
  storage.set(TEACHER_GROUPS_KEY, list);
}

// Ссылка на панель выглядит как …/#/t/КОД/КЛЮЧ — достаём из неё код и ключ.
function parsePanelLink(text: string): { code: string; key: string } | null {
  const m = /#\/t\/([A-Za-z0-9]{6})\/([^\s/?#]+)/.exec(text);
  return m ? { code: m[1].toUpperCase(), key: m[2] } : null;
}

export function renderHome(): void {
  const lastStudent = storage.get<string | null>(LAST_STUDENT_KEY, null);
  const teacherGroups = storage.get<SavedGroup[]>(TEACHER_GROUPS_KEY, []);
  // Кнопку открыли с экрана «Домой» — сразу возвращаем студента в его группу.
  const standalone = matchMedia('(display-mode: standalone)').matches;
  if (standalone && lastStudent && teacherGroups.length === 0) {
    routeTo(`#/s/${lastStudent}`);
    return;
  }

  const app = render(`
        <main class="page">
            <section class="screen">
                <div class="logo" aria-hidden="true">SOS</div>
                <h1>Тревожная кнопка</h1>
                <p>Если на физкультуре стало плохо, студент нажимает кнопку — и преподаватель сразу видит тревогу на своей панели с местом на карте. Дополнительно тревога уходит по SMS.</p>

                <div class="card">
                    <h2>Я студент</h2>
                    <p class="hint">Отсканируй QR-код в спортзале или введи код группы.</p>
                    <form id="codeForm" class="inline-form">
                        <input id="codeInput" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="Код группы" aria-label="Код группы">
                        <button class="btn" type="submit">Открыть</button>
                    </form>
                    <button id="continueStudent" class="btn btn-primary" type="button" hidden>Открыть мою кнопку</button>
                </div>

                <div class="card">
                    <h2>Я преподаватель</h2>
                    <p class="hint">Создайте группу — получите QR-код для студентов и панель, где видно всех студентов и тревоги.</p>
                    <a class="btn btn-primary" href="#/new">Создать группу</a>
                    <div id="myGroups" class="my-groups" hidden>
                        <p class="hint">Мои группы:</p>
                        <ul id="myGroupsList"></ul>
                    </div>
                    <p class="hint">Уже есть группа? Вставьте ссылку на её панель:</p>
                    <form id="panelForm" class="inline-form" novalidate>
                        <input id="panelInput" autocomplete="off" placeholder="Ссылка на панель" aria-label="Ссылка на панель преподавателя">
                        <button class="btn" type="submit">Открыть</button>
                    </form>
                    <p id="panelError" class="error" role="alert" hidden>Это не ссылка на панель. Она выглядит так: …/#/t/КОД/КЛЮЧ</p>
                </div>
            </section>
        </main>
    `);

  $<HTMLFormElement>('#codeForm', app).addEventListener('submit', (event) => {
    event.preventDefault();
    const code = clean(
      $<HTMLInputElement>('#codeInput', app).value,
      6,
    ).toUpperCase();
    if (code.length === 6) routeTo(`#/s/${code}`);
  });

  $<HTMLFormElement>('#panelForm', app).addEventListener('submit', (event) => {
    event.preventDefault();
    const panel = parsePanelLink($<HTMLInputElement>('#panelInput', app).value);
    $('#panelError', app).hidden = Boolean(panel);
    if (panel) routeTo(`#/t/${panel.code}/${panel.key}`);
  });

  if (lastStudent) {
    const button = $<HTMLButtonElement>('#continueStudent', app);
    button.hidden = false;
    button.addEventListener('click', () => routeTo(`#/s/${lastStudent}`));
  }

  if (teacherGroups.length > 0) {
    $('#myGroups', app).hidden = false;
    const list = $('#myGroupsList', app);
    for (const group of teacherGroups) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#/t/${group.code}/${group.key}`;
      link.textContent = `${group.title} (${group.code})`;
      item.append(link);
      list.append(item);
    }
  }
}

export function renderNewGroup(): void {
  const app = render(`
        <main class="page">
            <section class="screen">
                <h1>Новая группа</h1>
                <p>Студенты отсканируют QR-код, введут имя и телефон — и появятся у вас в списке. Тревоги будут приходить на панель, а дополнительно — SMS на ваш номер.</p>
                <form id="groupForm" class="form" novalidate>
                    <label>Название группы
                        <input id="title" maxlength="60" placeholder="ИВТ-21, физкультура">
                    </label>
                    <label>Как вас подписать <span class="opt">необязательно</span>
                        <input id="teacherName" maxlength="60" autocomplete="name" placeholder="Ирина Петровна">
                    </label>
                    <label>Ваш телефон для SMS
                        <input id="teacherPhone" type="tel" autocomplete="tel" placeholder="+7 999 123-45-67">
                    </label>
                    <p id="formError" class="error" role="alert" hidden></p>
                    <button id="createButton" class="btn btn-primary btn-big" type="submit">Создать группу</button>
                </form>
                <a class="link" href="#/">← На главную</a>
            </section>
        </main>
    `);

  const form = $<HTMLFormElement>('#groupForm', app);
  const errorBox = $('#formError', app);
  const button = $<HTMLButtonElement>('#createButton', app);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const teacherPhone = normalizePhone(
      $<HTMLInputElement>('#teacherPhone', app).value,
    );
    if (!teacherPhone) {
      errorBox.textContent =
        'Укажите номер телефона — на него придут SMS о тревогах.';
      errorBox.hidden = false;
      return;
    }
    errorBox.hidden = true;
    button.disabled = true;
    button.textContent = 'Создаю…';
    try {
      const { code, key, group } = await createGroup({
        title: clean($<HTMLInputElement>('#title', app).value),
        teacherName: clean($<HTMLInputElement>('#teacherName', app).value),
        teacherPhone,
      });
      rememberTeacherGroup({ code, key, title: group.title });
      routeTo(`#/t/${code}/${key}`);
    } catch (err) {
      errorBox.textContent = errorMessage(err);
      errorBox.hidden = false;
      button.disabled = false;
      button.textContent = 'Создать группу';
    }
  });
}
