// Как панель преподавателя привлекает внимание: сирена, системное уведомление, вибрация, мигающий заголовок.

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let audio: AudioContext | null = null;
let sirenTimer: number | null = null;
let titleTimer: number | null = null;
const baseTitle = document.title;

// Браузеры разрешают звук только после нажатия пользователя — поэтому нужна кнопка «Включить звук».
export function unlockSound(): void {
  const Ctx =
    window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
  if (!Ctx) return;
  audio ??= new Ctx();
  void audio.resume();
}

export function soundUnlocked(): boolean {
  return audio !== null && audio.state === 'running';
}

export function beep(duration = 0.9): void {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const t = audio.currentTime;
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.linearRampToValueAtTime(620, t + duration / 2);
  osc.frequency.linearRampToValueAtTime(880, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export function setSiren(on: boolean): void {
  if (on && sirenTimer === null) {
    beep();
    sirenTimer = window.setInterval(() => beep(), 1300);
  } else if (!on && sirenTimer !== null) {
    clearInterval(sirenTimer);
    sirenTimer = null;
  }
}

export function setTitleAlarm(count: number): void {
  if (titleTimer !== null) {
    clearInterval(titleTimer);
    titleTimer = null;
  }
  document.title = baseTitle;
  if (count === 0) return;
  let flip = false;
  titleTimer = window.setInterval(() => {
    flip = !flip;
    document.title = flip ? `🆘 Тревога (${count})` : baseTitle;
  }, 800);
}

export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

export async function askNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

// Системное уведомление видно, даже если вкладка свёрнута или открыта другая программа.
export function systemNotify(title: string, body: string, tag: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted')
    return;
  const options: NotificationOptions = {
    body,
    tag,
    requireInteraction: true,
    icon: './resources/icon-192.png',
  };
  const fallback = () => {
    try {
      new Notification(title, options);
    } catch {
      // Уведомления недоступны — хватит звука, вибрации и мигающего заголовка.
    }
  };
  // На Android уведомление можно показать только через service worker.
  if (!('serviceWorker' in navigator)) return fallback();
  navigator.serviceWorker
    .getRegistration()
    .then((registration) =>
      registration ? registration.showNotification(title, options) : fallback(),
    )
    .catch(fallback);
}

export function vibrate(): void {
  navigator.vibrate?.([400, 150, 400, 150, 800]);
}

// Чтобы экран телефона не гас, пока открыта панель.
let wakeLock: { release(): Promise<void> } | null = null;

export async function keepScreenOn(): Promise<boolean> {
  const nav = navigator as Navigator & {
    wakeLock?: {
      request(type: 'screen'): Promise<{ release(): Promise<void> }>;
    };
  };
  if (!nav.wakeLock) return false;
  try {
    wakeLock = await nav.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

export function wakeLockActive(): boolean {
  return wakeLock !== null;
}
