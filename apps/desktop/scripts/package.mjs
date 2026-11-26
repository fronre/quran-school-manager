// Builds the Windows installer. Steps: build the app, stage ONLY what must ship (bundles + the two native libraries, installed
// for production in a clean folder), then run electron-builder on that folder. Output: out/installer/. Unsigned (no certificate yet).
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, Platform } from 'electron-builder';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkg = read(join(root, 'package.json')); const dbPkg = read(join(root, '../../packages/db/package.json'));
const electronVersion = read(join(root, '../../node_modules/electron/package.json')).version;
const stage = join(root, 'out', 'stage'); const output = join(root, 'out', 'installer');

console.log('1/4 build'); execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });

console.log('2/4 stage'); rmSync(stage, { recursive: true, force: true }); rmSync(output, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(root, 'build'), join(stage, 'build'), { recursive: true });
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'mishkat', productName: 'Mishkat', version: pkg.version, description: 'Mishkat - Quranic association management', author: 'Mishkat', main: 'dist/main.cjs',
  dependencies: { 'better-sqlite3': dbPkg.dependencies['better-sqlite3'], '@node-rs/argon2': dbPkg.dependencies['@node-rs/argon2'] },
}, null, 2));

console.log('3/4 install production dependencies (prebuilt native binaries, no compiler needed)');
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });

// The argon2 native library imports VCRUNTIME140.dll / VCRUNTIME140_1.dll. A clean Windows has no "Visual C++ Redistributable", so the app crashed at start there
// ("Cannot find native binding"). Ship the two runtime DLLs next to the library (app-local deployment; Windows looks in the library's own folder first).
// VERIFY: Microsoft's redistribution terms for these files before any wider distribution.
if (process.platform === 'win32') {
  const dir = join(stage, 'node_modules', '@node-rs', 'argon2-win32-x64-msvc');
  for (const f of ['vcruntime140.dll', 'vcruntime140_1.dll']) cpSync(join(process.env.WINDIR ?? 'C:\Windows', 'System32', f), join(dir, f));
}

console.log('4/4 installer');
await build({
  projectDir: stage, targets: Platform.WINDOWS.createTarget('nsis'),
  config: {
    appId: 'dz.mishkat.app', productName: 'Mishkat', electronVersion, electronDist: join(root, '../../node_modules/electron/dist'),
    directories: { output, buildResources: join(stage, 'build') }, npmRebuild: false, buildDependenciesFromSource: false, nodeGypRebuild: false,
    asar: true, asarUnpack: ['**/*.node', '**/vcruntime140*.dll'],
    files: ['dist/**/*', 'package.json', 'node_modules/**/*', '!node_modules/**/{test,tests,docs,*.md,*.map}',
      '!node_modules/better-sqlite3/{deps,src}/**', '!node_modules/better-sqlite3/prebuilds/!(win32-x64.node)', '!node_modules/@node-rs/argon2-!(win32-x64-msvc)/**'],
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: join(stage, 'build', 'icon.png'), signAndEditExecutable: true },
    nsis: { oneClick: true, perMachine: false, runAfterFinish: true, createDesktopShortcut: 'always', createStartMenuShortcut: true, shortcutName: 'الشهاب', deleteAppDataOnUninstall: false, artifactName: 'Mishkat-Setup-${version}.${ext}' },
  },
});
console.log('done:', output);
