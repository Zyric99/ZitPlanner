const { contextBridge, ipcRenderer } = require('electron');
const developerMode = process.argv.includes('--klaslokaal-dev-mode');
let beforeClose=()=>{};
if(process.argv.includes('--klaslokaal-project-files'))ipcRenderer.on('project-before-close',()=>Promise.resolve().then(()=>beforeClose()).then(()=>ipcRenderer.send('project-close-ready',null),error=>ipcRenderer.send('project-close-ready',error.message)));
const projects=process.argv.includes('--klaslokaal-project-files')?{
  ...Object.fromEntries(['startup','bootstrap','save','list','load','activate','create','createEmpty','duplicate','rename','resetPreview','reset','delete'].map(method=>[method,payload=>ipcRenderer.invoke(`project-${method}`,payload)])),
  onBeforeClose:callback=>{beforeClose=callback;},
}:undefined;
contextBridge.exposeInMainWorld('desktop', { exportPDF: name => ipcRenderer.invoke('export-pdf', name), print: () => ipcRenderer.invoke('print-plan'), developerMode, ...(projects?{projects}:{}), ...(developerMode ? { developerInfo: () => ipcRenderer.invoke('developer-info') } : {}) });
