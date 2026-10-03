import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { projectDirectory, initializeInstalledWorkspace } = require('../desktop/installation.cjs');
const { ProjectWorkspace } = require('../desktop/project-workspace.cjs');
const seedFile = new URL('../defaults/standaard-project.json', import.meta.url);

async function workspace(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zitplanner-installation-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new ProjectWorkspace(directory);
}

test('installed projects use writable user data while source runs retain their existing project folder', () => {
  const paths = { userData: path.resolve('profile'), projectRoot: path.resolve('source') };
  assert.equal(projectDirectory({ ...paths, isPackaged: true }), path.join(paths.userData, 'projects'));
  assert.equal(projectDirectory({ ...paths, isPackaged: false }), path.join(paths.projectRoot, 'projects'));
  const override = path.resolve('custom-projects');
  assert.equal(projectDirectory({ ...paths, isPackaged: true, override }), override);
});

test('fresh installed workspaces contain only the bundled standard project', async t => {
  const store = await workspace(t);
  await initializeInstalledWorkspace({ store, isPackaged: true, seedFile });
  const boot = await store.startup(), seed = JSON.parse(await fs.readFile(seedFile, 'utf8'));
  assert.equal((await store.list()).length, 1);
  assert.equal(boot.document.state.name, 'Standaard project');
  assert.deepEqual(boot.document.state.students, seed.state.students);
  assert.equal(boot.document.state.rooms.length, seed.state.rooms.length);
  assert.equal(boot.document.plans.length, 0);
  assert.equal(boot.document.lists.length, 0);
});

test('restarting or upgrading preserves edited projects and the selected project without rereading the seed', async t => {
  const store = await workspace(t);
  await initializeInstalledWorkspace({ store, isPackaged: true, seedFile });
  const created = await store.createEmpty({ name: 'Eigen project' });
  const before = await fs.readFile(created.file, 'utf8');
  await initializeInstalledWorkspace({ store, isPackaged: true, seedFile: 'missing-seed.json' });
  assert.equal((await store.startup()).document.id, created.document.id);
  assert.equal(await fs.readFile(created.file, 'utf8'), before);
  assert.equal((await store.list()).length, 2);
});

test('source runs leave initialization and existing storage behavior to the renderer', async t => {
  const store = await workspace(t);
  await initializeInstalledWorkspace({ store, isPackaged: false, seedFile: 'missing-seed.json' });
  assert.equal((await store.startup()).document, null);
  assert.deepEqual(await fs.readdir(store.directory), []);
});

test('a missing installed seed fails explicitly without creating substitute projects', async t => {
  const store = await workspace(t);
  await assert.rejects(initializeInstalledWorkspace({ store, isPackaged: true, seedFile: path.join(store.directory, 'missing.json') }), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(store.directory), []);
});
