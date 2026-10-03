const {app}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ProjectStore}=require('../desktop/project-store.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'artifacts',`default-set-profile-${process.pid}`);
app.setPath('userData',profile);app.disableHardwareAcceleration();
process.env.KLASLOKAAL_PROJECT_DIR=path.join(profile,'projects');
delete process.env.KLASLOKAAL_LEGACY_STORAGE;
const backend=new ProjectStore(process.env.KLASLOKAAL_PROJECT_DIR),defaultFile=path.join(backend.directory,'default-layout.json');
let originalId,mainId;
(async()=>{
  const {defaults,enabledSeats}=await import('../src/engine.mjs');
  const {initializeRooms,newRoom,captureRoom}=await import('../src/rooms.mjs');
  const {factoryDefaultSet}=await import('../src/default-set.mjs');
  const source=initializeRooms(defaults()),second=newRoom(source,'Computerlokaal','computer');mainId=source.activeRoomId;
  source.participatingRooms.push(second.id);source.settings.studentRulesEnabled=true;
  source.settings.layout.benches.find(b=>b.id==='grid-A1').capacity=1;
  source.students=['p','q','r'].map((id,i)=>({id,name:`Leerling ${i}`,class:i===2?'2C':'1A',year:i===2?'2':'1',absent:false}));
  source.studentRooms={p:mainId,q:mainId,r:second.id};source.assignments={'grid-A1:0':'p'};source.locks=['p'];
  const seat=enabledSeats({...source.settings,...second.settings,layout:second.layout})[0];second.assignments={[seat]:'r'};second.locks=['r'];
  captureRoom(source);
  const lists=[{id:'list',name:'Bewaarde lijst',students:structuredClone(source.students)}];
  const boot=await backend.bootstrap({state:source,plans:[],lists,template:factoryDefaultSet()});originalId=boot.document.id;
  app.on('browser-window-created',(_event,win)=>{
    win.hide();win.webContents.setBackgroundThrottling(false);win.webContents.once('did-finish-load',async()=>{
      const js=code=>win.webContents.executeJavaScript(code);
      const wait=expression=>js(`new Promise((resolve,reject)=>{const end=Date.now()+10000;function check(){if(${expression})return resolve();if(Date.now()>end)return reject(Error('Default set timeout: '+${JSON.stringify(expression)}));setTimeout(check,25);}check();})`);
      const ready=()=>wait("document.querySelector('#capacity').textContent&&document.querySelector('.local-label').textContent==='Automatisch opgeslagen'");
      const projects=async()=>{await js("document.querySelector('#open-plans').click()");await wait("document.querySelector('#save-default-set')");};
      const saved=()=>wait("document.querySelector('.local-label').textContent==='Automatisch opgeslagen'");
      const document=async()=>(await backend.startup()).document;
      try {
        await ready();const file=(await backend.startup()).file,before=await fs.readFile(file,'utf8');
        await projects();await js("document.querySelector('#save-default-set').click()");
        assert.equal(await js("document.querySelectorAll('[data-default-room]').length"),2);
        await js("document.querySelectorAll('[data-default-room]').forEach(input=>{input.checked=false;input.dispatchEvent(new Event('change'));})");
        assert.equal(await js("document.querySelector('#default-set-confirm').disabled"),true);
        await js("document.querySelectorAll('[data-default-room]').forEach(input=>{input.checked=true;input.dispatchEvent(new Event('change'));});document.querySelector('#default-set-confirm').click()");
        await wait("!document.querySelector('#modal').open&&document.querySelector('#toast').textContent.includes('Standaardset bewaard')");
        assert.equal(await fs.readFile(file,'utf8'),before);
        const savedDefault=await fs.readFile(defaultFile,'utf8');
        assert.equal(JSON.parse(savedDefault).rooms.length,2);assert.equal(JSON.parse(savedDefault).students.length,0);
        // Make the current project differ from the saved set, including a weekly plan.
        const {generateWeek,applyWeeklyDay}=await import('../src/weekly-planner.mjs');
        const current=await document(),edited=current.state;
        edited.settings.layout.benches.find(b=>b.id==='grid-A1').capacity=2;captureRoom(edited);
        const extra=newRoom(edited,'Tijdelijk lokaal','small'),extraSeat=enabledSeats({...edited.settings,...extra.settings,layout:extra.layout})[0];
        edited.rooms[1].assignments={};edited.rooms[1].locks=[];extra.assignments={[extraSeat]:'r'};extra.locks=['r'];
        edited.studentRooms.r=extra.id;edited.classRooms={'1A':mainId,'2C':extra.id};edited.participatingRooms.push(extra.id);
        edited.assignments={'grid-A1:0':'p','grid-A1:1':'q'};edited.locks=['p','q'];edited.rules=[{id:'fixed-r',type:'fixed',students:['r'],roomId:extra.id,seat:extraSeat,priority:'Verplicht'}];captureRoom(edited);
        edited.weeklyPlans=generateWeek(edited,{iterations:0});applyWeeklyDay(edited,'maandag');
        await backend.save({...current,state:edited});await win.loadFile(path.join(root,'src','index.html'));await ready();
        const original=(await document()).state;
        // A failed save of new defaults preserves the prior custom default.
        await fs.rm(`${defaultFile}.bak`,{force:true});await fs.mkdir(`${defaultFile}.bak`);
        await projects();await js("document.querySelector('#save-default-set').click();document.querySelector('#default-set-confirm').click()");
        await wait("document.querySelector('#default-set-error').textContent");
        assert.equal(await fs.readFile(defaultFile,'utf8'),savedDefault);
        await js("document.querySelector('#modal [data-close]').click()");await fs.rm(`${defaultFile}.bak`,{recursive:true,force:true});
        await projects();await js("document.querySelector('#restore-default-set').click()");
        assert.ok((await js("document.querySelector('#modal-content').textContent")).includes('Tijdelijk lokaal'));
        assert.ok((await js("document.querySelector('#modal-content').textContent")).includes('weekindeling vervalt'));
        await js('new Promise(resolve=>setTimeout(resolve,200))');
        try{await fs.writeFile(path.join(root,'artifacts','default-set-reset-preview.png'),(await win.webContents.capturePage()).toPNG());}catch(error){console.log('Reset preview capture unavailable: '+error.message);}
        await js("document.querySelector('#default-set-confirm').click()");await saved();
        const reset=(await document()).state;
        assert.equal(reset.rooms.length,2);assert.deepEqual(reset.students,original.students);
        assert.deepEqual(reset.assignments,{'grid-A1:0':'p'});assert.deepEqual(reset.locks,[]);assert.equal(reset.rules.find(r=>r.type==='fixed'&&r.students[0]==='p').seat,'grid-A1:0');assert.equal(reset.studentRooms.r,null);
        assert.equal(reset.weeklyPlans,undefined);assert.equal(reset.rules.find(r=>r.id==='fixed-r').roomId,extra.id);assert.ok(reset.rules.find(r=>r.id==='fixed-r').positionCode);
        assert.deepEqual((await document()).lists,lists);
        await js("document.querySelector('#undo').click()");await saved();
        const undone=(await document()).state;
        for(const field of ['rooms','students','rules','studentRooms','classRooms','weeklyPlans'])assert.deepEqual(undone[field],original[field]);
        await js("document.querySelector('#redo').click()");await saved();
        assert.deepEqual((await document()).state.rooms,reset.rooms);
        await win.loadFile(path.join(root,'src','index.html'));await ready();assert.equal((await document()).state.rooms.length,2);
        // Factory restore affects the project, never the custom default file.
        await projects();await js("document.querySelector('#restore-factory-set').click();document.querySelector('#default-set-confirm').click()");await saved();
        assert.equal((await document()).state.rooms.length,1);assert.equal((await document()).state.students.length,3);
        assert.equal(await fs.readFile(defaultFile,'utf8'),savedDefault);
        await js("document.querySelector('#undo').click()");await saved();assert.equal((await document()).state.rooms.length,2);
        await projects();await js("document.querySelector('#new-project').click();document.querySelector('#new-project-name').value='Van standaardset';document.querySelector('#save-submit').click()");
        await wait("!document.querySelector('#modal').open&&document.querySelector('#plan-heading').textContent==='Van standaardset'");await saved();
        const fresh=await document();assert.notEqual(fresh.id,originalId);assert.equal(fresh.state.students.length,0);assert.equal(fresh.state.rooms.length,2);assert.deepEqual(fresh.state.rooms.map(r=>r.layout),JSON.parse(savedDefault).rooms.map(r=>r.layout));
        console.log('Default set UI: selection/save, failure protection, reset preview, pupils/lists, seat cleanup, weekly Undo/Redo, restart, factory restore and new project passed.');app.exit(0);
      }catch(error){console.error(error);app.exit(1);}
    });
  });
  require('../desktop/desktop.cjs');
})().catch(error=>{console.error(error);app.exit(1);});
