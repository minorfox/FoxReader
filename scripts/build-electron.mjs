import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outMain = resolve(rootDir, 'dist-electron/main/index.mjs');
const outPreload = resolve(rootDir, 'dist-electron/preload/index.cjs');

mkdirSync(dirname(outMain), { recursive: true });
mkdirSync(dirname(outPreload), { recursive: true });

export async function buildElectron() {
  await Promise.all([
    build({
      entryPoints: [resolve(rootDir, 'src/main/index.ts')],
      outfile: outMain,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: true,
      external: ['electron', 'node:sqlite'],
    }),
    build({
      entryPoints: [resolve(rootDir, 'src/preload/index.ts')],
      outfile: outPreload,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      sourcemap: true,
      external: ['electron'],
    }),
  ]);
}

export async function watchElectron(onRebuild) {
  const mainCtx = await context({
    entryPoints: [resolve(rootDir, 'src/main/index.ts')],
    outfile: outMain,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
    external: ['electron', 'node:sqlite'],
    plugins: [
      {
        name: 'notify-rebuild',
        setup(b) {
          b.onEnd((result) => {
            if (result.errors.length === 0) onRebuild?.('main');
          });
        },
      },
    ],
  });

  const preloadCtx = await context({
    entryPoints: [resolve(rootDir, 'src/preload/index.ts')],
    outfile: outPreload,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    sourcemap: true,
    external: ['electron'],
    plugins: [
      {
        name: 'notify-rebuild',
        setup(b) {
          b.onEnd((result) => {
            if (result.errors.length === 0) onRebuild?.('preload');
          });
        },
      },
    ],
  });

  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);
  return async () => {
    await Promise.all([mainCtx.dispose(), preloadCtx.dispose()]);
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildElectron().catch((err) => {
    console.error('[build-electron] Failed:', err);
    process.exit(1);
  });
}
