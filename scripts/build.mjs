// Bundles the extension with esbuild. Outputs are committed: installing never builds.
// Panel -> IIFE for the sandboxed iframe; service and CLI -> ESM for Node.
// `--variant prod` (default) builds the committed production bundles into the repo; `--variant test
// --out <dir>` is what scripts/build-test.mjs runs for the local "Kanban TEST" build
// (src/core/variant.ts reads the baked-in __KANBAN_VARIANT__).
import { build } from 'esbuild';
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { values: args } = parseArgs({ options: { variant: { type: 'string', default: 'prod' }, out: { type: 'string' } } });
if (args.variant !== 'prod' && args.variant !== 'test') throw new Error(`build: --variant must be prod or test, not "${args.variant}"`);
// Production bundles are committed and never go anywhere else; the test build never lands in the repo.
if (args.variant === 'prod' && args.out !== undefined) throw new Error('build: --out is only for --variant test');
if (args.variant === 'test' && args.out === undefined) throw new Error('build: --variant test needs --out <dir> outside the repo');
const outRoot = args.out === undefined ? root : resolve(args.out);

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  logLevel: 'warning',
  legalComments: 'none',
  absWorkingDir: root,
  define: { __KANBAN_VARIANT__: JSON.stringify(args.variant) },
};

/** @type {Array<{ name: string } & import('esbuild').BuildOptions>} */
const entries = [
  { name: 'panel', entryPoints: ['src/panel/main.ts'], outfile: 'panel/main.js', format: 'iife', platform: 'browser', target: 'es2022' },
  {
    name: 'service',
    entryPoints: ['src/service/main.ts'],
    outfile: 'service/main.js',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'eof',
  },
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
  const outfile = resolve(outRoot, options.outfile);
  await build({ ...common, ...options, outfile });
  // A #! banner means the output is meant to run directly.
  if (options.banner?.js?.startsWith('#!')) chmodSync(outfile, 0o755);
  console.log(`built ${name} (${args.variant}) -> ${args.out === undefined ? options.outfile : outfile}`);
}

if (entries.length === 0) console.log('build: no entries yet');
