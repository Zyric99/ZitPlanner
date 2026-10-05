const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'artifacts','student-years-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  try {
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const js=code=>win.webContents.executeJavaScript(code),state=()=>js("JSON.parse(localStorage.getItem('klaslokaal-v1'))"),errors=[];
    win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const load=()=>win.loadFile(path.join(root,'src','index.html'));
    const input=(selector,value)=>js(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(value)};document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input'));`);
    const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await load();
    await js(`(async()=>{const e=await import('./engine.mjs');localStorage.setItem('klaslokaal-v1',JSON.stringify(e.defaults()));localStorage.removeItem('klaslokaal-v1-plans');localStorage.removeItem('klaslokaal-v1-lists');})()`);await load();
    await click('[data-tab="students"]');await click('#import-top');
    const text=['Naam;Klas;Leerjaar','Detected;4B;',...Array.from({length:9},(_,i)=>`Pupil ${i};Onbekend;`)].join('\n');
    await input('#import-text',text);await click('#import-submit');
    assert.equal(await js("document.querySelectorAll('[data-year-correction]').length"),9);
    await click('#import-submit');assert.equal((await state()).students.length,0);
    assert.match(await js("document.querySelector('#year-correction-error').textContent"),/9 resterende/);
    await input('#year-correction-all','-1');await click('#year-correction-apply');assert.match(await js("document.querySelector('#year-correction-error').textContent"),/positief/);
    await input('#year-correction-all','4');await click('#year-correction-apply');
    await js("document.querySelector('[data-year-correction]').value='2'");
    await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
    await js("document.querySelector('#year-correction-all').scrollIntoView({block:'center'})");
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await new Promise(resolve=>setTimeout(resolve,200));
    await fs.writeFile(path.join(root,'artifacts','student-years-import.png'),(await win.webContents.capturePage()).toPNG());
    await click('#import-submit');
    let s=await state();assert.equal(s.students.length,10);assert.equal(s.students[0].year,'4');assert.equal(s.students[1].year,'2');assert.ok(s.students.slice(2).every(p=>p.year==='4'));
    assert.equal(await js("document.querySelector('#student-year-errors').hidden"),true);
    await load();assert.deepEqual((await state()).students,s.students);
    // Changing class recalculates the year and discards the previous manual override.
    await click('[data-tab="students"]');await click(`[data-person="${s.students[1].id}"]`);
    await input('#edit-class','6B');assert.equal(await js("document.querySelector('#edit-year').value"),'6');
    await click('#edit-submit');s=await state();assert.equal(s.students[1].year,'6');assert.equal(s.students[1].yearOverride,undefined);
    // A failed edit explains the problem and allows an explicit manual correction.
    await click(`[data-person="${s.students[1].id}"]`);await input('#edit-class','Onbekend');await click('#edit-submit');
    assert.match(await js("document.querySelector('#edit-errors').textContent"),/handmatig/);
    await input('#edit-year','5');await click('#edit-submit');assert.equal((await state()).students[1].year,'5');
    // Users may also override a detected year, then return to automatic detection.
    await click(`[data-person="${s.students[0].id}"]`);await click('#edit-year-manual');await input('#edit-year','7');await click('#edit-submit');await load();
    assert.equal((await state()).students[0].year,'7');await click('[data-tab="students"]');await click(`[data-person="${s.students[0].id}"]`);await click('#edit-year-manual');await click('#edit-submit');assert.equal((await state()).students[0].year,'4');
    // Class-wide overrides include pupils in other rooms and manually absent pupils,
    // remain limited to the edited class code, and survive history and reopening.
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),s=e.defaults();s.students=[{id:'bulk-a',name:'Alpha',class:'4A',year:'4',absent:false},{id:'bulk-b',name:'Beta',class:'4A',year:'4',absent:true},{id:'other',name:'Other',class:'4B',year:'4',absent:false},{id:'source',name:'Source',class:'3A',year:'3',absent:false}];r.initializeRooms(s);const room=r.newRoom(s,'Andere klasruimte','small');r.assignRoom(s,'bulk-b',room.id);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await load();
    await click('[data-tab="students"]');await click('[data-person="bulk-a"]');
    assert.equal(await js("document.querySelector('#edit-year-manual').parentElement.textContent.trim()"),'Handmatig');
    assert.equal(await js("document.querySelector('#edit-year-class').disabled"),true);
    await click('#edit-year-manual');assert.equal(await js("document.querySelector('#edit-year-class').disabled"),false);
    await click('#edit-year-class');await input('#edit-year','7');
    assert.match(await js("document.querySelector('#edit-year-help').textContent"),/2 leerlingen in 4A/);
    await fs.writeFile(path.join(root,'artifacts','student-year-class-option.png'),(await win.webContents.capturePage()).toPNG());
    await click('#edit-submit');s=await state();assert.deepEqual(s.students.map(p=>p.year),['7','7','4','3']);
    assert.ok(s.students.slice(0,2).every(p=>p.yearOverride.class==='4A'&&p.yearOverride.year==='7'));assert.equal(s.students[1].absent,true);
    await click('#undo');assert.deepEqual((await state()).students.map(p=>p.year),['4','4','4','3']);
    await click('#redo');await load();assert.deepEqual((await state()).students.map(p=>p.year),['7','7','4','3']);
    // Turning off manual mode clears the class checkbox; automatic mode affects
    // only the selected pupil and leaves other manual corrections intact.
    await click('[data-tab="students"]');await click('[data-person="bulk-a"]');await click('#edit-year-class');await click('#edit-year-manual');
    assert.equal(await js("document.querySelector('#edit-year-class').disabled"),true);assert.equal(await js("document.querySelector('#edit-year-class').checked"),false);
    await click('#edit-submit');assert.deepEqual((await state()).students.map(p=>p.year),['4','7','4','3']);
    // Changing the selected pupil's class applies to the new class, not the old one.
    await click('[data-person="source"]');await input('#edit-class','4A');await click('#edit-year-manual');await click('#edit-year-class');await input('#edit-year','8');await click('#edit-submit');
    assert.deepEqual((await state()).students.map(p=>p.year),['8','8','4','8']);
    // A peer's year change invalidates the week even if the selected pupil already
    // has the chosen year. Attendance still returns to its manual baseline.
    await js(`(async()=>{const y=await import('./student-year.mjs'),w=await import('./weekly-planner.mjs'),s=JSON.parse(localStorage.getItem('klaslokaal-v1'));y.setManualYear(s.students[1],'9');s.weeklyPlans=w.generateWeek(s,{iterations:0});w.applyWeeklyDay(s,'maandag');localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await load();
    await click('[data-tab="students"]');await click('[data-person="bulk-a"]');await click('#edit-year-class');await click('#edit-submit');
    s=await state();assert.equal(s.weeklyPlans,undefined);assert.deepEqual(s.students.map(p=>p.year),['8','8','4','8']);assert.equal(s.students[1].absent,true);
    // Stored sessions keep students with missing years and offer every unresolved row.
    await js(`(async()=>{const e=await import('./engine.mjs'),s=e.defaults();s.students=[{id:'a',name:'Loaded A',class:'Onbekend',absent:false},{id:'b',name:'Loaded B',class:'Andere klas',year:'invalid',absent:false},{id:'c',name:'Loaded C',class:'3A',year:'9',absent:false}];localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await load();
    assert.equal((await state()).students.length,3);assert.equal((await state()).students[2].year,'3');assert.equal(await js("document.querySelectorAll('[data-year-correction]').length"),2);
    await click('[data-close]');assert.equal(await js("document.querySelector('#student-year-errors').hidden"),false);
    await click('#generate');assert.equal(await js("document.querySelectorAll('[data-year-correction]').length"),2);
    await input('#year-correction-all','2');await click('#year-correction-apply');await click('#year-correction-save');
    assert.equal(await js("document.querySelector('#student-year-errors').hidden"),true);
    await click('#undo');assert.equal(await js("document.querySelector('#student-year-errors').hidden"),false);await click('#redo');await load();
    assert.equal(await js("document.querySelector('#modal').open"),false);assert.deepEqual((await state()).students.map(p=>p.year),['2','2','3']);
    // Saved lists and plans recheck years when opened.
    await js(`(async()=>{const e=await import('./engine.mjs'),s=e.defaults();s.students=[{id:'saved',name:'Saved pupil',class:'Onbekend',year:'2',absent:false}];localStorage.setItem('klaslokaal-v1-lists',JSON.stringify([{id:'list',name:'Test list',students:s.students}]));localStorage.setItem('klaslokaal-v1-plans',JSON.stringify([{id:'plan',created:new Date().toISOString(),state:s}]));})()`);await load();
    await click('[data-tab="students"]');await click('[data-action="lists"]');await click('[data-load-list="list"]');assert.equal(await js("document.querySelectorAll('[data-year-correction]').length"),1);await click('[data-close]');
    await click('#open-plans');await click('[data-load-plan="plan"]');assert.equal(await js("document.querySelectorAll('[data-year-correction]').length"),1);await click('[data-close]');
    // JSON project imports also surface all errors instead of rejecting the roster.
    const project=await state();project.students=[{id:'project',name:'Project pupil',class:'Onbekend',year:'',absent:false}];project.assignments={};project.locks=[];project.studentRooms={project:project.activeRoomId};
    await click('#open-plans');await js(`const transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify({version:1,state:project}))}],'project.json'));const field=document.querySelector('#project-file');field.files=transfer.files;field.dispatchEvent(new Event('change'));`);
    await js(`new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(document.querySelector('[data-year-correction="project"]')){clearInterval(timer);resolve();}else if(Date.now()-start>5000){clearInterval(timer);reject(Error('Project import timeout'));}},20);})`);
    assert.equal((await state()).students[0].id,'project');await input('#year-correction-all','6');await click('#year-correction-apply');await click('#year-correction-save');await load();assert.equal((await state()).students[0].year,'6');
    if(errors.length)throw Error(errors.join('\n'));
    console.log('PASS: automatic import years, all nine corrections, invalid values, bulk and individual correction, class edits, manual override, reload, missing saved years, generation guard, undo/redo, saved list, saved plan, JSON project.');app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
