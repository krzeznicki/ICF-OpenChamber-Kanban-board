// Bundles the extension with esbuild. Outputs are committed: installing never builds.
// Later tasks add entries below (panel -> IIFE, service and CLI -> ESM for Node).
import { build } from 'esbuild';
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
const common = { bundle: true, logLevel: 'warning', legalComments: 'none', absWorkingDir: root };

/** @type {Array<{ name: string } & import('esbuild').BuildOptions>} */
const entries = [
  // { name: 'panel', entryPoints: ['src/panel/main.ts'], outfile: 'panel/main.js', format: 'iife', platform: 'browser', target: 'es2022' },
  // { name: 'service', entryPoints: ['src/service/main.ts'], outfile: 'service/main.js', format: 'esm', platform: 'node', target: 'node22' },
  {
    name: 'cli',
    entryPoints: ['src/cli/task-board.ts'],
    outfile: 'build/cli/task-board.mjs',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    // Node bundles keep third-party licence comments at the end of the file.
    legalComments: 'eof',
  },
];

for (const { name, ...options } of entries) {
  for (const entry of options.entryPoints ?? []) {
    if (!existsSync(resolve(root, entry))) throw new Error(`build: entry "${name}" is missing ${entry}`);
  }
  await build({ ...common, ...options });
  // A #! banner means the output is meant to run directly.
  if (options.banner?.js?.startsWith('#!')) chmodSync(resolve(root, options.outfile), 0o755);
  console.log(`built ${name} -> ${options.outfile}`);
}

if (entries.length === 0) console.log('build: no entries yet');
