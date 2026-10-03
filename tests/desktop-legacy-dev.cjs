const {app}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'artifacts',`legacy-dev-profile-${process.pid}`);
app.setPath('userData',profile);app.disableHardwareAcceleration();
process.env.KLASLOKAAL_PROJECT_DIR=path.join(profile,'projects');
const enabled=process.env.KLASLOKAAL_DEV_MODE==='True';
app.on('browser-window-created',(_event,win)=>{
  win.hide();
  win.webContents.once('did-finish-load',async()=>{
    try {
      const js=code=>win.webContents.executeJavaScript(code);
      const wait=expression=>js(`new Promise((resolve,reject)=>{const deadline=Date.now()+8000;function check(){if(${expression})return resolve();if(Date.now()>deadline)return reject(Error('Legacy timeout'));setTimeout(check,25);}check();})`);
      await wait("document.querySelector('#capacity').textContent");
      assert.equal(await js('Boolean(window.desktop.projects)'),false);
      assert.equal(await js('Boolean(window.desktop.resetToDefaults)'),false);
      assert.equal(await js("Boolean(document.querySelector('#reset-default-project'))"),false);
      assert.equal(await js("Boolean(document.querySelector('#developer-project-storage'))"),enabled);
      const before=await js("localStorage.getItem('klaslokaal-v1')");assert.ok(before);
      if(enabled){
        await wait("document.querySelector('#developer-project-storage').textContent.includes('Niet gebruikt in legacy-modus')");
        const info=await js('window.desktop.developerInfo()');
        assert.equal(info.storageBackend,'localStorage');
        assert.equal(info.storagePath,path.join(win.webContents.session.getStoragePath(),'Local Storage','leveldb'));
        assert.equal(info.projectDirectory,process.env.KLASLOKAAL_PROJECT_DIR);
        const text=await js("document.querySelector('#developer-project-storage').textContent");
        for(const value of ['Legacy localStorage','Niet gebruikt in legacy-modus',info.storagePath,'Oude localStorage blijft behouden.'])assert.ok(text.includes(value),value);
      }
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Legacycontrole';document.querySelector('#save-submit').click()");
      assert.equal(await js("JSON.parse(localStorage.getItem('klaslokaal-v1')).name"),'Legacycontrole');
      if(enabled){
        assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'saved');
        await js("Storage.prototype.setItem=function(){throw new DOMException('Testopslag vol','QuotaExceededError')};document.querySelector('#save').click();document.querySelector('#plan-name').value='Niet bewaard';document.querySelector('#save-submit').click()");
        assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'error');
        assert.ok((await js("document.querySelector('#developer-project-storage').textContent")).includes('QuotaExceededError'));
        assert.equal(await js("JSON.parse(localStorage.getItem('klaslokaal-v1')).name"),'Legacycontrole');
      }
      console.log(`Legacy developer mode ${enabled}: storage mode, paths, unavailable template, diagnostics visibility and saves passed.`);
      app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
  });
});
require('../desktop/desktop.cjs');
