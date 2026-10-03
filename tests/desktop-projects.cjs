// Exercise the production desktop entrypoint and isolated preload with real files.
const {app}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {ProjectStore}=require('../desktop/project-store.cjs');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),profile=path.join(require('node:os').tmpdir(),`zitplanner-projects-${process.pid}-${randomUUID()}`);
process.env.KLASLOKAAL_PROJECT_DIR=path.join(profile,'projects');
app.setPath('userData',profile);app.disableHardwareAcceleration();
const enabled=process.env.KLASLOKAAL_DEV_MODE?.toLowerCase()==='true';
let failSave=false,saveGate=null;
const originalSave=ProjectStore.prototype.save;
ProjectStore.prototype.save=function(document){return failSave?Promise.reject(Error('Testopslag vol')):saveGate?saveGate.then(()=>originalSave.call(this,document)):originalSave.call(this,document);};
app.on('browser-window-created',(_event,win)=>{
  win.hide();
  win.webContents.setBackgroundThrottling(false);
  win.webContents.once('did-finish-load',async()=>{
    const js=code=>win.webContents.executeJavaScript(code);
    const wait=expression=>js(`new Promise((resolve,reject)=>{const deadline=Date.now()+8000;function check(){if(${expression})return resolve();if(Date.now()>deadline)return reject(Error('Desktop timeout'));setTimeout(check,25);}check();})`);
    const ready=()=>wait("document.querySelector('#capacity').textContent");
    const saved=()=>wait("!document.querySelector('#modal').open&&document.querySelector('.local-label').textContent==='Automatisch opgeslagen'");
    const boot=()=>js('window.desktop.projects.startup()');
    let stage='startup';
    try {
      await ready();await wait("document.querySelector('.local-label').textContent==='Automatisch opgeslagen'");
      assert.equal(await js('window.desktop.developerMode'),enabled);
      assert.equal(await js("typeof window.desktop.developerInfo==='function'"),enabled);
      assert.equal(await js("Boolean(document.querySelector('#developer-details'))"),enabled);
      assert.equal(await js("Boolean(document.querySelector('#developer-project-storage'))"),enabled);
      assert.equal(await js("localStorage.getItem('klaslokaal-v1')"),null);
      const initial=await boot(),id=initial.document.id;
      assert.ok(initial.file.startsWith(process.env.KLASLOKAAL_PROJECT_DIR));
      assert.equal(initial.document.state.students.length,48);
      assert.deepEqual(initial.document.state.assignments,{});
      assert.ok(initial.document.state.rooms.every(room=>!Object.keys(room.assignments).length));
      if(enabled){
        await wait("document.querySelector('#developer-project-storage').textContent.includes('default-layout.json')");
        const info=await js('window.desktop.developerInfo()');
        assert.equal(info.storagePath,process.env.KLASLOKAAL_PROJECT_DIR);assert.equal(info.storageBackend,'project-files');
        assert.equal(info.projectDirectory,process.env.KLASLOKAAL_PROJECT_DIR);
        assert.equal(info.defaultLayout.file,path.join(info.projectDirectory,'default-layout.json'));assert.equal(info.defaultLayout.available,true);
        assert.equal(info.legacyBackup.hasSave,false);
        const text=await js("document.querySelector('#developer-project-storage').textContent");
        for(const value of [initial.file,id,initial.document.state.name,'1 lokaaltab','Legacykopie bevat geen eerdere opslag'])assert.ok(text.includes(value),value);
        assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'saved');
        const size=(await fs.stat(initial.file)).size;
        assert.ok(text.includes(`${(size/1024).toFixed(1)} KiB opgeslagen`));
        assert.ok(text.includes(new Date(initial.document.modified).toLocaleString('nl-BE')));
      }
      const {duplicateRoom,switchRoom}=await import('../src/rooms.mjs');
      const {emptyProjectState}=await import('../src/project-session.mjs');
      const legacy=JSON.stringify(initial.document.state);
      const fixture=initial.document.state,copy=duplicateRoom(fixture,fixture.activeRoomId,'Mijn tweede lokaal');switchRoom(fixture,copy.id);
      const backend=new ProjectStore(process.env.KLASLOKAAL_PROJECT_DIR);
      await backend.save({...initial.document,state:fixture});await backend.setTemplate(emptyProjectState(fixture));
      await js(`localStorage.setItem('klaslokaal-v1',${JSON.stringify(legacy)})`);
      await fs.writeFile(path.join(backend.directory,'legacy-backup.json'),JSON.stringify({'klaslokaal-v1':legacy}));
      await win.loadFile(path.join(root,'src','index.html'));await ready();
      assert.equal(await js("document.querySelectorAll('[data-layout-open]').length"),2);
      assert.equal((await boot()).document.state.activeRoomId,copy.id);
      if(enabled){
        await wait("document.querySelector('#developer-project-storage').textContent.includes('2 lokaaltabs')");
        await wait("document.querySelector('#developer-project-storage').textContent.includes('Legacykopie bewaard')");
        const info=await js('window.desktop.developerInfo()');
        assert.equal(info.legacyBackup.rooms,1);
        assert.ok((await js("document.querySelector('#developer-project-storage').textContent")).includes('1 lokaaltab in kopie'));
        assert.equal(info.defaultLayout.rooms,2);
      }
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Devcontrole';document.querySelector('#save-submit').click()");await saved();
      const before=(await boot()).document;
      assert.equal(before.state.name,'Devcontrole');assert.equal(Object.hasOwn(before.state,'developerMode'),false);
      for(const flag of ['developerStorage','developerInfo','DEVELOPER_MODE'])assert.equal(Object.hasOwn(before.state,flag),false);
      await win.loadFile(path.join(root,'src','index.html'));await ready();
      assert.equal(await js("document.querySelector('#plan-heading').textContent"),'Devcontrole');
      assert.deepEqual((await boot()).document.state.rooms,before.state.rooms);
      await js("document.querySelector('#open-plans').click()");await wait("document.querySelector('#new-project')");
      await js("document.querySelector('#new-project').click();document.querySelector('#new-project-name').value='Tweede project';document.querySelector('#save-submit').click()");await saved();
      const next=await boot();assert.notEqual(next.document.id,id);assert.equal(next.document.state.students.length,0);
      if(enabled){const text=await js("document.querySelector('#developer-project-storage').textContent");assert.ok(text.includes(next.file));assert.ok(text.includes(next.document.id));assert.ok(text.includes('Tweede project'));}
      assert.deepEqual(next.document.state.rooms.map(r=>r.layout),before.state.rooms.map(r=>r.layout));
      assert.equal(next.document.state.activeRoomId,copy.id);
      await win.loadFile(path.join(root,'src','index.html'));await ready();assert.equal(await js("document.querySelector('#plan-heading').textContent"),'Tweede project');
      await js("document.querySelector('#open-plans').click()");await wait("document.querySelector('[data-open-project]')");
      await js(`document.querySelector('[data-open-project="${id}"]').click()`);await saved();
      assert.equal((await boot()).document.state.students.length,48);
      // Hold a real save so pending status and switching's save barrier are observable.
      let releaseSave;saveGate=new Promise(resolve=>{releaseSave=resolve;});
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Devcontrole';document.querySelector('#save-submit').click()");
      await wait("document.querySelector('.local-label').textContent==='Bezig met opslaan…'");
      if(enabled){
        await js("document.querySelector('#developer-project-storage').open=false");
        await js("document.querySelector('#warnings-check').click()");
        assert.equal(await js("document.querySelector('#developer-project-storage').open"),false);
        assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'pending');
        assert.ok((await js("document.querySelector('#developer-project-storage summary').textContent")).includes('Opslaan…'));
        assert.ok((await js("document.querySelector('#developer-project-storage').textContent")).includes('te schrijven'));
      }
      await js("document.querySelector('#open-plans').click()");
      assert.equal(await js("Boolean(document.querySelector('#new-project'))"),false);
      saveGate=null;releaseSave();
      await wait("document.querySelector('#new-project')");
      await js("document.querySelector('#modal [data-close]').click()");
      if(enabled)assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'saved');
      failSave=true;
      stage='write failure';
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Retry project';document.querySelector('#save-submit').click()");
      await wait("document.querySelector('.local-label').textContent.startsWith('Bewaren mislukt')");
      assert.equal((await boot()).document.state.name,'Devcontrole');
      if(enabled){assert.ok((await js("document.querySelector('#developer-details').textContent")).includes('Testopslag vol'));assert.equal(await js("document.querySelector('#developer-project-storage').dataset.status"),'error');}
      stage='write retry';failSave=false;await js("document.querySelector('#save-submit').click()");await saved();
      assert.equal(await js("localStorage.getItem('klaslokaal-v1')"),legacy);
      stage='student deletion';
      const {starterFixture}=await import('./starter-fixture.mjs'),removal=starterFixture();
      removal.state.rules.push({id:'related',type:'separate',students:['q','r'],priority:'Voorkeur'});
      const active=(await boot()).document;await backend.save({...active,state:removal.state,plans:removal.plans,lists:removal.lists});
      await win.loadFile(path.join(root,'src','index.html'));await ready();await wait("document.querySelector('.local-label').textContent==='Automatisch opgeslagen'");
      await js("document.querySelector('[data-tab=students]').click()");
      const deletionBefore=(await boot()).document;
      await js("document.querySelector('[data-delete-student=\"r\"]').click()");
      assert.ok((await js("document.querySelector('#modal-content').textContent")).includes('Testleerling 3'));
      assert.equal((await boot()).document.state.students.length,3);
      await js("document.querySelector('#modal [data-close]').click()");assert.deepEqual((await boot()).document,deletionBefore);
      await js("document.querySelector('[data-delete-student=\"r\"]').click();document.querySelector('#delete-student-confirm').click()");await saved();
      const removed=(await boot()).document;
      assert.deepEqual(removed.state.students.map(p=>p.id),['p','q']);assert.equal(removed.state.studentRooms.r,undefined);
      assert.ok(removed.state.rooms.every(room=>!Object.values(room.assignments).includes('r')&&!room.locks.includes('r')));
      assert.ok(removed.state.rules.every(rule=>!rule.students.includes('r')));assert.ok(removed.state.rules.some(rule=>rule.id==='fixed-p'));
      assert.equal(removed.state.weeklyPlans,undefined);assert.deepEqual(removed.lists,removal.lists);assert.deepEqual(removed.plans,removal.plans);
      await js("document.querySelector('#undo').click()");await saved();
      assert.deepEqual((await boot()).document.state.rooms,deletionBefore.state.rooms);assert.ok((await boot()).document.state.weeklyPlans);
      await js("document.querySelector('#redo').click()");await saved();
      await win.loadFile(path.join(root,'src','index.html'));await ready();await js("document.querySelector('[data-tab=students]').click()");
      assert.equal((await boot()).document.state.students.length,2);
      await js("document.querySelector('[data-action=clear]').click()");assert.equal((await boot()).document.state.students.length,2);
      await js("document.querySelector('#modal [data-close]').click()");assert.equal((await boot()).document.state.students.length,2);
      await js("document.querySelector('[data-action=clear]').click();document.querySelector('#clear-list-confirm').click()");await saved();
      const cleared=(await boot()).document;assert.equal(cleared.state.students.length,0);assert.deepEqual(cleared.state.rules,[]);
      assert.deepEqual(cleared.state.studentRooms,{});assert.ok(cleared.state.rooms.every(room=>!Object.keys(room.assignments).length&&!room.locks.length));
      assert.deepEqual(cleared.lists,removal.lists);assert.deepEqual(cleared.plans,removal.plans);
      await js("document.querySelector('#undo').click()");await saved();assert.equal((await boot()).document.state.students.length,2);
      assert.equal(await js("localStorage.getItem('klaslokaal-v1')"),legacy);
      console.log('Student removal: individual/whole-list confirmation and cancel, cleanup across rooms/rules/pins/week, retained lists/plans/legacy, undo/redo and restart passed.');
      stage='screenshot';
      if(enabled){
        await js("document.querySelector('#developer-project-storage').open=true;document.querySelector('.right-sidebar').scrollTop=document.querySelector('.right-sidebar').scrollHeight");
        // Hidden Windows surfaces may need another compositor frame; never wait on hidden RAF.
        for(let attempt=0;attempt<3;attempt++){
          await new Promise(resolve=>setTimeout(resolve,150));
          try {await fs.writeFile(path.join(root,'artifacts','developer-mode.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());break;}
          catch(error){if(attempt===2)throw error;}
        }
      }
      app.removeAllListeners('window-all-closed');
      stage='close flush';
      const closed=new Promise(resolve=>win.once('closed',resolve));
      saveGate=new Promise(resolve=>{releaseSave=resolve;});
      await js("document.querySelector('#save').click();document.querySelector('#plan-name').value='Saved on close';document.querySelector('#save-submit').click()");
      win.close();assert.equal(win.isDestroyed(),false);saveGate=null;releaseSave();await closed;
      assert.equal((await backend.startup()).document.state.name,'Saved on close');
      assert.equal(await fs.readFile(path.join(backend.directory,'legacy-backup.json'),'utf8'),JSON.stringify({'klaslokaal-v1':legacy}));
      console.log(`Developer mode ${process.env.KLASLOKAAL_DEV_MODE??'(unset)'}: disk autosave, two room tabs, new/open/restart, write failure and close flush passed.`);
      app.exit(0);
    }catch(error){console.error(`Projectcontrole: ${stage}`,error);app.exit(1);}
  });
});
require('../desktop/desktop.cjs');
