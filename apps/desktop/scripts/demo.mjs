// Builds a separate DEMO copy of the data (apps/desktop/out/demo) with names, teachers, groups, guardians, attendance, memorization and fees.
// Real data is never touched. Usage: node scripts/demo.mjs
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'); const demo = join(root, 'out', 'demo'); const dist = join(root, 'dist');
if (!existsSync(join(dist, 'migrations'))) throw new Error('Run "npm run build" first.');
await build({ platform: 'node', format: 'cjs', bundle: true, target: 'node24', external: ['electron', 'better-sqlite3', '@node-rs/argon2'], entryPoints: [join(root, 'scripts/demo-seed.ts')], outfile: join(root, 'out', 'demo-seed.cjs'), logLevel: 'warning' });
const electron = createRequire(import.meta.url)('electron');
try { execFileSync(electron, [join(root, 'out', 'demo-seed.cjs')], { env: { ...process.env, MISHKAT_DEMO_DIR: demo, MISHKAT_DIST: dist }, stdio: 'ignore', timeout: 240000 }); } catch { /* the result is read from the files below */ }
if (existsSync(join(demo, 'seed-error.txt'))) { console.error(readFileSync(join(demo, 'seed-error.txt'), 'utf8')); process.exit(1); }
console.log(readFileSync(join(demo, 'seed-summary.json'), 'utf8'));
