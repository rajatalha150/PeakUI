import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const script = join(dirname(fileURLToPath(import.meta.url)), 'peakui-install-android');

test('Android readiness rejects incomplete SDKs and accepts the complete baseline', () => {
  const root = mkdtempSync(join(tmpdir(), 'peakui-android-check-'));
  const env = { ...process.env, PEAKUI_ANDROID_SDK_ROOT: root };
  const check = () => {
    try {
      execFileSync('bash', [script, '--check'], { env, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  const executable = (relativePath) => {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    chmodSync(path, 0o755);
    return path;
  };

  try {
    assert.equal(check(), false);
    executable('cmdline-tools/latest/bin/sdkmanager');
    executable('platform-tools/adb');
    for (const api of [35, 36]) {
      const jar = join(root, `platforms/android-${api}/android.jar`);
      mkdirSync(dirname(jar), { recursive: true });
      writeFileSync(jar, '');
      executable(`build-tools/${api}.0.0/aapt2`);
    }
    executable('ndk/27.3.13750724/ndk-build');
    assert.equal(check(), false);
    const cmake = executable('cmake/3.22.1/bin/cmake');
    assert.equal(check(), true);
    chmodSync(cmake, 0o644);
    assert.equal(check(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
