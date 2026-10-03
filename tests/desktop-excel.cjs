const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');app.setPath('userData',path.join(root,'artifacts','excel-profile'));
app.disableHardwareAcceleration();
// Rewrite a stored worksheet without changing ZIP offsets; refresh both CRCs.
function worksheetFixture(input,id,from,to) {
  assert.equal(Buffer.byteLength(from),Buffer.byteLength(to));
  const bytes=Buffer.from(input),name=`xl/worksheets/sheet${id}.xml`;let cursor=0,crc;
  while(bytes.readUInt32LE(cursor)===0x04034b50) {
    const size=bytes.readUInt32LE(cursor+18),length=bytes.readUInt16LE(cursor+26),extra=bytes.readUInt16LE(cursor+28),start=cursor+30+length+extra;
    if(bytes.toString('utf8',cursor+30,cursor+30+length)===name) {
      const body=bytes.toString('utf8',start,start+size);assert.ok(body.includes(from));
      Buffer.from(body.replace(from,to)).copy(bytes,start);
      crc=0xffffffff;for(const value of bytes.subarray(start,start+size)){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
      bytes.writeUInt32LE(crc,cursor+14);
    }
    cursor=start+size;
  }
  assert.notEqual(crc,undefined);
  while(bytes.readUInt32LE(cursor)===0x02014b50) {
    const length=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32);
    if(bytes.toString('utf8',cursor+46,cursor+46+length)===name)bytes.writeUInt32LE(crc,cursor+16);
    cursor+=46+length+extra+comment;
  }
  return Array.from(bytes);
}
app.whenReady().then(async()=>{
  try {
    const win=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    const js=code=>win.webContents.executeJavaScript(code),errors=[];win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
    await win.loadFile(path.join(root,'src','index.html'));
    await js(`(async()=>{const e=await import('./engine.mjs');localStorage.setItem('klaslokaal-v1',JSON.stringify(e.defaults()));})()`);
    await win.loadFile(path.join(root,'src','index.html'));
    const example=await js(`(async()=>{const {tableWorkbook}=await import('./excel-export.mjs');return Array.from(tableWorkbook(['Naam hoofdaccount','Voornaam hoofdaccount','Klas','Avondstudie op maandag','Avondstudie op dinsdag','Avondstudie op donderdag','Avondstudie op vrijdag'],[['Voorbeeld A','Leerling 1','1A','Nee','Nee','Nee','Nee'],['Voorbeeld B','Leerling 2','1A','Ja','Nee','Ja','Nee'],['Voorbeeld C','Leerling 3','1A','Nee','Ja','Nee','Ja']],{sheetName:'Testleerlingen'}));})()`);
    const parsed=await js(`(async()=>{const x=await import('./excel-import.mjs'),p=await import('./student-import.mjs');const sheets=await x.workbookSheets(new Uint8Array(${JSON.stringify(example)}));return {sheets,result:p.parseStudentRows(sheets[0].rows)};})()`);
    assert.equal(parsed.sheets[0].name,'Testleerlingen');assert.deepEqual(parsed.result.errors,[]);assert.equal(parsed.result.students.length,3);
    assert.deepEqual(parsed.result.students.map(p=>p.name),['Leerling 1 Voorbeeld A','Leerling 2 Voorbeeld B','Leerling 3 Voorbeeld C']);assert.ok(parsed.result.students.every(p=>p.year==='1'));
    // Exercise actual file input -> preview -> import -> local persistence.
    await js(`document.querySelector('[data-tab="students"]').click();document.querySelector('#import-top').click();const data=new DataTransfer();data.items.add(new File([new Uint8Array(${JSON.stringify(example)})],'Testleerlingen.xlsx'));const input=document.querySelector('#import-file');input.files=data.files;input.dispatchEvent(new Event('change'));`);
    await js(`new Promise((resolve,reject)=>{const started=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#import-submit').disabled){clearInterval(timer);resolve();}else if(Date.now()-started>10000){clearInterval(timer);reject(Error('Import timeout'));}},20);})`);
    await js(`document.querySelector('#import-submit').click();`);assert.match(await js(`document.querySelector('#import-preview').textContent`),/3 geldige leerlingen/);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(root,'artifacts','excel-import-preview.png'),(await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#import-submit').click();`);
    let state=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);assert.equal(state.students.length,3);assert.equal(state.students[1].eveningStudy.maandag,'Ja');
    await win.loadFile(path.join(root,'src','index.html'));
    state=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);assert.equal(state.students[1].lastName,'Voorbeeld B');
    await js(`document.querySelector('[data-tab="students"]').click();document.querySelector('[data-person="${state.students[1].id}"]').click();document.querySelector('#edit-first-name').value='Bért';document.querySelector('[data-study-day="vrijdag"]').value='Ja';document.querySelector('#edit-submit').click();`);
    state=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);assert.equal(state.students[1].name,'Bért Voorbeeld B');assert.equal(state.students[1].eveningStudy.vrijdag,'Ja');
    const outputPath=path.join(root,'artifacts','desktop-study-layout.xlsx');
    const downloaded=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(outputPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('#export').click();document.querySelector('#export-format').value='study-xlsx';document.querySelector('#export-format').dispatchEvent(new Event('change'));document.querySelector('#export-submit').click();`);await downloaded;
    const output=Array.from(await fs.readFile(outputPath));
    const roundTrip=await js(`(async()=>{const x=await import('./excel-import.mjs'),p=await import('./student-import.mjs');const sheets=await x.workbookSheets(new Uint8Array(${JSON.stringify(output)}));return {rows:sheets[0].rows,result:p.parseStudentRows(sheets[0].rows)};})()`);
    assert.deepEqual(roundTrip.rows[0],parsed.sheets[0].rows[0]);assert.equal(roundTrip.rows[1].length,7);assert.deepEqual(roundTrip.result.errors,[]);
    assert.deepEqual(roundTrip.result.students.map(({id,...p})=>p),state.students.map(({id,...p})=>p));
    // Existing seating exports can also be imported as a student roster.
    const standard=await js(`(async()=>{const x=await import('./excel-import.mjs'),p=await import('./student-import.mjs'),e=await import('./excel-export.mjs');const sheets=await x.workbookSheets(e.seatingWorkbook(JSON.parse(localStorage.getItem('klaslokaal-v1'))));return p.parseStudentRows(sheets[0].rows);})()`);
    assert.equal(standard.students.length,3);assert.deepEqual(standard.errors,[]);
    // The real export dialog projects the chosen columns, keeps choices across
    // scope/format changes and downloads a workbook with one tab per class.
    await js(`(async()=>{const e=await import('./engine.mjs');const s=e.defaults();s.students=[{id:'z',name:'Ada Zulu',class:'2A',year:'2',absent:false},{id:'b',name:'Zoe Beta',class:'10B',year:'10',absent:false},{id:'a',name:'Anna Alpha',class:'2A',year:'2',absent:false}];s.assignments={'grid-B1:1':'z','grid-C2:0':'a'};localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));
    const setFormat=async format=>js(`document.querySelector('#export-format').value='${format}';document.querySelector('#export-format').dispatchEvent(new Event('change'));`);
    await js(`document.querySelector('#export').click()`);assert.equal(await js(`document.querySelector('#export-format').value`),'xlsx');
    assert.equal(await js(`document.querySelector('#export-columns-field').hidden`),false);assert.equal(await js(`document.querySelector('#export-separate-classes').checked`),true);
    await setFormat('xlsx');assert.equal(await js(`document.querySelector('#export-columns-field').hidden`),false);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','seat']);
    await js(`document.querySelector('#export-scope').value='all';document.querySelector('#export-scope').dispatchEvent(new Event('change'));`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','seat']);
    assert.equal(await js(`document.querySelector('#export-separate-classes').checked`),true);
    await js(`document.querySelectorAll('[data-export-column]:checked').forEach(el=>el.click())`);
    assert.equal(await js(`document.querySelector('#export-submit').disabled`),true);assert.match(await js(`document.querySelector('#export-error').textContent`),/minstens één/);
    await js(`document.querySelector('[data-export-column="lastName"]').click();document.querySelector('[data-export-column="firstName"]').click();`);
    assert.equal(await js(`document.querySelector('#export-submit').disabled`),false);
    await js(`document.querySelector('#export-separate-classes').click()`);
    await setFormat('csv');assert.equal(await js(`document.querySelector('#export-columns-field').hidden`),true);assert.equal(await js(`document.querySelector('#export-submit').disabled`),false);
    await setFormat('study-xlsx');assert.equal(await js(`document.querySelectorAll('[data-export-column]:checked').length`),7);
    assert.equal(await js(`document.querySelector('[data-export-column=seat]').checked`),false);
    await js(`document.querySelector('[data-export-column=seat]').click()`);
    await setFormat('csv');await setFormat('study-xlsx');
    assert.equal(await js(`document.querySelector('[data-export-column=seat]').checked`),true);
    await setFormat('xlsx');assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['lastName','firstName']);
    assert.equal(await js(`document.querySelector('#export-separate-classes').checked`),false);
    await js(`document.querySelector('#export-separate-classes').click()`);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(root,'artifacts','desktop-excel-export-options.png'),(await win.webContents.capturePage()).toPNG());
    const selectedPath=path.join(root,'artifacts','desktop-excel-selected-columns.xlsx');
    const selectedDownload=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(selectedPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('#export-submit').click()`);await selectedDownload;
    const selectedBytes=Array.from(await fs.readFile(selectedPath));
    const selectedSheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(selectedBytes)}));})()`);
    assert.deepEqual(selectedSheets.map(sheet=>sheet.name),['2A','10B']);
    assert.deepEqual(selectedSheets[0].rows,[['Achternaam','Voornaam'],['Alpha','Anna'],['Zulu','Ada']]);
    assert.deepEqual(selectedSheets[1].rows,[['Achternaam','Voornaam'],['Beta','Zoe']]);
    // A newly opened example-layout export defaults back to seven columns.
    await js(`document.querySelector('[data-tab=students]').click();document.querySelector('[data-action=export-students]').click()`);
    assert.equal(await js(`document.querySelector('[data-export-column=seat]').checked`),false);
    await js(`document.querySelector('[data-export-column=seat]').click()`);
    const studySeatsPath=path.join(root,'artifacts','desktop-study-layout-seats.xlsx');
    const studySeatsDownload=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(studySeatsPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('#export-submit').click()`);await studySeatsDownload;
    const studySeatsBytes=Array.from(await fs.readFile(studySeatsPath));
    const studySeatsSheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(studySeatsBytes)}));})()`);
    assert.deepEqual(studySeatsSheets.map(sheet=>sheet.name),['2A','10B']);
    assert.equal(studySeatsSheets[0].rows[0].length,8);assert.equal(studySeatsSheets[0].rows[0].at(-1),'Plaats');
    assert.deepEqual(studySeatsSheets[0].rows.slice(1).map(row=>row.at(-1)),['C3','B2']);
    assert.equal(studySeatsSheets[1].rows[1].at(-1),'Nog niet geplaatst');
    await js(`document.querySelector('#export').click();document.querySelector('#export-scope').value='all';document.querySelector('#export-scope').dispatchEvent(new Event('change'));document.querySelector('#export-separate-classes').click();document.querySelectorAll('[data-export-column]:checked').forEach(el=>el.click());document.querySelector('[data-export-column="lastName"]').click();document.querySelector('[data-export-column="firstName"]').click();`);
    const combinedPath=path.join(root,'artifacts','desktop-excel-combined.xlsx');
    const combinedDownload=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(combinedPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('#export-submit').click()`);await combinedDownload;
    const combinedBytes=Array.from(await fs.readFile(combinedPath));
    const combinedSheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(combinedBytes)}));})()`);
    assert.equal(combinedSheets.length,1);assert.deepEqual(combinedSheets[0].rows,[['Achternaam','Voornaam'],['Alpha','Anna'],['Beta','Zoe'],['Zulu','Ada']]);
    // Two classroom tabs share A1; their assigned names survive column moves
    // and switching between room/all-room scopes and export formats.
    await js(`(async()=>{const e=await import('./engine.mjs'),r=await import('./rooms.mjs');const s=e.defaults();s.students=[{id:'east',name:'Anna Alpha',class:'2A',year:'2',absent:false},{id:'west',name:'Zoe Beta',class:'2A',year:'2',absent:false}];r.initializeRooms(s);s.rooms[0].name='Zaal Oost';const other=r.newRoom(s,'Zaal West','default');r.assignRoom(s,'west',other.id);s.assignments={'grid-A1:0':'east'};other.assignments={'grid-A1:0':'west'};r.captureRoom(s);localStorage.setItem('klaslokaal-v1',JSON.stringify(s));})()`);
    await win.loadFile(path.join(root,'src','index.html'));
    const dragColumn=async(id,target,after)=>{
      const points=await js(`(()=>{const a=document.querySelector('[data-export-drag="${id}"]').getBoundingClientRect(),b=document.querySelector('[data-column-row="${target}"]').getBoundingClientRect();return {from:{x:Math.round(a.x+a.width/2),y:Math.round(a.y+a.height/2)},to:{x:Math.round(b.x+24),y:Math.round(b.y+b.height*${after?0.75:0.25})}};})()`);
      win.webContents.sendInputEvent({type:'mouseMove',...points.from});
      win.webContents.sendInputEvent({type:'mouseDown',...points.from,button:'left',clickCount:1});
      for(let step=1;step<=8;step++)win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(points.from.x+(points.to.x-points.from.x)*step/8),y:Math.round(points.from.y+(points.to.y-points.from.y)*step/8)});
      win.webContents.sendInputEvent({type:'mouseUp',...points.to,button:'left',clickCount:1});
      await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    };
    await js(`document.querySelector('#export').click();document.querySelector('[data-export-column=room]').click();`);
    assert.equal(await js(`document.querySelector('#export-columns-field').contains(document.querySelector('#export-separate-classes'))`),false);
    assert.ok(await js(`document.querySelector('#export-sheet-options').getBoundingClientRect().top-document.querySelector('#export-columns-field').getBoundingClientRect().bottom>=20`));
    await dragColumn('room','seat',true);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','seat','room']);
    await js(`document.querySelector('#export-scope').value='all';document.querySelector('#export-scope').dispatchEvent(new Event('change'));`);
    await setFormat('study-xlsx');await setFormat('xlsx');
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','seat','room']);
    await dragColumn('room','name',false);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['room','name','seat']);
    await dragColumn('room','seat',false);
    assert.equal(await js(`document.querySelector('#export-separate-classes').checked`),true);
    await js(`document.querySelector('#export-separate-classes').click();`);
    assert.equal(await js(`document.querySelector('#export-separate-classes').checked`),false);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','room','seat']);
    await js(`document.querySelector('[data-export-drag=room]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','seat','room']);
    await js(`document.querySelector('[data-export-drag=room]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));`);
    assert.deepEqual(await js(`[...document.querySelectorAll('[data-export-column]:checked')].map(el=>el.dataset.exportColumn)`),['name','room','seat']);
    assert.equal(await js(`document.querySelectorAll('.is-dragging,.drop-before,.drop-after').length`),0);
    await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await fs.writeFile(path.join(root,'artifacts','desktop-excel-column-order.png'),(await win.webContents.capturePage()).toPNG());
    const roomOrderPath=path.join(root,'artifacts','desktop-excel-room-order.xlsx');
    const roomOrderDownload=new Promise((resolve,reject)=>win.webContents.session.once('will-download',(_event,item)=>{item.setSavePath(roomOrderPath);item.once('done',(_e,status)=>status==='completed'?resolve():reject(Error(status)));}));
    await js(`document.querySelector('#export-submit').click()`);await roomOrderDownload;
    const roomOrderBytes=Array.from(await fs.readFile(roomOrderPath));
    const roomOrderSheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(roomOrderBytes)}));})()`);
    assert.equal(roomOrderSheets.length,1);assert.deepEqual(roomOrderSheets[0].rows,[['Naam','Lokaal','Plaats'],['Anna Alpha','Zaal Oost','A1'],['Zoe Beta','Zaal West','A1']]);
    const rejected=await js(`(async()=>{const x=await import('./excel-import.mjs');try{await x.workbookSheets(new Uint8Array([1,2,3]));return false;}catch{return true;}})()`);assert.equal(rejected,true);
    // Real file import combines two class tabs and skips unrelated/broken tabs.
    const workbook=await js(`(async()=>{const e=await import('./engine.mjs'),x=await import('./excel-export.mjs');const s=e.defaults();s.students=[{id:'a',name:'Anna Alpha',class:'3A',year:'3'},{id:'b',name:'Bram Beta',class:'4B',year:'4'},{id:'o',name:'Overzicht',class:'Overzicht',year:'1'},{id:'z',name:'Beschadigd',class:'Z-Beschadigd',year:'1'}];return Array.from(x.seatingWorkbook(s));})()`);
    const badHeader=worksheetFixture(workbook,3,'>Naam</t>','>Info</t>');
    const multiWorkbook=worksheetFixture(badHeader,4,'<worksheet ','<worksheeX ');
    const parsedSheets=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(multiWorkbook)}));})()`);
    assert.equal(parsedSheets.length,4);assert.ok(parsedSheets[3].error);
    // Invalid text references and contradictory row/cell coordinates must be
    // reported, rather than importing the wrong name or overwriting a record.
    for(const [from,to,pattern] of [
      ['t="inlineStr"','t="s"        ',/tekstverwijzing/],
      ['t="inlineStr"','t="e"        ',/Excel-fout/],
      ['<row r="2"','<row r="1"',/geldig .xlsx/],
      ['r="A2"','r="A1"',/geldig .xlsx/]
    ]){
      const broken=worksheetFixture(workbook,1,from,to);
      const checked=await js(`(async()=>{const x=await import('./excel-import.mjs');return x.workbookSheets(new Uint8Array(${JSON.stringify(broken)}));})()`);
      assert.match(checked[0].error,pattern);assert.equal(checked[1].error,undefined);
    }
    const uploadWorkbook=async bytes=>{
      await js(`(()=>{document.querySelector('[data-tab=students]').click();document.querySelector('#import-top').click();const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})],'Klassen.xlsx'));const input=document.querySelector('#import-file');input.files=transfer.files;input.dispatchEvent(new Event('change'));})()`);
      await js(`new Promise((resolve,reject)=>{const start=Date.now(),timer=setInterval(()=>{if(!document.querySelector('#import-submit').disabled){clearInterval(timer);resolve();}else if(Date.now()-start>10000){clearInterval(timer);reject(Error('Workbook import timeout'));}},20);})`);
    };
    const beforeMulti=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);
    await uploadWorkbook(multiWorkbook);
    assert.equal(await js(`document.querySelector('#import-sheet').value`),'all');
    assert.equal(await js(`document.querySelectorAll('#import-sheet option:disabled').length`),2);
    assert.match(await js(`document.querySelector('#import-preview').textContent`),/Overzicht.*overgeslagen/);
    assert.match(await js(`document.querySelector('#import-preview').textContent`),/Z-Beschadigd.*overgeslagen/);
    await js(`document.querySelector('#import-submit').click()`);
    assert.match(await js(`document.querySelector('#import-preview').textContent`),/2 geldige leerlingen/);
    assert.deepEqual(await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`),beforeMulti);
    await js(`document.querySelector('[data-close]').click()`);
    await uploadWorkbook(multiWorkbook);
    // Individual tabs remain selectable, then switch back to importing all.
    await js(`document.querySelector('#import-sheet').value='1';document.querySelector('#import-sheet').dispatchEvent(new Event('change'));document.querySelector('#import-submit').click()`);
    assert.match(await js(`document.querySelector('#import-preview').textContent`),/1 geldige leerlingen/);
    await js(`document.querySelector('#import-sheet').value='all';document.querySelector('#import-sheet').dispatchEvent(new Event('change'));document.querySelector('#replace-list').click();document.querySelector('#import-submit').click();document.querySelector('#import-submit').click()`);
    const imported=await js(`JSON.parse(localStorage.getItem('klaslokaal-v1'))`);
    assert.deepEqual(imported.students.map(p=>[p.name,p.class]),[['Anna Alpha','3A'],['Bram Beta','4B']]);
    await win.loadFile(path.join(root,'src','index.html'));
    assert.deepEqual(await js(`JSON.parse(localStorage.getItem('klaslokaal-v1')).students`),imported.students);
    // Invalid-only workbooks cannot empty a list, even in replacement mode.
    const invalidOnly=await js(`(async()=>{const x=await import('./excel-export.mjs');return Array.from(x.tableWorkbook(['Omschrijving','Aantal'],[['Totaal','48']],{sheetName:'Overzicht'}));})()`);
    await uploadWorkbook(invalidOnly);
    await js(`document.querySelector('#replace-list').click();document.querySelector('#import-submit').click();document.querySelector('#import-submit').click()`);
    assert.match(await js(`document.querySelector('#import-preview').textContent`),/overgeslagen/);
    assert.deepEqual(await js(`JSON.parse(localStorage.getItem('klaslokaal-v1')).students`),imported.students);
    await js(`document.querySelector('[data-close]').click()`);
    if(errors.length)throw Error(errors.join('\n'));
    console.log(JSON.stringify({ok:true,checks:'real compressed example, file import and preview, persistence, split-name and attendance editing, XLSX round trip, Excel default, optional class tabs, combined download, column checklist, empty-selection validation, format and scope switching, actual selected-column download, per-class tabs and surname sorting, legacy seating import, invalid file'}));app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
});
