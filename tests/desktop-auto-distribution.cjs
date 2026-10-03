const {app,BrowserWindow}=require('electron');
const path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(os.tmpdir(),`zitplanner-auto-${randomUUID()}`));
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  try {
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
    const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const js=code=>win.webContents.executeJavaScript(code),state=()=>js("JSON.parse(localStorage.getItem('klaslokaal-v1'))");
    const load=()=>win.loadFile(path.join(root,'src','index.html'));
    await load();
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),g=await import('./grid-room.mjs'),s=e.defaults();s.settings.studentRulesEnabled=true;s.settings.classRulesEnabled=true;s.settings.yearRulesEnabled=false;s.settings.classRules.default={type:'separate',priority:'Verplicht'};s.students=Array.from({length:4},(_,i)=>({id:'s'+i,name:'Leerling '+i,class:i%2?'4B':'3A',year:i%2?'4':'3',absent:false}));r.initializeRooms(s);s.rooms[0].layout=g.generateGrid(g.emptyGridRoom(),{from:'A',to:'A',rows:1});s.settings.layout=s.rooms[0].layout;const b=r.newRoom(s,'Tweede lokaal');b.layout=g.generateGrid(g.emptyGridRoom(),{from:'B',to:'B',rows:1});s.participatingRooms=s.rooms.map(r=>r.id);r.distributeRooms(s,'balanced');localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await load();await js("document.querySelector('[data-tab=distribution]').click()");
    assert.equal(await js("document.querySelectorAll('.distribution-controls button').length"),1);
    assert.equal(await js("document.querySelector('#distribution-reviewed')"),null);
    assert.equal(await js("document.querySelector('[data-room-action=distribute]')"),null);
    assert.equal(await js("document.querySelector('[data-room-action=generate-all]')"),null);
    const original=await state(),roomId=original.studentRooms.s0;
    await js(`(()=>{const input=document.querySelector('[data-distribution-search="${roomId}"]');input.value='Leerling 0';input.dispatchEvent(new Event('input'));})()`);
    assert.equal(await js(`document.querySelector('[data-drop-room="${roomId}"]').querySelectorAll('[data-room-pupil]:not([hidden])').length`),1);
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('[data-room-action=pin-room]').click();document.querySelector('#rule-submit').click()");
    assert.equal((await state()).rules.find(r=>r.type==='fixed'&&r.students[0]==='s0').roomId,roomId);
    assert.match(await js("document.querySelector('[data-room-action=pin-room]').textContent"),/aanpassen/);
    assert.equal(await js(`document.querySelector('[data-distribution-search="${roomId}"]').value`),'Leerling 0');
    const pinned=await state();
    await js("document.querySelector('[data-room-action=auto-distribute]').click()");
    assert.equal(await js("document.querySelector('[data-room-action=auto-distribute]').disabled"),true);
    await js(`new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{const button=document.querySelector('[data-room-action=auto-distribute]');if(button&&!button.disabled){clearInterval(timer);resolve();}else if(Date.now()-start>20000){clearInterval(timer);reject(Error('Auto worker timeout'));}},25);})`);
    const automatic=await state();assert.equal(automatic.studentRooms.s0,roomId);assert.equal(automatic.activeRoomId,pinned.activeRoomId);
    assert.equal(automatic.distribution.reviewed,true);assert.equal(automatic.rooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0),4);
    assert.match(await js("document.querySelector('#distribution-auto-result').textContent"),/alle ingeschakelde regels zijn gevolgd/);
    await fs.mkdir(path.join(root,'artifacts'),{recursive:true});
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    win.webContents.invalidate();
    await new Promise(resolve=>setTimeout(resolve,200));
    await fs.writeFile(path.join(root,'artifacts','desktop-auto-distribution.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#undo').click()");assert.deepEqual((await state()).rooms,pinned.rooms);assert.deepEqual((await state()).studentRooms,pinned.studentRooms);
    assert.equal(await js("document.querySelector('#distribution-auto-result').textContent"),'');
    await js("document.querySelector('#redo').click()");assert.deepEqual((await state()).studentRooms,automatic.studentRooms);
    await load();await js("document.querySelector('[data-tab=distribution]').click()");assert.deepEqual((await state()).rules,automatic.rules);
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('[data-room-action=pin-room]').click();document.querySelector('#rule-remove').click()");assert.equal((await state()).rules.filter(r=>r.type==='fixed').length,0);
    // Both ways of opening a location edit the same rule. Click-away, toggle,
    // close button and Escape all dismiss the pupil controls.
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('.rooms-heading h2').click()");
    assert.equal(await js("document.querySelector('#manual-room-panel').textContent"),'');
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('[data-room-pupil=s0]').click()");
    assert.equal(await js("document.querySelector('#manual-room-panel').textContent"),'');
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('[data-room-action=close-pupil]').click()");
    assert.equal(await js("document.querySelector('#manual-room-panel').textContent"),'');
    await js("document.querySelector('[data-room-pupil=s0]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    assert.equal(await js("document.querySelector('#manual-room-panel').textContent"),'');
    await js("document.querySelector('[data-room-pupil=s0]').scrollIntoView({block:'center'})");
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const point=await js("(()=>{const r=document.querySelector('[data-room-pupil=s0]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
    await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.match(await js("document.querySelector('#manual-room-panel').textContent"),/Leerling 0/);
    await js("document.querySelector('.rooms-heading h2').click()");
    assert.equal(await js("document.querySelector('#manual-room-panel').textContent"),'');
    await js("document.querySelector('[data-room-pupil=s0]').click();document.querySelector('[data-room-action=pin-room]').click();document.querySelector('#rule-location-scope').value='seat';document.querySelector('#rule-location-scope').dispatchEvent(new Event('change'));document.querySelector('#rule-submit').click()");
    const exact=(await state()).rules.find(r=>r.type==='fixed');assert.ok(exact.seat);
    await js("document.querySelector('[data-tab=rules]').click();document.querySelector('[data-edit-rule]').click();document.querySelector('#rule-location-scope').value='room';document.querySelector('#rule-submit').click()");
    assert.equal((await state()).rules.length,1);assert.equal((await state()).rules[0].id,exact.id);assert.equal((await state()).rules[0].seat,undefined);
    await js("document.querySelector('[data-class-rule=\"3A\"]').click()");
    await js(`document.querySelector('#class-rule-room').value='${(await state()).rooms.find(r=>r.id!==exact.roomId).id}';document.querySelector('#class-rule-save').click()`);
    assert.match(await js("document.querySelector('#class-rule-errors').textContent"),/vaste locatie/);
    await js(`document.querySelector('#class-rule-room').value='${exact.roomId}';document.querySelector('#class-rule-save').click()`);
    assert.equal((await state()).classRooms['3A'],exact.roomId);
    await js("document.querySelector('[data-class-rule=\"3A\"]').click();document.querySelector('#class-rule-room').value='';document.querySelector('#class-rule-save').click()");
    assert.equal((await state()).classRooms['3A'],undefined);
    await js("document.querySelector('[data-tab=room]').click();document.querySelector('[data-person=s0]')?.click()");
    await js(`document.querySelector('[data-student=s0]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal(await js("document.querySelectorAll('[data-action=lock-student]').length"),0);
    assert.match(await js("document.querySelector('#context').textContent"),/Vaste locatie/);
    await js("document.querySelector('#room').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    assert.equal(await js("document.querySelector('#context').textContent"),'');
    // Force the same-table pair to different pinned rooms: Auto must warn.
    await js(`(async()=>{const r=await import('./rooms.mjs'),s=JSON.parse(localStorage.getItem('klaslokaal-v1'));s.settings.classRulesEnabled=false;s.rules=[{id:'together',type:'together',priority:'Verplicht',students:['s0','s1']}];r.pinStudentRoom(s,'s0',s.rooms[0].id);r.pinStudentRoom(s,'s1',s.rooms[1].id);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await load();await js("document.querySelector('[data-tab=distribution]').click();document.querySelector('[data-room-action=auto-distribute]').click()");
    await js(`new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(!document.querySelector('[data-room-action=auto-distribute]').disabled){clearInterval(timer);resolve();}else if(Date.now()-start>20000){clearInterval(timer);reject(Error('Conflict worker timeout'));}},25);})`);
    assert.match(await js("document.querySelector('#distribution-auto-result').textContent"),/Geen indeling zonder conflicten gevonden.*verschillende lokalen/s);
    const conflict=await state();assert.equal(conflict.studentRooms.s0,conflict.rooms[0].id);assert.equal(conflict.studentRooms.s1,conflict.rooms[1].id);
    // The one visible action must pass the dropdown choice to the worker.
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),g=await import('./grid-room.mjs'),s=e.defaults();s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.students=Array.from({length:8},(_,i)=>({id:'s'+i,name:'Leerling '+i,class:i<4?'3A':'4B',year:i<4?'3':'4',absent:false}));r.initializeRooms(s);r.newRoom(s,'Tweede lokaal');for(const room of s.rooms)room.layout=g.generateGrid(g.emptyGridRoom(),{from:'A',to:'D',rows:1});s.settings.layout=s.rooms[0].layout;s.participatingRooms=s.rooms.map(room=>room.id);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await load();await js("document.querySelector('[data-tab=distribution]').click()");
    for(const [mode,expected] of [['capacity',[8,0]],['balanced',[4,4]]]) {
      await js(`document.querySelector('#distribution-mode').value='${mode}';document.querySelector('#distribution-mode').dispatchEvent(new Event('change'));document.querySelector('[data-room-action=auto-distribute]').click()`);
      await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('[data-room-action=auto-distribute]').disabled){clearInterval(timer);resolve();}else if(Date.now()-started>20000){clearInterval(timer);reject(Error('Distribution mode worker timeout'));}},25);})`);
      const planned=await state();assert.equal(planned.distribution.mode,mode);
      assert.deepEqual(planned.rooms.map(room=>Object.keys(room.assignments).length),expected);
      assert.match(await js("document.querySelector('#distribution-auto-result').textContent"),/alle ingeschakelde regels zijn gevolgd/);
    }
    await fs.writeFile(path.join(root,'artifacts','desktop-combined-distribution.png'),(await win.webContents.capturePage()).toPNG());
    if(errors.length)throw Error(errors.join('\n'));
    console.log('PASS: joint Auto worker, visible conflicts, per-room student search, unified location rules, class location editing, real pupil clicks and panel dismissal, retained active tab, autosave, restart, undo and redo.');app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
