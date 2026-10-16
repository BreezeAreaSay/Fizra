// Общие мелочи для всех экранов.

export function $<T extends HTMLElement = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Нет элемента ${selector}`);
  return node;
}

// Разметка экранов статичная, а всё, что ввёл пользователь, вставляем через textContent.
export function render(html: string): HTMLElement {
  const app = $('#app');
  app.innerHTML = html;
  window.scrollTo(0, 0);
  return app;
}

export function show(root: ParentNode, screenId: string): void {
  for (const screen of root.querySelectorAll<HTMLElement>('.screen'))
    screen.hidden = screen.id !== screenId;
  window.scrollTo(0, 0);
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Приватный режим браузера: просто не запомним.
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Нечего удалять.
    }
  },
};

export function clean(value: unknown, max = 60): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Приводим номер к виду +79991234567, как бы его ни ввели: «8 (999) 123-45-67», «9991234567».
export function normalizePhone(value: string): string {
  const raw = value.trim();
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8'))
    digits = `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('9')) digits = `7${digits}`;
  if (digits.length < 5 || digits.length > 15) return '';
  const international =
    raw.startsWith('+') || (digits.length === 11 && digits.startsWith('7'));
  return international ? `+${digits}` : digits;
}

export function formatPhone(phone: string): string {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : phone;
}

export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function smsUrl(phone: string, text: string): string {
  // iPhone ждёт текст после «&body=», Android — после «?body=».
  return `sms:${phone}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
}

export function mapUrl(lat: number, lon: number): string {
  return `https://yandex.ru/maps/?pt=${lon.toFixed(6)},${lat.toFixed(6)}&z=18&l=map`;
}

export function formatAccuracy(meters: number | null): string {
  if (meters === null) return '';
  // Неразрывный пробел, чтобы «м» не переносилась на новую строку.
  return meters >= 1000
    ? `±${(meters / 1000).toFixed(1).replace('.', ',')} км`
    : `±${meters} м`;
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(ts: number): string {
  return timeFormat.format(ts);
}

export function formatDateTime(ts: number): string {
  return dateTimeFormat.format(ts);
}

export function timeAgo(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : formatDateTime(ts);
}

export function errorMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    'Нет связи с сервером. Проверьте интернет.'
  );
}

export function copyText(
  input: HTMLInputElement,
  button: HTMLButtonElement,
): void {
  const done = () => {
    const label = button.textContent;
    button.textContent = 'Скопировано ✓';
    setTimeout(() => (button.textContent = label), 2000);
  };
  navigator.clipboard.writeText(input.value).then(done, () => {
    input.select();
    document.execCommand('copy');
    done();
  });
}

export function routeTo(hash: string): void {
  location.hash = hash;
}
