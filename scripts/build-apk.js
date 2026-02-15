#!/usr/bin/env node
/**
 * Сборка APK из терминала (VS Code или любой другой).
 * Запуск: npm run build:apk
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const androidDir = path.join(root, 'android');
const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';

function hasJava() {
  if (process.env.JAVA_HOME) return true;
  try {
    execSync(isWin ? 'where java' : 'which java', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasJava()) {
  console.error('\nОшибка: не найден Java (JDK).');
  console.error('Gradle нужен JDK для сборки APK.');
  console.error('\nЧто сделать:');
  console.error('  1. Установите JDK 17: https://adoptium.net/');
  console.error('  2. Задайте переменную JAVA_HOME (путь к папке JDK, например C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.x-hotspot).');
  console.error('  3. Либо откройте проект android/ в Android Studio и соберите APK оттуда (Build → Build APK).\n');
  process.exit(1);
}

console.log('Syncing web assets...');
execSync('npx cap sync', { cwd: root, stdio: 'inherit' });

console.log('Building APK...');
execSync(`${gradlew} assembleDebug`, { cwd: androidDir, stdio: 'inherit' });

const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log('\nDone. APK:', apkPath);
