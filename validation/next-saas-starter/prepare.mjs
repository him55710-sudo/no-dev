import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2], 'Pass the external clone path.');
const exec = promisify(execFile);
const upstream = (await exec('git', ['-C', root, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim();
assert.equal(upstream, '6e33e58b1e553a41fe22e6b941a7229a002de361', 'Use the documented pinned upstream commit.');
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(root, 'pureobom-validation');
await mkdir(target, { recursive: true });
await copyFile(resolve(here, 'permissions.fixture.tsx'), resolve(target, 'permissions.test.tsx'));
await copyFile(resolve(here, 'vitest.config.fixture.mts'), resolve(target, 'vitest.config.mts'));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
manifest.packageManager = 'pnpm@11.25.0';
manifest.scripts.test = 'vitest run --config pureobom-validation/vitest.config.mts';
manifest.scripts.typecheck = 'tsc --noEmit';
manifest.devDependencies = {
  ...manifest.devDependencies,
  vitest: '4.1.11',
  vite: '7.3.7',
  '@electric-sql/pglite': '0.5.10',
  '@electric-sql/pglite-socket': '0.2.13',
};
await writeFile(resolve(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ upstream, root, modified: ['package.json', 'pureobom-validation'], applicationCodeModified: false }));
