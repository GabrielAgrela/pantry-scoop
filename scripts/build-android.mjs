import { spawn } from 'node:child_process';
import { access, cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const android = fileURLToPath(new URL('android/', root));
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
try { await access(new URL('android/local.properties', root)); }
catch { if (!sdk) throw new Error('Set ANDROID_HOME to your Android SDK, or open android/ in Android Studio to configure it.'); }
await new Promise((resolve, reject) => {
  const child = spawn('./gradlew', ['assembleDebug'], { cwd: android, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Android build exited with ${code}`)));
});
await mkdir(new URL('dist/android/', root), { recursive: true });
await cp(new URL('android/app/build/outputs/apk/debug/app-debug.apk', root), new URL('dist/android/pantry-scoop-debug.apk', root));
console.log('APK ready: dist/android/pantry-scoop-debug.apk');
