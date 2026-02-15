# Деплой и рестарт на сервере

## 1. Подтянуть изменения с GitHub

```bash
cd ~/Bluf
git pull origin main --no-rebase
```

Если Git пишет *"Need to specify how to reconcile divergent branches"*, один раз настройте merge:

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

### Если локальные коммиты на сервере не нужны

Привести сервер в точности к состоянию GitHub (осторожно: локальные изменения пропадут):

```bash
git fetch origin
git reset --hard origin/main
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
git pull origin main --no-rebase
sudo systemctl restart bluf
```
