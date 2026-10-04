const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, 'artifacts', `rule-audit-profile-${process.pid}`));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message);console.error(event.message); } });
    const js = code => win.webContents.executeJavaScript(code);
    const state = () => js("JSON.parse(localStorage.getItem('klaslokaal-v1'))");
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{
      const e=await import('./engine.mjs'),r=await import('./rooms.mjs');
      const s=r.initializeRooms(e.defaults()),first=s.activeRoomId,second=r.newRoom(s,'Second','classroom').id;
      s.students=[{id:'a',name:'Alice',class:'1A',year:'1',absent:false},{id:'b',name:'Bob',class:'2B',year:'2',absent:false}];
      s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.settings.studentRulesEnabled=true;s.participatingRooms=[first,second];
      s.studentRooms={a:first,b:second};s.assignments={'grid-A1:0':'a'};s.locks=['a'];r.captureRoom(s);
      const room=s.rooms.find(room=>room.id===second);room.assignments={'grid-A1:0':'b'};room.locks=['b'];
      s.rules=[{id:'together',type:'together',students:['a','b'],priority:'Verplicht'}];
      localStorage.setItem('klaslokaal-v1',JSON.stringify(s));
      localStorage.setItem('klaslokaal-v1-lists',JSON.stringify([{id:'reuse',name:'Same IDs',students:s.students}]));
    })()`);
    await win.loadFile(path.join(root,'src','index.html'));
    assert.match(await js("document.querySelector('#warning-list').textContent"), /verschillende lokalen/);
    assert.equal(await js("Number(document.querySelector('#warning-count').textContent)"), 1);
    const second = (await state()).rooms[1].id;
    await js(`document.querySelector('[data-layout-open="${second}"]').click()`);
    assert.match(await js("document.querySelector('#warning-list').textContent"), /verschillende lokalen/);
    // Real saved-list action must clear both room snapshots, including reused IDs.
    await js("document.querySelector('[data-tab=students]').click();document.querySelector('[data-action=lists]').click();document.querySelector('[data-load-list=reuse]').click()");
    let saved = await state();
    assert.equal(saved.students.length, 2);
    assert.deepEqual(saved.rules, []);
    assert.ok(saved.rooms.every(room => !Object.keys(room.assignments).length && !room.locks.length));
    assert.deepEqual(saved.assignments, {});
    // Both unplaced students appear in one grouped warning.
    assert.equal(await js("Number(document.querySelector('#warning-count').textContent)"), 1);
    assert.equal(await js("document.querySelectorAll('#active-warning-list [data-warning-group=unplaced]').length"), 1);
    assert.match(await js("document.querySelector('#active-warning-list').textContent"), /2 leerlingen hebben nog geen geldige zitplaats/);
    assert.deepEqual(await js("Array.from(document.querySelectorAll('[data-unplaced]'), button => button.dataset.unplaced).sort()"), ['a', 'b']);
    // Compact JSON exports must reopen through the actual legacy import input.
    const packed = await js(`(async()=>{const g=await import('./grid-room.mjs');return JSON.stringify({version:1,state:JSON.parse(localStorage.getItem('klaslokaal-v1')),plans:[],lists:[]},(_key,item)=>g.packGridRoom(item));})()`);
    await js(`(()=>{document.querySelector('#open-plans').click();const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(packed)}],'backup.json'));const input=document.querySelector('#project-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));})()`);
    await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#modal').open){clearInterval(timer);resolve();}else if(Date.now()-started>5000){clearInterval(timer);reject(Error(document.querySelector('#toast').textContent));}},20);})`);
    saved = await state();
    assert.equal(saved.students.length, 2);
    assert.equal(saved.rooms.length, 2);
    // A malformed associated record must reject the entire backup, preserving
    // the current project rather than silently importing only its main state.
    const beforeInvalid = saved;
    const malformed = JSON.stringify({ version: 1, state: saved, lists: [{ id: 'broken', name: 'Broken', students: [{}] }] });
    await js(`(()=>{document.querySelector('#open-plans').click();const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(malformed)}],'invalid.json'));const input=document.querySelector('#project-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));})()`);
    await js(`new Promise(resolve=>setTimeout(resolve,100))`);
    assert.deepEqual(await state(), beforeInvalid);
    assert.equal(await js("document.querySelector('#modal').open"), true);
    assert.match(await js("document.querySelector('#toast').textContent"), /geen geldig/);
    await js("document.querySelector('[data-close]').click()");
    // Rule edits invalidate a week and disable its day selector. They must
    // release that day's temporary absences before ordinary generation.
    await js(`(async()=>{
      const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),w=await import('./weekly-planner.mjs');
      const s=r.initializeRooms(e.defaults());s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;
      s.students=[{id:'tuesday',name:'Tuesday pupil',class:'1A',year:'1',absent:false,eveningStudy:{maandag:'Nee',dinsdag:'Ja',donderdag:'Ja',vrijdag:'Ja'}}];
      r.normalizeRooms(s);s.weeklyPlans=w.generateWeek(s,{iterations:30});w.applyWeeklyDay(s,'maandag');
      localStorage.setItem('klaslokaal-v1',JSON.stringify(s));
    })()`);
    await win.loadFile(path.join(root,'src','index.html'));
    assert.equal((await state()).students[0].absent, true);
    await js("document.querySelector('[data-tab=rules]').click();document.querySelector('#class-rules-enabled').click()");
    saved = await state();
    assert.equal(saved.students[0].absent, false);
    assert.equal(saved.weeklyPlans.activeDay, null);
    assert.deepEqual(errors, []);
    console.log('Desktop rule audit passed: cross-room warnings, roster replacement, compact JSON import, invalid backup rejection, weekly edit attendance.');
    await win.close();app.quit();
  } catch (error) { console.error(error);app.exit(1); }
});
