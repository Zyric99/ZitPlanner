const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','grid-smoke-profile'));
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,width:1600,height:1100,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const state=()=>js(`(async()=>{const {unpackGridRoom}=await import('./grid-room.mjs');return JSON.parse(localStorage.getItem('klaslokaal-v1'),(_key,value)=>unpackGridRoom(value));})()`);
    const action=name=>js(`document.querySelector('[data-editor-action="${name}"]').click()`);
    const selectAt=async(gx,gy)=>{
      const p=await js(`(()=>{const svg=document.querySelector('#layout-grid'),v=document.querySelector('.grid-scroll'),z=Number(document.querySelector('#editor-zoom').value);v.scrollIntoView({block:'start'});v.scrollLeft=Math.max(0,(${gx}*32+40)*z-v.clientWidth/2);v.scrollTop=Math.max(0,(${gy}*32+64)*z-v.clientHeight/2);v.dispatchEvent(new Event('scroll'));const p=new DOMPoint(40+${gx}*32+8,64+${gy}*32+8).matrixTransform(svg.getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)};})()`);
      await frame();win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await frame();
    };
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{const e=await import('./engine.mjs');localStorage.setItem('klaslokaal-v1',JSON.stringify(e.defaults()));})()`);await win.loadFile(path.join(root,'src','index.html'));
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-action="new"]').click();document.querySelector('#new-room-name').value='Rastervoorbeeld';document.querySelector('#room-dialog-save').click();`);
    await action('generate');assert.match(await js(`document.querySelector('.grid-generator').textContent`),/30 banken/);
    assert.equal(await js(`document.querySelector('#grid-first-row').value`),'1');
    assert.equal(await js(`document.querySelectorAll('[data-grid-bench]').length`),30);
    assert.equal(await js(`document.querySelector('[data-grid-bench="grid-A1"] .grid-table').getAttribute('y')`),'96');
    const firstAxis=await js(`document.querySelector('[data-axis-seat-row="1"] text').getAttribute('y')`);
    await action('undo');assert.equal(await js(`document.querySelectorAll('[data-grid-bench]').length`),0);
    await action('redo');assert.equal(await js(`document.querySelectorAll('[data-grid-bench]').length`),30);
    assert.equal(await js(`document.querySelector('[data-axis-seat-row="1"] text').getAttribute('y')`),firstAxis);
    // The adjacent apply button updates both dimensions; Enter applies them too.
    assert.equal(await js(`document.querySelector('[data-editor-action="generate"]').textContent`),'Toepassen');
    await js(`document.querySelector('#grid-to').value='G';document.querySelector('#grid-rows').value=6;document.querySelector('[data-editor-action="generate"]').click();`);
    assert.match(await js(`document.querySelector('.grid-generator').textContent`),/42 banken/);
    assert.equal(await js(`document.querySelectorAll('[data-axis-column]').length`),7);
    await action('undo');assert.match(await js(`document.querySelector('.grid-generator').textContent`),/30 banken/);
    await js(`document.querySelector('#grid-from').value='b';document.querySelector('#grid-rows').value=4;document.querySelector('#grid-rows').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
    assert.match(await js(`document.querySelector('.grid-generator').textContent`),/20 banken/);
    assert.equal(await js(`document.querySelector('#grid-from').value`),'B');
    assert.equal(await js(`document.querySelectorAll('[data-axis-seat-row]').length`),8);
    await action('undo');assert.match(await js(`document.querySelector('.grid-generator').textContent`),/30 banken/);
    // Remove B3, then move C4 into its empty slot; C4 remains vacant after regeneration.
    await selectAt(6,13);assert.match(await js(`document.querySelector('.bench-properties h3').textContent`),/B5 \/ B6/);await action('delete');
    await selectAt(12,19);assert.match(await js(`document.querySelector('.bench-properties h3').textContent`),/C7 \/ C8/);
    await js(`document.querySelector('#bench-gx').value=6;document.querySelector('#bench-gy').value=13;document.querySelector('[data-editor-action="position"]').click();`);await action('rotate');assert.equal(await js(`document.querySelector('#bench-facing').value`),'left');
    await js(`document.querySelector('.visual-settings').open=true;document.querySelector('#gap-after').value='B';document.querySelector('#gap-width').value=2;document.querySelector('[data-editor-action="gap"]').click();`);
    assert.equal(await js(`document.querySelector('.visual-settings').open`),true);
    await js(`document.querySelector('#section-after').value='D';document.querySelector('#section-name').value='Extra';document.querySelector('#section-width').value=12;document.querySelector('[data-editor-action="section"]').click();`);
    await action('student');await selectAt(26,6);await js(`document.querySelector('#bench-capacity').value=1;document.querySelector('#bench-capacity').dispatchEvent(new Event('change'));`);
    await action('student');await selectAt(32,6);await action('rotate');
    assert.match(await js(`document.querySelector('.bench-properties h3').textContent`),/EXT3 \/ EXT4/);
    // Drag a new table from the palette directly into Extra, then remove it.
    const paletteDrop=await js(`(()=>{const button=document.querySelector('[data-editor-action="student"]');button.scrollIntoView({block:'start'});const a=button.getBoundingClientRect(),svg=document.querySelector('#layout-grid'),p=new DOMPoint(40+26*32+8,64+18*32+8).matrixTransform(svg.getScreenCTM());return {a:{x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2)},b:{x:Math.round(p.x),y:Math.round(p.y)}};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',...paletteDrop.a,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',...paletteDrop.b});win.webContents.sendInputEvent({type:'mouseUp',...paletteDrop.b,button:'left',clickCount:1});await frame();
    assert.match(await js(`document.querySelector('.bench-properties h3').textContent`),/EXT5 \/ EXT6/);await action('delete');
    await action('teacher');await selectAt(52,1);
    assert.equal(await js(`document.querySelector('[data-editor-action="delete"]').disabled`),false);
    await action('delete');await action('generate');assert.match(await js(`document.querySelector('.grid-generator').textContent`),/31 banken/);
    assert.match(await js(`document.querySelector('[data-editor-action="teacher"]').textContent`),/plaatsen/);
    assert.equal(await js(`document.querySelector('[data-axis-seat-row="1"] text').getAttribute('y')`),firstAxis);
    await action('undo');await action('undo');await action('teacher');assert.equal(await js(`document.querySelector('.bench-properties h3').textContent`),'Leerkracht');
    await js(`document.querySelector('#bench-gx').value=52;document.querySelector('#bench-gy').value=0;document.querySelector('[data-editor-action="position"]').click();`);await action('rotate');
    // Undo/redo restores the teacher's visual direction without changing capacity.
    await action('undo');assert.equal(await js(`document.querySelector('#bench-facing').value`),'down');await action('redo');assert.equal(await js(`document.querySelector('#bench-facing').value`),'left');
    // Both axes stay visible while scrolling; row spacing is saved separately.
    await js(`document.querySelector('.visual-settings').open=true;document.querySelector('#gap-axis').value='row';document.querySelector('#gap-axis').dispatchEvent(new Event('change'));document.querySelector('#row-gap-after').value='3';document.querySelector('#gap-width').value=1;document.querySelector('[data-editor-action="gap"]').click();`);
    await selectAt(8,13);
    assert.match(await js(`document.querySelector('.bench-properties h3').textContent`),/B5 \/ B6/);
    const scrollPosition=()=>js(`({left:document.querySelector('.grid-scroll').scrollLeft,top:document.querySelector('.grid-scroll').scrollTop,page:window.scrollY,parent:document.querySelector('main').scrollTop})`);
    await js(`document.querySelector('.grid-scroll').scrollLeft=210;document.querySelector('.grid-scroll').scrollTop=480;window.scrollTo(0,200);`);await frame();
    const scrollBefore=await scrollPosition();
    await js(`document.querySelector('#bench-enabled').click();`);assert.deepEqual(await scrollPosition(),scrollBefore);
    await js(`document.querySelector('#bench-enabled').click();`);assert.deepEqual(await scrollPosition(),scrollBefore);
    await action('copy');assert.deepEqual(await scrollPosition(),scrollBefore);
    await action('rotate');assert.deepEqual(await scrollPosition(),scrollBefore);
    await action('delete');assert.deepEqual(await scrollPosition(),scrollBefore);
    assert.equal(await js(`document.querySelector('#grid-top-axis').getBoundingClientRect().top===document.querySelector('.grid-shell').getBoundingClientRect().top+1`),true);
    await action('generate');await action('save');let s=await state(),room=s.rooms.find(r=>r.name==='Rastervoorbeeld');
    assert.equal(room.layout.version,2);assert.deepEqual(room.layout.grid,{from:'A',to:'F',rows:5,firstRow:1});assert.equal(room.layout.benches.length,32,JSON.stringify(room.layout.benches.filter(b=>!b.cell)));assert.equal(room.layout.benches.some(b=>b.code==='C4'),false);
    assert.equal(room.layout.benches.find(b=>b.id==='grid-C4').gy,13);assert.equal(room.layout.benches.find(b=>b.id==='grid-C4').facing,'left');
    assert.deepEqual(room.layout.gaps,[{after:'B',width:2}]);assert.equal(room.layout.sections[0].name,'Extra');
    assert.deepEqual(room.layout.rowGaps,[{after:3,width:1}]);
    const manual=room.layout.benches.filter(b=>b.sectionId);assert.equal(manual.length,2);assert.deepEqual(manual.map(b=>b.capacity),[1,2]);assert.equal(manual[1].facing,'left');assert.equal(room.layout.benches.find(b=>b.kind==='teacher').facing,'left');
    const saved=structuredClone(room);await win.loadFile(path.join(root,'src','index.html'));s=await state();room=s.rooms.find(r=>r.id===saved.id);assert.deepEqual(room,saved);
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-edit="${room.id}"]').click();document.querySelector('.grid-scroll').scrollTop=0;document.querySelector('.grid-scroll').dispatchEvent(new Event('scroll'));window.scrollTo(0,0);`);
    await frame();await fs.writeFile(path.join(root,'artifacts','desktop-grid-editor.png'),(await win.webContents.capturePage()).toPNG());
    // Widen, rename and remove visual features without losing manually placed tables.
    const sectionId=room.layout.sections[0].id;
    await js(`document.querySelector('.visual-settings').open=true;document.querySelector('[data-editor-section="${sectionId}"]').click();document.querySelector('#section-name').value='Computers';document.querySelector('#section-width').value=18;document.querySelector('[data-editor-action="section"]').click();`);
    const areaCodes=prefix=>js(`Array.from(document.querySelectorAll('#layout-grid [data-code]'),el=>el.dataset.code).filter(code=>code.startsWith('${prefix}')).sort()`);
    assert.deepEqual(await areaCodes('COM'),['COM1','COM3','COM4']);
    await action('undo');assert.deepEqual(await areaCodes('EXT'),['EXT1','EXT3','EXT4']);
    await action('redo');assert.deepEqual(await areaCodes('COM'),['COM1','COM3','COM4']);
    await js(`document.querySelector('[data-editor-remove-gap="B"]').click();document.querySelector('[data-editor-remove-section="${sectionId}"]').click();`);
    assert.deepEqual(await areaCodes('COM'),['COM1','COM3','COM4']);
    await action('save');s=await state();room=s.rooms.find(r=>r.id===saved.id);assert.equal(room.layout.sections.length,0);assert.equal(room.layout.gaps.length,0);assert.equal(room.layout.benches.length,32);assert.ok(manual.every(b=>room.layout.benches.some(x=>x.id===b.id)));
    // Opening the room includes the named area and renders exactly one teacher chair.
    await js(`document.querySelector('[data-room-open="${room.id}"]').click();`);assert.equal(await js(`document.querySelectorAll('#room .seat').length`),61);assert.equal(await js(`document.querySelectorAll('#room .teacher-bench .chair').length`),1);
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('#room [data-code]'),el=>el.dataset.code).filter(code=>code.startsWith('COM')).sort()`),['COM1','COM3','COM4']);
    // A large grid uses compact browser storage and reopens as the same layout.
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-action="new"]').click();document.querySelector('#new-room-name').value='Groot raster';document.querySelector('#room-dialog-save').click();document.querySelector('#grid-to').value='H';document.querySelector('#grid-rows').value=8;document.querySelector('[data-editor-action="generate"]').click();`);
    assert.match(await js(`document.querySelector('.grid-generator').textContent`),/64 banken/);assert.equal(await js(`document.querySelectorAll('[data-axis-column]').length`),8);assert.equal(await js(`document.querySelectorAll('[data-axis-row]').length`),8);
    await js(`document.querySelector('#grid-to').value='Z';document.querySelector('#grid-rows').value=20;document.querySelector('[data-editor-action="generate"]').click();`);
    await selectAt(6,13);await action('delete');await action('save');
    assert.equal(await js(`JSON.parse(localStorage.getItem('klaslokaal-v1')).rooms.find(r=>r.name==='Groot raster').layout.packedGrid`),true);
    const large=(await state()).rooms.find(r=>r.name==='Groot raster');assert.equal(large.layout.benches.length,519);
    await win.loadFile(path.join(root,'src','index.html'));assert.deepEqual((await state()).rooms.find(r=>r.id===large.id),large);
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-edit="${large.id}"]').click();`);assert.match(await js(`document.querySelector('.grid-generator').textContent`),/519 banken/);
    // Applying smaller ranges trims both canvas axes, including after save/reload.
    const canvasSize=()=>js(`({width:document.querySelector('#layout-grid').viewBox.baseVal.width,height:document.querySelector('#layout-grid').viewBox.baseVal.height})`);
    const largeSize=await canvasSize();
    await js(`document.querySelector('.grid-scroll').scrollTop=100000;document.querySelector('#grid-rows').value=3;document.querySelector('[data-editor-action="generate"]').click();`);await frame();
    const shorterSize=await canvasSize();assert.ok(shorterSize.height<largeSize.height);assert.equal(shorterSize.width,largeSize.width);
    assert.equal(await js(`document.querySelectorAll('[data-axis-seat-row]').length`),6);
    await action('undo');assert.deepEqual(await canvasSize(),largeSize);await action('redo');assert.deepEqual(await canvasSize(),shorterSize);
    await js(`document.querySelector('.grid-scroll').scrollLeft=100000;document.querySelector('#grid-to').value='C';document.querySelector('[data-editor-action="generate"]').click();`);await frame();
    const smallerSize=await canvasSize();assert.ok(smallerSize.width<shorterSize.width);assert.equal(smallerSize.height,shorterSize.height);
    assert.equal(await js(`document.querySelectorAll('[data-axis-column]').length`),3);
    assert.match(await js(`document.querySelector('.grid-generator').textContent`),/8 banken/);
    await action('undo');assert.deepEqual(await canvasSize(),shorterSize);await action('redo');assert.deepEqual(await canvasSize(),smallerSize);
    await action('save');const smaller=(await state()).rooms.find(r=>r.id===large.id);assert.equal(smaller.layout.columns,22);assert.equal(smaller.layout.rows,23);
    assert.deepEqual(smaller.layout.benches.map(b=>b.id).sort(),large.layout.benches.filter(b=>['A','B','C'].includes(b.cell.column)&&b.cell.row<=3).map(b=>b.id).sort());
    await win.loadFile(path.join(root,'src','index.html'));assert.deepEqual((await state()).rooms.find(r=>r.id===large.id),smaller);
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-edit="${large.id}"]').click();`);assert.deepEqual(await canvasSize(),smallerSize);
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'A–F / 1–5, removal, movement, rotation, gap, named section, manual one/two-seat tables, teacher, undo/redo, regeneration, save/reload, visual feature edits, row/column canvas shrink'}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
