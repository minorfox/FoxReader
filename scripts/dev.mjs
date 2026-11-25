import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildElectron } from './build-electron.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const DEV_URL = 'http://127.0.0.1:5173';

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolvePromise();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`));
          return;
        }
        setTimeout(check, 250);
      });
    };
    check();
  });
}

async function main() {
  console.log('[dev] Building Electron main & preload...');
  await buildElectron();

  const viteBin = resolve(rootDir, 'node_modules/vite/bin/vite.js');
  const viteProc = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', '5173'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NO_PROXY: 'localhost,127.0.0.1,::1',
    },
  });

  const cleanup = () => {
    if (!viteProc.killed) viteProc.kill();
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  await waitForServer(DEV_URL);
  console.log(`[dev] Vite ready at ${DEV_URL}. Launching Electron...`);

  const electronBin = require('electron');
  const electronProc = spawn(electronBin, ['.'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: DEV_URL,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      NO_PROXY: 'localhost,127.0.0.1,::1',
    },
  });

  electronProc.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  viteProc.on('exit', (code) => {
    if (code && code !== 0) {
      if (!electronProc.killed) electronProc.kill();
      process.exit(code);
    }
  });
}

main().catch((err) => {
  console.error('[dev] Error:', err);
  process.exit(1);
});
