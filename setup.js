// Страница для преподавателя: собирает ссылку на кнопку для своей группы и рисует QR-код.
import { normalizePhone } from './phone.js';

const $ = (id) => document.getElementById(id);
const clean = (value) => value.replace(/\s+/g, ' ').trim();

function buildLink({ phone, teacher, group }) {
  const url = new URL('./', location.href); // index.html лежит рядом с этой страницей
  url.searchParams.set('p', phone);
  if (group) url.searchParams.set('g', group);
  if (teacher) url.searchParams.set('n', teacher);
  return url.href;
}

function renderQr(text) {
  const qr = window.qrcode(0, 'M'); // 0 — размер подбирается автоматически
  qr.addData(text);
  qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true, alt: 'QR-код со ссылкой на тревожную кнопку' });
}

$('form').addEventListener('submit', (event) => {
  event.preventDefault();
  const phone = normalizePhone($('phone').value);
  $('formError').hidden = Boolean(phone);
  if (!phone) return;

  const group = clean($('group').value);
  const link = buildLink({ phone, group, teacher: clean($('teacher').value) });
  $('link').value = link;
  $('open').href = link;
  $('posterGroup').textContent = group ? `Группа ${group}` : '';
  renderQr(link);
  $('setupForm').hidden = true;
  $('result').hidden = false;
});

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('link').value);
  } catch {
    $('link').select();
    document.execCommand('copy');
  }
  $('copy').textContent = 'Скопировано ✓';
  setTimeout(() => ($('copy').textContent = 'Скопировать'), 2000);
});

$('print').addEventListener('click', () => window.print());

$('again').addEventListener('click', () => {
  $('result').hidden = true;
  $('setupForm').hidden = false;
});
