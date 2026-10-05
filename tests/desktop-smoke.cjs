// Real Electron smoke check of the shared default grid, planner worker and exports.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','smoke-profile'));
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.setMenuBarVisibility(false);
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);
    const regenerate=async()=>{await js(`document.querySelector('#generate').click();document.querySelector('#generation-submit').click();`);await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#generate').disabled){clearInterval(timer);resolve();}else if(Date.now()-started>15000){clearInterval(timer);reject(Error('Planner timeout'));}},30);})`);return state();};
    const screenshot=async name=>{await frame();await fs.writeFile(path.join(root,'artifacts',name),(await win.webContents.capturePage()).toPNG());};
    const loadFixture=async(code,legacy=false)=>{await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs'),s=e.${legacy?'legacyDefaults':'defaults'}();s.settings.studentRulesEnabled=true;${code};localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);await win.loadFile(path.join(root,'src','index.html'));};
    await win.loadFile(path.join(root,'src','index.html'));
    await loadFixture(`s.settings.studentRulesEnabled=false;s.students=e.sampleStudents();s.name='Corrected default classroom';r.initializeRooms(s);s.assignments=e.generate(s,{iterations:200}).assignments;r.captureRoom(s)`);
    let s=await state();assert.equal(s.settings.studentRulesEnabled,false);await js(`document.querySelector('[data-tab="rules"]').click()`);assert.deepEqual(await js(`[...document.querySelectorAll('[data-rules-section]')].map(section=>section.dataset.rulesSection)`),['year','class','student']);assert.equal(await js(`document.querySelector('#student-rules-enabled').checked`),false);await js(`document.querySelector('[data-tab="room"]').click()`);assert.equal(s.rooms[0].layout.kind,'custom');assert.equal(s.settings.layout.version,2);
    assert.equal(await js(`document.querySelectorAll('#room .bench').length`),95);assert.equal(await js(`document.querySelectorAll('#room .seat').length`),190);
    assert.equal(await js(`document.querySelectorAll('#room .teacher-bench .chair').length`),1);
    assert.deepEqual(await js(`(()=>{const t=document.querySelector('.teacher-bench>rect'),p=document.querySelector('#bench-grid-K2 .bench-table'),c=document.querySelector('.teacher-bench .chair');return {same:t.getAttribute('width')===p.getAttribute('width')&&t.getAttribute('height')===p.getAttribute('height'),center:Number(c.getAttribute('x'))+Number(c.getAttribute('width'))/2===Number(t.getAttribute('x'))+Number(t.getAttribute('width'))/2};})()`),{same:true,center:true});
    const codes=await js(`[...document.querySelectorAll('#room .seat')].map(s=>s.dataset.code)`);assert.equal(new Set(codes).size,190);assert.ok(codes.includes('A1')&&codes.includes('A2')&&codes.includes('A3'));
    assert.equal(await js(`document.querySelectorAll('#room .bench-label').length`),0);assert.deepEqual(await js(`[...document.querySelectorAll('#room .column-label')].map(el=>el.textContent).filter(t=>/^\\d+$/.test(t))`),['1','2','3','4','5','6','7','8']);
    s=await regenerate();assert.equal(Object.keys(s.assignments).length,48);
    // Main page keeps compact tabs and its viewport through unrelated controls.
    const metrics=()=>js(`({height:document.querySelector('#room-viewport').clientHeight,width:document.querySelector('#room-viewport').clientWidth,body:document.body.scrollWidth,window:innerWidth})`);
    const regular=await metrics();assert.ok(regular.height>=650);assert.ok(regular.body<=regular.window);
    await js(`document.querySelector('#overview').click()`);await screenshot('desktop-default-grid.png');
    await js(`document.querySelector('#expand-room').click()`);await frame();assert.ok((await metrics()).height>regular.height+65);
    await js(`document.querySelector('#expand-room').click();document.querySelector('#fit').click()`);win.setSize(1100,720);await new Promise(r=>setTimeout(r,150));assert.ok((await metrics()).height>=370);win.setSize(1600,1000);await new Promise(r=>setTimeout(r,150));
    // Rule configuration, category suspension and pupil warning visibility remain functional.
    await loadFixture(`s.students=e.sampleStudents().slice(0,2);s.students[1].class=s.students[0].class;s.students[1].year='4';s.students[1].yearOverride={class:s.students[1].class,year:'4'};s.settings.classRulesEnabled=true;s.settings.classRules.default.type='gap';s.assignments={'A1:0':'demo-0','A1:1':'demo-1'};s.locks=['demo-0','demo-1'];s.rules=[{id:'f',type:'fixed',students:['demo-1'],seat:'A1:1',priority:'Verplicht'}]`,true);
    assert.deepEqual((await state()).assignments,{'grid-A1:0':'demo-0','grid-A1:1':'demo-1'});assert.equal((await state()).rules.find(r=>r.id==='f').seat,'grid-A1:1');
    const original=(await state()).assignments;s=await regenerate();assert.deepEqual(s.assignments,original);
    assert.equal(await js(`Number(document.querySelector('#warning-count').textContent)`),2);
    assert.equal(await js(`document.querySelectorAll('#room .seat.warning').length`),2);assert.equal(await js(`document.querySelectorAll('#room .bench.warning').length`),0);
    await js(`document.querySelector('[data-tab="rules"]').click()`);
    for(const category of ['class','year','student']) {
      assert.ok(await js(`!!document.querySelector('#${category}-rules-enabled').closest('summary')`));
      await js(`document.querySelector('[data-rules-section="${category}"]>summary .rules-category-name').click()`);
      assert.equal(await js(`document.querySelector('[data-rules-section="${category}"]').open`),false);
      const before=(await state()).settings[`${category}RulesEnabled`];
      // Real pointer input verifies that the switch works in a closed details element.
      const point=await js(`(()=>{const r=document.querySelector('#${category}-rules-enabled').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
      win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await frame();
      assert.equal((await state()).settings[`${category}RulesEnabled`],!before);
      assert.equal(await js(`document.querySelector('[data-rules-section="${category}"]').open`),false);
      assert.equal(await js(`document.activeElement.id`),`${category}-rules-enabled`);
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await frame();
      assert.equal((await state()).settings[`${category}RulesEnabled`],before);
      assert.equal(await js(`document.querySelector('[data-rules-section="${category}"]').open`),true);
    }
    await screenshot('desktop-collapsed-rule-toggles.png');
    await js(`document.querySelector('[data-tab="rules"]').click();document.querySelector('#class-rules-enabled').click();`);assert.equal(await js(`Number(document.querySelector('#warning-count').textContent)`),1);
    await js(`document.querySelector('#year-rules-enabled').click();`);assert.equal(await js(`Number(document.querySelector('#warning-count').textContent)`),0);
    await js(`document.querySelector('#class-rules-enabled').click();document.querySelector('#year-rules-enabled').click();document.querySelector('[data-tab="room"]').click();document.querySelector('#active-warning-list [data-hide-warning]').click();document.querySelector('#active-warning-list [data-hide-warning]').click();`);
    assert.equal(await js(`document.querySelectorAll('#room .seat.warning').length`),0);assert.equal((await state()).hiddenWarnings.length,2);
    await win.loadFile(path.join(root,'src','index.html'));assert.equal((await state()).hiddenWarnings.length,2);
    await js(`document.querySelector('#hidden-warnings').open=true;document.querySelector('#hidden-warning-list [data-warning]').click();`);assert.equal(await js(`document.querySelectorAll('#room .seat.warning-focus').length`),2);
    await js(`document.querySelector('#hidden-warning-list [data-restore-warning]').click();`);assert.equal(await js(`document.querySelectorAll('#room .seat.warning').length`),2);
    await loadFixture(`s.students=e.sampleStudents().slice(0,2);s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.assignments={'grid-A1:0':'demo-0','grid-A1:1':'demo-1'};s.rules=[{id:'personal',type:'separate',students:['demo-0','demo-1'],priority:'Verplicht'}]`);
    await js(`document.querySelector('[data-tab="rules"]').click();document.querySelector('[data-rules-section="student"]').open=false;document.querySelector('#student-rules-enabled').click()`);
    assert.equal(await js(`Number(document.querySelector('#warning-count').textContent)`),0);assert.equal((await state()).rules.length,1);
    assert.equal(await js(`document.querySelector('[data-rules-section="student"]').open`),false);
    await win.loadFile(path.join(root,'src','index.html'));await js(`document.querySelector('[data-tab="rules"]').click()`);
    assert.equal(await js(`document.querySelector('#student-rules-enabled').checked`),false);assert.match(await js(`document.querySelector('#rule-audit').textContent`),/Leerlingregels uitgeschakeld/);
    await js(`document.querySelector('#student-rules-enabled').click()`);assert.equal(await js(`Number(document.querySelector('#warning-count').textContent)`),1);
    // Priority colours agree between warning cards and seats, including overlaps.
    await loadFixture(`s.students=e.sampleStudents().slice(0,6);s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;r.initializeRooms(s);s.assignments={'grid-A1:0':'demo-0','grid-A1:1':'demo-1','grid-B1:0':'demo-2','grid-B1:1':'demo-3','grid-C1:0':'demo-4','grid-C1:1':'demo-5'};s.rules=e.PRIORITIES.map((priority,i)=>({id:'colour-'+i,type:'separate',students:['demo-'+(i*2),'demo-'+(i*2+1)],priority}));s.rules.push({id:'overlapping-soft',type:'separate',students:['demo-0','demo-1'],priority:'Zachte voorkeur'});r.captureRoom(s)`);
    const colours=await js(`(()=>{const result={};for(const [style,student] of [['required','demo-0'],['preference','demo-2'],['soft','demo-4']]){const card=document.querySelector('#active-warning-list .warning-'+style),seat=document.querySelector('#room [data-student="'+student+'"] .seat-bg');result[style]={background:getComputedStyle(card).backgroundColor,fill:getComputedStyle(seat).fill};}return result;})()`);
    assert.deepEqual(colours,{required:{background:'rgb(255, 224, 222)',fill:'rgb(255, 224, 222)'},preference:{background:'rgb(255, 251, 244)',fill:'rgb(255, 224, 173)'},soft:{background:'rgb(226, 244, 222)',fill:'rgb(226, 244, 222)'}});
    await screenshot('warning-priority-colours.png');
    await js(`document.querySelector('#active-warning-list .warning-required [data-hide-warning]').click()`);
    assert.equal(await js(`document.querySelector('#room [data-student="demo-0"]').classList.contains('warning-soft')`),true);
    assert.equal(await js(`getComputedStyle(document.querySelector('#hidden-warning-list .warning-required')).backgroundColor`),'rgb(245, 246, 245)');
    await js(`document.querySelector('#hidden-warning-list [data-restore-warning]').click()`);
    assert.equal(await js(`document.querySelector('#room [data-student="demo-0"]').classList.contains('warning-required')`),true);
    // Actual student drag, fixed positions and pins operate on distinct table/seat IDs.
    await loadFixture(`s.students=e.sampleStudents().slice(0,8);s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.settings.placementMode='ordered';r.initializeRooms(s);s.assignments=e.generate(s,{iterations:0}).assignments;r.captureRoom(s)`);
    await js(`document.querySelector('#zoom-label').value='75';document.querySelector('#zoom-label').dispatchEvent(new Event('change'));`);
    const points=await js(`(()=>{const a=document.querySelector('[data-seat="grid-A1:0"] .seat-bg').getBoundingClientRect(),b=document.querySelector('[data-seat="grid-B2:0"] .seat-bg').getBoundingClientRect();return {a:{x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2)},b:{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}};})()`),student=(await state()).assignments['grid-A1:0'];
    win.webContents.sendInputEvent({type:'mouseDown',...points.a,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',...points.b});win.webContents.sendInputEvent({type:'mouseUp',...points.b,button:'left',clickCount:1});await frame();assert.equal((await state()).assignments['grid-B2:0'],student);
    await js(`document.querySelector('[data-student="${student}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('[data-action="fixed-position"]').click();document.querySelector('#rule-submit').click();`);
    assert.equal((await state()).locks.length,0);assert.ok((await state()).rules.some(r=>r.type==='fixed'&&r.students[0]===student));s=await regenerate();assert.equal(s.assignments['grid-B2:0'],student);assert.equal(s.rules[0].seat,'grid-B2:0');
    await js(`document.querySelector('#bench-grid-E2 .bench-table').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('#room-viewport').scrollLeft=240;document.querySelector('#room-viewport').scrollTop=200;`);
    const viewportBefore=await js(`({left:document.querySelector('#room-viewport').scrollLeft,top:document.querySelector('#room-viewport').scrollTop,page:scrollY})`);
    await js(`document.querySelector('[data-action="disable-bench"]').click();`);assert.deepEqual(await js(`({left:document.querySelector('#room-viewport').scrollLeft,top:document.querySelector('#room-viewport').scrollTop,page:scrollY})`),viewportBefore);
    // Default room opens directly in the same editor as every other room.
    await js(`document.querySelector('[data-layout-action="edit"]').click();`);assert.ok(await js(`!!document.querySelector('#layout-grid')`));assert.equal(await js(`document.querySelector('#modal').open`),false);
    assert.equal(await js(`document.querySelectorAll('#layout-grid .grid-table-coordinate').length`),0);assert.deepEqual(await js(`[...document.querySelectorAll('[data-grid-bench=\"grid-A1\"] .grid-seat-code')].map(el=>el.textContent)`),['A1','A2']);assert.deepEqual(await js(`[...document.querySelectorAll('[data-grid-bench=\"grid-A2\"] .grid-seat-code')].map(el=>el.textContent)`),['A3','A4']);assert.deepEqual(await js(`[...document.querySelectorAll('#grid-side-axis text')].map(el=>el.textContent)`),['1','2','3','4','5','6','7','8']);await screenshot('desktop-seat-labels-editor.png');
    await js(`document.querySelector('[data-editor-action="teacher"]').click();document.querySelector('[data-editor-action="rotate"]').click();document.querySelector('[data-editor-action="save"]').click();document.querySelector('[data-room-open="standaardlokaal"]').click();`);
    assert.equal((await state()).settings.layout.benches.find(b=>b.kind==='teacher').facing,'left');assert.equal((await state()).assignments['grid-B2:0'],student);
    const beforeReload=await state();await win.loadFile(path.join(root,'src','index.html'));assert.deepEqual((await state()).rooms,beforeReload.rooms);
    // Capture actual PDF via test IPC; no OS save dialog and no real user files.
    const exported=new Promise((resolve,reject)=>ipcMain.handle('export-pdf',async()=>{try{const bytes=await win.webContents.printToPDF({landscape:true,pageSize:'A3',printBackground:true,preferCSSPageSize:true});resolve(bytes);return true;}catch(error){reject(error);return false;}}));
    await js(`document.querySelector('[data-tab=export]').click();document.querySelector('#export-format').value='pdf';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-submit').click();`);const pdf=await exported;assert.equal(pdf.toString('ascii',0,4),'%PDF');assert.ok(pdf.length>5000);await fs.writeFile(path.join(root,'artifacts','desktop-check.pdf'),pdf);
    const xlsxPath=path.join(root,'artifacts','desktop-seating.xlsx'),downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(xlsxPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('[data-tab=export]').click();document.querySelector('#export-format').value='xlsx';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-submit').click();`);await downloaded;const xlsx=await fs.readFile(xlsxPath);assert.equal(xlsx.readUInt32LE(0),0x04034b50);
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'shared editable default, table naming, teacher footprint, worker, responsive viewport, categories, warning hide/restore, legacy reference import, real pupil drag, pins, fixed positions, scroll preservation, reload, PDF and XLSX',pdfBytes:pdf.length,xlsxBytes:xlsx.length}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
