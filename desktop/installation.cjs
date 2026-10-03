const path = require('node:path');
const fs = require('node:fs/promises');

function projectDirectory({ isPackaged, userData, projectRoot, override }) {
  return override || path.join(isPackaged ? userData : projectRoot, 'projects');
}

async function initializeInstalledWorkspace({ store, isPackaged, seedFile }) {
  if (!isPackaged) return;
  const existing = await store.startup();
  if (existing.document) return;
  const seed = JSON.parse(await fs.readFile(seedFile, 'utf8'));
  await store.bootstrap(seed);
}

module.exports = { projectDirectory, initializeInstalledWorkspace };
