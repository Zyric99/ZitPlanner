const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','weekly-profile'));app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  try {
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code),state=()=>js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`),errors=[];
    win.webContents.on('console-message',event=>{if(event.level==='error'){errors.push(event.message);console.error('Renderer:',event.message);}});
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{const e=await import('./engine.mjs'),p=await import('./student-import.mjs');const s=e.defaults();s.students=p.parseStudentRows([p.STUDY_HEADERS,['Anoniem','Piet','DEMO-1BASa1','Nee','Nee','Nee','Nee'],['Bibber','Bert','DEMO-1BASa1','Ja','Nee','Ja','Nee'],['Claeys','Mirthe','DEMO-1BASa1','Ja','Ja','Ja','Ja']]).students;localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));
    // Seed an existing week to verify compatibility; new weeks have no UI action.
    const loadWeek=async keep=>{
      await js(`(async()=>{const w=await import('./weekly-planner.mjs'),s=JSON.parse(localStorage.getItem('klaslokaal-v1'));s.weeklyPlans=w.generateWeek(s,{keepSeats:${keep!==false}});for(const p of s.students)p.absent=s.weeklyPlans.baselineAbsent[p.id]??p.absent;w.applyWeeklyDay(s,'maandag',{capture:false});localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
      await win.loadFile(path.join(root,'src','index.html'));
      return state();
    };
    let s=await loadWeek();const bert=s.students[1].id,mirthe=s.students[2].id;
    assert.equal(await js(`document.querySelector('#navigation [data-tab="room"]').classList.contains('active')`),true);
    assert.equal(s.weeklyPlans.keepSeats,true);assert.deepEqual(Object.values(s.weeklyPlans.days).map(d=>d.presentIds.length),[2,1,2,1]);
    const seatFor=(daily,id)=>Object.entries(daily.assignments.standaardlokaal).find(([,p])=>p===id)?.[0];
    assert.equal(seatFor(s.weeklyPlans.days.maandag,bert),seatFor(s.weeklyPlans.days.donderdag,bert));
    assert.equal(new Set(Object.values(s.weeklyPlans.days).map(d=>seatFor(d,mirthe))).size,1);
    const select=async day=>{await js(`document.querySelector('#weekly-day').value='${day}';document.querySelector('#weekly-day').dispatchEvent(new Event('change'));`);return state();};
    s=await select('dinsdag');assert.equal(s.students[1].absent,true);assert.equal(s.students[2].absent,false);assert.equal(Object.values(s.assignments).length,1);
    await js(`document.querySelector('[data-tab="students"]').click();document.querySelector('[data-person="${bert}"]').click();`);
    assert.equal(await js(`document.querySelector('#edit-absent')`),null);
    assert.equal(await js(`document.querySelectorAll('[data-absent], [data-student-row].absent').length`),0);
    assert.equal(await js(`document.querySelector('#sidebar-content').textContent.includes('Afwezig')`),false);
    await js(`document.querySelector('#edit-submit').click();document.querySelector('[data-tab="room"]').click();`);
    assert.equal((await state()).students[1].absent,true);
    s=await select('maandag');assert.equal(s.students[1].absent,false);assert.equal(Object.values(s.assignments).length,2);
    // Editing one day survives switching days and reopening the app.
    const oldSeat=Object.keys(s.assignments).find(seat=>s.assignments[seat]===bert);
    const target=await js(`document.querySelector('#room .seat.empty').dataset.seat`);
    await js(`document.querySelector('[data-seat="${oldSeat}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('[data-action="move-student"]').click();document.querySelector('[data-seat="${target}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));`);
    assert.equal((await state()).assignments[target],bert);
    await select('dinsdag');s=await select('maandag');assert.equal(s.assignments[target],bert);
    await win.loadFile(path.join(root,'src','index.html'));s=await state();assert.equal(s.weeklyPlans.activeDay,'maandag');assert.equal(s.assignments[target],bert);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(root,'artifacts','weekly-planning.png'),(await win.webContents.capturePage()).toPNG());
    const output=path.join(root,'artifacts','desktop-weekly.xlsx');
    const downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(output);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('[data-tab=export]').click();document.querySelector('#export-format').value='xlsx';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-scope').value='week';document.querySelector('#export-scope').dispatchEvent(new Event('change'));document.querySelector('#export-submit').click();`);await downloaded;
    const bytes=Array.from(await fs.readFile(output)),sheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(bytes)}));})()`);
    assert.deepEqual(sheets[0].rows[0],['Dag','Naam','Plaats']);assert.equal(sheets[0].rows.length,7);
    assert.deepEqual(sheets[0].rows.slice(1).map(row=>row[0]),['Maandag','Donderdag','Maandag','Dinsdag','Donderdag','Vrijdag']);
    await js(`document.querySelector('[data-export-column=day]').click();document.querySelector('#export-scope').value='room';document.querySelector('#export-scope').dispatchEvent(new Event('change'));document.querySelector('#export-format').value='csv';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-format').value='xlsx';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-scope').value='week';document.querySelector('#export-scope').dispatchEvent(new Event('change'));`);
    assert.equal(await js(`document.querySelector('[data-export-column=day]').checked`),false);
    s=await loadWeek(false);assert.equal(s.weeklyPlans.keepSeats,false);
    // Editing a class while a day is active restores the manual baseline,
    // without an absence control or an accidental persisted day-specific absence.
    await select('dinsdag');await js(`document.querySelector('[data-tab="students"]').click();document.querySelector('[data-person="${bert}"]').click();document.querySelector('#edit-class').value='2A';document.querySelector('#edit-class').dispatchEvent(new Event('input'));document.querySelector('#edit-submit').click();`);
    s=await state();assert.equal(s.students[1].absent,false);assert.equal(s.students[1].class,'2A');assert.equal(s.students[2].absent,false);assert.ok(!s.weeklyPlans);
    // Three alternating pairs need a seat change in a two-seat room, even
    // though every day fits. All movements appear in a single warning.
    await js(`(async()=>{const e=await import('./engine.mjs'),p=await import('./student-import.mjs');const s=e.defaults();s.settings.classRulesEnabled=false;s.settings.yearRulesEnabled=false;s.students=p.parseStudentRows([p.STUDY_HEADERS,['Alpha','A','1A','Ja','Nee','Ja','Ja'],['Beta','B','1A','Ja','Ja','Nee','Ja'],['Gamma','C','1A','Nee','Ja','Ja','Nee']]).students;let n=0;for(const b of s.settings.layout.benches)if(b.kind==='student'){b.enabled=n++<2;b.capacity=1;}localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));s=await loadWeek();
    assert.ok(s.weeklyPlans.changes.length>0);assert.ok(Object.values(s.weeklyPlans.days).every(day=>day.unplaced.length===0));
    assert.equal(await js(`document.querySelectorAll('#weekly-warning:not([hidden])').length`),1);
    assert.equal(await js(`document.querySelectorAll('#weekly-warning li').length`),s.weeklyPlans.changes.length);
    await js(`document.querySelector('#weekly-warning').open=true;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(root,'artifacts','weekly-seat-change-warning.png'),(await win.webContents.capturePage()).toPNG());
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'existing-week compatibility, actual attendance, stable seats, day switching, daily manual edits and reload, weekly XLSX download, keep-seats opt-out, absence baseline'}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
