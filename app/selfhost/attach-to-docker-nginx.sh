#!/usr/bin/env bash
# Подключает тревожную кнопку к nginx, который работает в Docker, по адресу https://<домен>/sos/.
#
#   bash attach-to-docker-nginx.sh <контейнер nginx> <файл или папка с конфигом/шаблонами nginx на сервере>
#   пример: bash attach-to-docker-nginx.sh durag-nginx-1 /opt/durag/deploy/nginx/templates
#
# Что делает:
#   1. запускает кнопку в Docker в той же сети, что и nginx (порты наружу не открываются);
#   2. добавляет блок location /sos/ в HTTPS-сервер nginx (старый файл сохраняется рядом с суффиксом .bak-sos);
#   3. перезапускает nginx; если он не поднялся — возвращает старый конфиг.
set -euo pipefail

NGINX=${1:?Укажите имя контейнера nginx, например durag-nginx-1}
TARGET=${2:?Укажите файл или папку с конфигом nginx}
HERE=$(cd "$(dirname "$0")" && pwd)

# Файл, где описан HTTPS-сервер (listen 443).
if [ -d "$TARGET" ]; then
  CONF=$(find "$TARGET" -maxdepth 1 -type f ! -name '*.bak-sos' -exec grep -l 'listen[[:space:]]*443' {} + 2>/dev/null | head -n 1 || true)
else
  CONF=$TARGET
fi
[ -n "${CONF:-}" ] && [ -f "$CONF" ] || { echo "Не нашёл файл с 'listen 443' в $TARGET"; exit 1; }
echo "Конфиг nginx: $CONF"

NETWORK=$(docker inspect "$NGINX" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
echo "Сеть Docker: $NETWORK"

echo "== 1. Запускаю кнопку в Docker"
cd "$HERE"
PROXY_NETWORK=$NETWORK docker compose -f docker-compose.proxy.yml up -d --build

echo "== 2. Добавляю /sos/ в nginx"
if grep -q 'fizra-sos' "$CONF"; then
  echo "Блок уже есть — пропускаю"
else
  cp "$CONF" "$CONF.bak-sos"
  # Вставляем сразу после server_name в первом блоке с listen 443.
  awk '
    /listen[[:space:]]+443/ { in443 = 1 }
    { print }
    in443 && !done && /server_name/ {
      print ""
      print "    # Тревожная кнопка (fizra-sos). Переменная + resolver: nginx запустится, даже если кнопка выключена."
      print "    location = /sos { return 301 /sos/; }"
      print "    location /sos/ {"
      print "        resolver 127.0.0.11 valid=30s;"
      print "        set $sos_upstream http://fizra-sos:3077;"
      print "        rewrite ^/sos/(.*)$ /$1 break;"
      print "        proxy_pass $sos_upstream;"
      print "        proxy_http_version 1.1;"
      print "        proxy_set_header Upgrade $http_upgrade;"
      print "        proxy_set_header Connection \"upgrade\";"
      print "        proxy_set_header Host $host;"
      print "        proxy_read_timeout 1h;"
      print "    }"
      done = 1
    }
  ' "$CONF.bak-sos" > "$CONF"
  grep -q 'fizra-sos' "$CONF" || { cp "$CONF.bak-sos" "$CONF"; echo "Не нашёл server_name после listen 443 — ничего не менял"; exit 1; }
fi

echo "== 3. Перезапускаю nginx"
docker restart "$NGINX" >/dev/null
sleep 3
if docker exec "$NGINX" nginx -t; then
  echo
  echo "Готово! Откройте https://<ваш домен>/sos/"
else
  echo "nginx не принял конфиг — возвращаю старый"
  cp "$CONF.bak-sos" "$CONF"
  docker restart "$NGINX" >/dev/null
  exit 1
fi
