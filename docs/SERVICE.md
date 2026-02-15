# Запуск Bluf как сервиса (всегда включён, с SSL)

Если запускать приложение вручную (`./deploy.sh` или `node server/index.js`), оно завершится при отключении SSH. Чтобы Bluf работал **постоянно** (и после отключения SSH, и после перезагрузки сервера), запустите его как **systemd-сервис**.

Сертификаты (cert.pem, key.pem) лежат в `server/` — HTTPS включится автоматически.

---

## 1. Один раз: установить сервис

**Шаг 1.** Узнайте полный путь к папке Bluf на сервере. Например:
```bash
cd ~/Bluf
pwd
```
Часто это `/root/Bluf` или `/home/ваш_пользователь/Bluf`.

**Шаг 2.** Откройте unit-файл в проекте и при необходимости измените путь:
```bash
nano ~/Bluf/bluf.service
```
В строке `WorkingDirectory=...` укажите **ваш** путь к Bluf и добавьте `/server`, например:
```ini
WorkingDirectory=/root/Bluf/server
```

**Шаг 3.** Скопируйте unit в systemd и включите сервис:
```bash
sudo cp ~/Bluf/bluf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bluf
sudo systemctl start bluf
```

**Шаг 4.** Проверьте, что сервис запущен:
```bash
sudo systemctl status bluf
```
Должно быть `active (running)`. В логах будет что-то вроде `Bluf: https://...`.

Дальше можно отключать SSH — приложение продолжит работать.

---

## 2. Обновление (после git pull)

Обновить код и перезапустить приложение:

```bash
cd ~/Bluf
git pull
sudo systemctl restart bluf
```

Или добавьте в свой скрипт деплоя строку в конце: `sudo systemctl restart bluf`.

---

## 3. Полезные команды

| Команда | Что делает |
|--------|------------|
| `sudo systemctl status bluf` | Статус и последние строки лога |
| `sudo systemctl restart bluf` | Перезапуск |
| `sudo systemctl stop bluf` | Остановить |
| `sudo journalctl -u bluf -f` | Смотреть лог в реальном времени |

После перезагрузки сервера сервис запустится сам (мы сделали `systemctl enable bluf`).
