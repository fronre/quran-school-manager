// Builds main + preload (esbuild, CommonJS), the renderer (vite) and copies migrations. Requires Node >= 24 (type stripping).
import { build as esbuild } from 'esbuild';
import { build as vite } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toCssVariables } from '../../../packages/ui/src/tokens.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

writeFileSync(join(root, 'src/renderer/tokens.css'), `/* GENERATED from packages/ui/src/tokens.ts by scripts/build.mjs. Do not edit. */\n${toCssVariables()}\n`);

const common = { platform: 'node', format: 'cjs', bundle: true, target: 'node24', external: ['electron', 'better-sqlite3', '@node-rs/argon2'], sourcemap: false, logLevel: 'warning' };
await esbuild({ ...common, entryPoints: [join(root, 'src/main/main.ts')], outfile: join(dist, 'main.cjs') });
await esbuild({ ...common, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(dist, 'preload.cjs') });
cpSync(join(root, '../../packages/db/migrations'), join(dist, 'migrations'), { recursive: true });

await vite({
  root: join(root, 'src/renderer'), base: './', configFile: false, logLevel: 'warn',
  plugins: [react()],
  build: { outDir: join(dist, 'renderer'), emptyOutDir: true, target: 'chrome140', assetsInlineLimit: 0, cssCodeSplit: false },
});
console.log('built', dist);
