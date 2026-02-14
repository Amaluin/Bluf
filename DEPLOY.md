# Развёртывание Bluf на VPS

Краткая инструкция, как запустить игру на своём сервере (Ubuntu/Debian или аналог).

## Что нужно на VPS

- Сервер с доступом по SSH
- Установленный **Node.js 18+** (проверка: `node -v`)

---

## 1. Подключение и подготовка

```bash
ssh user@ВАШ_IP_СЕРВЕРА
```

Установка Node.js (если ещё нет):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## 2. Загрузка проекта на сервер

**Вариант A — через Git** (если проект в репозитории):

```bash
cd ~
git clone https://github.com/ВАШ_ЛОГИН/bluf.git
cd bluf
```

**Вариант B — через SCP с вашего ПК** (из папки с проектом на компьютере):

```bash
scp -r d:\Bluf user@ВАШ_IP_СЕРВЕРА:~/bluf
```

Затем на сервере:

```bash
cd ~/bluf
```

---

## 3. Установка зависимостей и запуск

```bash
npm install --production
```

Проверка запуска вручную (обязательно из папки проекта и с привязкой ко всем сетевым интерфейсам):

```bash
cd ~/Bluf
HOST=0.0.0.0 npm start
```

В браузере откройте `http://ВАШ_IP_СЕРВЕРА:3000`. Если игра открывается — переходите к шагу 4. Остановка: `Ctrl+C`.

---

## 4. Постоянный запуск через PM2

Чтобы приложение не падало при отключении SSH и перезапускалось при сбоях:

```bash
sudo npm install -g pm2
cd ~/Bluf
HOST=0.0.0.0 pm2 start server/index.js --name bluf
pm2 save
pm2 startup
```

Полезные команды:

- `pm2 status` — статус
- `pm2 logs bluf` — логи
- `pm2 restart bluf` — перезапуск
- `pm2 stop bluf` — остановка

---

## 5. Открыть порт в файрволе

Если на VPS включён UFW:

```bash
sudo ufw allow 3000/tcp
sudo ufw reload
```

---

## 6. (Опционально) Домен и HTTPS через Nginx

Если есть домен (например, `bluf.example.com`), можно повесить его на приложение и включить SSL.

Установка Nginx:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

Создайте конфиг:

```bash
sudo nano /etc/nginx/sites-available/bluf
```

Вставьте (замените `bluf.example.com` на ваш домен):

```nginx
server {
    listen 80;
    server_name bluf.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Включите сайт и получите сертификат:

```bash
sudo ln -s /etc/nginx/sites-available/bluf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d bluf.example.com
```

После этого игра будет доступна по `https://bluf.example.com`. Certbot настроит редирект с HTTP на HTTPS.

---

## Переменные окружения

При необходимости можно задать порт и хост:

```bash
PORT=3000 HOST=0.0.0.0 pm2 start server/index.js --name bluf
```

Или через ecosystem-файл PM2:

```bash
nano ecosystem.config.cjs
```

Содержимое:

```javascript
module.exports = {
  apps: [{
    name: 'bluf',
    script: 'server/index.js',
    cwd: '/home/user/bluf',
    env: { NODE_ENV: 'production', PORT: 3000 },
  }],
};
```

Запуск: `pm2 start ecosystem.config.cjs`.

---

## Итог

| Без домена        | С доменом + Nginx      |
|-------------------|------------------------|
| `http://IP:3000`  | `https://bluf.example.com` |

После выполнения шагов 1–5 игра уже доступна по IP и порту 3000. Шаг 6 нужен только для красивого адреса и HTTPS.

---

## Если открывается только localhost

Приложение должно слушать на **всех интерфейсах** (`0.0.0.0`), иначе снаружи по IP зайти нельзя.

1. **Запускайте с переменной окружения:**
   ```bash
   cd ~/Bluf
   HOST=0.0.0.0 npm start
   ```
   Или через PM2: `HOST=0.0.0.0 pm2 start server/index.js --name bluf`

2. **Откройте порт в файрволе** (шаг 5 выше):
   ```bash
   sudo ufw allow 3000/tcp
   sudo ufw reload
   ```

3. **Проверьте с сервера:** `curl -I http://127.0.0.1:3000` — должен вернуть ответ. Затем откройте в браузере `http://IP_СЕРВЕРА:3000`.
