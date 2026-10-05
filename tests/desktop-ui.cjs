const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
app.setPath('userData',path.join(root,'artifacts','ui-profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 try {
  const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const js=code=>win.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'),state=()=>js("JSON.parse(localStorage.getItem('klaslokaal-v1'))"),errors=[];
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  // Allow the hidden window's compositor to catch up after a workspace swap.
  const shot=async name=>{await frame();await new Promise(resolve=>setTimeout(resolve,150));await fs.writeFile(path.join(root,'artifacts',name),(await win.webContents.capturePage()).toPNG());};
  const choose=(id,value)=>js(`document.querySelector('#${id}').value=${JSON.stringify(value)};document.querySelector('#${id}').dispatchEvent(new Event('change'));`);
  await win.loadFile(path.join(root,'src','index.html'));
  await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),s=r.initializeRooms(e.defaults());s.students=e.sampleStudents();s.name='UI controle';s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.settings.placementMode='ordered';const initial=s.activeRoomId,other=r.newRoom(s,'Lokaal B','classroom');s.participatingRooms=[initial,other.id];for(const [i,p] of s.students.entries())r.assignRoom(s,p.id,i<24?initial:other.id);for(const room of s.rooms)room.assignments=e.generate(r.roomState(s,room.id)).assignments;r.switchRoom(s,initial);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
  await win.loadFile(path.join(root,'src','index.html'));
  assert.equal(await js("document.querySelectorAll('#regenerate,#check,#layout-classes,[data-layout-close]').length"),0);
  assert.match(await js("document.querySelector('.local-label').textContent"),/Automatisch opgeslagen/);
  const before=await state(),other=before.rooms.find(r=>r.id!==before.activeRoomId),membership=before.studentRooms;
  await js("document.querySelector('#generate').click()");await choose('generation-scope','room');
  await shot('ui-generation.png');
  await js("document.querySelector('[data-close]').click()");assert.deepEqual(await state(),before);
  await js("document.querySelector('#generate').click()");await choose('generation-scope','room');
  assert.equal(await js("document.querySelectorAll('#generation-period,#generation-week-options,#weekly-keep-seats').length"),0);
  assert.equal(await js("document.querySelector('#generation-scope').disabled"),false);
  assert.equal(await js("document.querySelector('#generation-count').disabled"),true);
  await js("document.querySelector('#generation-submit').click()");
  await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#generate').disabled){clearInterval(timer);resolve();}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('Single-room planner timeout'));}},25);})`);
  const after=await state();assert.deepEqual(after.studentRooms,membership);assert.deepEqual(after.rooms.find(r=>r.id===other.id).assignments,other.assignments);assert.equal(Object.values(after.assignments).length,24);
  // A method selected for all rooms must also reach rooms outside the active tab.
  await js("document.querySelector('#generate').click()");await choose('generation-scope','all');await choose('placement-mode','ordered');await js("document.querySelector('#generation-submit').click()");
  await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#generate').disabled){clearInterval(timer);resolve();}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('All-room planner timeout'));}},25);})`);
  assert.ok((await state()).rooms.every(room=>room.settings.placementMode==='ordered'));
  await js("document.querySelector('#overview').click()");await shot('ui-seating.png');
  await js("document.querySelector('#expand-room').click()");
  assert.ok(await js("document.querySelector('#undo').getBoundingClientRect().width>0"));
  await js("document.querySelector('#expand-room').click()");
  assert.ok(await js("document.querySelector('#undo').closest('.app-header')!==null"));
  await js("document.querySelector('.view-menu>summary').click()");await frame();
  assert.equal(await js("document.querySelector('.view-menu').open"),true);
  assert.equal(await js("document.querySelector('.view-menu .menu-items').getBoundingClientRect().right<=innerWidth"),true);
  await js("document.querySelector('#zoom-in').click()");assert.equal(await js("document.querySelector('.view-menu').open"),false);
  await js("document.querySelector('.view-menu>summary').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  assert.equal(await js("document.querySelector('.view-menu').open"),false);
  await js("document.querySelector('[data-tab=students]').click()");
  assert.equal(await js("document.querySelector('#sidebar-content').textContent.includes('Klik een naam')"),false);
  assert.equal(await js("document.querySelector('#sidebar-content').closest('#task-workspace')!==null"),true);
  assert.ok(await js("document.querySelector('#undo').getBoundingClientRect().width>0"));
  assert.ok(await js("document.querySelector('#student-filter').getBoundingClientRect().width>250"));
  await shot('ui-students.png');
  const pupil=after.students[0];await js(`document.querySelector('#student-filter').value=${JSON.stringify(pupil.name)};document.querySelector('#student-filter').dispatchEvent(new Event('input'));`);
  assert.equal(await js("document.querySelectorAll('[data-student-row]:not([hidden])').length"),1);
  await js(`document.querySelector('[data-person="${pupil.id}"]').click()`);assert.equal(await js("document.querySelector('#modal').open"),true);
  await js("document.querySelector('[data-close]').click();document.querySelector('[data-tab=rules]').click()");
  assert.equal(await js("document.querySelector('[data-rules-section=general]')"),null);
  assert.equal(await js("document.querySelectorAll('.rules-intro,.category-status').length"),0);
  assert.ok(await js("document.querySelector('[data-rules-section=class]').getBoundingClientRect().width>400"));await shot('ui-rules.png');
  assert.equal(await js("document.querySelectorAll('[data-year-rule]').length"),0);
  // Disabled modules close immediately and reject pointer/keyboard expansion.
  for(const category of ['year','class','student']) {
    if(!await js(`document.querySelector('#${category}-rules-enabled').checked`))await js(`document.querySelector('#${category}-rules-enabled').click()`);
    assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),true);
    await js(`document.querySelector('[data-rules-section=${category}] .rules-category-name').click()`);
    assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),false);
    await js(`document.querySelector('[data-rules-section=${category}] .rules-category-name').click();document.querySelector('#${category}-rules-enabled').click()`);
    assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),false);
    await js(`document.querySelector('[data-rules-section=${category}] .rules-category-name').click()`);
    assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),false);
    await js(`document.querySelector('[data-rules-section=${category}]>summary').focus()`);
    for(const keyCode of ['Return','Space']) {
      win.webContents.sendInputEvent({type:'keyDown',keyCode});win.webContents.sendInputEvent({type:'keyUp',keyCode});await frame();
      assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),false);
    }
  }
  await js("document.querySelector('[data-tab=students]').click();document.querySelector('[data-tab=rules]').click()");
  assert.equal(await js("[...document.querySelectorAll('[data-rules-section]')].some(section=>section.open)"),false);
  const disabledState=await state();
  await win.loadFile(path.join(root,'src','index.html'));await js("document.querySelector('[data-tab=rules]').click()");
  assert.equal(await js("[...document.querySelectorAll('[data-rules-section]')].some(section=>section.open)"),false);
  assert.deepEqual((await state()).assignments,disabledState.assignments);
  assert.deepEqual((await state()).settings.yearRules,[]);
  for(const category of ['year','class','student']) {
    await js(`document.querySelector('#${category}-rules-enabled').click()`);
    assert.equal(await js(`document.querySelector('[data-rules-section=${category}]').open`),true);
  }
  await js("document.querySelector('[data-action=add-year-rule]').click();document.querySelector('#year-rule-a').value='3';document.querySelector('#year-rule-b').value='4';document.querySelector('#year-rule-save').click()");
  assert.equal((await state()).settings.yearRules.length,1);
  assert.equal(await js("[...document.querySelectorAll('[data-year-rule]')].filter(button=>JSON.parse(button.dataset.yearRule)[0]!==JSON.parse(button.dataset.yearRule)[1]).length"),1);
  await win.loadFile(path.join(root,'src','index.html'));await js("document.querySelector('[data-tab=rules]').click()");
  assert.equal(await js("document.querySelectorAll('[data-delete-year-rule]').length"),1);
  await js("document.querySelector('[data-delete-year-rule]').click()");
  assert.deepEqual((await state()).settings.yearRules,[]);
  assert.equal(await js("document.querySelectorAll('[data-year-rule]').length"),0);
  await js("document.querySelector('[data-action=add-year-rule]').click();document.querySelector('#year-rule-scope').value='within';document.querySelector('#year-rule-scope').dispatchEvent(new Event('change'));document.querySelector('#year-rule-a').value='3';document.querySelector('#year-rule-type').value='separate';document.querySelector('#year-rule-save').click()");
  assert.equal((await state()).settings.yearRules.length,1);await shot('ui-year-rule-delete.png');
  assert.deepEqual(await js("[...document.querySelectorAll('[data-year-rule]')].map(button=>JSON.parse(button.dataset.yearRule))"),[['3','3']]);
  await js("document.querySelector('[data-delete-year-rule]').click()");assert.deepEqual((await state()).settings.yearRules,[]);
  assert.equal(await js("document.querySelectorAll('[data-year-rule]').length"),0);
  assert.equal(await js("document.querySelectorAll('[data-delete-year-rule]').length"),0);
  await js("document.querySelector('[data-tab=rooms]').click()");
  assert.equal(await js("document.querySelector('.room-card-actions').querySelectorAll(':scope>button').length"),2);await shot('ui-rooms.png');
  await js("document.querySelector('[data-tab=distribution]').click()");assert.ok(await js("document.querySelector('[data-room-action=class-layouts]')!==null"));assert.equal(await js("document.querySelector('.unassigned-room')"),null);await shot('ui-distribution.png');
  assert.equal(await js("document.querySelector('#distribution-reviewed')"),null);
  assert.equal(await js("document.querySelectorAll('.distribution-controls button').length"),1);
  assert.equal(await js("document.querySelector('#navigation [data-tab=distribution]').classList.contains('active')"),true);
  await js("document.querySelector('[data-tab=export]').click();document.querySelector('#export-scope').value='all';document.querySelector('#export-scope').dispatchEvent(new Event('change'))");
  assert.equal(await js("document.querySelector('#export-scope').value"),'all');assert.equal(await js("document.querySelector('#export-format').value"),'xlsx');await shot('ui-export.png');
  await choose('export-format','csv');assert.equal(await js("document.querySelector('#export-scope-field').hidden"),true);
  await choose('export-format','pdf');assert.equal(await js("document.querySelector('#export-scope').value"),'room');
  await js("document.querySelector('[data-tab=room]').click()");
  win.setSize(1024,768);await frame();await shot('ui-seating-compact.png');
  assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true);
  await js("document.querySelector('[data-tab=students]').click()");await shot('ui-students-compact.png');
  assert.equal(await js("document.documentElement.scrollWidth<=innerWidth"),true);
  await js("document.querySelector('[data-action=clear]').click()");assert.equal((await state()).students.length,48);
  await js("document.querySelector('#modal [data-close]').click()");assert.equal((await state()).students.length,48);
  await js("document.querySelector('[data-action=clear]').click();document.querySelector('#clear-list-confirm').click()");assert.equal((await state()).students.length,0);
  await js("document.querySelector('[data-tab=distribution]').click()");assert.equal(await js("document.querySelectorAll('.unassigned-room').length"),1);
  await js("document.querySelector('[data-tab=students]').click()");
  await js("document.querySelector('#undo').click()");assert.equal((await state()).students.length,48);
  await js("document.querySelector('#redo').click()");assert.equal((await state()).students.length,0);
  await js("document.querySelector('#undo').click()");
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({ok:true,checks:'single-room isolation, generation cancellation, single-plan generation, larger student/rule screens, filtering and direct editing, menu dismissal, room card actions, consolidated export and compact layouts'}));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
