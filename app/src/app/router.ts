// Один HTML-файл, экраны переключаются по адресу после «#»:
//   #/            — главная
//   #/new         — создание группы
//   #/s/КОД       — кнопка студента (эта ссылка зашита в QR-код)
//   #/t/КОД/КЛЮЧ  — панель преподавателя
import { renderHome, renderNewGroup } from './home';
import { renderStudent } from './student';
import { renderTeacher } from './teacher';

let cleanup: (() => void) | null = null;

function route(): void {
  cleanup?.();
  cleanup = null;
  const [section = '', rawCode = '', key = ''] = location.hash
    .replace(/^#\/?/, '')
    .split('/');
  const code = rawCode.toUpperCase();
  if (section === 's' && /^[A-Z0-9]{6}$/.test(code))
    cleanup = renderStudent(code);
  else if (section === 't' && /^[A-Z0-9]{6}$/.test(code) && key)
    cleanup = renderTeacher(code, decodeURIComponent(key));
  else if (section === 'new') renderNewGroup();
  else renderHome();
}

export function startRouter(): void {
  window.addEventListener('hashchange', route);
  route();
}
