# TURN: видео и микрофон на смартфонах

На смартфоне в лобби и в игре часто **не видно и не слышно оппонентов**, хотя с компьютера в браузере всё работает. Причина — мобильный интернет (4G/5G) и многие Wi‑Fi используют **симметричный NAT**: прямого P2P по одному STUN недостаточно, нужен **TURN**‑сервер, который ретранслирует медиа.

## Что сделать

Поднять TURN на том же сервере, где крутится Bluf (например **coturn**), и прописать его в `public/config.js`.

---

## 1. Установка coturn (Linux)

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install -y coturn

# Включить сервис
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
# или вручную: раскомментировать TURNSERVER_ENABLED=1 в /etc/default/coturn
```

## 2. Настройка coturn

Создайте конфиг (или отредактируйте существующий):

```bash
sudo nano /etc/turnserver.conf
```

Минимальный рабочий вариант (подставьте свой пароль и внешний IP сервера):

```ini
listening-port=3478
tls-listening-port=5349
external-ip=ВАШ_ВНЕШНИЙ_IP
realm=bluf
server-name=bluf
lt-cred-mech
user=bluf:ВАШ_ПАРОЛЬ_ДЛЯ_TURN
no-multicast-peers
no-cli
```

- **ВАШ_ВНЕШНИЙ_IP** — тот же IP, по которому открываете Bluf (например `2.56.241.41`).
- **ВАШ_ПАРОЛЬ_ДЛЯ_TURN** — придумайте сложный пароль (он будет в config.js в открытом виде, поэтому не используйте пароль от чего‑то важного).

Если сервер за NAT и внешний IP один, а внутренний другой:

```ini
external-ip=ВНЕШНИЙ_IP/ВНУТРЕННИЙ_IP
```

Перезапуск:

```bash
sudo systemctl enable coturn
sudo systemctl restart coturn
```

## 3. Фаервол

Откройте порты для TURN:

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
# диапазон для реле (по умолчанию coturn использует 49152–65535)
sudo ufw allow 49152:65535/udp
sudo ufw reload
```

## 4. Конфиг на клиенте (Bluf)

В `public/config.js` после `BLUF_SERVER_URL` добавьте (или раскомментируйте и подставьте свои данные):

```js
window.BLUF_TURN = {
  url: 'turn:2.56.241.41:3478',
  username: 'bluf',
  credential: 'ВАШ_ПАРОЛЬ_ДЛЯ_TURN'
};
```

Используйте тот же IP, что и в `BLUF_SERVER_URL`, и тот же пароль, что в `user=bluf:...` в конфиге coturn.

Если Bluf открываете по HTTPS с доменом, в TURN можно указать домен:

```js
window.BLUF_TURN = {
  url: 'turn:ваш-домен.ru:3478',
  username: 'bluf',
  credential: 'ваш-пароль'
};
```

## 5. Проверка

Перезалейте обновлённый `config.js` на сервер, обновите страницу на смартфоне (лучше с полной перезагрузкой). Зайдите в лобби, включите камеру/микрофон. После настройки TURN оппоненты должны быть видны и слышны и с телефона.

В браузере (F12 → Console) можно посмотреть, используется ли TURN: в логах ICE или в `pc.iceConnectionState` после установки соединения.

---

## Кратко

| Где            | Что |
|----------------|-----|
| Сервер         | Установить coturn, настроить `external-ip`, `user=bluf:пароль`, открыть порты 3478 и 49152:65535/udp |
| `public/config.js` | Задать `window.BLUF_TURN = { url: 'turn:IP:3478', username: 'bluf', credential: 'пароль' }` |

После этого видео и микрофон должны работать и в лобби, и в игре, в том числе на смартфонах.
