const {app}=require('electron');
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'artifacts',`legacy-check-${process.pid}`));
process.env.KLASLOKAAL_LEGACY_STORAGE='True';
app.disableHardwareAcceleration();
app.on('browser-window-created',(_event,win)=>{
  win.hide();win.webContents.once('did-finish-load',async()=>{
    try {
      const js=code=>win.webContents.executeJavaScript(code);
      await js("new Promise((resolve,reject)=>{const deadline=Date.now()+8000;function check(){if(document.querySelector('#capacity').textContent)return resolve();if(Date.now()>deadline)return reject(Error('Legacy startup timeout'));setTimeout(check,25);}check();})");
      assert.equal(await js('window.desktop.projects'),undefined);
      assert.equal(await js("document.querySelector('#save').textContent"),'Plan bewaren');
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Legacy remains available';document.querySelector('#save-submit').click()");
      assert.equal(await js("JSON.parse(localStorage.getItem('klaslokaal-v1')).name"),'Legacy remains available');
      assert.equal(await js("JSON.parse(localStorage.getItem('klaslokaal-v1-plans'))[0].state.name"),'Legacy remains available');
      console.log('Legacy storage: original autosave and named-plan logic remain available.');app.exit(0);
    }catch(error){console.error(error);app.exit(1);}
  });
});
require('../desktop/desktop.cjs');
