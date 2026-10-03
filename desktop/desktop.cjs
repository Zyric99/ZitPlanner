const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { ProjectWorkspace } = require('./project-workspace.cjs');
const { projectDirectory, initializeInstalledWorkspace } = require('./installation.cjs');
const projectRoot = path.resolve(__dirname, '..');
// Source runs retain their old profile; installed builds use a stable AppData folder.
const storageProfile=app.isPackaged?path.resolve(app.commandLine.getSwitchValue('user-data-dir')||path.join(app.getPath('appData'),'Zitplanner')):app.getPath('userData');
mkdirSync(storageProfile,{recursive:true});
app.setName('Zitplanner');
app.setPath('userData',storageProfile);
const appId='be.klaslokaal.desktop';
const appIcon=path.join(projectRoot,'assets',process.platform==='win32'?'klaslokaal.ico':'klaslokaal.png');
if(process.platform==='win32')app.setAppUserModelId(appId);
const projectStore=new ProjectWorkspace(projectDirectory({isPackaged:app.isPackaged,userData:storageProfile,projectRoot,override:process.env.KLASLOKAAL_PROJECT_DIR}));
const PROJECT_FILES=process.env.KLASLOKAAL_LEGACY_STORAGE?.toLowerCase()!=='true';
const DEVELOPER_MODE = process.env.KLASLOKAAL_DEV_MODE?.toLowerCase() === 'true';
const developerArguments = [...(PROJECT_FILES?['--klaslokaal-project-files']:[]),...(DEVELOPER_MODE ? ['--klaslokaal-dev-mode'] : [])];
let mainWindow;
let closing=false;
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
app.on('browser-window-created',(_event,win)=>{
  win.setIcon(appIcon);
  if(process.platform==='win32')win.setAppDetails({appId,appIconPath:appIcon,appIconIndex:0,relaunchCommand:app.isPackaged?`"${process.execPath}"`:`"${process.execPath}" "${projectRoot}"`,relaunchDisplayName:'Zitplanner'});
  closing=false;
  win.on('close',event=>{if(!PROJECT_FILES||closing||!ownsInstance)return;event.preventDefault();win.webContents.send('project-before-close');});
});
ipcMain.on('project-close-ready',async(event,error)=>{
  if(event.sender!==mainWindow?.webContents)return;
  if(error){dialog.showErrorBox('Project niet opgeslagen','Sluiten is gestopt omdat opslaan niet is gelukt. Probeer opnieuw of exporteer een projectbestand.');return;}
  await projectStore.queue;closing=true;mainWindow.close();
});
for(const method of ['startup','bootstrap','save','list','load','activate','create','createEmpty','duplicate','rename','resetPreview','reset','delete']) {
  ipcMain.handle(`project-${method}`,(event,payload)=>{
    if(!PROJECT_FILES||event.sender!==mainWindow?.webContents)throw Error('Geen toegang tot projectopslag.');
    return projectStore[method](payload);
  });
}
app.whenReady().then(async () => {
  if(!ownsInstance)return;
  if(PROJECT_FILES)await projectStore.cleanupBackups().catch(error=>console.warn('Oude projectbackups konden niet worden opgeruimd:',error.message));
  if(PROJECT_FILES)await initializeInstalledWorkspace({store:projectStore,isPackaged:app.isPackaged,seedFile:path.join(projectRoot,'defaults','standaard-project.json')});
  mainWindow = new BrowserWindow({ width: 1600, height: 1000, minWidth: 1100, minHeight: 720, title: 'Zitplanner', icon:appIcon, backgroundColor: '#f4f6f5', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: developerArguments } });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Exportbestand opslaan', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  mainWindow.loadFile(path.join(projectRoot, 'src', 'index.html'));
}).catch(error=>{
  dialog.showErrorBox('Zitplanner starten mislukt',`De projectopslag kon niet worden geopend.\n${error.message}`);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { mainWindow = new BrowserWindow({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, additionalArguments: developerArguments } }); mainWindow.loadFile(path.join(projectRoot, 'src', 'index.html')); } });
ipcMain.handle('developer-info', async event => {
  if(event.sender!==mainWindow?.webContents)throw Error('Geen toegang tot ontwikkelaarsinformatie.');
  if(!DEVELOPER_MODE)return null;
  return {
  electron: process.versions.electron,
  node: process.versions.node,
  storagePath: PROJECT_FILES?projectStore.directory:path.join(mainWindow.webContents.session.getStoragePath(),'Local Storage','leveldb'),
  storageBackend: PROJECT_FILES?'project-files':'localStorage',
  ...await projectStore.diagnostics(),
  };
});
ipcMain.handle('export-pdf', async (_, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, { title: 'Indeling als PDF opslaan', defaultPath: `${path.basename(suggestedName)}.pdf`, filters: [{ name: 'PDF-document', extensions: ['pdf'] }] });
  if (result.canceled) return false;
  const bytes = await mainWindow.webContents.printToPDF({ landscape: true, pageSize: 'A3', printBackground: true, preferCSSPageSize: true });
  await fs.writeFile(result.filePath, bytes); return true;
});
ipcMain.handle('print-plan', () => new Promise(resolve => mainWindow.webContents.print({ silent: false, landscape: true, printBackground: true }, success => resolve(success))));
