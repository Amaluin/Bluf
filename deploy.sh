#!/bin/bash
# Быстрый деплой Bluf: git pull в Bluf, затем запуск приложения из Bluf/server
# Запуск из корня сервера: ./Bluf/deploy.sh   или   bash Bluf/deploy.sh
# В фоне: nohup ./Bluf/deploy.sh >> Bluf/deploy.log 2>&1 &

set -e
BLUF_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BLUF_DIR"

echo "=== Bluf: git pull в $BLUF_DIR ==="
git pull

echo "=== Остановка старого процесса на порту 3000 (если есть) ==="
PID=$(lsof -t -i :3000 2>/dev/null || true)
if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null || true
  sleep 1
fi

echo "=== Запуск приложения из Bluf/server ==="
cd "$BLUF_DIR/server"
exec node index.js
