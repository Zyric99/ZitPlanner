const {app,BrowserWindow}=require('electron');
const os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(os.tmpdir(),`zitplanner-unplaced-${process.pid}-${Date.now()}`);
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  try {
    const win=new BrowserWindow({show:false,width:1550,height:1050,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    const js=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){console.error('Renderer check failed:',code,errors,new Error().stack);throw error;}},frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const state=()=>js(`(async()=>{const {unpackGridRoom}=await import('./grid-room.mjs');return JSON.parse(localStorage.getItem('klaslokaal-v1'),(_key,value)=>unpackGridRoom(value));})()`);
    const position=selector=>js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    const pointerClick=async selector=>{const p=await position(selector);win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await frame();};
    const drag=async(from,to)=>{await position(to);const a=await position(from),b=await js(`(()=>{const r=document.querySelector(${JSON.stringify(to)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);win.webContents.sendInputEvent({type:'mouseDown',...a,button:'left',clickCount:1});await frame();win.webContents.sendInputEvent({type:'mouseMove',...b});await frame();win.webContents.sendInputEvent({type:'mouseUp',...b,button:'left',clickCount:1});await frame();};
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),g=await import('./grid-room.mjs'),s=e.defaults();s.settings.layout=g.generateGrid(g.emptyGridRoom(),{from:'A',to:'D',rows:1});s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.settings.studentRulesEnabled=false;s.students=e.sampleStudents().slice(0,4);s.students[3].absent=true;s.assignments={};r.initializeRooms(s);s.studentRooms['demo-0']=null;s.studentRooms['demo-1']=null;s.studentRooms['demo-3']=null;r.captureRoom(s);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));await frame();
    await js(`document.querySelector('#zoom-label').value='40';document.querySelector('#zoom-label').dispatchEvent(new Event('change'));`);await frame();
    assert.equal(await js(`document.querySelectorAll('#active-warning-list .warning-entry').length`),1);
    assert.equal(await js(`document.querySelector('#warning-count').textContent`),'1');
    assert.match(await js(`document.querySelector('#active-warning-list').textContent`),/3 leerlingen hebben nog geen geldige zitplaats/);
    assert.equal(await js(`document.querySelectorAll('#unplaced [data-unplaced]').length`),3);
    assert.equal(await js(`document.querySelector('#unplaced [data-unplaced="demo-3"]')`),null);
    await click('[data-warning-group="unplaced"]');assert.equal(await js(`document.querySelectorAll('#unplaced .warning-focus').length`),3);
    await click('#active-warning-list [data-hide-warning]');assert.equal((await state()).hiddenWarnings.length,3);assert.equal(await js(`document.querySelectorAll('#active-warning-list .warning-entry').length`),0);
    await click('#hidden-warnings summary');await click('#hidden-warning-list [data-restore-warning]');assert.deepEqual((await state()).hiddenWarnings,[]);
    // Selection alone never enables moving; the explicit button arms one destination.
    await pointerClick('[data-unplaced="demo-0"]');assert.equal(await js(`document.querySelector('[data-unplaced="demo-0"]').getAttribute('aria-pressed')`),'true');assert.equal(await js(`document.querySelector('[data-action="move-student"]').textContent`),'Verplaatsen / wisselen');assert.equal(await js(`document.querySelector('[data-action="move-student"]').getAttribute('aria-pressed')`),'false');
    const unplacedStart=await state();await pointerClick('[data-seat="grid-A1:0"] .seat-bg');assert.deepEqual(await state(),unplacedStart);
    // Closing, clicking away, and Escape cancel an armed move without altering data.
    for(const cancel of ['close','away','escape']){
      await click('[data-unplaced="demo-0"]');await click('[data-action="move-student"]');assert.equal(await js(`document.querySelector('[data-action="move-student"]').getAttribute('aria-pressed')`),'true');assert.equal(await js(`document.querySelector('[data-action="move-student"]').textContent`),'Verplaatsen / wisselen');
      if(cancel==='close')await click('[data-action="close-context"]');else if(cancel==='away')await click('#warning-count');else await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
      await pointerClick('[data-seat="grid-A1:0"] .seat-bg');assert.deepEqual(await state(),unplacedStart);
    }
    await click('[data-unplaced="demo-0"]');await click('[data-action="move-student"]');
    await pointerClick('[data-seat="grid-A1:0"] .seat-bg');assert.equal((await state()).assignments['grid-A1:0'],'demo-0');assert.equal((await state()).studentRooms['demo-0'],(await state()).activeRoomId);assert.equal(await js(`document.querySelectorAll('#unplaced [data-unplaced]').length`),2);
    assert.equal(await js(`document.querySelector('[data-action="move-student"]').getAttribute('aria-pressed')`),'false');const placedOnce=await state();await pointerClick('[data-seat="grid-B1:0"] .seat-bg');assert.deepEqual(await state(),placedOnce);
    // Real drag from the bottom list into an empty chair, including undo.
    await drag('[data-unplaced="demo-1"]','[data-seat="grid-B1:0"] .seat-bg');assert.equal((await state()).assignments['grid-B1:0'],'demo-1');assert.equal((await state()).studentRooms['demo-1'],(await state()).activeRoomId);
    const draggedOnce=await state();await pointerClick('[data-seat="grid-C1:0"] .seat-bg');assert.deepEqual(await state(),draggedOnce,'dragging must not enable follow-up click moves');
    await pointerClick('[data-seat="grid-B1:0"] .seat-bg');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-B1:0"] .seat-bg');assert.equal(await js(`document.querySelector('[data-action="move-student"]').getAttribute('aria-pressed')`),'false','choosing the same seat also ends move mode');
    await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-D1:0"] .seat-bg');assert.equal((await state()).assignments['grid-D1:0'],'demo-1');const movedOnce=await state();await pointerClick('[data-seat="grid-C1:0"] .seat-bg');assert.deepEqual(await state(),movedOnce,'one explicit move must not enable another');
    await pointerClick('[data-seat="grid-D1:0"] .seat-bg');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-A1:0"] .seat-bg');assert.equal((await state()).assignments['grid-A1:0'],'demo-1');assert.equal((await state()).assignments['grid-D1:0'],'demo-0');assert.equal(await js(`document.querySelector('[data-action="move-student"]').getAttribute('aria-pressed')`),'false');
    await click('#undo');await click('#undo');assert.deepEqual((await state()).assignments,draggedOnce.assignments);
    assert.equal(await js(`document.querySelectorAll('#active-warning-list .warning-entry').length`),1);assert.match(await js(`document.querySelector('#active-warning-list').textContent`),/heeft nog geen geldige zitplaats/);
    await click('#undo');assert.equal((await state()).assignments['grid-B1:0'],undefined);assert.equal((await state()).studentRooms['demo-1'],null);assert.equal(await js(`document.querySelectorAll('#active-warning-list .warning-entry').length`),1);
    // An occupied drop uses the existing replacement semantics: the previous occupant becomes unplaced.
    await drag('[data-unplaced="demo-1"]','[data-seat="grid-A1:0"] .seat-bg');assert.equal((await state()).assignments['grid-A1:0'],'demo-1');assert.ok(await js(`Boolean(document.querySelector('[data-unplaced="demo-0"]'))`));
    await click('#undo');assert.equal((await state()).assignments['grid-A1:0'],'demo-0');
    // Keyboard activation and invalid drops leave pupil data intact.
    await click('[data-unplaced="demo-2"]');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-C1:0"] .seat-bg');assert.equal((await state()).assignments['grid-C1:0'],'demo-2');
    const before=await state();await drag('[data-unplaced="demo-1"]','#warning-count');assert.deepEqual((await state()).assignments,before.assignments);
    const cancelledStart=await position('[data-unplaced="demo-1"]');win.webContents.sendInputEvent({type:'mouseDown',...cancelledStart,button:'left',clickCount:1});await frame();await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);const cancelledEnd=await position('[data-seat="grid-B1:0"] .seat-bg');win.webContents.sendInputEvent({type:'mouseMove',...cancelledEnd});win.webContents.sendInputEvent({type:'mouseUp',...cancelledEnd,button:'left',clickCount:1});await frame();assert.deepEqual((await state()).assignments,before.assignments);
    await win.loadFile(path.join(root,'src','index.html'));assert.deepEqual((await state()).assignments,before.assignments);assert.equal(await js(`document.querySelectorAll('#unplaced [data-unplaced]').length`),1);
    // No-room placement validates mandatory destinations before making any write.
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),g=await import('./grid-room.mjs'),s=e.defaults();s.settings.layout=g.generateGrid(g.emptyGridRoom(),{from:'A',to:'D',rows:1});s.settings.classRulesEnabled=true;s.settings.yearRulesEnabled=false;s.settings.studentRulesEnabled=true;s.students=e.sampleStudents().slice(0,5);s.students[1].class='3Blocked';s.students[2].class='3Location';s.students[3].absent=true;r.initializeRooms(s);const other=r.newRoom(s,'Andere klas');s.participatingRooms.push(other.id);s.studentRooms=Object.fromEntries(s.students.map(p=>[p.id,p.id==='demo-4'?other.id:null]));s.classRooms={'3Blocked':other.id};s.rules=[{id:'room-location',type:'fixed',students:['demo-2'],roomId:other.id,priority:'Verplicht'}];r.captureRoom(s);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));await frame();await js(`document.querySelector('#zoom-label').value='40';document.querySelector('#zoom-label').dispatchEvent(new Event('change'));`);await frame();
    const constrained=await state();assert.equal(await js(`document.querySelectorAll('#unplaced [data-unplaced]').length`),3);assert.equal(await js(`Boolean(document.querySelector('[data-unplaced="demo-4"]'))`),false);
    await drag('[data-unplaced="demo-1"]','[data-seat="grid-B1:0"] .seat-bg');assert.match(await js(`document.querySelector('#toast').textContent`),/klas heeft een vast lokaal/);assert.deepEqual(await state(),constrained);
    await click('[data-unplaced="demo-2"]');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-B1:0"] .seat-bg');assert.match(await js(`document.querySelector('#toast').textContent`),/vastgezet in een lokaal/);assert.deepEqual(await state(),constrained);
    await click('[data-unplaced="demo-0"]');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-A1:0"] .seat-bg');assert.equal((await state()).studentRooms['demo-0'],constrained.activeRoomId);assert.equal((await state()).assignments['grid-A1:0'],'demo-0');assert.equal((await state()).studentRooms['demo-4'],constrained.studentRooms['demo-4']);
    await click('#undo');assert.equal((await state()).studentRooms['demo-0'],null);assert.deepEqual((await state()).assignments,{});
    // A disabled personal-rule module keeps its data but releases its room constraint.
    await js(`const s=JSON.parse(localStorage.getItem('klaslokaal-v1'));s.settings.studentRulesEnabled=false;localStorage.setItem('klaslokaal-v1',JSON.stringify(s));`);await win.loadFile(path.join(root,'src','index.html'));await click('[data-unplaced="demo-2"]');await click('[data-action="move-student"]');await pointerClick('[data-seat="grid-B1:0"] .seat-bg');assert.equal((await state()).studentRooms['demo-2'],constrained.activeRoomId);assert.equal((await state()).assignments['grid-B1:0'],'demo-2');assert.equal((await state()).rules[0].roomId,constrained.rules[0].roomId);
    if(errors.length)throw Error(errors.join('\n'));win.destroy();console.log(JSON.stringify({ok:true,checks:'grouped warnings, individual hidden keys, no-room bottom-list click/drag, atomic room/seat undo, occupied replacement, absent exclusion, other-room exclusion, mandatory class/location guards, disabled location module, invalid drop, Escape cancellation, save/reload',profile}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
