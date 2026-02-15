# HTTPS для камеры и микрофона

В браузерах доступ к камере и микрофону (`getUserMedia`) разрешён только в **безопасном контексте**:

- **Работает:** `https://...` (любой домен) и `http://localhost` / `http://127.0.0.1`
- **Не работает:** `http://IP` или `http://ваш-домен.ru` (обычный HTTP с сервера)

Поэтому с localhost камера включается, а при открытии сайта по адресу сервера (например `http://2.56.241.41:3000`) — нет.

## Что сделать

Нужно отдавать приложение по **HTTPS**. Варианты:

### 1. Без домена: самоподписанный сертификат (по IP)

Домен не нужен. Браузер один раз покажет предупреждение «Небезопасное соединение» — нажмите «Дополнительно» → «Перейти на сайт (небезопасно)». После этого страница будет считаться безопасной и камера заработает.

**Шаг 1.** Создайте сертификат (один раз, в папке проекта или в отдельной папке):

```bash
# В корне проекта или в server/
openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```

Появится `cert.pem` и `key.pem`.

**Шаг 2.** Запустите сервер. Если `cert.pem` и `key.pem` лежат в папке `server/`, HTTPS включится **автоматически** (переменные окружения не нужны):

```bash
# Из папки server/ — достаточно:
cd ~/Bluf/server
node index.js
```

В консоли должно быть: `Bluf: https://...` и строка про камеру/микрофон.

Если запускаете из корня проекта, укажите пути к сертификатам:

```bash
# Из корня проекта (Linux / macOS)
SSL_CERT=server/cert.pem SSL_KEY=server/key.pem node server/index.js

# Windows (PowerShell) из корня
$env:SSL_CERT="server/cert.pem"; $env:SSL_KEY="server/key.pem"; node server/index.js
```

**Шаг 3.** Откройте в браузере **https://IP-ВАШЕГО-СЕРВЕРА:3000** (например `https://2.56.241.41:3000`). Примите предупреждение браузера один раз.

**Шаг 4.** В `public/config.js` укажите тот же адрес с `https://`:

```js
window.BLUF_SERVER_URL = 'https://2.56.241.41:3000';
```

Готово: камера и микрофон будут работать по IP без покупки домена.

**Если что-то пошло не так**

- **`https://IP:3000` не открывается, работает только `http://`** — на порту 3000 запущен сервер **без HTTPS**. Нужно остановить его и запустить с сертификатами:
  1. Остановите процесс на порту 3000: `kill $(lsof -t -i :3000)` (или `kill -9 ...`).
  2. Запустите с сертификатами (из папки `server/`):
     ```bash
     cd ~/Bluf/server
     SSL_CERT=cert.pem SSL_KEY=key.pem node index.js
     ```
  3. В консоли **обязательно** должно быть: `Bluf: https://...` и строка `(HTTPS: камера/микрофон...)`. Если видите `Bluf: http://...` — переменные не подхватились, проверьте, что `cert.pem` и `key.pem` лежат в `server/`.
  4. Откройте в браузере `https://2.56.241.41:3000`. При предупреждении о сертификате нажмите «Дополнительно» → «Перейти на сайт (небезопасно)».
  Проверка с самого сервера: `curl -k https://localhost:3000` — должен вернуть HTML страницы, а не ошибку соединения.

- **`EADDRINUSE: address already in use 0.0.0.0:3000`** — порт 3000 уже занят (часто это уже запущенный Bluf без HTTPS). Остановите старый процесс:
  ```bash
  # Узнать, кто слушает порт 3000 (Linux)
  sudo lsof -i :3000
  # или, если lsof нет:  ss -tlnp | grep 3000   или  netstat -tlnp | grep 3000
  # Завершить процесс: подставьте реальный PID из вывода (вторая колонка в lsof)
  kill <PID>
  # или одной командой (если на порту есть процесс; иначе будет "kill: usage" — тогда порт свободен)
  kill $(lsof -t -i :3000) 2>/dev/null; true
  # при необходимости принудительно:
  kill -9 $(lsof -t -i :3000) 2>/dev/null; true
  ```
  Если видите **`kill: usage`** — на порту 3000 ничего не запущено, можно сразу запускать сервер с `SSL_CERT` и `SSL_KEY`.
  После остановки процесса снова запустите сервер с `SSL_CERT` и `SSL_KEY`.

- **`Cannot find module '/root/Bluf/index.js'`** — запуск был из корня проекта, а указан `node index.js`. Точка входа приложения — `server/index.js`. Из корня проекта всегда запускайте:
  ```bash
  SSL_CERT=server/cert.pem SSL_KEY=server/key.pem node server/index.js
  ```
  Вариант с `node index.js` и `cert.pem`/`key.pem` годится только если вы предварительно перешли в папку `server/`:
  ```bash
  cd server
  SSL_CERT=cert.pem SSL_KEY=key.pem node index.js
  ```

---

### 2. С доменом: reverse proxy (nginx + Let's Encrypt)

Запускайте Bluf как обычно (HTTP на порту 3000), а снаружи ставьте nginx (или Caddy) с SSL:

- Установите nginx, получите сертификат (например Let's Encrypt: `certbot`).
- В nginx настройте проксирование на `http://127.0.0.1:3000`.
- Пользователи заходят по `https://ваш-домен.ru` — камера будет работать.

Пример фрагмента конфига nginx:

```nginx
server {
    listen 443 ssl;
    server_name ваш-домен.ru;
    ssl_certificate /etc/letsencrypt/live/ваш-домен.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ваш-домен.ru/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

После настройки в `public/config.js` укажите `window.BLUF_SERVER_URL = 'https://ваш-домен.ru';` (без порта, если 443).

### 3. Node с HTTPS (без nginx)

Сервер уже умеет работать по HTTPS: задайте переменные окружения `SSL_CERT` и `SSL_KEY` (пути к `cert.pem` и `key.pem`) — см. раздел про самоподписанный сертификат выше.

### 4. Локальная сеть / тест

Если нужно только в локальной сети с одного компьютера — открывайте вкладку с этого же компьютера по `http://localhost:3000`. Камера будет работать.
