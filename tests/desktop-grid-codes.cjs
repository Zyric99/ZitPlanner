const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','grid-codes-profile'));
app.whenReady().then(async()=>{
  try{
    const win=new BrowserWindow({show:false,width:1600,height:1100,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const errors=[];win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
    const js=code=>win.webContents.executeJavaScript(code),frame=()=>js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const action=name=>js(`document.querySelector('[data-editor-action="${name}"]').click()`);
    const title=()=>js(`document.querySelector('.bench-properties h3').textContent`);
    const clickAt=async(gx,gy)=>{
      await js(`(()=>{const v=document.querySelector('.grid-scroll'),z=Number(document.querySelector('#editor-zoom').value);v.scrollIntoView({block:'start'});v.scrollLeft=Math.max(0,(${gx}*32+40)*z-v.clientWidth/2);v.scrollTop=Math.max(0,(${gy}*32+64)*z-v.clientHeight/2);v.dispatchEvent(new Event('scroll'));})()`);await frame();
      const p=await js(`(()=>{const p=new DOMPoint(40+${gx}*32+8,64+${gy}*32+8).matrixTransform(document.querySelector('#layout-grid').getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)};})()`);
      win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await frame();
    };
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{const {defaults}=await import('./engine.mjs');localStorage.setItem('klaslokaal-v1',JSON.stringify(defaults()));})()`);await win.loadFile(path.join(root,'src','index.html'));
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-edit="standaardlokaal"]').click();document.querySelector('#editor-zoom').value=.25;document.querySelector('#editor-zoom').dispatchEvent(new Event('change'));`);
    // V1 is at visual x=89 after the default's aisles. Drag into empty V7/V8.
    await clickAt(89,1);assert.match(await title(),/V1 \/ V2/);
    const points=await js(`(()=>{const svg=document.querySelector('#layout-grid'),point=gy=>{const p=new DOMPoint(40+89*32+8,64+gy*32+8).matrixTransform(svg.getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)};};return {from:point(1),to:point(19)};})()`);
    win.webContents.sendInputEvent({type:'mouseDown',...points.from,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',...points.to});await frame();
    assert.deepEqual(await js(`Array.from(document.querySelectorAll('#placement-preview [data-code]'),e=>e.dataset.code)`),['V7','V8']);
    win.webContents.sendInputEvent({type:'mouseUp',...points.to,button:'left',clickCount:1});await frame();assert.match(await title(),/V7 \/ V8/);
    await action('undo');assert.match(await title(),/V1 \/ V2/);await action('redo');assert.match(await title(),/V7 \/ V8/);
    await js(`document.querySelector('#layout-grid').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))`);assert.match(await title(),/W7 \/ W8/);
    await js(`document.querySelector('#layout-grid').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}))`);assert.match(await title(),/W7 \/ W8/); // W5/W6 is occupied.
    await js(`document.querySelector('#bench-capacity').value=1;document.querySelector('#bench-capacity').dispatchEvent(new Event('change'))`);assert.equal(await title(),'Plaatsen W7');
    await js(`document.querySelector('#bench-capacity').value=2;document.querySelector('#bench-capacity').dispatchEvent(new Event('change'))`);assert.match(await title(),/W7 \/ W8/);
    // Click the lower half of V7/V8; both chair rows select the same paired slot.
    await action('student');await clickAt(89,22);assert.match(await title(),/V7 \/ V8/);
    await action('student');await clickAt(89,1);assert.match(await title(),/V1 \/ V2/);
    await action('generate');await action('save');
    const saved=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1')).settings.layout`);
    assert.deepEqual(saved.benches.find(b=>b.id==='grid-V1').cell,{column:'W',row:4});
    assert.equal(saved.benches.filter(b=>b.cell?.column==='V'&&b.cell.row===4).length,1);
    assert.equal(saved.benches.filter(b=>b.cell?.column==='V'&&b.cell.row===1).length,1);
    await win.loadFile(path.join(root,'src','index.html'));assert.deepEqual(await js(`JSON.parse(localStorage.getItem('klaslokaal-v1')).settings.layout`),saved);
    await js(`document.querySelector('[data-tab="rooms"]').click();document.querySelector('[data-room-edit="standaardlokaal"]').click();document.querySelector('#editor-zoom').value=.25;document.querySelector('#editor-zoom').dispatchEvent(new Event('change'));`);
    await clickAt(89,19);assert.match(await title(),/V7 \/ V8/);
    await fs.writeFile(path.join(root,'artifacts','desktop-grid-codes.png'),(await win.webContents.capturePage()).toPNG());
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'real drag and preview V7/V8, undo/redo, keyboard cell movement, occupied cell rejection, one/two chairs, new bench at even chair row, regeneration, save/reload'}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
