# Установка на свой сервер

Здесь уже всё собрано: `server.mjs` (сервер одним файлом) и `public/` (страницы). На сервере нужен только **Node.js 18+** — без `npm install` и без сборки.

Приложение слушает **внутренний порт 3077 только на 127.0.0.1**, поэтому другие проекты не мешают. Наружу его отдаёт ваш nginx или Caddy через уже настроенный HTTPS. HTTPS обязателен: без него браузер не даст геолокацию.

## 1. Скопировать и проверить

```bash
git clone -b claude/practical-ramanujan-2w976l https://github.com/BreezeAreaSay/Fizra.git /opt/fizra
cd /opt/fizra/app/selfhost

node -v                      # нужен 18 или новее
ss -ltn | grep 3077          # пусто = порт свободен; иначе возьмите другой, например PORT=3099
PORT=3077 node server.mjs    # должно появиться «Тревожная кнопка запущена»; Ctrl+C — выйти
```

Если GitHub с сервера не открывается — скачайте папку `app/selfhost` на компьютер и скопируйте: `scp -r selfhost user@сервер:/opt/fizra/app/`.

## 2. Запустить как службу (выберите одно)

**systemd:**

```bash
sudo cp fizra-sos.service /etc/systemd/system/
sudo systemctl enable --now fizra-sos
systemctl status fizra-sos
```

Данные (группы, студенты, тревоги) хранятся в `/var/lib/fizra-sos/db.json`.

**Docker:**

```bash
docker compose up -d --build
```

Данные — в папке `./data`.

## Если nginx сам работает в Docker (порты 80/443 держит `docker-proxy`)

Тогда nginx не видит `127.0.0.1:3077` на сервере. Кнопку запускаем тоже в Docker, в сети этого nginx — одним скриптом:

```bash
systemctl disable --now fizra-sos      # если уже запускали как службу
bash attach-to-docker-nginx.sh <контейнер-nginx> <папка с конфигом или шаблонами nginx>
# например: bash attach-to-docker-nginx.sh durag-nginx-1 /opt/durag/deploy/nginx/templates
```

Скрипт запускает кнопку в Docker (`docker-compose.proxy.yml`), добавляет в HTTPS-сервер nginx блок `location /sos/` (старый файл сохраняется с суффиксом `.bak-sos`) и перезапускает nginx — сайт на несколько секунд моргнёт. Если nginx не примет конфиг, скрипт вернёт старый. Повторный запуск безопасен: блок не добавится второй раз.

Данные — в папке `./data`. Кнопка откроется по адресу `https://<ваш домен>/sos/`.

## 3. Открыть наружу через ваш веб-сервер

- **nginx** — готовые блоки в `nginx.conf.example`: путь `https://ваш-домен/sos/` или поддомен `https://sos.ваш-домен/`. После правки: `sudo nginx -t && sudo systemctl reload nginx`.
- **Caddy** — в `Caddyfile.example`.

Важно для nginx: строки `Upgrade`/`Connection` нужны для WebSocket — без них тревоги будут появляться на панели только после обновления страницы.

## 4. Проверить

1. Откройте `https://ваш-домен/sos/` → «Создать группу».
2. Сохраните ссылку на панель.
3. Отсканируйте QR-код телефоном, зарегистрируйтесь и нажмите «Проверить, что всё работает» — на панели должна появиться карточка «Проверка».

## Обновление

```bash
cd /opt/fizra && git pull
sudo systemctl restart fizra-sos     # или: docker compose up -d --build
```

## Как собрано

Те же исходники, что в `app/src` и `app/backend`. Модули платформы AppDeploy при сборке заменяются своими: `server/sdk.ts` (база в JSON-файле, WebSocket) и `server/client.ts` (запросы к серверу). Пересобрать: `cd app && npm install && npm run selfhost:build`.
