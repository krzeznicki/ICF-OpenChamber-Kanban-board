import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_INSTRUCTIONS_MAX } from '@openchamber/sdk';
import { VARIANT, branchPrefix, panelId, toVariant } from '../src/core/variant.ts';
import { dataDir } from '../src/service/store.ts';
import { defaultLinksFile, worktreeBranch } from '../src/service/sessions.ts';
import { defaultQueueFile } from '../src/service/queue.ts';
import { instructionsText } from '../src/service/instructions.ts';

const CLI = '/opt/ext/icf kanban test/build/cli/task-board.mjs';

test('unbundled code (tests, tsc) runs as the production variant', () => {
  assert.equal(VARIANT, 'prod');
});

test('toVariant: only "test" selects the test build; anything else is prod', () => {
  assert.equal(toVariant('test'), 'test');
  assert.equal(toVariant('prod'), 'prod');
  assert.equal(toVariant(undefined), 'prod');
  assert.equal(toVariant('TEST'), 'prod');
});

test('data dir: prod ~/.icf-kanban, test ~/.icf-kanban-test', () => {
  assert.equal(dataDir('prod', '/home/u'), '/home/u/.icf-kanban');
  assert.equal(dataDir('test', '/home/u'), '/home/u/.icf-kanban-test');
});

test('links.json and queue.json live in the variant data dir', () => {
  assert.equal(defaultLinksFile('prod', '/h'), '/h/.icf-kanban/links.json');
  assert.equal(defaultLinksFile('test', '/h'), '/h/.icf-kanban-test/links.json');
  assert.equal(defaultQueueFile('prod', '/h'), '/h/.icf-kanban/queue.json');
  assert.equal(defaultQueueFile('test', '/h'), '/h/.icf-kanban-test/queue.json');
});

test('worktree branch prefix: prod icf/, test icf-test/', () => {
  assert.equal(branchPrefix('prod'), 'icf/');
  assert.equal(branchPrefix('test'), 'icf-test/');
  assert.equal(worktreeBranch('drag-cards-abc123', 'prod'), 'icf/drag-cards-abc123');
  assert.equal(worktreeBranch('drag-cards-abc123', 'test'), 'icf-test/drag-cards-abc123');
});

test('prod instructions are unchanged by the variant default', () => {
  assert.equal(instructionsText(CLI), instructionsText(CLI, 'prod'));
  assert.doesNotMatch(instructionsText(CLI, 'prod'), /TEST/);
  assert.match(instructionsText(CLI, 'prod'), /Skills icf-kanban-create\/status\/next\/start/);
});

test('test instructions: say TEST development build, name its own CLI, only when the user asks for the TEST board', () => {
  const text = instructionsText(CLI, 'test');
  assert.ok(text.includes(`node "${CLI}"`));
  assert.match(text, /Kanban TEST development build/);
  assert.match(text, /only when the user asks for the TEST board/);
  assert.match(text, /Skills kanban-test-create\/status\/next\/start/);
  assert.doesNotMatch(text, /icf-kanban-/);
  for (const cmd of ['list --ready', 'next', 'claim <id>', 'state <id>', 'create --title', '--dir <the project root']) assert.ok(text.includes(cmd), cmd);
  assert.ok(text.length <= SERVICE_INSTRUCTIONS_MAX && text.length < 900, `length ${text.length}`);
  assert.ok(!text.includes('\n'));
});

test('panel id (and session item providerId): prod icf-kanban, test icf-kanban-test, matching the manifests', async () => {
  const { testManifest } = await import('../src/build/testBuild.ts');
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(panelId('prod'), pkg.openchamber.contributes.panel.id);
  assert.equal(panelId('test'), (testManifest(pkg, 'abc1234') as any).openchamber.contributes.panel.id);
});
