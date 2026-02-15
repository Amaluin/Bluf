# Деплой и рестарт на сервере

## 1. Подтянуть изменения с GitHub

**Рекомендуемый способ на сервере — просто взять всё из `main`** (без merge и без открытия редактора):

```bash
cd ~/Bluf
git fetch origin
git reset --hard origin/main
```

Сервер будет в точности как на GitHub. Локальные коммиты на сервере при этом теряются (для сервера это обычно нормально).

---

### Вариант через git pull (если нужны свои коммиты на сервере)

```bash
cd ~/Bluf
git pull origin main --no-rebase
```

Если откроется редактор (nano) для сообщения merge — сохраните и выйдите: **Ctrl+O**, Enter, **Ctrl+X**.

Если Git пишет *"Need to specify how to reconcile divergent branches"*:

```bash
git config pull.rebase false
git pull origin main
```

### Если есть конфликт (unmerged files)

1. Посмотреть файлы с конфликтом: `git status`
2. Открыть файл, например: `nano docs/TURN.md`
3. Удалить маркеры `<<<<<<<`, `=======`, `>>>>>>>`, оставить нужный текст
4. Пометить как решённый и завершить merge:

```bash
git add docs/TURN.md
git commit -m "Merge: resolve conflict"
```

---

## 2. Рестарт приложения Bluf

После обновления кода перезапустите сервис:

```bash
sudo systemctl restart bluf
```

Проверить статус:

```bash
sudo systemctl status bluf
```

Должно быть `active (running)`.

---

## 3. Если меняли unit-файл systemd

После правок `bluf.service`:

```bash
sudo cp /root/Bluf/bluf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart bluf
```

---

## Краткая последовательность после правок в репозитории

```bash
cd ~/Bluf
git fetch origin
git reset --hard origin/main
sudo systemctl restart bluf
```
