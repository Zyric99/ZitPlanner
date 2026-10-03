// Compile the production NSIS extension into a harness using isolated profiles.
// No actual Windows account's AppData or installation registry is modified.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
const root = path.resolve(__dirname, '..');
const nsisString = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

(async () => {
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const folder = await fs.mkdtemp(path.join(artifacts, 'uninstaller-test-'));
  const appData = path.join(folder, 'profile'), appProfile = path.join(appData, 'Zitplanner');
  assert.ok(folder.startsWith(artifacts + path.sep));
  const generator = path.join(folder, 'create-uninstaller.exe'), uninstaller = path.join(folder, 'uninstaller.exe');
  const script = [
    'Unicode true',
    'RequestExecutionLevel user',
    'SilentInstall silent',
    'SilentUnInstall silent',
    'Name "Zitplanner uninstaller test"',
    'OutFile "' + nsisString(generator) + '"',
    '!include "LogicLib.nsh"',
    '!include "FileFunc.nsh"',
    '!define BUILD_UNINSTALLER',
    'Var installMode',
    'Var testIsUpdated',
    '!macro _isUpdated _a _b _t _f',
    '  StrCmp $testIsUpdated "1" `${_t}` `${_f}`',
    '!macroend',
    '!define isUpdated `"" isUpdated ""`',
    '!include "' + nsisString(path.join(root, 'build', 'installer.nsh')) + '"',
    'Section "Generate"',
    '  WriteUninstaller "' + nsisString(uninstaller) + '"',
    'SectionEnd',
    'Function un.onInit',
    '  StrCpy $installMode "CurrentUser"',
    '  StrCpy $testIsUpdated "0"',
    '  ${GetParameters} $R0',
    '  ClearErrors',
    '  ${GetOptions} $R0 "--updated" $R1',
    '  ${IfNot} ${Errors}',
    '    StrCpy $testIsUpdated "1"',
    '  ${EndIf}',
    '  !insertmacro customUnInit',
    '  Call un.ForceCheckComponent',
    '  ; Only the harness substitutes an isolated AppData parent.',
    '  StrCpy $zitplannerDataRoot "' + nsisString(appData) + '"',
    '  Call un.RecordSelection',
    'FunctionEnd',
    'Section "un.Zitplanner verwijderen"',
    '  SectionIn RO',
    'SectionEnd',
    '!insertmacro customUnInstallSection',
    'Function un.ForceCheckComponent',
    '  ; Simulate a user checking the component after initialization.',
    '  ${GetParameters} $R0',
    '  ClearErrors',
    '  ${GetOptions} $R0 "--force-check-component" $R1',
    '  ${IfNot} ${Errors}',
    '    SectionGetFlags ${ZITPLANNER_DELETE_DATA_SECTION} $R1',
    '    IntOp $R1 $R1 | ${SF_SELECTED}',
    '    SectionSetFlags ${ZITPLANNER_DELETE_DATA_SECTION} $R1',
    '  ${EndIf}',
    'FunctionEnd',
    'Function un.RecordSelection',
    '  SectionGetFlags ${ZITPLANNER_DELETE_DATA_SECTION} $R0',
    '  IntOp $R0 $R0 & ${SF_SELECTED}',
    '  FileOpen $R1 "' + nsisString(path.join(folder, 'selection.txt')) + '" w',
    '  FileWrite $R1 "$R0"',
    '  FileClose $R1',
    'FunctionEnd',
  ].join('\r\n');
  const scriptFile = path.join(folder, 'harness.nsi');
  await fs.writeFile(scriptFile, script);
  const tool = await getMakeNsisPath();
  function run(file, args = [], env = process.env) {
    const result = spawnSync(file, args, { env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  }
  run(tool.path, ['/V2', scriptFile], { ...process.env, ...tool.env });
  run(generator, ['/S']);
  const project = path.join(appProfile, 'projects', 'project.json');
  const otherProfile = path.join(appData, 'AnotherApp', 'keep.txt');
  const legacyProfile = path.join(appData, 'klaslokaal', 'keep.txt');
  async function seed() {
    await fs.mkdir(path.dirname(project), { recursive: true });
    await fs.mkdir(path.join(appProfile, 'projects', 'backups'), { recursive: true });
    await fs.writeFile(project, 'saved project');
    await fs.writeFile(path.join(appProfile, 'projects', 'backups', 'backup.json'), 'backup');
    await fs.writeFile(path.join(appProfile, 'settings.json'), 'settings');
    for (const file of [otherProfile, legacyProfile]) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'preserve'); }
  }
  await seed();
  run(uninstaller, ['/S', '_?=' + folder]);
  assert.equal(await fs.readFile(path.join(folder, 'selection.txt'), 'utf8'), '0');
  assert.equal(await fs.readFile(project, 'utf8'), 'saved project');
  console.log('PASS default component is unchecked and saved projects are retained.');

  run(uninstaller, ['/S', '--delete-zitplanner-data', '_?=' + folder]);
  assert.equal(await fs.readFile(path.join(folder, 'selection.txt'), 'utf8'), '1');
  await assert.rejects(fs.access(appProfile), { code: 'ENOENT' });
  for (const file of [otherProfile, legacyProfile]) assert.equal(await fs.readFile(file, 'utf8'), 'preserve');
  console.log('PASS selecting removal deletes projects, backups and settings, preserving other profiles.');

  await seed();
  run(uninstaller, ['/S', '--updated', '--delete-zitplanner-data', '_?=' + folder]);
  assert.equal(await fs.readFile(path.join(folder, 'selection.txt'), 'utf8'), '0');
  assert.equal(await fs.readFile(project, 'utf8'), 'saved project');
  console.log('PASS upgrades never select data removal even with explicit silent opt-in.');

  run(uninstaller, ['/S', '--updated', '--force-check-component', '_?=' + folder]);
  assert.equal(await fs.readFile(path.join(folder, 'selection.txt'), 'utf8'), '1');
  assert.equal(await fs.readFile(project, 'utf8'), 'saved project');
  console.log('PASS the upgrade guard preserves projects even if the component is checked later.');
})().catch(error => { console.error(error); process.exitCode = 1; });
