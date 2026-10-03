const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','tabs-smoke-profile'));
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);
    const open=async id=>{await js(`document.querySelector('[data-layout-open="${id}"]').click()`);await frame();};
    const rename=async name=>js(`document.querySelector('[data-layout-action="rename"]').click();document.querySelector('#room-name').value=${JSON.stringify(name)};document.querySelector('#room-dialog-save').click();`);
    const create=async(name,type='default')=>{await js(`document.querySelector('#new-layout-tab').click();document.querySelector('#new-room-name').value=${JSON.stringify(name)};document.querySelector('#new-room-template').value='${type}';document.querySelector('#room-dialog-save').click();`);return (await state()).activeRoomId;};
    const waitGenerated=()=>js(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{const s=JSON.parse(localStorage.getItem('klaslokaal-v1'));if(s.rooms.reduce((n,r)=>n+Object.keys(r.assignments).length,0)===8&&!document.querySelector('#generate').disabled){clearInterval(timer);resolve();}},25);setTimeout(()=>{clearInterval(timer);reject(Error('Tab generation timeout'));},15000);})`);
    await win.loadFile(path.join(root,'src','index.html'));await js(`(async()=>{const e=await import('./engine.mjs'),s=e.defaults();s.students=e.sampleStudents().slice(0,8).map((p,i)=>({...p,class:i<4?'1A':'1B'}));s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await win.loadFile(path.join(root,'src','index.html'));
    const main=(await state()).activeRoomId;await rename('Main Classroom');const science=await create('Science Room'),exam=await create('Exam Setup','default');
    assert.equal(await js(`document.querySelectorAll('#layout-tabs [role="tab"]').length`),3);assert.equal(await js(`document.body.classList.contains('room-management')`),false);
    await js(`document.querySelector('[data-tab="distribution"]').click();document.querySelector('[data-room-action="class-layouts"]').click();document.querySelector('[data-class-layout="0"]').value='${main}';document.querySelector('[data-class-layout="1"]').value='${science}';document.querySelector('#room-dialog-save').click();`);
    let s=await state();assert.deepEqual(s.classRooms,{'1A':main,'1B':science});assert.ok(s.students.every(p=>s.studentRooms[p.id]===(p.class==='1A'?main:science)));
    await open(science);await rename('Science · Lab');s=await state();assert.equal(s.classRooms['1B'],science);assert.equal(s.rooms.find(r=>r.id===science).name,'Science · Lab');
    await open(exam);await js(`document.querySelector('#layout-participates').checked=false;document.querySelector('#layout-participates').dispatchEvent(new Event('change'));`);assert.equal((await state()).participatingRooms.includes(exam),false);
    await js(`document.querySelector('#generate').click();document.querySelector('#generation-submit').click();document.querySelector('[data-layout-open="${main}"]').click();`);await waitGenerated();
    s=await state();assert.equal(s.activeRoomId,main);assert.equal(Object.keys(s.rooms.find(r=>r.id===main).assignments).length,4);assert.equal(Object.keys(s.rooms.find(r=>r.id===science).assignments).length,4);assert.equal(Object.keys(s.rooms.find(r=>r.id===exam).assignments).length,0);assert.equal(await js(`document.body.classList.contains('room-management')`),false);
    await open(science);assert.equal(await js(`document.querySelector('#layout-tabs [aria-selected="true"]').textContent.trim()`),'Science · Lab');assert.equal(await js(`document.querySelector('.layout-strip').getBoundingClientRect().height<=44`),true);
    assert.equal(await js(`document.querySelector('#layout-participates').disabled`),true);
    // Roving keyboard navigation switches rooms without changing class bindings.
    await js(`document.querySelector('#layout-tabs [aria-selected="true"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`);assert.equal((await state()).activeRoomId,exam);assert.deepEqual((await state()).classRooms,s.classRooms);await open(science);
    // Class mappings are managed from the distribution screen.
    await js(`document.querySelector('[data-tab="distribution"]').click();document.querySelector('[data-room-action="class-layouts"]').click();`);assert.match(await js(`document.querySelector('#modal-content').textContent`),/Science · Lab/);await js(`document.querySelector('[data-close]').click()`);await open(science);
    await js(`document.querySelector('#zoom-label').value='75';document.querySelector('#zoom-label').dispatchEvent(new Event('change'));`);await open(main);await open(science);assert.equal(await js(`document.querySelector('#zoom-label').value`),'75');
    await js(`document.querySelector('#generate').click();document.querySelector('#generation-scope').value='room';document.querySelector('#generation-scope').dispatchEvent(new Event('change'));document.querySelector('#generation-count').value='3';document.querySelector('#generation-submit').click();`);
    await js(`new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(document.querySelectorAll('#alternatives button').length===3&&!document.querySelector('#generate').disabled){clearInterval(timer);resolve();}},25);setTimeout(()=>{clearInterval(timer);reject(Error('Tab alternatives timeout'));},15000);})`);
    await open(main);assert.equal(await js(`document.querySelector('#alternatives').hidden`),true);await open(science);
    await frame();await fs.writeFile(path.join(root,'artifacts','desktop-layout-tabs.png'),(await win.webContents.capturePage()).toPNG());
    const before=await state();await win.loadFile(path.join(root,'src','index.html'));s=await state();assert.equal(s.activeRoomId,science);assert.deepEqual(s.rooms,before.rooms);assert.deepEqual(s.classRooms,before.classRooms);
    // Removing a bound tab cannot silently erase its class destination.
    await js(`document.querySelector('[data-layout-action="delete"]').click();document.querySelector('#room-dialog-save').click();`);assert.match(await js(`document.querySelector('#room-dialog-error').textContent`),/vervangende/);assert.equal((await state()).classRooms['1B'],science);
    await js(`document.querySelector('#delete-room-replacement').value='${exam}';document.querySelector('#room-dialog-save').click();`);s=await state();assert.equal(s.rooms.length,2);assert.equal(s.classRooms['1B'],exam);assert.ok(s.students.filter(p=>p.class==='1B').every(p=>s.studentRooms[p.id]===exam));assert.equal(Object.values(s.rooms.find(r=>r.id===exam).assignments).length,0);
    await js(`document.querySelector('#generate').click();document.querySelector('#generation-submit').click();`);await waitGenerated();assert.equal(Object.keys((await state()).rooms.find(r=>r.id===exam).assignments).length,4);
    // Closing a tab remains undoable, including names, destinations and seats.
    await js(`document.querySelector('#undo').click();document.querySelector('#undo').click();`);s=await state();assert.ok(s.rooms.some(r=>r.id===science));assert.equal(s.classRooms['1B'],science);
    // Many tabs scroll horizontally and keep long names contained in the strip.
    await js(`(async()=>{const r=await import('./rooms.mjs'),s=JSON.parse(localStorage.getItem('klaslokaal-v1'));for(let i=0;i<15;i++)r.newRoom(s,'Extra Room '+i+' · a longer descriptive classroom name','classroom');localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await win.loadFile(path.join(root,'src','index.html'));
    const overflow=await js(`(()=>{const tabs=document.querySelector('#layout-tabs'),strip=document.querySelector('.layout-strip');return {scroll:tabs.scrollWidth>tabs.clientWidth,height:strip.getBoundingClientRect().height,body:document.body.scrollWidth,width:innerWidth};})()`);assert.equal(overflow.scroll,true);assert.ok(overflow.height<=44);assert.ok(overflow.body<=overflow.width);
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'compact browser tabs, create/name/rename, keyboard, class routing, active-tab-independent worker, reload, guarded deletion/reassignment, undo, overflow'}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
