# Сборка APK для Android

Приложение в APK — это та же игра: открывается веб-интерфейс и подключается к **вашему серверу** (VPS). Сервер должен быть уже запущен и доступен по сети.

## Что нужно

- **Node.js** на ПК (для `npx cap` и сборки)
- **JDK 17** (для сборки Android) — обычно уже есть с Android Studio или можно установить отдельно: [Adoptium](https://adoptium.net/)
- **Сервер Bluf** запущен и доступен по IP или домену (см. [DEPLOY.md](DEPLOY.md))

Собрать APK можно **из терминала VS Code** (или любого терминала) — Android Studio не обязателен.

### Если сборка пишет «JAVA_HOME is not set»

Нужно установить **JDK 17** и указать путь к нему.

**Windows:**
1. Скачайте JDK 17: https://adoptium.net/ (Temurin 17 LTS, Windows x64, .msi).
2. Установите (запомните путь, например `C:\Program Files\Eclipse Adoptium\jdk-17.0.13.11-hotspot`).
3. Задайте переменную окружения **JAVA_HOME**:
   - Поиск Windows → «Переменные среды» → «Изменить системные переменные» → «Переменные среды».
   - «Создать» → имя: `JAVA_HOME`, значение: путь к папке JDK (без `\bin`).
   - В «Path» добавьте `%JAVA_HOME%\bin`.
   - Перезапустите терминал (и VS Code).
4. Проверка: в терминале `java -version` — должна быть строка с версией 17.

**Альтернатива:** откройте папку `android` в **Android Studio** (File → Open). Студия подхватит свой JDK. Соберите APK через Build → Build APK(s).

---

## 1. Укажите адрес сервера

Перед сборкой APK отредактируйте **`public/config.js`** и укажите URL вашего сервера:

```javascript
window.BLUF_SERVER_URL = 'http://ВАШ_IP:3000';
```

Примеры:
- по IP: `'http://2.56.241.41:3000'`
- по домену: `'https://bluf.example.com'`

Если оставить пустую строку `''`, приложение будет подключаться к тому же хосту, с которого открыта страница (для веб-версии это нормально; для APK нужен явный адрес).

---

## 2. Установка зависимостей (один раз)

```bash
cd Bluf
npm install
```

---

## 3. Синхронизация веб-файлов в Android-проект

После любых изменений в папке `public/` выполните:

```bash
npx cap sync
```

Так в проект Android попадут актуальные `index.html`, `app.js`, `config.js` и т.д.

---

## 4. Сборка APK

### Вариант A: из VS Code (или любого терминала)

В корне проекта выполните:

```bash
npm run build:apk
```

Скрипт сам выполнит `cap sync` и сборку через Gradle. Готовый APK будет здесь:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Убедитесь, что установлен **JDK 17** (переменная `JAVA_HOME` должна указывать на него).

### Вариант B: вручную через Gradle

После `npx cap sync`:

```bash
cd android
./gradlew assembleDebug
```

На Windows в PowerShell или CMD:

```bash
cd android
gradlew.bat assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

### Вариант C: через Android Studio

1. Откройте папку **`android`** в Android Studio: **File → Open** → `Bluf/android`.
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Установка на телефон: **Run** (зелёный треугольник).

---

## 5. Релизный (signed) APK для публикации

Для установки без Android Studio и для магазинов нужна подписанная сборка:

1. В Android Studio: **Build → Generate Signed Bundle / APK**.
2. Выберите **APK**, создайте или выберите keystore, задайте пароли и алиасы.
3. Выберите build variant **release** и соберите APK.

Релизный APK будет в `android/app/build/outputs/apk/release/`.

---

## Важно

- **Сервер должен быть запущен** и доступен по указанному в `config.js` адресу (порт открыт, при необходимости `HOST=0.0.0.0` и файрвол).
- Для **HTTP** (не HTTPS) приложение уже настроено: в манифесте включён `usesCleartextTraffic`, так что подключение по `http://IP:3000` работает.
- После смены адреса сервера заново выполните `npx cap sync` и пересоберите APK.

Игра в APK и в браузере подключаются к одному и тому же серверу, мультиплеер между ними работает.
