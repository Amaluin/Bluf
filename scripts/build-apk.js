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

console.log('Syncing web assets...');
execSync('npx cap sync', { cwd: root, stdio: 'inherit' });

console.log('Building APK...');
execSync(`${gradlew} assembleDebug`, { cwd: androidDir, stdio: 'inherit' });

const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
console.log('\nDone. APK:', apkPath);
