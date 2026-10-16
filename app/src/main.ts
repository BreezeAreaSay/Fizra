import './styles.css';
import { startRouter } from './app/router';

startRouter();

// Service worker: кнопка открывается без интернета, а уведомления на Android показываются через него.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}
