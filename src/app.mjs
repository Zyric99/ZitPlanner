import { ownValue } from './id-record.mjs';
import { AREAS, PRIORITIES, RULE_TYPES, CLASS_RULE_TYPES, YEAR_RULE_TYPES, classRuleFor, yearRuleFor, yearPairKey, studentRulesFor, REMOVED_RULE_TYPES, defaults, sampleStudents, enabledSeats, seatBench as engineSeatBench, seatLabel as engineSeatLabel, validSeat as engineValidSeat, seatCode, benchCapacity, benchesFor, roomStudents, seatGeometry, evaluate, generate, sectionsFor, migrateState, sectionLabel, containsBench, letterRange } from './engine.mjs';
import { warningKey, warningGroups, aggregateUnplacedWarnings, reconcileHiddenWarnings, warningPriorityClass, warningHighlights } from './warning-state.mjs';
import { seatingWorkbook, weeklyWorkbook, exportColumns, EXCEL_MIME } from './excel-export.mjs';
import { workbookSheets } from './excel-import.mjs';
import { rowsText, textRows, parseStudentRows, parseStudentSheets, studentNameParts, STUDY_DAYS } from './student-import.mjs';
import { updateStudentList } from './student-list.mjs';
import { createAttendanceUI, setStudentAttendance, resetStudentAttendance, studentIsAbsent, attendanceDate, attendanceStatus, attendanceLabel } from './attendance.mjs';
import { captureCalendarDay, openCalendarDate, calendarRecord, calendarAttendanceSaved, saveCalendarAttendance } from './calendar-model.mjs';
import { todayKey, periodDates, validDateKey, isSchoolDay, shiftSchoolDay } from './calendar-dates.mjs';
import { calendarWorkbook, calendarBackup } from './calendar-export.mjs';
import { createCalendarPreference } from './calendar-preference.mjs';
import { createCalendarUI, calendarControlsMarkup } from './calendar-ui.mjs';
import { evaluateCrossRoomRules } from './auto-distribution.mjs';
import { inferYear, normalizeYear, manualYear, setManualYear, normalizeStudentYears, studentYearErrors } from './student-year.mjs';
import { initializeRooms, normalizeRooms, captureRoom, switchRoom, currentRoom, roomState, roomStats, roomSystemValid, classRoomId, assignRoom, assignClassRoom, studentLocationRoomId, distributeRooms, participatingRoomIds } from './rooms.mjs';
import { layoutValid, layoutSize, customBenches, benchSize, directionName } from './layout.mjs';
import { locationRule, setLocationRule } from './location-rules.mjs';
import { createRoomUI } from './room-ui.mjs';
import { createWeeklyUI } from './weekly-ui.mjs';
import { captureWeeklyDay, leaveWeeklyDay, weeklyPlansValid, weeklyCurrent, dayLabel } from './weekly-planner.mjs';
import { visualBands, gridColumns, columnX, rowY, rowOffset, visualPosition, packGridRoom, unpackGridRoom } from './grid-room.mjs';
import { createProjectSession } from './project-session.mjs';
import { validState, validProjectBackup } from './project-validation.mjs';
import { axisBenchIds, mergeSelection, selectionRect, benchesInRect } from './bench-selection.mjs';
let ROOM=null,BENCHES=[],BY_BENCH={};
const seatBench=seat=>engineSeatBench(seat,state.settings),seatLabel=seat=>engineSeatLabel(seat,state.settings),validSeat=seat=>engineValidSeat(seat,state.settings);
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const clone = object => structuredClone(object);
const KEY = 'klaslokaal-v1';
// Supplied by the launcher through Electron's isolated preload; never saved with a plan.
const DEVELOPER_MODE = window.desktop?.developerMode === true;
let developerInfo=null,developerStorage=null;
let storageFailure = false;
let storagePending=false;
let projectSession;
try {
  projectSession=await createProjectSession(window.desktop?.projects,localStorage,KEY,details=>{
    storageFailure=!!details.error;storagePending=details.pending;
    developerStorage={key:details.file,...details};
    $('.local-label').textContent=details.status;
    if(DEVELOPER_MODE)renderDeveloperDetails();
    if(details.error)toast('Project bewaren is niet gelukt. Probeer opnieuw of exporteer je projectbestand.');
  });
} catch(error) {
  $('.local-label').textContent='Project openen mislukt';
  $('#toast').hidden=false;$('#toast').textContent=error.message;
  throw error;
}
function read(key, fallback) {
  if(projectSession)return projectSession.read(key,fallback);
  try {
    const json=localStorage.getItem(key),value=JSON.parse(json,(_key,value)=>unpackGridRoom(value));
    if(DEVELOPER_MODE&&key===KEY)developerStorage={key,bytes:new Blob([json??'']).size,status:json?'Gelezen bij start':'Nog geen opgeslagen sessie'};
    return value || fallback;
  } catch(error) {
    if(DEVELOPER_MODE&&key===KEY)developerStorage={key,status:`Lezen mislukt (${error.name}); voorbeeld geladen`,error:true};
    return fallback;
  }
}
function write(key, value) {
  if(projectSession){projectSession.save(key,value);return;}
  try {
    const json=JSON.stringify(value,(_key,item)=>packGridRoom(item));
    localStorage.setItem(key,json);
    if(DEVELOPER_MODE)developerStorage={key,bytes:new Blob([json]).size,status:'Automatisch opgeslagen',time:new Date().toISOString(),pending:false};
  } catch(error) {
    storageFailure=true;
    if(DEVELOPER_MODE)developerStorage={key,status:`Bewaren mislukt (${error.name})`,time:new Date().toISOString(),error:true,pending:false};
    toast('Lokaal bewaren is niet gelukt. Exporteer je projectbestand om je werk te bewaren.');
  }
  if(DEVELOPER_MODE)renderDeveloperDetails();
}
let state = read(KEY, null);
if(projectSession?.hasProject&&!validState(state)) {
  $('.local-label').textContent='Project openen mislukt';
  $('#toast').hidden=false;$('#toast').textContent='Het opgeslagen project bevat ongeldige gegevens. Het bestand is niet overschreven.';
  throw Error('Ongeldig opgeslagen project.');
}
if (!validState(state)) { state=defaults(); state.students=sampleStudents(); state.name='Voorbeeld · Examen oktober'; state=initializeRooms(migrateState(state)); }
state=initializeRooms(migrateState(state));
normalizeStudentYears(state.students);
const calendarPreference=createCalendarPreference(localStorage,state.calendar?.enabled===true);
calendarPreference.apply(state);
if(state.calendar?.enabled&&!isSchoolDay(state.calendar.selectedDate))openCalendarDate(state,shiftSchoolDay(state.calendar.selectedDate));
let plans=read(`${KEY}-plans`,[]).filter(p=>p && validState(p.state)).map(p=>({...p,state:initializeRooms(migrateState(p.state))}));
let lists=read(`${KEY}-lists`,[]).filter(l=>l && Array.isArray(l.students));
await projectSession?.initialize(state,plans,lists);
let past=[],future=[],tab='room',selected=null,selectedBench=null,pendingMove=null,highlight=[],colorMode='neutral',zoom=1,zoomMode='custom',expanded=false,alternatives=[],alternativeIndex=0,revision=0,busy=false;
let benchSelection=[],benchSelectionMode=false,benchSelectionLabel='';
let analysis=evaluate(state),toastTimer;
let warningFocus=null,hiddenWarningsOpen=false;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,4500); }
function commit(change, { keepAlternatives=false, keepWeekly=false }={}) {
  roomsUI.clearAutoResult();past.push(clone(state));if(past.length>60)past.shift();future=[];
  const pins=JSON.stringify(state.rooms.map(r=>r.locks));
  change();calendarPreference.apply(state);normalizeStudentYears(state.students);normalizeRooms(state);
  if(state.calendar?.enabled&&!isSchoolDay(state.calendar.selectedDate))openCalendarDate(state,shiftSchoolDay(state.calendar.selectedDate));
  if(!keepWeekly&&state.weeklyPlans) {
    if(pins!==JSON.stringify(state.rooms.map(r=>r.locks))) {
      leaveWeeklyDay(state,{restorePins:false});delete state.weeklyPlans;
    } else if(state.weeklyPlans.activeDay&&!weeklyCurrent(state)) {
      // Source changes disable the old day selector. Restore manual attendance
      // now so its temporary absences cannot silently exclude future pupils.
      leaveWeeklyDay(state);normalizeRooms(state);
    }
  }
  captureWeeklyDay(state);captureCalendarDay(state);state.modified=new Date().toISOString();revision++;
  if(!keepAlternatives)alternatives=[];write(KEY,state);render();
}
function history(redo=false) {if(roomsUI.history(redo))return;const source=redo?future:past,dest=redo?past:future; if(!source.length)return; roomsUI.clearAutoResult();dest.push(clone(state));state=source.pop();calendarPreference.apply(state);normalizeStudentYears(state.students);revision++;alternatives=[];write(KEY,state);render(); }
const person = id => state.students.find(s=>s.id===id);
const studentSeat = id => Object.keys(state.assignments).find(seat=>state.assignments[seat]===id);
const activeStudents = () => roomStudents(state).filter(s=>!s.absent);
const unplacedStudents = () => {const seated=new Set(Object.values(state.assignments));return state.students.filter(p=>!p.absent&&(!state.rooms.some(room=>room.id===ownValue(state.studentRooms,p.id))||ownValue(state.studentRooms,p.id)===state.activeRoomId&&!seated.has(p.id)));};
const fixedLabel=rule=>{const room=state.rooms.find(r=>r.id===rule.roomId);return room?(!rule.seat?`${room.name} · vast lokaal`:`${room.name} · ${engineSeatBench(rule.seat,roomState(state,room.id).settings)?engineSeatLabel(rule.seat,roomState(state,room.id).settings):rule.positionCode?rule.positionCode+' · deze plaats bestaat niet meer':'Onbekende positie'}`):rule.roomId?'Verwijderd lokaal · vaste positie niet actief':seatLabel(rule.seat);};
const roomViews=new Map();
const rulesSectionOpen=new Map();
function openRoom(id) {
  if(id===state.activeRoomId&&tab==='room')return;
  const viewport=$('#room-viewport');roomViews.set(state.activeRoomId,{zoom,zoomMode,left:viewport.scrollLeft,top:viewport.scrollTop});
  selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;alternatives=[];alternativeIndex=0;benchSelection=[];benchSelectionMode=false;tab='room';
  const view=roomViews.get(id)??{zoom:1,zoomMode:'custom',left:0,top:0};zoom=view.zoom;zoomMode=view.zoomMode;
  switchRoom(state,id);write(KEY,state);render();viewport.scrollTo({left:view.left,top:view.top});
}
function selectStudent(id, focus=true) {const destination=ownValue(state.studentRooms,id);if(destination&&destination!==state.activeRoomId)openRoom(destination);benchSelection=[];benchSelectionMode=false;warningFocus=null;pendingMove=null;selected=id;selectedBench=seatBench(studentSeat(id))?.id || null;highlight=selectedBench?[selectedBench]:[]; renderRoom();renderContext();renderUnplaced(); if(focus && selectedBench)focusBench(selectedBench); }
function focusBench(id) { const b=BY_BENCH[id],viewport=$('#room-viewport'); if(b)viewport.scrollTo({left:Math.max(0,(b.x+32+roomGutter())*zoom-viewport.clientWidth/2),top:Math.max(0,(b.y+55)*zoom-viewport.clientHeight/2),behavior:'smooth'}); }
function move(id,target) {
  const p=person(id);if(!p||p.absent)return toast('Een afwezige leerling kan niet worden geplaatst.');
  const assignedRoom=state.rooms.find(room=>room.id===ownValue(state.studentRooms,id));
  if(assignedRoom&&assignedRoom.id!==state.activeRoomId)return toast('Wijs deze leerling eerst aan dit lokaal toe via Verdeling over lokalen.');
  let prepared=null;
  if(!assignedRoom){prepared=clone(state);try{assignRoom(prepared,id,state.activeRoomId);}catch(error){return toast(error.message);}}
  const from=studentSeat(id),other=state.assignments[target];pendingMove=null;if(from===target){selectStudent(id,false);return;}
  commit(()=>{if(prepared)state=prepared;if(from){if(other)state.assignments[from]=other;else delete state.assignments[from];}state.assignments[target]=id;});selectStudent(id,false);
}
function removeStudent(id) { commit(()=>{ const seat=studentSeat(id);if(seat)delete state.assignments[seat];state.locks=state.locks.filter(x=>x!==id); }); selected=id;renderContext(); }
function deleteStudentsDialog(id=null) {
  if(busy)return toast('Wacht tot de planner klaar is.');
  const pupils=id?[person(id)].filter(Boolean):state.students;
  if(!pupils.length)return toast('De lijst is al leeg.');
  const ids=new Set(pupils.map(p=>p.id)),ruleCount=state.rules.filter(rule=>rule.students.some(student=>ids.has(student))).length;
  const confirmId=id?'delete-student-confirm':'clear-list-confirm';
  modal(id?'Leerling verwijderen':'Lijst leegmaken',
    `<p>${id?`Wil je <strong>${esc(pupils[0].name)}</strong> (${esc(pupils[0].class)}) uit de huidige leerlingenlijst verwijderen?`:`Wil je alle <strong>${pupils.length} leerlingen</strong> uit de huidige lijst verwijderen?`}</p><p>De bijbehorende zitplaatsen, pins en ${ruleCount} leerlingregels worden verwijderd.${state.weeklyPlans?' De bewaarde weekindeling vervalt.':''} Bewaarde lijsten en andere projecten blijven behouden.</p><p>Je kunt dit daarna ongedaan maken.</p>`,
    `<button class="button" data-close>Annuleren</button><button class="button danger" id="${confirmId}">${id?'Leerling verwijderen':'Lijst leegmaken'}</button>`);
  $(`#${confirmId}`).onclick=()=>{
    if(busy)return toast('Wacht tot de planner klaar is.');
    selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;
    commit(()=>{
      if(state.weeklyPlans)leaveWeeklyDay(state);
      delete state.weeklyPlans;
      state.students=state.students.filter(p=>!ids.has(p.id));
      state.rules=state.rules.filter(rule=>!rule.students.some(student=>ids.has(student)));
      state.assignments=Object.fromEntries(Object.entries(state.assignments).filter(([,student])=>!ids.has(student)));
      state.locks=state.locks.filter(student=>!ids.has(student));
      for(const room of state.rooms){
        room.assignments=Object.fromEntries(Object.entries(room.assignments).filter(([,student])=>!ids.has(student)));
        room.locks=room.locks.filter(student=>!ids.has(student));
      }
      for(const student of ids){delete state.studentRooms[student];delete state.studentRoomPins[student];}
      state.distribution.reviewed=false;
      if(!id){state.benchLocks=[];state.hiddenWarnings=[];state.classRooms={};if(!projectSession)state.name='Nieuwe indeling';state.planId=null;for(const room of state.rooms)room.hiddenWarnings=[];}
    });
    closeModal();toast(id?'Leerling verwijderd. Ongedaan maken brengt de leerling terug.':'Lijst leeggemaakt. Ongedaan maken brengt je lijst terug.');
  };
}
function render() {
  if(tab!=='room'&&expanded)expandRoom(false);
  if(tab!=='room'){benchSelection=[];benchSelectionMode=false;}
  BENCHES=benchesFor(state.settings);BY_BENCH=Object.fromEntries(BENCHES.map(b=>[b.id,b]));ROOM=layoutSize(state.settings.layout);
  const gutter=roomGutter();$('#room').setAttribute('viewBox',`${-gutter} 0 ${ROOM.width+gutter} ${ROOM.height}`);$('#room').setAttribute('aria-label',`${currentRoom(state).name} · ${BENCHES.length} leerlingenbanken`);
  benchSelection=benchSelection.filter(id=>BY_BENCH[id]);
  if(person(selected)) { const bench=seatBench(studentSeat(selected))?.id||null;if(bench!==selectedBench){selectedBench=bench;highlight=bench?[bench]:[];} }
  analysis=evaluate(state);
  analysis.warnings.push(...evaluateCrossRoomRules(state,true).warnings);
  const remainingHidden=reconcileHiddenWarnings(state,analysis.warnings);
  if(JSON.stringify(remainingHidden)!==JSON.stringify(state.hiddenWarnings)){state.hiddenWarnings=remainingHidden;write(KEY,state);}
  if(warningFocus&&!analysis.warnings.some(w=>warningKey(state,w)===warningFocus))warningFocus=null;
  $('#plan-heading').textContent=state.name;$('#student-count').textContent=state.students.length;$('#rule-count').textContent=studentRulesFor(state).length+Object.keys(state.classRooms).length+(state.settings.classRulesEnabled?(state.settings.classRules.default.type!=='none'?1:0)+Object.values(state.settings.classRules.overrides).filter(r=>r.type!=='none').length:0)+(state.settings.yearRulesEnabled?state.settings.yearRules.filter(r=>r.type!=='none').length:0);
  $('.local-label').textContent=storageFailure?'Bewaren mislukt':storagePending?'Bezig met opslaan…':'Automatisch opgeslagen';
  renderYearErrors();
  if(projectSession){$('#save').textContent='Naam wijzigen';$('#save').disabled=projectSession.id===projectSession.standard?.id;}
  $('#undo').disabled=!past.length;$('#redo').disabled=!future.length;
  const ids=Object.values(state.assignments),benchIds=Object.keys(state.assignments).map(s=>seatBench(s)?.id),counts={}; benchIds.forEach(b=>counts[b]=(counts[b]||0)+1);
  const fixed=new Set([...studentRulesFor(state).filter(r=>r.type==='fixed'&&r.roomId===state.activeRoomId).map(r=>r.students[0]),...state.locks,...Object.entries(state.assignments).filter(([seat])=>state.benchLocks.includes(seatBench(seat)?.id)).map(([,id])=>id)]);
  const hiddenCount=warningGroups(state,analysis.warnings).hidden.length;
  const stats=[[activeStudents().length,'leerlingen in lokaal'],[Object.keys(counts).length,'banken gebruikt'],[Object.values(counts).filter(n=>n>1).length,'gedeelde banken'],[fixed.size,'vastgezet'],[analysis.warnings.length,hiddenCount?`waarschuwingen · ${hiddenCount} verborgen`:'waarschuwingen']];
  $('#summary').innerHTML=stats.map(([n,label],i)=>`<div class="stat ${i===4&&n?'warn':''}"><strong>${n}</strong><small>${label}</small></div>`).join('');
  $('#capacity').textContent=`${activeStudents().length} leerlingen / ${enabledSeats(state.settings).length} beschikbare plaatsen`;
  $('#generation-summary').textContent=`${state.settings.placementMode==='ordered'?'Geordend':'Willekeurig'} · ${state.weeklyPlans?.activeDay?dayLabel(state.weeklyPlans.activeDay):'Zonder dagfilter'}`;
  renderSidebar();roomsUI.render(tab);calendarUI.renderControls();renderRoom();renderContext();renderWarnings();renderUnplaced();renderAlternatives();captureRoom(state);captureWeeklyDay(state);weeklyUI.render();
  if(DEVELOPER_MODE)renderDeveloperDetails();
}
function renderDeveloperDetails() {
  if(!DEVELOPER_MODE)return;
  let panel=$('#developer-details');
  if(!panel){panel=document.createElement('section');panel.id='developer-details';panel.className='developer-details';panel.setAttribute('aria-label','Ontwikkelaarsmodus');$('.right-sidebar').append(panel);}
  const rows=[
    ['Runtime',developerInfo?`Electron ${developerInfo.electron} · Node ${developerInfo.node}`:'Runtimegegevens laden…'],
    ['Actief lokaal',`${state.activeRoomId}\n${state.settings.placementMode==='ordered'?'Geordend':'Willekeurig'} · ${state.weeklyPlans?.activeDay?dayLabel(state.weeklyPlans.activeDay):'Zonder dagfilter'}`],
    ['Zitplaatsen',`${Object.keys(state.assignments).length}/${enabledSeats(state.settings).length} bezet · ${studentRulesFor(state).filter(r=>r.type==='fixed'&&r.roomId===state.activeRoomId).length} vaste locaties · ${analysis.warnings.length} waarschuwingen`],
  ];
  const storageOpen=$('#developer-project-storage')?.open??true;
  panel.replaceChildren();
  const heading=document.createElement('h3');heading.textContent='DEV · Technische details';panel.append(heading);
  const listFor=entries=>{
    const list=document.createElement('dl');
    for(const [label,value] of entries){const term=document.createElement('dt'),description=document.createElement('dd');term.textContent=label;description.textContent=value;list.append(term,description);}
    return list;
  };
  panel.append(listFor(rows));
  const section=document.createElement('details');section.id='developer-project-storage';section.open=storageOpen;
  section.dataset.status=developerStorage?.pending?'pending':developerStorage?.error?'error':developerStorage?.time?'saved':'loaded';
  const summary=document.createElement('summary');summary.textContent=`Projectopslag · ${developerStorage?.pending?'Opslaan…':developerStorage?.error?'Fout':developerStorage?.time?'Opgeslagen':'Laden…'}`;
  section.append(summary);
  const save=developerStorage,standard=developerInfo?.standard??projectSession?.standard;
  section.append(listFor([
    ['Opslagmodus',projectSession?'Projectbestanden · werkruimte versie 3':'Legacy localStorage'],
    ['Projectmap',projectSession?.directory??developerInfo?.projectDirectory??'Pad laden…'],
    ['Projectbestand',projectSession?.file??developerInfo?.storagePath??'Pad laden…'],
    ['Actief project',`${state.name}\n${projectSession?.id??'Legacy'} · ${state.rooms.length} lokaaltab${state.rooms.length===1?'':'s'}`],
    ['Laatste opslagactie',save?`${save.status}${save.time?`\n${new Date(save.time).toLocaleString('nl-BE')}`:''}${save.bytes!==undefined?` · ${(save.bytes/1024).toFixed(1)} KiB${save.pending||save.error?' te schrijven':' opgeslagen'}`:''}`:'Nog geen opslagactie'],
    ['Standaard project',standard?`${standard.name}\n${standard.file}\n${standard.rooms} lokalen · ${standard.students} leerlingen`:'Niet gebruikt in legacy-modus'],
    ['Backups',developerInfo?.backupDirectory??(projectSession?`${projectSession.directory}/backups`:'Oude localStorage blijft behouden.')],
    ['Migratiebackup',developerInfo?.migrationBackup??'Geen migratie nodig'],
    ['Legacygegevens','Oude localStorage blijft behouden.'],
  ]));
  panel.append(section);
}
function renderSectionList() {
  const sections=sectionsFor(state.settings);
  return `<h3 class="section-title">Kolommen en vulvolgorde</h3><ol class="section-order">${sections.map(section=>{
    const label=sectionLabel(section),benches=BENCHES.filter(b=>containsBench(section,b));
    const overlap=benches.filter(b=>sections.some(other=>other.id!==section.id&&other.enabled&&containsBench(other,b))).length;
    return `<li class="section-item" data-section-id="${esc(section.id)}"><button class="section-handle" data-section-handle="${esc(section.id)}" aria-label="Versleep ${label}; gebruik pijl omhoog of omlaag om de volgorde aan te passen" title="Sleep of gebruik de pijltoetsen">⋮⋮</button><input type="checkbox" data-section-toggle="${esc(section.id)}" ${section.enabled?'checked':''} aria-label="${label} inschakelen">${section.builtin?`<span class="section-name">${label}</span>`:`<button class="section-name editable" data-edit-section="${esc(section.id)}" title="Letterbereik aanpassen">${label}</button>`}<small title="${benches.length} banken in dit bereik${overlap?`; ${overlap} ook in een ander ingeschakeld bereik`:''}">${benches.length*2} pl.${overlap?' ◇':''}</small>${!section.builtin?`<button class="section-remove" data-remove-section="${esc(section.id)}" aria-label="Bereik ${label} verwijderen">×</button>`:''}</li>`;
  }).join('')}</ol><button class="button full" data-action="add-section">＋ Letterbereik toevoegen</button>`;
}
function sectionDialog(existing=null) {
  const options=value=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter=>`<option ${letter===value?'selected':''}>${letter}</option>`).join('');
  modal(existing?'Letterbereik aanpassen':'Letterbereik toevoegen',`<div class="range-fields"><label class="field">Van letter<select id="section-from">${options(existing?.from||'D')}</select></label><label class="field">Tot en met letter<select id="section-to">${options(existing?.to||'H')}</select></label></div><div id="section-errors"></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="section-save">Bereik bewaren</button>`);
  $('#section-save').onclick=()=>{
    const from=$('#section-from').value,to=$('#section-to').value;
    if(from>to){$('#section-errors').innerHTML='<div class="inline-errors">De eerste letter moet vóór of gelijk aan de laatste letter staan.</div>';return;}
    commit(()=>{if(existing){const section=state.settings.sections.find(s=>s.id===existing.id);section.from=from;section.to=to;}else state.settings.sections.push({id:crypto.randomUUID(),from,to,enabled:true,builtin:false});});closeModal();toast('Letterbereik bewaard. Maak opnieuw een indeling om de vulvolgorde toe te passen.');
  };
}
function reorderSection(id,delta) {
  const sections=state.settings.sections,index=sections.findIndex(s=>s.id===id),target=index+delta;
  if(index<0||target<0||target>=sections.length)return;
  commit(()=>{const [section]=state.settings.sections.splice(index,1);state.settings.sections.splice(target,0,section);});
  document.querySelector(`[data-section-handle="${CSS.escape(id)}"]`)?.focus();
}
function renderSidebar() {
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const container=$('#sidebar-content');
  container.querySelectorAll('[data-rules-section]').forEach(section=>rulesSectionOpen.set(section.dataset.rulesSection,section.open));
  const task=['students','rules','attendance','export'].includes(tab);
  document.body.classList.toggle('task-mode',task);
  $('#task-workspace').hidden=!task;
  (task?$('#task-workspace'):$('.left-sidebar')).append(container);
  if(tab==='room') {
    container.innerHTML=state.settings.layout?.kind==='custom'?``:`${renderSectionList()}<div class="sidebar-block"><h3 class="section-title">Zitrijen</h3><div class="row-buttons">${[1,2,3,4,5,6,7,8].map(row=>`<button class="row-button ${state.settings.rows.includes(row)?'on':''}" data-row="${row}" aria-pressed="${state.settings.rows.includes(row)}">${row}</button>`).join('')}</div></div>`;
  } else if(['rooms','distribution'].includes(tab)) {
    container.innerHTML='';
  } else if(tab==='export') {
    renderExport(container);
  } else if(tab==='attendance') {
    attendanceUI.render(container);
  } else if(tab==='students') {
    const classes=[...new Set(state.students.map(s=>s.class))].sort(),years=[...new Set(state.students.map(s=>s.year))].sort();
    container.innerHTML=`<div class="task-heading"><div><h2>Leerlingen</h2><p>${state.students.length} leerlingen · ${classes.length} klassen · ${years.length} leerjaren${state.weeklyPlans?.activeDay?' · '+dayLabel(state.weeklyPlans.activeDay):''}</p></div><div class="task-actions"><button class="button primary" id="import-top" data-action="import">＋ Leerlingen toevoegen</button><details class="overflow-menu"><summary class="button">Lijsten ▾</summary><div class="menu-items"><button data-action="save-list">Lijst bewaren</button><button data-action="lists">Bewaarde lijsten openen</button><button class="danger" data-action="clear">Lijst leegmaken</button></div></details></div></div><div class="student-filters"><label>Zoeken<input id="student-filter" placeholder="Naam, klas of leerjaar…" value="${esc(studentFilter)}"></label><span id="student-filter-count" role="status"></span></div><div class="student-list">${state.students.map(s=>`<div class="person-row" data-student-row="${esc(s.id)}"><button data-person="${esc(s.id)}" title="Leerling aanpassen">${esc(s.name)}<small>${esc(s.class)} · leerjaar ${esc(s.year)} · ${esc(state.rooms.find(r=>r.id===ownValue(state.studentRooms,s.id))?.name??'Nog geen lokaal')}</small></button><button class="button small" data-student-room="${esc(s.id)}">Zitplaats bekijken</button><button class="button small danger" data-delete-student="${esc(s.id)}" aria-label="${esc(s.name)} verwijderen">Verwijderen</button></div>`).join('')||'<p class="muted">Geen leerlingen.</p>'}</div>`;
    $('#student-filter').oninput=event=>{studentFilter=event.target.value;filterStudents();};filterStudents();
  } else {
    container.innerHTML=`<div class="task-heading"><div><h2>Regels</h2></div><button class="button" data-tab="room">Zitplaatsen bekijken →</button></div><div class="rules-grid">${rulesPage()}</div>`;
    container.querySelectorAll('[data-rules-section]').forEach(section=>{
      const enabled=()=>state.settings[`${section.dataset.rulesSection}RulesEnabled`]!==false;
      const summary=section.querySelector('summary');
      summary.onclick=event=>{if(!enabled()&&!event.target.closest('.rules-category-switch'))event.preventDefault();};
      summary.onkeydown=event=>{if(!enabled()&&['Enter',' '].includes(event.key)&&!event.target.closest('.rules-category-switch'))event.preventDefault();};
      section.ontoggle=()=>{if(!enabled()&&section.open)section.open=false;};
    });
  }
}
let studentFilter='';
function filterStudents() {
  const query=studentFilter.trim().toLocaleLowerCase('nl');let count=0;
  document.querySelectorAll('[data-student-row]').forEach(row=>{const p=person(row.dataset.studentRow);row.hidden=![p.name,p.class,p.year].some(value=>value.toLocaleLowerCase('nl').includes(query));if(!row.hidden)count++;});
  $('#student-filter-count').textContent=`${count} van ${state.students.length} leerlingen`;
}
const relationOptions=(types,value,inherit=false)=>`${inherit?`<option value="default" ${value==='default'?'selected':''}>Gebruik standaardregel</option>`:''}${Object.entries(types).map(([type,label])=>`<option value="${type}" ${type===value?'selected':''}>${label}</option>`).join('')}`;
const priorityOptions=value=>PRIORITIES.map(priority=>`<option ${priority===value?'selected':''}>${priority}</option>`).join('');
const adjacencyOption=(id,rule)=>`<div class="adjacency-option" id="${id}-field" ${rule?.type!=='adjacent'?'hidden':''}><label><input type="checkbox" id="${id}" ${rule?.acrossBenches!==false?'checked':''}>Ook controleren tussen aangrenzende banken</label></div>`;
const adjacencyDescription=rule=>rule?.type==='adjacent'?` · ${rule.acrossBenches===false?'Alleen dezelfde bank':'Ook aangrenzende banken'}`:'';
const categoryNames={class:'Klasregels',year:'Leerjaarregels',student:'Leerlingregels'};
const rulesSection=category=>{const enabled=state.settings[`${category}RulesEnabled`]!==false;return `class="rules-section ${enabled?'':'rules-section-disabled'}" data-rules-section="${category}" ${enabled&&rulesSectionOpen.get(category)!==false?'open':''}`;};
const categoryToggle=(category,enabled)=>`<summary class="rules-category-heading"><span class="rules-category-name">${categoryNames[category]}</span><label class="rules-category-switch"><input type="checkbox" role="switch" id="${category}-rules-enabled" data-rule-category="${category}" aria-label="${categoryNames[category]} gebruiken" ${enabled?'checked':''}><span class="rules-switch-track" aria-hidden="true"></span><span class="rules-switch-state" aria-hidden="true">${enabled?'Aan':'Uit'}</span></label></summary>`;
function rulesPage() {
  const settings=state.settings,classes=[...new Set([...state.students.map(p=>p.class),...Object.keys(settings.classRules.overrides),...Object.keys(state.classRooms)])].sort();
  const pairs=new Map(settings.yearRules.map(rule=>[yearPairKey(...rule.years),rule.years]));
  return `
    
    <details ${rulesSection('year')}>${categoryToggle('year',settings.yearRulesEnabled)}${[...pairs.values()].map(pair=>{const rule=yearRuleFor(settings,...pair),within=pair[0]===pair[1];return `<div class="year-rule-row"><button class="relationship-row" data-year-rule="${esc(yearPairKey(...pair))}"><strong>${within?`Binnen leerjaar ${esc(pair[0])}`:`Leerjaar ${esc(pair[0])} ↔ ${esc(pair[1])}`}</strong><small>${within?`${esc(pair[0])} ↔ ${esc(pair[1])} · `:''}${YEAR_RULE_TYPES[rule?.type||'none']}${adjacencyDescription(rule)}${rule&&rule.type!=='none'?` · ${rule.priority}`:''}</small></button>${rule?`<button class="button small danger" data-delete-year-rule="${esc(yearPairKey(...pair))}" aria-label="${within?`Regel binnen leerjaar ${esc(pair[0])}`:`Regel tussen leerjaar ${esc(pair[0])} en ${esc(pair[1])}`} verwijderen">Verwijderen</button>`:''}</div>`;}).join('')}<button class="button full" data-action="add-year-rule">＋ Leerjaarrelatie toevoegen</button></details>
    <details ${rulesSection('class')}>${categoryToggle('class',settings.classRulesEnabled)}<label class="rule-field">Standaard klasregel<select id="default-class-type">${relationOptions(CLASS_RULE_TYPES,settings.classRules.default.type)}</select></label><label class="rule-field">Belang<select id="default-class-priority" ${settings.classRules.default.type==='none'?'disabled':''}>${priorityOptions(settings.classRules.default.priority)}</select></label>${adjacencyOption('default-class-across-benches',settings.classRules.default)}${classes.map(klass=>{const custom=Object.hasOwn(settings.classRules.overrides,klass),rule=classRuleFor(settings,klass);return `<button class="relationship-row" data-class-rule="${esc(klass)}"><strong>${esc(klass)} <span class="rule-source ${custom?'custom':''}">${custom?'Eigen regel':'Standaard'}</span></strong><small>${CLASS_RULE_TYPES[rule.type]}${adjacencyDescription(rule)}${rule.type!=='none'?` · ${rule.priority}`:''}${classRoomId(state,klass)?` · Vast lokaal: ${esc(state.rooms.find(r=>r.id===classRoomId(state,klass))?.name)}`:''}</small></button>`;}).join('')||'<p class="muted">Geen klassen.</p>'}</details>
    <details ${rulesSection('student')}>${categoryToggle('student',settings.studentRulesEnabled)}<button class="button full" data-action="add-rule">＋ Leerlingregel toevoegen</button><div class="student-list">${state.rules.map(r=>`<div class="rule-list-item"><strong>${esc(RULE_TYPES[r.type])}</strong>${r.type==='fixed'?`<small>${esc(fixedLabel(r))}</small>`:''}<small>${esc(r.priority)}</small>${r.students.map(id=>esc(person(id)?.name)).join(', ')}<br><button class="button small" data-edit-rule="${esc(r.id)}">Aanpassen</button> <button class="button small danger" data-delete-rule="${esc(r.id)}">Verwijderen</button></div>`).join('')||'<p class="muted">Nog geen persoonlijke regels.</p>'}</div></details>
    `;
}
function classRuleDialog(klass) {
  const custom=Object.hasOwn(state.settings.classRules.overrides,klass),rule=classRuleFor(state.settings,klass);
  modal(`Klasregel · ${esc(klass)}`,`<label class="field">Regel<select id="class-rule-type">${relationOptions(CLASS_RULE_TYPES,custom?rule.type:'default',true)}</select></label><label class="field" id="class-rule-priority-field">Belang<select id="class-rule-priority">${priorityOptions(custom?rule.priority:'Verplicht')}</select></label>${adjacencyOption('class-rule-across-benches',rule)}<label class="field">Vast lokaal (verplicht)<select id="class-rule-room"><option value="">Automatische verdeling</option>${state.rooms.map(r=>`<option value="${esc(r.id)}" ${classRoomId(state,klass)===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><div id="class-rule-errors" role="alert"></div><p>Standaard: ${CLASS_RULE_TYPES[state.settings.classRules.default.type]} · ${state.settings.classRules.default.priority}${adjacencyDescription(state.settings.classRules.default)}</p>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="class-rule-save">Regel bewaren</button>`);
  const update=()=>{$('#class-rule-priority-field').hidden=['default','none'].includes($('#class-rule-type').value);$('#class-rule-across-benches-field').hidden=$('#class-rule-type').value!=='adjacent';};$('#class-rule-type').onchange=update;update();
  $('#class-rule-save').onclick=()=>{const type=$('#class-rule-type').value,priority=$('#class-rule-priority').value,acrossBenches=$('#class-rule-across-benches').checked,roomId=$('#class-rule-room').value||null;try{assignClassRoom(clone(state),klass,roomId);}catch(error){$('#class-rule-errors').textContent=error.message;return;}commit(()=>{assignClassRoom(state,klass,roomId);if(type==='default')delete state.settings.classRules.overrides[klass];else state.settings.classRules.overrides={...state.settings.classRules.overrides,[klass]:{type,priority,...(type==='adjacent'?{acrossBenches}:{})}};});closeModal();toast('Klasregel bewaard en indeling gecontroleerd.');};
}
function yearRuleDialog(pair=null) {
  const rule=pair?yearRuleFor(state.settings,...pair):null,years=[...new Set([...state.students.map(p=>p.year),...state.settings.yearRules.flatMap(r=>r.years)])].filter(Boolean).sort((a,b)=>a.localeCompare(b,'nl',{numeric:true}));
  const within=pair&&pair[0]===pair[1];
  modal('Leerjaarregel',`<label class="field">Type regel<select id="year-rule-scope" ${pair?'disabled':''}><option value="within" ${within?'selected':''}>Binnen hetzelfde leerjaar</option><option value="between" ${!within?'selected':''}>Tussen twee leerjaren</option></select></label><datalist id="known-years">${years.map(year=>`<option value="${esc(year)}"></option>`).join('')}</datalist><div class="range-fields" id="year-rule-years"><label class="field"><span id="year-rule-a-label">Eerste leerjaar</span><input id="year-rule-a" list="known-years" value="${esc(pair?.[0]||'')}" ${pair?'readonly':''}></label><label class="field" id="year-rule-b-field">Tweede leerjaar<input id="year-rule-b" list="known-years" value="${esc(pair?.[1]||'')}" ${pair?'readonly':''}></label></div><p id="year-rule-existing" hidden></p><label class="field">Regel<select id="year-rule-type">${relationOptions(YEAR_RULE_TYPES,rule?.type||(pair?'none':'separate'))}</select></label><label class="field" id="year-rule-priority-field">Belang<select id="year-rule-priority">${priorityOptions(rule?.priority||'Verplicht')}</select></label>${adjacencyOption('year-rule-across-benches',rule)}<div id="year-rule-errors" role="alert"></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="year-rule-save">Regel bewaren</button>`);
  let currentKey=pair?yearPairKey(...pair):null;
  const chosenYears=()=>{const a=$('#year-rule-a').value.trim();return [a,$('#year-rule-scope').value==='within'?a:$('#year-rule-b').value.trim()];};
  const update=()=>{
    const within=$('#year-rule-scope').value==='within';
    $('#year-rule-a-label').textContent=within?'Leerjaar':'Eerste leerjaar';$('#year-rule-b-field').hidden=within;$('#year-rule-b').disabled=within;$('#year-rule-years').classList.toggle('single-year',within);

    $('#year-rule-priority-field').hidden=$('#year-rule-type').value==='none';
    $('#year-rule-across-benches-field').hidden=$('#year-rule-type').value!=='adjacent';
  };
  const loadExisting=()=>{
    const [a,b]=chosenYears(),valid=a&&b&&($('#year-rule-scope').value==='within'||a!==b),key=valid?yearPairKey(a,b):null,existing=valid?yearRuleFor(state.settings,a,b):null;
    if(key!==currentKey){$('#year-rule-type').value=existing?.type||(pair?'none':'separate');$('#year-rule-priority').value=existing?.priority||'Verplicht';$('#year-rule-across-benches').checked=existing?.acrossBenches!==false;currentKey=key;}
    $('#year-rule-existing').hidden=!existing;$('#year-rule-existing').textContent=existing?'Er bestaat al een regel voor deze relatie. Je bewerkt deze regel; bewaren vervangt de vorige instelling.':'';
    $('#year-rule-errors').innerHTML='';update();
  };
  $('#year-rule-type').onchange=update;$('#year-rule-scope').onchange=loadExisting;
  for(const id of ['#year-rule-a','#year-rule-b']){$(id).oninput=loadExisting;$(id).onchange=loadExisting;}
  loadExisting();
  $('#year-rule-save').onclick=()=>{
    const [a,b]=chosenYears(),type=$('#year-rule-type').value,priority=$('#year-rule-priority').value,acrossBenches=$('#year-rule-across-benches').checked;
    if(!a||!b||($('#year-rule-scope').value==='between'&&a===b)){$('#year-rule-errors').innerHTML=`<div class="inline-errors">${$('#year-rule-scope').value==='within'?'Kies een leerjaar.':'Kies twee verschillende leerjaren, of kies Binnen hetzelfde leerjaar.'}</div>`;return;}
    commit(()=>{state.settings.yearRules=state.settings.yearRules.filter(r=>yearPairKey(...r.years)!==yearPairKey(a,b));if(type!=='none')state.settings.yearRules.push({years:[a,b],type,priority,...(type==='adjacent'?{acrossBenches}:{})});});closeModal();toast('Leerjaarregel bewaard en indeling gecontroleerd.');
  };
}
function roomGutter() {return state.settings.layout?.version===2?48:0;}
function roomAxisMarkup(axis,value,x,y,{exporting=false}={}) {
  const ids=axisBenchIds(BENCHES,axis==='column'?{column:value}:{row:value}),active=ids.length>0&&ids.every(id=>benchSelection.includes(id));
  const label=axis==='column'?`Kolom ${value}`:`Stoelrij ${value}`;
  return `<g ${exporting?'':`data-room-${axis}="${value}" role="button" tabindex="0" aria-label="${label}: banken selecteren" aria-pressed="${active}"`} class="room-axis ${!exporting&&active?'axis-selected':''}">${exporting?'':`<title>${label} selecteren · Ctrl voegt toe</title><rect x="${x-24}" y="${y-28}" width="48" height="44" rx="5"/>`}<text x="${x}" y="${y}" text-anchor="middle" class="column-label">${value}</text></g>`;
}
function roomSVG({ exporting=false, detail='class' }={}) {
  const custom=state.settings.layout?.kind==='custom';
  const rollCallDate=!exporting&&state.attendanceColorsEnabled?attendanceDate(state):null;
  const rollCallSaved=rollCallDate&&calendarAttendanceSaved(state,rollCallDate);
  const {active}=warningGroups(state,analysis.warnings),{students:warningStudents,benches:warningBenches}=warningHighlights(active.map(({warning})=>warning));
  const enabled=new Set(enabledSeats(state.settings));
  const focusedStudents=new Set(!exporting?analysis.warnings.find(w=>warningKey(state,w)===warningFocus)?.students:[]);
  const classes=[...new Set(state.students.map(s=>s.class))].sort(),years=[...new Set(state.students.map(s=>s.year))].sort();
  const palette=['#d7e7e1','#e6dfed','#f0e4cf','#dce5ef','#e6edce','#efdfdc','#d6e8ed','#e9e1d4'];
  let markup=`<rect x="${-roomGutter()}" width="${ROOM.width+roomGutter()}" height="${ROOM.height}" fill="white"/>`;
  if(custom&&state.settings.layout.version===2){
    const l=state.settings.layout;
    for(const s of visualBands(l))markup+=`<g class="custom-section"><rect x="${40+s.x*32}" y="64" width="${s.width*32}" height="${l.rows*32}" fill="#edf4fa" stroke="#b8cde0"/><text x="${48+s.x*32}" y="88" font-size="17" fill="#54768c">${esc(s.name)}</text></g>`;
    for(const c of gridColumns(l.grid)){const x=40+visualPosition(l,{gx:columnX(l,c),gy:0,anchor:c}).gx*32;markup+=roomAxisMarkup('column',c,x+(l.grid.columnStep??6)*16,38,{exporting})+`<line x1="${x-16}" y1="64" x2="${x-16}" y2="${ROOM.height-48}" stroke="#e3eae5" stroke-dasharray="5 5"/>`;}
    for(let i=1;i<=l.grid.rows;i++){const y=64+(rowY(l,i)+rowOffset(l,i))*32;markup+=roomAxisMarkup('row',i*2-1,-14,y+43,{exporting})+roomAxisMarkup('row',i*2,-14,y+96,{exporting})+`<line x1="40" y1="${y-28}" x2="${ROOM.width-40}" y2="${y-28}" stroke="#e3eae5" stroke-dasharray="5 5"/>`;}
    for(const g of l.gaps){const x=40+(visualPosition(l,{gx:columnX(l,g.after),gy:0,anchor:g.after}).gx+(l.grid.columnStep??6))*32;markup+=`<rect x="${x}" y="64" width="${g.width*32}" height="${ROOM.height-112}" fill="#f4eedc" fill-opacity=".4"/>`;}
    for(const g of l.rowGaps??[]){const y=64+(rowY(l,g.after+1)+rowOffset(l,g.after+1)-g.width)*32-28;markup+=`<rect x="40" y="${y}" width="${ROOM.width-80}" height="${g.width*32}" fill="#f4eedc" fill-opacity=".4"/>`;}
  }
  if(custom)for(const b of customBenches(state.settings.layout).filter(b=>b.kind==='teacher')) {const size=benchSize(b);markup+=`<g class="teacher-bench"><rect x="${b.x}" y="${b.y}" width="${size.width}" height="${size.height}" rx="4" fill="#d76b62" stroke="#ad534e"/><text x="${b.x+size.width/2}" y="${b.y+size.height/2}" text-anchor="middle" fill="white" font-size="12">Leerkracht</text>${Array.from({length:b.capacity},(_,i)=>{const g=seatGeometry(b,i);return `<rect class="chair" x="${g.chairX}" y="${g.chairY}" width="${g.chairWidth}" height="${g.chairHeight}" rx="4"/>`;}).join('')}<text x="${b.x+size.width/2}" y="${b.y+size.height-4}" text-anchor="middle" fill="white">${{up:'↑',right:'→',down:'↓',left:'←'}[b.facing]}</text></g>`;}
  for(const b of BENCHES) {
    const disabled=!Array.from({length:benchCapacity(b)},(_,i)=>`${b.id}:${i}`).some(seat=>enabled.has(seat)),warn=warningBenches.get(b.id),locked=state.benchLocks.includes(b.id);
    const direction=directionName(b.facing);
    markup+=`<g id="bench-${b.id}" data-bench="${b.id}" data-facing="${b.facing}" class="bench ${disabled?'disabled':''} ${warn?`warning ${warn}`:''} ${!exporting&&highlight.includes(b.id)?'highlight':''} ${!exporting&&benchSelection.includes(b.id)?'bulk-selected':''}"><title>Plaatsen ${esc(b.label)} · zitrichting ${direction}${disabled?' · Uitgeschakeld':''}${locked?' · Vastgezet':''}</title>`;
    if(custom){const size=benchSize(b);markup+=`<rect class="bench-table" x="${b.x}" y="${b.y}" width="${size.width}" height="${size.height}" rx="4"/>`;}
    for(let i=0;i<benchCapacity(b);i++) {
      const seat=`${b.id}:${i}`,s=person(state.assignments[seat]),seatEnabled=enabled.has(seat),seatLocked=locked||(s&&state.locks.includes(s.id)),fixed=s&&studentRulesFor(state).some(r=>r.type==='fixed'&&r.students.includes(s.id)&&(!r.roomId||r.roomId===state.activeRoomId));
      const studentWarning=s&&warningStudents.get(s.id),studentFocus=s&&focusedStudents.has(s.id);
      const {x,y,w,chairX,chairY,chairWidth,chairHeight}=seatGeometry(b,i);
      markup+=`<rect class="chair ${seatEnabled?'':'chair-disabled'}" x="${chairX}" y="${chairY}" width="${chairWidth}" height="${chairHeight}" rx="5"/>`;
      let fill='';if(s&&colorMode!=='neutral'&&!studentWarning){ const options=colorMode==='class'?classes:years;fill=` style="fill:${palette[options.indexOf(colorMode==='class'?s.class:s.year)%palette.length]}"`; }
      const attendanceColor=s&&!exporting&&state.attendanceColorsEnabled&&rollCallSaved;
      if(attendanceColor)fill=` style="fill:${({present:'#c8e5d5',absent:'#f5ddd6',unexpected:'#e3e7e5'})[attendanceStatus(s,rollCallDate)]}"`;
      const display=s?s.name.split(' ')[0]:'',line=exporting?(detail==='class'?s?.class:detail==='year'?`jr. ${s?.year}`:''):'';
      markup+=`<g class="seat ${!s?'empty':''} ${seatLocked?'pinned':''} ${fixed?'fixed-position':''} ${studentWarning?`warning ${studentWarning}`:''} ${studentFocus?'warning-focus':''} ${!exporting&&selected===s?.id?'selected':''}" data-seat="${seat}" data-code="${esc(seatCode(seat,state.settings))}" data-student="${s?esc(s.id):''}" ${!seatEnabled&&!s?'opacity="0.35"':''}><title>${esc(seatLabel(seat))} · ${s?`${esc(s.name)} · ${esc(s.class)} · leerjaar ${esc(s.year)}`:seatEnabled?'Vrije plaats':'Uitgeschakelde plaats'}${seatLocked?' · Leerling vastgezet':''}${fixed?' · Vaste locatie':''}${studentWarning?' · Actieve waarschuwing':''}</title><rect class="seat-bg" x="${x}" y="${y}" width="${w}" height="43" rx="3"${fill}/>`;
      if(s) {
        if(exporting) { const words=s.name.split(' '),first=words.shift(),rest=words.join(' ');markup+=`<text x="${x+w/2}" y="${y+13}" font-size="10" text-anchor="middle" fill="#34483b" ${first.length>8?`textLength="${w-4}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(first)}</text><text x="${x+w/2}" y="${y+25}" font-size="8" text-anchor="middle" fill="#34483b" ${rest.length>11?`textLength="${w-4}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(rest)}</text>${line?`<text x="${x+w/2}" y="${y+36}" font-size="8" text-anchor="middle" fill="#738472">${esc(line)}</text>`:''}`; }
        else { const surname=s.name.split(' ').slice(1).join(' ');markup+=`<text class="student-name" x="${x+w/2}" y="${y+14}" text-anchor="middle" ${display.length>6?`textLength="${w-6}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(display)}</text><text class="student-sub" x="${x+w/2}" y="${y+27}" text-anchor="middle" ${surname.length>7?`textLength="${w-6}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(surname)}</text><text class="student-class" x="${x+w/2}" y="${y+39}" text-anchor="middle" ${s.class.length>8?`textLength="${w-6}" lengthAdjust="spacingAndGlyphs"`:''}>${esc(s.class)}</text>`; }
        if(seatLocked)markup+=`<text x="${x+w-5}" y="${y+10}" font-size="10" text-anchor="end" fill="#527663">⌑</text>`;
        if(fixed)markup+=`<text x="${x+2}" y="${y+10}" font-size="8" fill="#527663">◆</text>`;
      } else markup+=`<text class="empty-label" x="${x+w/2}" y="${y+27}" text-anchor="middle">${esc(seatCode(seat,state.settings))}${seatEnabled?'':' ×'}</text>`;
      if(custom&&s)markup+=`<text class="custom-seat-code" x="${x+w/2}" y="${y+51}" text-anchor="middle">${esc(seatCode(seat,state.settings))}</text>`;
      markup+='</g>';
    }
    if(custom){const size=benchSize(b);markup+=`<text class="facing-arrow" x="${b.x+size.width/2}" y="${b.y+size.height-2}" text-anchor="middle" fill="#718976">${{up:'↑',right:'→',down:'↓',left:'←'}[b.facing]}</text></g>`;}
  }
  return markup+(!exporting?'<rect id="room-selection-box" class="selection-box" pointer-events="none" hidden/>':'');
}
function roomHeightZoom() { return Math.max(.1,Math.min(3,($('#room-viewport').clientHeight-32)/ROOM.height)); }
function renderRoom() {
  // Printing hides the interactive room; keep its screen size until it is visible again.
  if(!$('#room-viewport').getBoundingClientRect().height)return;
  const maximum=roomHeightZoom();
  if(zoomMode==='height')zoom=maximum;
  else if(zoomMode==='overview')zoom=Math.min(maximum,($('#room-viewport').clientWidth-16)/(ROOM.width+roomGutter()));
  else zoom=Math.min(3,Math.max(.1,zoom));
  $('#room').innerHTML=roomSVG();$('#room').style.width=`${(ROOM.width+roomGutter())*zoom}px`;$('#room').style.height=`${ROOM.height*zoom}px`;$('#zoom-label').value=`${Math.round(zoom*100)}`;
  $('#room').classList.toggle('selecting-benches',benchSelectionMode);$('#select-benches').setAttribute('aria-pressed',String(benchSelectionMode));$('#select-benches').classList.toggle('primary',benchSelectionMode);
  $('#zoom-in').disabled=zoom>=3-.001;$('#zoom-out').disabled=zoom<=.1;
}
function fitRoom() { zoomMode='height';renderRoom(); }
function renderContext() {
  if(benchSelection.length){
    const benches=benchSelection.map(id=>BY_BENCH[id]).filter(Boolean),enabled=benches.filter(b=>b.enabled!==false&&!state.settings.disabled.includes(b.id)).length;
    $('#context').innerHTML=`<div class="context-card bulk-context"><button class="close-context" data-action="close-context" aria-label="Selectie sluiten">×</button><h3>Meerdere banken</h3><small>${benchSelectionLabel?esc(benchSelectionLabel)+' · ':''}${benches.length} ${benches.length===1?'bank':'banken'} geselecteerd<br>${enabled} actief · ${benches.length-enabled} uitgeschakeld</small><button class="button" data-action="enable-selected-benches" ${enabled===benches.length?'disabled':''}>Banken activeren</button><button class="button" data-action="disable-selected-benches" ${!enabled?'disabled':''}>Banken deactiveren</button></div>`;return;
  }
  const p=person(selected),b=BY_BENCH[selectedBench];
  if(!p&&!b) { $('#context').innerHTML='';return; }
  let content='<button class="close-context" data-action="close-context" aria-label="Selectie sluiten">×</button>';
  const moveControl=p&&!p.absent&&(ownValue(state.studentRooms,p.id)===state.activeRoomId||!state.rooms.some(room=>room.id===ownValue(state.studentRooms,p.id)))?`<button class="button ${pendingMove===p.id?'primary':''}" data-action="move-student" aria-pressed="${pendingMove===p.id}">Verplaatsen / wisselen</button>`:'';
  if(p) { const seat=studentSeat(p.id),fixed=locationRule(state,p.id);content+=`<div class="eyebrow">GESELECTEERDE LEERLING</div><h3>${esc(p.name)}</h3><small>${esc(p.class)} · leerjaar ${esc(p.year)}<br>${p.absent?'Afwezig':esc(state.rooms.find(room=>room.id===ownValue(state.studentRooms,p.id))?.name||'Nog geen lokaal')+' · '+(seat?esc(seatLabel(seat)):'Nog niet geplaatst')}</small>${moveControl}<button class="button" data-action="edit-student">Gegevens aanpassen</button><button class="button" data-action="fixed-position">⌑ ${fixed?'Vaste locatie aanpassen':'Vaste locatie instellen'}</button>${seat?'<button class="button" data-action="remove">Uit indeling halen</button>':''}<button class="button" data-action="add-rule">＋ Regel voor deze leerling</button>`;
    const attendanceKind=attendanceStatus(p,attendanceDate(state));
    const attendanceSaved=calendarAttendanceSaved(state);
    content+=`<div class="context-attendance is-${attendanceSaved?attendanceKind:'unrecorded'}"><small>Aanwezigheid · ${attendanceLabel(attendanceKind)}${attendanceSaved?'':' · niet bewaard'}</small><button class="button" data-context-attendance="${esc(p.id)}" aria-label="${esc(p.name)} ${studentIsAbsent(p)?'aanwezig':'afwezig'} markeren">${studentIsAbsent(p)?'✓ Aanwezig markeren':'− Afwezig markeren'}</button></div>`;
    const rules=state.rules.filter(r=>r.students.includes(p.id));content+=rules.map(r=>`<div class="rule-chip">${esc(RULE_TYPES[r.type])}<small>${r.type==='fixed'?esc(fixedLabel(r)):r.students.filter(id=>id!==p.id).map(id=>esc(person(id)?.name)).join(', ')} · ${esc(r.priority)}</small>${r.type==='fixed'?`<button class="button small" data-delete-rule="${esc(r.id)}">Vaste locatie verwijderen</button>`:''}</div>`).join('');
  }
  if(b){
    const disabledSeats=state.settings.disabledSeats??[],side=disabledSeats.includes(`${b.id}:0`)?0:1,off=disabledSeats.includes(`${b.id}:${side}`),code=seatCode(`${b.id}:${side}`,state.settings),otherCode=seatCode(`${b.id}:${1-side}`,state.settings);
    content+=`<div class="sidebar-block"><h3>Plaatsen ${esc(b.label)}</h3><small>Gebied ${b.area}${b.custom?` · ${b.capacity} plaatsen`:''}</small><button class="button" data-action="disable-bench">${state.settings.disabled.includes(b.id)||b.enabled===false?'Bank beschikbaar maken':'Bank uitschakelen'}</button>${benchCapacity(b)===2?`<div class="chair-controls"><button class="button" data-action="disable-chair" aria-pressed="${off}">Stoel ${esc(code)} ${off?'inschakelen':'uitschakelen'}</button><button class="button chair-swap" data-action="swap-disabled-chair" aria-label="Uitgeschakelde stoel wisselen naar ${esc(otherCode)}" title="Uitgeschakelde stoel wisselen naar ${esc(otherCode)}" ${off?'':'disabled'}>⇄</button></div>`:''}</div>`;
  }
  $('#context').innerHTML=`<div class="context-card">${content}</div>`;
}
function renderWarnings() {
  $('#rule-audit').hidden=!DEVELOPER_MODE;
  const groups=warningGroups(state,analysis.warnings),active=aggregateUnplacedWarnings(groups.active),hidden=aggregateUnplacedWarnings(groups.hidden);$('#warning-count').textContent=active.length;
  $('#warning-count').title=`${active.length} actief · ${hidden.length} verborgen`;
  const unplaced=unplacedStudents();
  const entry=({warning:w,index,indices},isHidden=false)=>`<div class="warning-entry ${warningPriorityClass(w)} ${isHidden?'hidden-warning':''}"><button class="warning-details" data-warning="${index}" ${indices?'data-warning-group="unplaced"':''} title="Betrokken leerlingen opzoeken en markeren"><strong>${isHidden?'Verborgen · ':'⚠ '}${w.type==='class'?'Klasregel niet gevolgd · ':w.type==='year'?'Leerjaarregel niet gevolgd · ':''}${w.benches.length?`Plaatsen ${w.benches.map(id=>esc(BY_BENCH[id]?.label??'Onbekende plaats')).join(' & ')}`:w.crossRoom?'Lokaalregel niet gevolgd':'Nog niet geplaatst'}</strong><p>${esc(w.message)}</p><small>${esc(w.priority)} · ${isHidden?'Nog niet opgelost':'Actief'}</small></button><div class="warning-actions"><button class="button small" ${isHidden?'data-restore-warning':'data-hide-warning'}="${index}" ${indices?`data-warning-indices="${indices.join(',')}"`:''}>${isHidden?'Waarschuwing opnieuw tonen':'Waarschuwing verbergen'}</button></div></div>`;
  const empty=hidden.length?`<div class="warning-empty"><strong>Geen actieve waarschuwingen</strong><p>${hidden.length} verborgen waarschuwingen zijn nog niet opgelost en blijven gecontroleerd.${unplaced.length?` ${unplaced.length} leerlingen wachten nog op een plaats.`:''}</p></div>`:`<div class="all-good"><div class="check-circle">✓</div><strong>${unplaced.length?'De geplaatste leerlingen voldoen':'Alles op z’n plek'}</strong>${unplaced.length?`<p>${unplaced.length} leerlingen wachten nog op een plaats.</p>`:''}</div>`;
  $('#warning-list').innerHTML=`<div id="active-warning-list">${active.map(w=>entry(w)).join('')||empty}</div><details id="hidden-warnings" ${hiddenWarningsOpen?'open':''}><summary>Verborgen waarschuwingen <span>${hidden.length}</span></summary><div id="hidden-warning-list">${hidden.map(w=>entry(w,true)).join('')||'<p class="muted">Geen verborgen waarschuwingen.</p>'}</div></details>`;
  $('#hidden-warnings').ontoggle=event=>hiddenWarningsOpen=event.target.open;
  $('#rule-audit').innerHTML=`${state.settings.studentRulesEnabled!==false?`✓ ${analysis.evaluated} van ${state.rules.length} persoonlijke regels gecontroleerd.`:'Leerlingregels uitgeschakeld · instellingen bewaard.'}<br>${analysis.inactive?`${analysis.inactive} regels niet actief: een betrokken leerling is afwezig of nog niet geplaatst.<br>`:''}${analysis.partial?`${analysis.partial} groepsregels gelden voor de aanwezige, geplaatste groepsleden.<br>`:''}${state.settings.classRulesEnabled?`✓ ${analysis.classChecks} klasrelaties gecontroleerd.`:'Klasregels uitgeschakeld · instellingen bewaard.'}<br>${state.settings.yearRulesEnabled?`✓ ${analysis.yearChecks} leerjaarrelaties gecontroleerd.`:'Leerjaarregels uitgeschakeld · instellingen bewaard.'}<br>`;
}
function renderUnplaced() {
  const unplaced=unplacedStudents(),warningStudents=warningHighlights(warningGroups(state,analysis.warnings).active.map(({warning})=>warning)).students,focusedStudents=new Set(warningFocus==='unplaced'?unplaced.map(p=>p.id):analysis.warnings.find(w=>warningKey(state,w)===warningFocus)?.students);
  const full=activeStudents().length>enabledSeats(state.settings).length;
  const help=full?(state.settings.layout?.kind==='custom'?'Er zijn onvoldoende plaatsen in dit lokaal. Schakel banken in, pas de opstelling aan of verplaats leerlingen via Verdeling over lokalen.':'Er zijn onvoldoende fysieke plaatsen. Schakel meer gebieden, zitrijen of banken in.'):'';
  $('#unplaced').hidden=!unplaced.length;$('#unplaced').innerHTML=`<h3>${unplaced.length} leerlingen nog te plaatsen</h3>${help?`<p>${help}</p>`:''}${unplaced.map(s=>`<button class="button small ${warningStudents.has(s.id)?`warning ${warningStudents.get(s.id)}`:''} ${focusedStudents.has(s.id)||selected===s.id?'warning-focus':''}" data-person="${esc(s.id)}" data-unplaced="${esc(s.id)}" aria-pressed="${selected===s.id}">${esc(s.name)} · ${esc(s.class)}</button>`).join('')}`;
}
function selectUnplacedStudent(id) {selectStudent(id,false);}
function renderAlternatives() { $('#alternatives').hidden=!alternatives.length;$('#alternatives').innerHTML=alternatives.map((a,i)=>`<button class="alternative ${i===alternativeIndex?'active':''}" data-alternative="${i}">Indeling ${i+1} · ${a.warnings.length} waarschuwingen${a.unplaced.length?` · ${a.unplaced.length} nog te plaatsen`:''}</button>`).join(''); }
function generationDialog(options={}) {
  if(busy)return toast('Wacht totdat de huidige indeling klaar is.');
  if(studentYearErrors(state.students).length)return yearErrorsDialog();
  const targets=participatingRoomIds(state),scope=options.scope??(targets.length===1&&targets[0]===state.activeRoomId?'room':'all');
  modal('Indeling maken',`<label class="field">Lokalen<select id="generation-scope"><option value="room" ${scope==='room'?'selected':''}>Dit lokaal · ${esc(currentRoom(state).name)}</option><option value="all" ${scope==='all'?'selected':''}>Alle deelnemende lokalen (${targets.length})</option></select></label><label class="field">Plaatsing<select id="placement-mode"><option value="random" ${state.settings.placementMode==='random'?'selected':''}>Willekeurig</option><option value="ordered" ${state.settings.placementMode==='ordered'?'selected':''}>Geordend</option></select></label><button class="button small" id="ordered-settings">Geordend plaatsen instellen…</button><details id="generation-advanced"><summary>Meer opties</summary><label class="field">Alternatieven<select id="generation-count"><option value="1">Eén indeling</option><option value="3">Drie alternatieven voor dit lokaal</option></select></label></details><div id="generation-error" role="alert"></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="generation-submit">Indeling maken</button>`);
  const update=()=>{
    $('#generation-advanced').hidden=$('#generation-scope').value!=='room';
    const alternativesAllowed=$('#generation-scope').value==='room'&&$('#placement-mode').value==='random';
    $('#generation-count').disabled=!alternativesAllowed;
    $('#generation-count').title=$('#placement-mode').value==='ordered'?'Geordend maakt steeds dezelfde indeling. Drie alternatieven zijn alleen beschikbaar bij Willekeurig.':'';
    if(!alternativesAllowed)$('#generation-count').value='1';

    $('#ordered-settings').hidden=$('#placement-mode').value!=='ordered';
  };
  $('#generation-scope').onchange=update;$('#placement-mode').onchange=update;update();
  $('#ordered-settings').onclick=()=>{const nextOptions={...options,scope:$('#generation-scope').value};closeModal();orderedDialog(()=>generationDialog(nextOptions));};
  $('#generation-submit').onclick=()=>{
    const scope=$('#generation-scope').value,mode=$('#placement-mode').value,count=scope==='room'&&mode==='random'?Number($('#generation-count').value):1;
    if(scope==='all'&&!targets.length){$('#generation-error').textContent='Kies eerst deelnemende lokalen in Verdeling over lokalen.';return;}
    closeModal();
    const roomIds=scope==='all'?targets:[state.activeRoomId];
    if(roomIds.some(id=>roomState(state,id).settings.placementMode!==mode))commit(()=>{
      for(const room of state.rooms)if(roomIds.includes(room.id))room.settings.placementMode=mode;
      if(roomIds.includes(state.activeRoomId))state.settings.placementMode=mode;
    });
    makePlan(count,scope,options.openSeating);
  };
}
function openGeneratedSeats(roomIds) {
  const id=roomIds.includes(state.activeRoomId)?state.activeRoomId:roomIds[0];
  if(id)openRoom(id);
}
function makePlan(count=1,scope='all',openSeating=false) {
  if(scope==='all')return makeRoomPlans({fromMain:true,openSeating});
  if(busy)return;if(!activeStudents().length)return toast('Voeg eerst aanwezige leerlingen toe.');
  busy=true;$('#generate').disabled=true;$('#generate').textContent='Even indelen…';const startRevision=revision,startRoomId=state.activeRoomId;
  const worker=new Worker('./planner-worker.mjs',{type:'module'});
  const finish=()=>{busy=false;worker.terminate();$('#generate').disabled=false;$('#generate').textContent='✦  Indeling maken…';};
  worker.onmessage=({data})=>{
    if(data.progress){$('#generate').textContent=`Indeling ${data.progress}/${data.total}…`;return;}
    finish();if(revision!==startRevision)return toast('Je hebt intussen iets aangepast. Maak opnieuw een indeling met de nieuwe instellingen.');
    const generated=data.alternatives;commit(()=>{state.rooms.find(r=>r.id===startRoomId).assignments=generated[0].assignments;if(state.activeRoomId===startRoomId)state.assignments=generated[0].assignments;});if(openSeating)openGeneratedSeats([startRoomId]);if(count>1&&state.activeRoomId===startRoomId){alternatives=generated;alternativeIndex=0;renderAlternatives();}
    toast(generated[0].unplaced.length?`${generated[0].unplaced.length} leerlingen hebben nog geen plaats. Controleer de beschikbare capaciteit.`:`Indeling gemaakt · ${generated[0].warnings.length} waarschuwingen.`);
  };
  worker.onerror=()=>{finish();toast('Indelen is niet gelukt. Je huidige indeling blijft bewaard.');};
  worker.postMessage({state:clone(state),count});
}
function makeRoomPlans({fromMain=false,openSeating=false}={}) {
  if(busy||!participatingRoomIds(state).length)return;
  const prepared=clone(state);captureRoom(prepared);
  if(fromMain){
    if(!state.students.some(p=>!p.absent))return toast('Voeg eerst aanwezige leerlingen toe.');
    const targets=new Set(participatingRoomIds(state));
    if(!state.distribution.reviewed||state.students.some(p=>!p.absent&&!targets.has(ownValue(state.studentRooms,p.id)))){distributeRooms(prepared,prepared.distribution.mode,{keepFixed:prepared.distribution.keepFixed});prepared.distribution.reviewed=true;}
  }
  busy=true;const startRevision=revision,worker=new Worker('./planner-worker.mjs',{type:'module'});
  $('#generate').disabled=true;$('#generate').textContent='Alle lokalen indelen…';
  const finish=()=>{busy=false;worker.terminate();$('#generate').disabled=false;$('#generate').textContent='✦  Indeling maken…';};
  toast('Zitplaatsen maken per lokaal…');
  worker.onmessage=({data})=>{if(data.progress){toast(`Zitplaatsen maken: lokaal ${data.progress} van ${data.total}…`);return;}finish();if(startRevision!==revision){render();return toast('De verdeling is intussen aangepast. Maak opnieuw zitplaatsen.');}
    commit(()=>{const visible=state.activeRoomId;for(const result of data.rooms)prepared.rooms.find(r=>r.id===result.roomId).assignments=result.assignments;prepared.assignments=clone(prepared.rooms.find(r=>r.id===prepared.activeRoomId).assignments);switchRoom(prepared,visible);state=prepared;});if(openSeating)openGeneratedSeats(data.rooms.map(room=>room.roomId));else {if(!fromMain)tab='distribution';render();}const unassigned=state.students.filter(p=>!p.absent&&!ownValue(state.studentRooms,p.id)).length;toast(`Zitplaatsen gemaakt in ${data.rooms.length} lokalen. ${unassigned+data.rooms.reduce((sum,r)=>sum+r.unplaced.length,0)} leerlingen wachten nog op een plaats.`);
  };
  worker.onerror=()=>{finish();render();toast('Zitplaatsen maken is niet gelukt. De bestaande indelingen blijven bewaard.');};worker.postMessage({state:prepared,rooms:true});
}
function makeAutomaticRoomPlan() {
  const targets=participatingRoomIds(state);
  if(busy||!targets.length)return;
  if(studentYearErrors(state.students).length)return yearErrorsDialog();
  const prepared=clone(state);if(prepared.weeklyPlans){leaveWeeklyDay(prepared);delete prepared.weeklyPlans;}captureRoom(prepared);
  const startRevision=revision,worker=new Worker('./planner-worker.mjs',{type:'module'});
  busy=true;roomsUI.clearAutoResult();render();toast(targets.length===1?'Alle leerlingen aan het lokaal toewijzen en zitplaatsen maken…':'Lokaalverdeling en zitplaatsen samen controleren…');
  const finish=()=>{busy=false;worker.terminate();};
  worker.onmessage=({data})=>{
    if(data.progress){toast(`Automatisch indelen: poging ${data.progress} van ${data.total}.`);return;}
    finish();
    if(startRevision!==revision){render();return toast('De gegevens zijn intussen aangepast. Start Auto opnieuw.');}
    if(data.error){render();return toast(`Automatisch indelen mislukt: ${data.error}`);}
    const result=data.autoDistribution;commit(()=>{state=result.state;state.planId=crypto.randomUUID();});roomsUI.showAutoResult(result);render();
    toast(result.complete?'Automatische verdeling klaar: alle regels gevolgd.':`Beste gevonden indeling: ${result.unplaced.length} zonder zitplaats, ${result.warnings.length} waarschuwingen.`);
  };
  worker.onerror=()=>{finish();render();toast('Automatisch indelen mislukt. Probeer opnieuw.');};
  worker.postMessage({state:prepared,autoDistribution:true});
}
function modal(title,body,actions='') { $('#modal').classList.remove('ordered-modal','custom-ordered','calendar-modal');$('#modal-content').innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="icon-button" data-close aria-label="Venster sluiten">×</button></div><div class="modal-body">${body}</div>${actions?`<div class="modal-actions">${actions}</div>`:''}`;$('#modal').showModal(); }
function closeModal(){ $('#modal').close(); }
function download(data,name,type) { const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000); }
function safeName(name) { return name.replace(/[<>:"/\\|?*]/g,'_').slice(0,100)||'Indeling'; }
function renderYearErrors() {
  let banner=$('#student-year-errors');
  if(!banner){banner=document.createElement('div');banner.id='student-year-errors';banner.className='inline-errors';banner.setAttribute('role','alert');$('.page-heading').after(banner);}
  const errors=studentYearErrors(state.students);banner.hidden=!errors.length;
  banner.innerHTML=errors.length?`<strong>Leerjaar niet herkenbaar bij ${errors.length} leerlingen.</strong> Controleer hun klascode of vul het leerjaar handmatig in. <button class="button small" data-action="fix-years">Alle leerjaarfouten aanpassen</button>`:'';
}
function yearCorrectionFields(students) {
  return `<div class="inline-errors" role="alert">Het leerjaar kon voor ${students.length} leerlingen niet uit de klascode worden afgeleid. Geen van deze leerlingen wordt overgeslagen.</div><label class="field">Leerjaar voor alle leerlingen hieronder<input id="year-correction-all" inputmode="numeric" placeholder="Bijvoorbeeld: 4"></label><button class="button small" id="year-correction-apply">Op alle fouten toepassen</button><div class="column-start-table"><table><thead><tr><th>Naam</th><th>Klas</th><th>Leerjaar</th></tr></thead><tbody>${students.map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.class)}</td><td><input data-year-correction="${esc(p.id)}" aria-label="Leerjaar voor ${esc(p.name)} (${esc(p.class)})" inputmode="numeric" value="${esc(p.year)}"></td></tr>`).join('')}</tbody></table></div><div id="year-correction-error" role="alert"></div>`;
}
function bindYearCorrections() {
  $('#year-correction-apply').onclick=()=>{
    const year=normalizeYear($('#year-correction-all').value);
    $('#year-correction-error').textContent=year?'':'Vul een positief geheel getal als leerjaar in.';
    if(year)document.querySelectorAll('[data-year-correction]').forEach(input=>input.value=year);
  };
}
function correctedYears() {
  const inputs=[...document.querySelectorAll('[data-year-correction]')],invalid=inputs.filter(input=>!normalizeYear(input.value));
  for(const input of inputs)input.setAttribute('aria-invalid',String(invalid.includes(input)));
  $('#year-correction-error').textContent=invalid.length?`Vul een positief geheel getal in voor alle ${invalid.length} resterende leerlingen.`:'';
  if(invalid.length){invalid[0].focus();return null;}
  return new Map(inputs.map(input=>[input.dataset.yearCorrection,normalizeYear(input.value)]));
}
function yearErrorsDialog() {
  const errors=studentYearErrors(state.students);if(!errors.length)return;
  modal('Leerjaren controleren',yearCorrectionFields(errors),'<button class="button" data-close>Later aanpassen</button><button class="button primary" id="year-correction-save">Alle leerjaren bewaren</button>');bindYearCorrections();
  $('#year-correction-save').onclick=()=>{
    const years=correctedYears();if(!years)return;
    commit(()=>{if(state.weeklyPlans){leaveWeeklyDay(state);delete state.weeklyPlans;}for(const p of state.students)if(years.has(p.id))setManualYear(p,years.get(p.id));});
    closeModal();toast(`${years.size} leerjaren aangepast.`);
  };
}
function importDialog() {
  modal('Leerlingen toevoegen',`<label class="field">Excel-, CSV- of tekstbestand<input type="file" id="import-file" accept=".xlsx,.csv,.tsv,.txt"></label><div id="import-class-options" hidden><label class="toggle-line"><input type="checkbox" id="import-class-from-sheet">Werkbladnamen als klassen gebruiken als de kolom Klas ontbreekt</label><p class="muted">Voor Excelbestanden met een apart werkblad per klas. Controleer de klasnamen in de voorvertoning: werkbladnamen kunnen ingekort of aangepast zijn. Alleen de leerlingenlijst wordt geïmporteerd, geen zitplaatsen.</p></div><label class="field" id="import-sheet-field" hidden>Werkblad<select id="import-sheet"></select></label><label class="field" id="import-text-field">Leerlingenlijst<textarea id="import-text" placeholder="Naam;Klas&#10;Emma Peeters;3A&#10;Noah Janssens;4B"></textarea></label><p class="muted">Kolomkoppen: Naam of Volledige naam; Voornaam + Achternaam (of Familienaam); Naam + Voornaam. Aparte naamkolommen bewaren ook samengestelde voornamen.</p><label class="field">Naamvolgorde bij één naamkolom<select id="import-name-order"><option value="first-last">Voornaam achternaam (Emma Van den Berg)</option><option value="last-first">Achternaam voornaam (Van den Berg Emma)</option></select></label><p class="muted">Bij Achternaam voornaam is het laatste woord de voornaam en de rest de achternaam. De getoonde naam wordt Voornaam Achternaam. Aparte naamkolommen bepalen altijd de naam.</p><label class="toggle-line"><input type="checkbox" id="replace-list">Huidige leerlingenlijst vervangen</label><div id="import-preview"></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="import-submit">Lijst controleren</button>`);
  let preview=null,sheets=[],fileRevision=0;
  const reset=()=>{preview=null;$('#import-submit').textContent='Lijst controleren';$('#import-preview').innerHTML='';};
  $('#import-text').oninput=reset;$('#replace-list').onchange=reset;
  const sheetOptions=()=>({classFromSheetName:$('#import-class-from-sheet').checked,fullNameOrder:$('#import-name-order').value});
  const sheetNotice=()=>{
    if(!sheets.length)return;
    const result=parseStudentSheets(sheets,$('#replace-list').checked?[]:state.students,sheetOptions());
    $('#import-preview').innerHTML=`<p>Werkbladen: ${result.sheets.filter(sheet=>sheet.valid).map(sheet=>esc(sheet.name)).join(', ')||'geen geldige werkbladen'}</p>${result.errors.length?`<div class="inline-errors" role="alert">${result.errors.map(esc).join('<br>')}</div>`:''}`;
  };
  const chooseSheet=()=>{
    const all=$('#import-sheet').value==='all';
    $('#import-text-field').hidden=all;
    $('#import-text').value=all?'':rowsText(sheets[Number($('#import-sheet').value)].rows);
    reset();sheetNotice();
  };
  $('#import-sheet').onchange=chooseSheet;
  const refreshSheetOptions=()=>{
    const select=$('#import-sheet'),previous=select.value,checked=parseStudentSheets(sheets,[],sheetOptions());
    select.innerHTML=`<option value="all">Alle geldige werkbladen</option>`+sheets.map((s,i)=>`<option value="${i}" ${checked.sheets[i].valid?'':'disabled'}>${esc(s.name)}${checked.sheets[i].valid?'':' · overgeslagen'}</option>`).join('');
    select.value=sheets.length===1&&checked.sheets[0].valid?'0':previous&&previous!=='all'&&checked.sheets[Number(previous)]?.valid?previous:'all';
    $('#import-sheet-field').hidden=sheets.length<2;
  };
  $('#import-class-from-sheet').onchange=()=>{
    const previous=$('#import-sheet').value;refreshSheetOptions();
    if($('#import-sheet').value!==previous)chooseSheet();else {reset();sheetNotice();}
  };
  $('#import-name-order').onchange=()=>{reset();sheetNotice();};
  const fileInput=$('#import-file');
  fileInput.onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    const revision=++fileRevision;sheets=[];reset();$('#import-submit').disabled=true;$('#import-text').value='';$('#import-text-field').hidden=false;$('#import-sheet-field').hidden=true;$('#import-class-options').hidden=true;$('#import-class-from-sheet').checked=false;
    try {
      if(/\.xlsx$/i.test(file.name)) {
        const loaded=await workbookSheets(await file.arrayBuffer());
        if(revision!==fileRevision||$('#import-file')!==fileInput)return;
        sheets=loaded;$('#import-class-options').hidden=false;$('#import-sheet').value='all';refreshSheetOptions();chooseSheet();
      }else {const text=await file.text();if(revision!==fileRevision||$('#import-file')!==fileInput)return;$('#import-text').value=text;}
    }catch(error){if(revision===fileRevision&&$('#import-file')===fileInput)$('#import-preview').innerHTML=`<div class="inline-errors">${esc(error.message)}</div>`;}
    finally{if(revision===fileRevision&&$('#import-file')===fileInput)$('#import-submit').disabled=false;}
  };
  $('#import-submit').onclick=()=>{
    if(!preview){
      const existing=$('#replace-list').checked?[]:state.students;
      if(sheets.length&&$('#import-sheet').value==='all')preview=parseStudentSheets(sheets,existing,sheetOptions());
      else {
        const defaultClass=sheets.length&&sheetOptions().classFromSheetName?sheets[Number($('#import-sheet').value)].name:'';
        preview=parseStudentRows(textRows($('#import-text').value),existing,{defaultClass,fullNameOrder:sheetOptions().fullNameOrder});
      }
      $('#import-preview').innerHTML=`<p><strong>${preview.students.length} geldige leerlingen</strong>${preview.yearErrors.length?' · leerjaren nog controleren':' klaar om toe te voegen'}.</p>${preview.students.length?`<table><thead><tr><th>Naam</th><th>Klas</th><th>Leerjaar</th><th>Voornaam</th><th>Achternaam</th></tr></thead><tbody>${preview.students.slice(0,5).map(p=>`<tr><td>${esc(p.name)}</td><td>${esc(p.class)}</td><td>${esc(p.year||'Niet herkend')}</td><td>${esc(studentNameParts(p).firstName)}</td><td>${esc(studentNameParts(p).lastName)}</td></tr>`).join('')}</tbody></table>`:''}${preview.errors.length?`<div class="inline-errors">${preview.errors.map(esc).join('<br>')}<br>Ongeldige werkbladen en regels worden niet toegevoegd.</div>`:''}${preview.yearErrors.length?yearCorrectionFields(preview.yearErrors):''}`;if(preview.yearErrors.length)bindYearCorrections();$('#import-submit').textContent=`${preview.students.length} leerlingen toevoegen`;return;}
    if(!preview.students.length)return toast('Er zijn geen geldige leerlingen om toe te voegen.');
    if(preview.yearErrors.length){const years=correctedYears();if(!years)return;for(const p of preview.yearErrors)setManualYear(p,years.get(p.id));}
    commit(()=>updateStudentList(state,preview.students,{replace:$('#replace-list').checked}));selected=null;selectedBench=null;tab='students';closeModal();render();toast(`${preview.students.length} leerlingen toegevoegd.`);
  };
}
function ruleDialog(existing=null,{fixed=false,apply=false,pupilId=selected,roomOnly=false}={}) {
  const initialType=fixed?'fixed':existing?.type||'separate',initialRoom=existing?.roomId||ownValue(state.studentRooms,pupilId)||state.activeRoomId;
  const view=roomState(state,state.rooms.some(r=>r.id===initialRoom)?initialRoom:state.activeRoomId),initialSeat=existing?.seat||Object.keys(view.assignments).find(seat=>view.assignments[seat]===pupilId)||enabledSeats(view.settings)[0];
  modal(existing?'Regel aanpassen':'Zitregel toevoegen',`<label class="field">Regel<select id="rule-type">${Object.entries(RULE_TYPES).map(([key,label])=>`<option value="${key}" ${initialType===key?'selected':''}>${esc(label)}</option>`).join('')}</select></label><label class="field" id="rule-priority-field">Belangrijkheid<select id="rule-priority">${priorityOptions(existing?.priority||'Verplicht')}</select></label><div id="rule-position-fields" hidden><label class="field">Lokaal<select id="rule-room">${state.rooms.map(r=>`<option value="${esc(r.id)}" ${r.id===view.activeRoomId?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label><label class="field">Vaste locatie (verplicht)<select id="rule-location-scope"><option value="room" ${existing&&!existing.seat||roomOnly?'selected':''}>Alleen het lokaal</option><option value="seat" ${existing?.seat||!existing&&!roomOnly?'selected':''}>Exacte zitplaats</option></select></label><div id="rule-seat-fields" class="range-fields"><label class="field">Bank<select id="rule-bench"></select></label><label class="field">Zitplaats<select id="rule-seat"></select></label></div></div><div class="member-picker">${state.students.map(p=>`<label><input type="checkbox" name="rule-member" value="${esc(p.id)}" ${(existing?.students || [pupilId]).includes(p.id)?'checked':''}>${esc(p.name)} <span class="muted">${esc(p.class)}</span></label>`).join('')}</div><div id="rule-errors" role="alert"></div>`,`${existing?.type==='fixed'?'<button class="button danger" id="rule-remove">Vaste locatie verwijderen</button>':''}<button class="button" data-close>Annuleren</button><button class="button primary" id="rule-submit">${apply?'Toepassen en bewaren':'Regel bewaren'}</button>`);
  if($('#rule-remove'))$('#rule-remove').onclick=()=>{commit(()=>state.rules=state.rules.filter(r=>r.id!==existing.id));closeModal();};
  const areaHelp=document.createElement('p');areaHelp.id='rule-area-help';areaHelp.className='muted';
  areaHelp.textContent=view.settings.layout?.kind==='custom'?'Leerlingen moeten in hetzelfde lokaal en hetzelfde eigen vak zitten. Banken buiten eigen vakken vormen samen één gebied.':'Leerlingen moeten in hetzelfde lokaal en hetzelfde gebied van de plattegrond zitten.';
  $('#rule-type').closest('label').after(areaHelp);
  const locationSettings=()=>roomState(state,$('#rule-room').value).settings;
  const updateSeats=(side=0)=>{const b=benchesFor(locationSettings()).find(b=>b.id===$('#rule-bench').value);$('#rule-seat').innerHTML=b?Array.from({length:benchCapacity(b)},(_,i)=>`<option value="${i}" ${i===side?'selected':''}>${esc(seatCode(`${b.id}:${i}`,locationSettings()))}</option>`).join(''):'';};
  const updateRoom=(seat=null)=>{const benches=benchesFor(locationSettings());$('#rule-bench').innerHTML=benches.map(b=>`<option value="${esc(b.id)}" ${b.id===seat?.split(':')[0]?'selected':''}>${esc(b.label)}</option>`).join('');updateSeats(Number(seat?.split(':')[1]||0));};
  $('#rule-room').onchange=()=>updateRoom();$('#rule-bench').onchange=()=>updateSeats();updateRoom(initialSeat);
  const update=()=>{const type=$('#rule-type').value;areaHelp.hidden=type!=='area';$('#rule-position-fields').hidden=type!=='fixed';$('#rule-priority-field').hidden=type==='fixed';$('#rule-seat-fields').hidden=$('#rule-location-scope').value==='room';};$('#rule-type').onchange=update;$('#rule-location-scope').onchange=update;update();
  $('#rule-submit').onclick=()=>{
    const type=$('#rule-type').value,students=[...document.querySelectorAll('[name=rule-member]:checked')].map(e=>e.value);
    if(type==='fixed'?students.length!==1:type==='group'?students.length<2:students.length!==2){$('#rule-errors').textContent='Kies het gevraagde aantal leerlingen.';return;}
    const seat=type==='fixed'&&$('#rule-location-scope').value==='seat'?`${$('#rule-bench').value}:${$('#rule-seat').value}`:null;
    if(seat&&!engineValidSeat(seat,locationSettings())){$('#rule-errors').textContent='Kies een bestaande zitplaats.';return;}
    const rule={id:existing?.id||crypto.randomUUID(),type,students,priority:type==='fixed'?'Verplicht':$('#rule-priority').value,...(type==='fixed'?{roomId:$('#rule-room').value,...(seat?{seat,positionCode:seatCode(seat,locationSettings())}:{})}:{})};
    if(type==='fixed'&&classRoomId(state,person(students[0]).class)&&classRoomId(state,person(students[0]).class)!==rule.roomId){$('#rule-errors').textContent='Deze klas heeft een ander vast lokaal. Pas eerst de klasregel aan.';return;}
    commit(()=>{
      if(type==='fixed'){setLocationRule(state,rule);state.settings.studentRulesEnabled=true;}
      else if(existing)state.rules=state.rules.map(r=>r.id===existing.id?rule:r);else state.rules.push(rule);
      if(apply&&seat&&!person(students[0]).absent) {
        // Move to the chosen room before applying its exact seat; keep the open tab.
        const active=state.activeRoomId;normalizeRooms(state);switchRoom(state,rule.roomId);
        const id=students[0],from=studentSeat(id),other=state.assignments[seat];
        if(from!==seat){if(from){if(other)state.assignments[from]=other;else delete state.assignments[from];}state.assignments[seat]=id;}
        switchRoom(state,active);
      }
    });
    closeModal();if(!apply)tab='rules';render();toast('Regel bewaard en huidige indeling gecontroleerd.');
  };
}
function orderedDialog(onSaved=null) {
  const options=state.settings.ordered;
  const available=enabledSeats(state.settings);
  const columns=(state.settings.layout?.kind==='custom'?[]:'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')).map(letter=>{
    const rows=available.filter(seat=>seatBench(seat).letter===letter).map(seat=>seatBench(seat).block*2+Number(seat.split(':')[1])+1).sort((a,b)=>a-b);
    const start=options.startRows?.[letter];
    return `<tr><th scope="row">Kolom ${letter}</th><td><select data-column-start="${letter}" aria-label="Startrij voor kolom ${letter}"><option value="">Standaard</option>${[1,2,3,4,5,6,7,8].map(row=>`<option value="${row}" ${start===row?'selected':''}>Rij ${row}${rows.includes(row)?'':' (niet beschikbaar)'}</option>`).join('')}</select></td><td>${rows.length?rows.join(', '):'Uitgeschakeld'}</td></tr>`;
  }).join('');
  modal('Geordend plaatsen instellen',`<label class="field">Eerst vullen<select id="ordered-axis"><option value="columns" ${options.axis==='columns'?'selected':''}>Per kolom: banken onder elkaar</option><option value="rows" ${options.axis==='rows'?'selected':''}>Per bankrij: banken naast elkaar</option></select></label><div class="range-fields"><label class="field">Kolomrichting<select id="ordered-horizontal"><option value="left" ${options.horizontal==='left'?'selected':''}>Van links naar rechts</option><option value="right" ${options.horizontal==='right'?'selected':''}>Van rechts naar links</option></select></label><label class="field">Bankrijrichting<select id="ordered-vertical"><option value="top" ${options.vertical==='top'?'selected':''}>Van boven naar beneden</option><option value="bottom" ${options.vertical==='bottom'?'selected':''}>Van beneden naar boven</option></select></label></div><label class="field">Standaard eerste zitplaats (beide modi)<select id="ordered-side"><option value="0" ${options.seatSide===0?'selected':''}>${state.settings.layout?.kind==='custom'?'Eerste plaats van de bank':'Eerste zitrij van de bank (1, 3, 5, 7)'}</option><option value="1" ${options.seatSide===1?'selected':''}>${state.settings.layout?.kind==='custom'?'Tweede plaats, als die beschikbaar is':'Tweede zitrij van de bank (2, 4, 6, 8)'}</option></select></label><div class="column-start-heading"><h3>Startrij per kolom</h3><button class="button small" id="reset-column-starts">Alles op standaard</button></div><div class="column-start-table"><table><thead><tr><th>Kolom</th><th>Startrij</th><th>Beschikbare rijen</th></tr></thead><tbody>${columns}</tbody></table></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="ordered-save">Instellingen bewaren</button>`);
  $('#modal').classList.add('ordered-modal');$('#modal').classList.toggle('custom-ordered',state.settings.layout?.kind==='custom');
  $('#reset-column-starts').onclick=()=>document.querySelectorAll('[data-column-start]').forEach(select=>select.value='');
  $('#ordered-save').onclick=()=>{const startRows=Object.fromEntries([...document.querySelectorAll('[data-column-start]')].filter(select=>select.value).map(select=>[select.dataset.columnStart,Number(select.value)]));commit(()=>{state.settings.ordered={axis:$('#ordered-axis').value,horizontal:$('#ordered-horizontal').value,vertical:$('#ordered-vertical').value,seatSide:Number($('#ordered-side').value),startRows};state.settings.placementMode='ordered';});closeModal();toast('Instellingen bewaard. Maak een indeling om ze toe te passen.');onSaved?.();};
}
function editStudent() {
  const p=person(selected);if(!p)return;
  modal('Leerling aanpassen',`${p.firstName!==undefined?`<label class="field">Achternaam<input id="edit-last-name" value="${esc(p.lastName)}"></label><label class="field">Voornaam<input id="edit-first-name" value="${esc(p.firstName)}"></label>`:`<label class="field">Naam<input id="edit-name" value="${esc(p.name)}"></label>`}<label class="field">Klas<input id="edit-class" value="${esc(p.class)}"></label><label class="field">Leerjaar<input id="edit-year" inputmode="numeric" value="${esc(p.year)}"></label><div class="student-year-options"><label class="toggle-line"><input type="checkbox" id="edit-year-manual" ${manualYear(p)||!inferYear(p.class)?'checked':''}>Handmatig</label><label class="toggle-line"><input type="checkbox" id="edit-year-class" disabled title="Pas dit leerjaar toe op alle leerlingen met dezelfde klascode.">Hele klas</label></div><p id="edit-year-help" role="status"></p>${p.eveningStudy?STUDY_DAYS.map(day=>`<label class="field">Avondstudie op ${day}<select data-study-day="${day}">${['','Ja','Nee'].map(value=>`<option value="${value}" ${p.eveningStudy[day]===value?'selected':''}>${value||'Niet ingevuld'}</option>`).join('')}</select></label>`).join(''):''}<div id="edit-errors" role="alert"></div>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="edit-submit">Bewaren</button>`);
  const updateYear=(classChanged=false)=>{
    const detected=inferYear($('#edit-class').value);
    if(classChanged){$('#edit-year-manual').checked=!detected;$('#edit-year').value=detected;}
    const manual=$('#edit-year-manual').checked,all=$('#edit-year-class');
    all.disabled=!manual;if(!manual)all.checked=false;
    $('#edit-year').readOnly=!$('#edit-year-manual').checked;
    if($('#edit-year').readOnly)$('#edit-year').value=detected;
    const klass=$('#edit-class').value.trim(),count=state.students.filter(student=>student.id===p.id||student.class===klass).length;
    $('#edit-year-help').textContent=manual&&all.checked?`Voor alle ${count} leerlingen in ${klass||'deze klas'}.`:!detected&&!manual?'Leerjaar niet herkenbaar. Kies Handmatig.':'';
    $('#edit-year-help').hidden=!$('#edit-year-help').textContent;
  };
  $('#edit-class').oninput=()=>updateYear(true);$('#edit-year-manual').onchange=()=>updateYear();$('#edit-year-class').onchange=()=>updateYear();updateYear();
  $('#edit-submit').onclick=()=>{
    const splitName=p.firstName!==undefined,firstName=splitName?$('#edit-first-name').value.trim():'',lastName=splitName?$('#edit-last-name').value.trim():'',name=splitName?[firstName,lastName].filter(Boolean).join(' '):$('#edit-name').value.trim(),klass=$('#edit-class').value.trim(),manual=$('#edit-year-manual').checked,year=manual?normalizeYear($('#edit-year').value):inferYear(klass);
    if(!name||!klass||!year){$('#edit-errors').innerHTML='<div class="inline-errors">Vul naam en klas in. Het leerjaar moet een positief geheel getal zijn; pas het handmatig aan als de klascode niet wordt herkend.</div>';return;}
    if(studentLocationRoomId(state,p.id)&&classRoomId(state,klass)&&studentLocationRoomId(state,p.id)!==classRoomId(state,klass)){$('#edit-errors').textContent='Deze klas heeft een ander vast lokaal. Pas eerst de vaste locatie van deze leerling aan.';return;}
    if(state.students.some(s=>s.id!==p.id&&s.name.toLowerCase()===name.toLowerCase()&&s.class.toLowerCase()===klass.toLowerCase())){$('#edit-errors').innerHTML='<div class="inline-errors">Deze leerling staat al in deze klas.</div>';return;}
    const classmates=manual&&$('#edit-year-class').checked?state.students.filter(student=>student.id!==p.id&&student.class===klass):[];
    commit(()=>{if(state.weeklyPlans&&(p.year!==year||p.class!==klass||classmates.some(student=>student.year!==year))){leaveWeeklyDay(state);delete state.weeklyPlans;}Object.assign(p,{name,class:klass,year,...(splitName?{firstName,lastName}:{}),...(p.eveningStudy?{eveningStudy:Object.fromEntries([...document.querySelectorAll('[data-study-day]')].map(select=>[select.dataset.studyDay,select.value]))}:{})});if(manual)setManualYear(p,year);else delete p.yearOverride;for(const student of classmates)setManualYear(student,year);if(p.absent){const seat=studentSeat(p.id);if(seat)delete state.assignments[seat];state.locks=state.locks.filter(id=>id!==p.id);}});closeModal();
  };
}
function useProject(document) {
  state=initializeRooms(migrateState(document.state));calendarPreference.apply(state);
  if(state.calendar?.enabled&&!isSchoolDay(state.calendar.selectedDate))openCalendarDate(state,shiftSchoolDay(state.calendar.selectedDate));
  normalizeStudentYears(state.students);
  plans=document.plans.filter(p=>p&&validState(p.state));lists=document.lists;
  past=[];future=[];revision++;alternatives=[];roomViews.clear();
  benchSelection=[];benchSelectionMode=false;selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;tab='room';
  zoom=1;zoomMode='custom';closeModal();render();write(KEY,state);yearErrorsDialog();
}
function projectSaveDialog(mode='save',project=null) {
  if(mode==='copy'){projectSession.duplicate(project?.id??projectSession.id).then(useProject).catch(error=>toast(error.message));return;}
  const creating=mode==='new',id=project?.id??projectSession.id;
  if(!creating&&id===projectSession.standard?.id)return toast('Het standaardproject behoudt zijn naam.');
  modal(creating?'Nieuw project':'Naam wijzigen',`<label class="field">Projectnaam<input id="${creating?'new-project-name':'plan-name'}" value="${esc(creating?'Nieuw project':project?.name??state.name)}" maxlength="120"></label><p id="project-action-error" role="alert"></p>`,
    `<button class="button" data-close>Annuleren</button><button class="button primary" id="save-submit">${creating?'Project maken':'Naam wijzigen'}</button>`);
  $('#save-submit').onclick=async event=>{
    const name=$(creating?'#new-project-name':'#plan-name').value.trim();if(!name)return;
    event.target.disabled=true;
    try{
      if(creating)useProject(await projectSession.create(name,{valid:validState}));
      else {const current=id===projectSession.id,next=await projectSession.rename(id,name);if(current)useProject(next);else await projectsDialog();}
    }catch(error){event.target.disabled=false;$('#project-action-error').textContent=error.message;}
  };
}
async function resetProjectDialog() {
  if(busy||roomsUI.isEditing)return toast('Wacht tot de planner klaar is en sluit eerst de opstellingseditor.');
  try{
    const preview=await projectSession.resetPreview(),startRevision=revision;
    modal('Terugzetten naar standaard',`<p><strong>${esc(preview.name)}</strong> terugzetten naar ${esc(preview.sourceName)}?</p><p>Alle huidige lokalen, leerlingen, regels, zitplaatsen, bewaarde lijsten en plannen in dit project worden vervangen. Dit kan niet met Ongedaan maken worden hersteld. Andere projecten blijven behouden.</p><p>De standaard bevat ${preview.rooms} lokalen, ${preview.students} leerlingen, ${preview.rules} leerlingregels, ${preview.lists} lijsten en ${preview.plans} plannen. Kies of je eerst een backup van je huidige project wilt maken.</p><p>Backuplocatie: <span class="backup-location">${esc(preview.backupDirectory)}</span><br>Projectbackups worden na 30 dagen automatisch verwijderd. Dit wordt eenmaal bij het starten van de app gecontroleerd. De oorspronkelijke standaard blijft bewaard.</p><p>Bij terugzetten zonder backup wordt geen nieuwe backup van je huidige project gemaakt.</p><p id="project-action-error" role="alert"></p>`,
      '<button class="button" data-close>Annuleren</button><button class="button subtle" id="reset-project-no-backup">Terugzetten zonder backup</button><button class="button danger" id="reset-project-confirm">Backup maken en terugzetten</button>');
    const reset=async backup=>{
      if(startRevision!==revision)return toast('Het project is gewijzigd. Bekijk de bevestiging opnieuw.');
      const buttons=[$('#reset-project-confirm'),$('#reset-project-no-backup')];buttons.forEach(button=>button.disabled=true);
      try{const result=await projectSession.reset({backup});useProject(result.document);toast(backup?'Project teruggezet. De vorige gegevens staan in de backupmap.':'Project teruggezet zonder nieuwe backup.');}
      catch(error){buttons.forEach(button=>button.disabled=false);$('#project-action-error').textContent=error.message;}
    };
    $('#reset-project-confirm').onclick=()=>reset(true);$('#reset-project-no-backup').onclick=()=>reset(false);
  }catch(error){toast(error.message);}
}
function deleteProjectDialog(project) {
  modal('Project verwijderen',`<p><strong>${esc(project.name)}</strong> verwijderen?</p><p>Dit verwijdert het volledige project uit de projectenlijst, inclusief ${project.rooms} lokalen, ${project.students} leerlingen, regels, zitplaatsen en bewaarde lijsten/plannen. Dit kan niet met Ongedaan maken worden hersteld. Eerst wordt een backup gemaakt. Andere projecten blijven behouden.${project.id===projectSession.id?' Het standaardproject wordt daarna geopend.':''}</p><p id="project-action-error" role="alert"></p>`,
    '<button class="button" data-close>Annuleren</button><button class="button danger" id="delete-project-confirm">Project verwijderen</button>');
  $('#delete-project-confirm').onclick=async event=>{
    event.target.disabled=true;
    try{const current=project.id===projectSession.id,result=await projectSession.remove(project.id);if(current)useProject(result.document);else await projectsDialog();toast('Project verwijderd. Een backup blijft bewaard.');}
    catch(error){event.target.disabled=false;$('#project-action-error').textContent=error.message;}
  };
}
async function projectsDialog() {
  if(busy||roomsUI.isEditing)return toast('Wacht tot de planner klaar is en sluit eerst de opstellingseditor.');
  try{
    await projectSession.flush();const projects=await projectSession.list();
    modal('Projecten',`<div class="project-list">${projects.map(p=>`<div class="plan-item project-item"><div><strong>${esc(p.name)}${p.id===projectSession.id?' · geopend':''}</strong><small>${p.error?esc(p.error):`${p.students} leerlingen · ${p.rooms} lokalen`}</small></div><div class="project-actions"><button class="button small" data-open-project="${esc(p.id)}" ${p.error?'disabled':''}>Openen</button><button class="button small" data-duplicate-project="${esc(p.id)}" ${p.error?'disabled':''}>Dupliceren</button><button class="button small" data-rename-project="${esc(p.id)}" ${p.error||p.standard?'disabled':''}>Naam wijzigen</button><button class="button small danger" data-delete-project="${esc(p.id)}" ${p.error||p.standard?'disabled':''} ${p.standard?'title="Het standaardproject kan niet worden verwijderd."':''}>Verwijderen</button></div></div>`).join('')}</div><p id="project-menu-error" role="alert"></p>`,
      '<button class="button primary" id="new-project">Nieuw project</button><button class="button" id="open-project">Importeren</button><button class="button danger" id="reset-project">Terugzetten naar standaard…</button><input type="file" id="project-file" accept=".json" hidden>');
    for(const p of projects){
      $(`[data-open-project="${CSS.escape(p.id)}"]`).onclick=async event=>{event.target.disabled=true;try{useProject(await projectSession.open(p.id,validState));}catch(error){event.target.disabled=false;$('#project-menu-error').textContent=error.message;}};
      $(`[data-duplicate-project="${CSS.escape(p.id)}"]`).onclick=async event=>{event.target.disabled=true;try{useProject(await projectSession.duplicate(p.id));}catch(error){event.target.disabled=false;$('#project-menu-error').textContent=error.message;}};
      $(`[data-rename-project="${CSS.escape(p.id)}"]`).onclick=()=>projectSaveDialog('save',p);
      $(`[data-delete-project="${CSS.escape(p.id)}"]`).onclick=()=>deleteProjectDialog(p);
    }
    $('#new-project').onclick=()=>projectSaveDialog('new');$('#reset-project').onclick=resetProjectDialog;
    $('#open-project').onclick=()=>$('#project-file').click();
    $('#project-file').onchange=async event=>{
      try{
        const file=event.target.files[0];if(!file)return;
        const imported=JSON.parse(await file.text(),(_key,item)=>unpackGridRoom(item));
        if(!validProjectBackup(imported))throw Error('Dit projectbestand bevat ongeldige gegevens, plannen of lijsten. Er is niets geïmporteerd.');
        await projectSession.flush();
        const saved=await window.desktop.projects.create({state:JSON.parse(JSON.stringify(initializeRooms(migrateState(imported.state)),(_key,item)=>packGridRoom(item))),lists:imported.lists??[],plans:imported.plans??[]});
        useProject(await projectSession.open(saved.document.id,validState));toast('Projectbestand als apart project geïmporteerd.');
      }catch(error){$('#project-menu-error').textContent=error.message;}
    };
  }catch(error){toast(error.message);}
}
function saveDialog(duplicate=false) {
  if(projectSession)return projectSaveDialog(duplicate?'copy':'save');
  modal(duplicate?'Plan dupliceren':'Plan bewaren',`<label class="field">Naam van de indeling<input id="plan-name" value="${esc(state.name+(duplicate?' · kopie':''))}" maxlength="120"></label>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="save-submit">Bewaren</button>`);
  $('#save-submit').onclick=()=>{const name=$('#plan-name').value.trim();if(!name)return toast('Geef je indeling een naam.');const id=duplicate?crypto.randomUUID():state.planId||crypto.randomUUID(),existing=plans.find(p=>p.id===id);commit(()=>{state.name=name;state.planId=id;});const plan={id,created:existing?.created||new Date().toISOString(),state:clone(state)};plans=plans.filter(p=>p.id!==id);plans.unshift(plan);write(`${KEY}-plans`,plans);closeModal();toast('Indeling bewaard.');};
}
function plansDialog() {
  if(projectSession)return projectsDialog();
  modal('Mijn plannen',`${plans.map(p=>`<div class="plan-item"><div><strong>${esc(p.state.name)}</strong><small>${p.state.students.length} leerlingen · gewijzigd ${new Date(p.state.modified).toLocaleString('nl-BE')}<br>Gemaakt ${new Date(p.created).toLocaleDateString('nl-BE')}</small></div><button class="button small" data-load-plan="${esc(p.id)}">Openen</button><button class="button small" data-copy-plan="${esc(p.id)}">Kopie</button></div>`).join('')||'<p>Geen bewaarde plannen.</p>'}`,`<button class="button" id="open-project">Projectbestand openen</button><input type="file" id="project-file" accept=".json" hidden><button class="button" id="duplicate-current">Huidige indeling dupliceren</button>`);
  $('#open-project').onclick=()=>$('#project-file').click();
  $('#project-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;const data=JSON.parse(await file.text(),(_key,item)=>unpackGridRoom(item));if(!validProjectBackup(data))throw Error();commit(()=>{state=initializeRooms(migrateState(data.state));state.planId=null;});selected=null;selectedBench=null;if(Array.isArray(data.plans)){const incoming=data.plans;plans=[...plans,...incoming.filter(p=>!plans.some(x=>x.id===p.id))];write(`${KEY}-plans`,plans);}if(Array.isArray(data.lists)){lists=[...lists,...data.lists.filter(l=>!lists.some(x=>x.id===l.id))];write(`${KEY}-lists`,lists);}closeModal();render();toast('Projectbestand geopend.');yearErrorsDialog();}catch{toast('Dit is geen geldig Zitplanner-projectbestand.');}};
  $('#duplicate-current').onclick=()=>{closeModal();saveDialog(true);};
}
function saveList() { modal('Leerlingenlijst bewaren',`<label class="field">Naam van de lijst<input id="list-name" placeholder="Bijvoorbeeld: klassen 3A en 4B"></label>`,`<button class="button" data-close>Annuleren</button><button class="button primary" id="list-save">Bewaren</button>`);$('#list-save').onclick=()=>{const name=$('#list-name').value.trim();if(!name)return toast('Geef de lijst een naam.');lists.unshift({id:crypto.randomUUID(),name,students:clone(state.students).map(s=>({...s,absent:false,...(s.attendanceAbsent!==undefined?{attendanceAbsent:false}:{})}))});write(`${KEY}-lists`,lists);closeModal();toast('Leerlingenlijst bewaard, zonder tijdelijke afwezigheden.');}; }
function listsDialog() { modal('Bewaarde leerlingenlijsten',`<p>Een lijst openen vervangt de huidige leerlingen en hun regels. Je kunt dit ongedaan maken.</p>${lists.map(l=>`<div class="plan-item"><div><strong>${esc(l.name)}</strong><small>${l.students.length} leerlingen</small></div><button class="button" data-load-list="${esc(l.id)}">Gebruiken</button></div>`).join('')||'<p>Nog geen lijsten bewaard.</p>'}`); }
function printMarkup(detail) {
  return `<h1>${esc(state.name)}</h1><p>${esc(currentRoom(state).name)} · ${new Date(state.modified).toLocaleString('nl-BE')} · ${activeStudents().length} leerlingen · ${analysis.warnings.length} waarschuwingen</p>${exportSVG(detail)}${analysis.warnings.length?`<div class="print-warnings">${analysis.warnings.map(w=>`<div>⚠ ${state.hiddenWarnings.includes(warningKey(state,w))?'[Verborgen] ':''}${w.benches.map(id=>BY_BENCH[id]?.label??'Onbekend').join(' & ')}: ${esc(w.message)}</div>`).join('')}</div>`:''}`;
}
function exportSVG(detail) {
  const styles=`.bench-table{fill:#e9e7dc;stroke:#c8c9be;stroke-width:1.7}.chair{fill:#a6b0b3;stroke:#7f8c90;stroke-width:1.4}.chair-disabled{opacity:.35;fill:#ddd;stroke-dasharray:3 2}.seat-bg{fill:#edf4ef;stroke:#b5c9bc;stroke-width:1.4}.empty .seat-bg{fill:#f9faf7;stroke:#d5d9cf}.disabled{opacity:.37}.disabled:has(.seat.warning){opacity:1}.seat.warning .seat-bg{fill:#ffe0ad;stroke:#d17b16;stroke-width:2.5}.bench-label{fill:#939b90;font-size:13px}.column-label{fill:#798b7e;font-size:21px;font-weight:600}.area-label{fill:#98a79c;font-size:13px}.empty-label{fill:#b1b8ac;font-size:15px}text{font-family:Arial,sans-serif}`;
  const gutter=roomGutter();return `<svg xmlns="http://www.w3.org/2000/svg" width="${ROOM.width+gutter}" height="${ROOM.height}" viewBox="${-gutter} 0 ${ROOM.width+gutter} ${ROOM.height}"><style>${styles}</style>${roomSVG({exporting:true,detail})}</svg>`;
}
function renderExport(container,options={}) {
  const formats={xlsx:'Excel (.xlsx)',pdf:'Plattegrond · PDF',print:'Plattegrond · Afdrukken',png:'Plattegrond · PNG',svg:'Plattegrond · SVG',csv:'Leerlingen · CSV',json:'Volledig projectbestand (.json)','calendar-xlsx':'Kalender · Excel (.xlsx)','calendar-json':'Kalender · Herstelbestand (.json)'};
  container.innerHTML=`<div class="task-heading"><h2>Export</h2></div><div class="export-panel"><label class="field">Bestand / uitvoer<select id="export-format">${Object.entries(formats).map(([value,label])=>`<option value="${value}" ${value===(options.format??'xlsx')?'selected':''}>${label}</option>`).join('')}</select></label><label class="field" id="export-scope-field">Omvang<select id="export-scope"><option value="room" ${!options.scope||options.scope==='room'?'selected':''}>Dit lokaal · ${esc(currentRoom(state).name)}</option><option value="all" ${options.scope==='all'?'selected':''}>Alle lokalen</option><option value="week" ${options.scope==='week'?'selected':''} ${weeklyCurrent(state)?'':'disabled'}>Hele week · alle deelnemende lokalen</option></select></label><label class="field" id="export-calendar-date-field" hidden><span id="export-calendar-date-label">Datum</span><input type="date" id="export-calendar-date" value="${esc(state.calendar?.selectedDate??todayKey())}"></label><label class="field" id="export-calendar-scope-field" hidden>Kalenderperiode<select id="export-calendar-scope"><option value="day">Dag</option><option value="week">Week</option><option value="month">Maand</option></select></label><label class="field" id="export-room-field">Lokaal<select id="export-room">${state.rooms.map(room=>`<option value="${esc(room.id)}" ${room.id===state.activeRoomId?'selected':''}>${esc(room.name)}</option>`).join('')}</select></label><label class="field" id="export-detail-field">Gegevens op de plattegrond<select id="export-detail"><option value="names">Alleen namen</option><option value="class" selected>Namen + klas</option><option value="year">Namen + leerjaar</option></select></label><fieldset id="export-columns-field" class="export-columns" hidden><legend>Kolommen en volgorde</legend><div id="export-columns-list"></div></fieldset><div id="export-sheet-options" hidden><strong>Werkbladopties</strong><label class="toggle-line"><input type="checkbox" id="export-separate-classes" checked>Een apart werkblad per klas</label></div><div id="export-error" role="alert"></div><div class="export-actions"><button class="button primary" id="export-submit">Exporteren</button></div></div>`;
  const multipleRooms=state.rooms.length>1;
  const columnChoices=options.columnChoices??{xlsx:new Map(exportColumns('xlsx',{allRooms:true,week:true}).map(c=>[c.id,c.id==='day'||c.id==='name'||c.id==='seat'||c.id==='room'&&multipleRooms||STUDY_DAYS.includes(c.id)]))};
  const columnOrder=options.columnOrder??{xlsx:exportColumns('xlsx',{allRooms:true,week:true}).map(c=>c.id)};
  const selectedColumnIds=()=>[...$('#export-columns-list').querySelectorAll('[data-export-column]:checked:not(:disabled)')].map(input=>input.dataset.exportColumn);
  const orderedColumns=()=>{
    const format=$('#export-format').value,scope=$('#export-scope').value;
    const available=exportColumns(format,{allRooms:scope==='all',week:scope==='week'});
    return columnOrder[format].map(id=>available.find(c=>c.id===id)).filter(Boolean);
  };
  let eveningStudyEnabled=options.eveningStudyEnabled??false,attendanceColors=options.attendanceColors??false;
  let eveningStudyOpen=eveningStudyEnabled&&(options.eveningStudyOpen??false);
  const columnUnits=id=>{
    const ids=orderedColumns().map(c=>c.id);
    if(STUDY_DAYS.includes(id))return ids.filter(key=>STUDY_DAYS.includes(key));
    const units=[];
    for(const key of ids){if(!STUDY_DAYS.includes(key))units.push(key);else if(!units.includes('eveningStudy'))units.push('eveningStudy');}
    return units;
  };
  const renderColumns=()=>{
    const choices=columnChoices.xlsx,columns=orderedColumns();
    const row=c=>`<div class="export-column-row" data-column-row="${c.id}"><button type="button" class="export-column-handle" data-export-drag="${c.id}" aria-label="${esc(c.label)} verplaatsen" title="Sleep om te verplaatsen, of gebruik de pijltoetsen">⠿</button><label class="toggle-line" ${c.id==='room'?'title="Naam van de toegewezen lokaaltab"':''}><input type="checkbox" data-export-column="${c.id}" ${STUDY_DAYS.includes(c.id)&&!eveningStudyEnabled?'disabled':''} ${(choices.get(c.id)??c.selected)?'checked':''}>${esc(STUDY_DAYS.includes(c.id)?c.id[0].toUpperCase()+c.id.slice(1):c.label)}</label></div>`;
    const days=columns.filter(c=>STUDY_DAYS.includes(c.id));
    $('#export-columns-list').innerHTML=columnUnits().map(id=>id==='eveningStudy'?`<div class="export-column-row export-day-group" data-column-row="eveningStudy"><button type="button" class="export-column-handle" data-export-drag="eveningStudy" aria-label="Avondstudiekolommen verplaatsen" title="Sleep om te verplaatsen, of gebruik de pijltoetsen">⠿</button><input type="checkbox" id="export-evening-study-enabled" aria-label="Avondstudie op …" ${eveningStudyEnabled?'checked':''}><details id="export-evening-study" ${eveningStudyOpen?'open':''}><summary aria-disabled="${!eveningStudyEnabled}">Avondstudie op …</summary><div class="export-day-columns">${days.map(row).join('')}<label class="toggle-line export-attendance-option"><input type="checkbox" id="export-attendance-colors" ${attendanceColors?'checked':''} ${eveningStudyEnabled?'':'disabled'}>Aanwezigheden</label></div></details></div>`:row(columns.find(c=>c.id===id))).join('');
    $('#export-evening-study').ontoggle=event=>{if(!event.target.isConnected)return;if(!eveningStudyEnabled)event.target.open=false;eveningStudyOpen=event.target.open;};
    const summary=$('#export-evening-study summary');
    summary.onclick=event=>{if(!eveningStudyEnabled)event.preventDefault();};
    summary.onkeydown=event=>{if(!eveningStudyEnabled&&['Enter',' '].includes(event.key))event.preventDefault();};
  };
  const validateColumns=()=>{
    const format=$('#export-format').value,excel=format==='xlsx',calendar=format.startsWith('calendar-'),date=$('#export-calendar-date').value,scope=$('#export-calendar-scope').value;
    const noDays=calendar&&(!validDateKey(date)||!periodDates(date,scope).some(key=>calendarRecord(state,key))),empty=excel&&!selectedColumnIds().length;
    $('#export-submit').disabled=empty||noDays;$('#export-error').textContent=empty?'Kies minstens één kolom om te exporteren.':noDays?'Geen bewaarde kalenderdagen in deze periode.':'';
  };
  $('#export-columns-list').onchange=event=>{
    if(event.target.id==='export-evening-study-enabled'){
      eveningStudyEnabled=event.target.checked;eveningStudyOpen=eveningStudyEnabled&&$('#export-evening-study').open;renderColumns();$('#export-evening-study-enabled').focus();
    }else if(event.target.id==='export-attendance-colors')attendanceColors=event.target.checked;
    else if(event.target.dataset.exportColumn)columnChoices.xlsx.set(event.target.dataset.exportColumn,event.target.checked);
    updateDateField();validateColumns();
  };
  const moveColumn=(id,targetId,after=false)=>{
    const visible=columnUnits(id);if(id===targetId||!visible.includes(id)||!visible.includes(targetId))return;
    const reordered=visible.filter(key=>key!==id);reordered.splice(reordered.indexOf(targetId)+(after?1:0),0,id);
    if(STUDY_DAYS.includes(id)){
      let index=0;columnOrder.xlsx=columnOrder.xlsx.map(key=>STUDY_DAYS.includes(key)?reordered[index++]:key);
    }else{
      const days=orderedColumns().filter(c=>STUDY_DAYS.includes(c.id)).map(c=>c.id);
      const reorderedIds=reordered.flatMap(key=>key==='eveningStudy'?days:[key]);
      const visibleIds=new Set(reorderedIds);let index=0;
      columnOrder.xlsx=columnOrder.xlsx.map(key=>visibleIds.has(key)?reorderedIds[index++]:key);
    }
    eveningStudyOpen=$('#export-evening-study').open;renderColumns();$(`#export-columns-list [data-export-drag="${id}"]`).focus();
  };
  let columnDrag=null;
  const clearDropMarkers=()=>$('#export-columns-list').querySelectorAll('.drop-before,.drop-after').forEach(row=>row.classList.remove('drop-before','drop-after'));
  const cancelColumnDrag=()=>{
    if(columnDrag?.handle.hasPointerCapture(columnDrag.pointerId))columnDrag.handle.releasePointerCapture(columnDrag.pointerId);
    columnDrag=null;clearDropMarkers();$('#export-columns-list').querySelector('.is-dragging')?.classList.remove('is-dragging');
  };
  $('#export-columns-list').onpointerdown=event=>{
    const handle=event.target.closest('[data-export-drag]');if(!handle||event.button!==0||!event.isPrimary)return;
    event.preventDefault();handle.focus();handle.setPointerCapture(event.pointerId);
    columnDrag={id:handle.dataset.exportDrag,handle,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false,target:null};
  };
  $('#export-columns-list').onpointermove=event=>{
    if(!columnDrag||event.pointerId!==columnDrag.pointerId)return;
    if(!columnDrag.moved&&Math.hypot(event.clientX-columnDrag.x,event.clientY-columnDrag.y)<4)return;
    columnDrag.moved=true;columnDrag.handle.closest('.export-column-row').classList.add('is-dragging');clearDropMarkers();columnDrag.target=null;
    const list=$('#export-columns-list'),bounds=list.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)return;
    const rows=[...list.querySelectorAll('[data-column-row]')].filter(item=>STUDY_DAYS.includes(columnDrag.id)?STUDY_DAYS.includes(item.dataset.columnRow):!STUDY_DAYS.includes(item.dataset.columnRow)),row=rows.find(item=>event.clientY<=item.getBoundingClientRect().bottom)??rows.at(-1);
    if(!row||row.dataset.columnRow===columnDrag.id)return;
    const rect=row.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;
    columnDrag.target={id:row.dataset.columnRow,after};row.classList.add(after?'drop-after':'drop-before');
  };
  $('#export-columns-list').onpointerup=event=>{
    if(!columnDrag||event.pointerId!==columnDrag.pointerId)return;
    const {id,target,moved}=columnDrag;cancelColumnDrag();if(moved&&target)moveColumn(id,target.id,target.after);
  };
  $('#export-columns-list').onpointercancel=cancelColumnDrag;
  $('#export-columns-list').onkeydown=event=>{
    const handle=event.target.closest('[data-export-drag]');if(!handle||!['ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();cancelColumnDrag();
    const id=handle.dataset.exportDrag,ids=columnUnits(id),index=ids.indexOf(id),next=index+(event.key==='ArrowUp'?-1:1);
    if(next>=0&&next<ids.length)moveColumn(id,ids[next],event.key==='ArrowDown');
  };
  const updateDateField=()=>{
    const calendar=$('#export-format').value.startsWith('calendar-');
    $('#export-calendar-date-field').hidden=!calendar;
    $('#export-calendar-scope-field').hidden=!calendar;
  };
  const update=()=>{
    const scope=$('#export-scope').value,format=$('#export-format').value,data=['csv','json'].includes(format)||format.startsWith('calendar-'),image=['pdf','print','png','svg'].includes(format);
    updateDateField();
    $('#export-scope-field').hidden=data;$('#export-detail-field').hidden=!image;
    cancelColumnDrag();
    const excel=format==='xlsx';$('#export-columns-field').hidden=!excel;$('#export-sheet-options').hidden=!excel;
    if(excel){eveningStudyOpen=$('#export-evening-study')?.open??eveningStudyOpen;renderColumns();}
    $('#export-scope').querySelectorAll('option').forEach(option=>option.disabled=option.value==='week'&&!weeklyCurrent(state)||image&&option.value!=='room');
    if(image&&scope!=='room')$('#export-scope').value='room';
    $('#export-room-field').hidden=data||$('#export-scope').value!=='room';

    $('#export-submit').textContent=format==='print'?'Afdrukken':'Exporteren';
    validateColumns();
  };
  $('#export-format').onchange=update;$('#export-scope').onchange=update;
  $('#export-calendar-date').onchange=validateColumns;$('#export-calendar-scope').onchange=validateColumns;
  $('#export-detail').value=options.detail??'class';$('#export-separate-classes').checked=options.separateClasses??true;update();
  $('#export-room').onchange=event=>{
    const choices={format:$('#export-format').value,scope:$('#export-scope').value,detail:$('#export-detail').value,separateClasses:$('#export-separate-classes').checked,columnChoices,columnOrder,eveningStudyEnabled,attendanceColors,eveningStudyOpen:$('#export-evening-study')?.open??eveningStudyOpen};
    openRoom(event.target.value);tab='export';render();renderExport(container,choices);
  };
  const detail=()=>$('#export-detail').value;
  const prepare=()=>{const d=detail();$('#print-root').innerHTML=printMarkup(d)+`<p>${Object.entries(state.assignments).map(([seat,id])=>{const s=person(id);return `${esc(seatCode(seat,state.settings))}: ${esc(s.name)}${d==='class'?' · '+esc(s.class):d==='year'?' · leerjaar '+esc(s.year):''}`;}).join(' &nbsp; | &nbsp; ')}</p>`;};
  $('#export-submit').onclick=async()=>{
    const format=$('#export-format').value,scope=$('#export-scope').value;
    try {
      if(format.startsWith('calendar-')){
        const date=$('#export-calendar-date').value,period=$('#export-calendar-scope').value;
        if(!validDateKey(date)||!periodDates(date,period).some(key=>calendarRecord(state,key)))throw Error('Geen bewaarde kalenderdagen in deze periode.');
        const name=`Kalender-${{day:'Dag',week:'Week',month:'Maand'}[period]}-${date}`;
        if(format==='calendar-xlsx')download(calendarWorkbook(state,date,period),name+'.xlsx',EXCEL_MIME);
        else download(JSON.stringify(calendarBackup(state,date,period),null,2),name+'.json','application/json');
      }
      else if(format==='xlsx'){
        if(scope==='week')download(weeklyWorkbook(state,{columns:selectedColumnIds(),separateClasses:$('#export-separate-classes').checked,attendanceColors:eveningStudyEnabled&&attendanceColors}),'Weekindeling.xlsx',EXCEL_MIME);
        else download(seatingWorkbook(state,{allRooms:scope==='all',columns:selectedColumnIds(),separateClasses:$('#export-separate-classes').checked,attendanceColors:eveningStudyEnabled&&attendanceColors}),safeName(state.name)+(scope==='all'?'-alle-lokalen':'')+'.xlsx',EXCEL_MIME);
      }
      else if(format==='json')download(JSON.stringify({version:1,state,plans,lists},null,2),safeName(state.name)+'.json','application/json');
      else if(format==='csv')download('\uFEFFNaam;Klas;Leerjaar\r\n'+state.students.map(s=>[s.name,s.class,s.year].map(v=>'"'+v.replaceAll('"','""')+'"').join(';')).join('\r\n'),'Leerlingen.csv','text/csv;charset=utf-8');
      else if(format==='svg')download(exportSVG(detail()),safeName(state.name)+'.svg','image/svg+xml');
      else if(format==='png')exportPNG(detail());
      else {prepare();if(format==='print'){if(window.desktop)await window.desktop.print();else window.print();}else if(window.desktop){const saved=await window.desktop.exportPDF(state.name);if(saved)toast('PDF opgeslagen.');}else{toast('Kies Opslaan als PDF in het afdrukvenster.');window.print();}return;}
      toast('Export klaargezet.');
    } catch(error){if($('#export-error'))$('#export-error').textContent='Exporteren is niet gelukt. '+error.message;else toast('Exporteren is niet gelukt. Probeer opnieuw.');}
  };
}
function exportPNG(detail) {
  const image=new Image(),size={...ROOM,width:ROOM.width+roomGutter()},name=safeName(state.name)+'.png',url=URL.createObjectURL(new Blob([exportSVG(detail)],{type:'image/svg+xml'}));
  image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=size.width*2;canvas.height=size.height*2;canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(blob)download(blob,name,'image/png');else toast('Afbeelding exporteren is niet gelukt.');URL.revokeObjectURL(url);},'image/png');};
  image.onerror=()=>{URL.revokeObjectURL(url);toast('Afbeelding exporteren is niet gelukt.');};image.src=url;
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-close'))return closeModal();
  if(target.dataset.tab){tab=target.dataset.tab;render();return;}
  if(target.hasAttribute('data-attendance')||target.hasAttribute('data-context-attendance')) {
    if(busy)return toast('Wacht tot de planner klaar is.');
    const id=target.dataset.attendance??target.dataset.contextAttendance,pupil=person(id);if(!pupil)return;
    const absent=!studentIsAbsent(pupil),main=$('main'),scroll=main.scrollTop;
    commit(()=>setStudentAttendance(state,id,absent),{keepWeekly:true,keepAlternatives:true});
    const card=target.hasAttribute('data-context-attendance')?$('#context [data-context-attendance]'):[...document.querySelectorAll('[data-attendance]')].find(button=>button.dataset.attendance===id);
    (card&&!card.hidden?card:$('#attendance-status'))?.focus({preventScroll:true});main.scrollTop=scroll;
    return;
  }
  if(target.dataset.openRoom){openRoom(target.dataset.openRoom);return;}
  if(target.dataset.editSection){sectionDialog(state.settings.sections.find(s=>s.id===target.dataset.editSection));return;}
  if(target.dataset.removeSection){const section=state.settings.sections.find(s=>s.id===target.dataset.removeSection);if(section&&!section.builtin)commit(()=>state.settings.sections=state.settings.sections.filter(s=>s.id!==section.id));return;}
  if(target.dataset.row){const row=Number(target.dataset.row);commit(()=>{state.settings.rows=state.settings.rows.includes(row)?state.settings.rows.filter(r=>r!==row):[...state.settings.rows,row];});return;}
  if(target.dataset.person){if(target.hasAttribute('data-unplaced'))selectUnplacedStudent(target.dataset.person);else if(tab==='students'){selected=target.dataset.person;editStudent();}else selectStudent(target.dataset.person);return;}
  if(target.dataset.studentRoom){tab='room';selectStudent(target.dataset.studentRoom);render();return;}
  if(target.dataset.deleteStudent){deleteStudentsDialog(target.dataset.deleteStudent);return;}
  if(target.hasAttribute('data-hide-warning')||target.hasAttribute('data-restore-warning')){
    const hiding=target.hasAttribute('data-hide-warning'),indices=target.dataset.warningIndices?.split(',').map(Number)??[Number(hiding?target.dataset.hideWarning:target.dataset.restoreWarning)],keys=indices.map(index=>analysis.warnings[index]).filter(Boolean).map(w=>warningKey(state,w));if(!keys.length)return;
    warningFocus=null;
    commit(()=>{state.hiddenWarnings=hiding?[...new Set([...state.hiddenWarnings,...keys])]:state.hiddenWarnings.filter(id=>!keys.includes(id));});
    toast(hiding?'Waarschuwing verborgen; de regel blijft gecontroleerd.':'Waarschuwing opnieuw getoond.');return;
  }
  if(target.hasAttribute('data-warning')){const w=analysis.warnings[Number(target.dataset.warning)];if(!w)return;const grouped=target.dataset.warningGroup==='unplaced';benchSelection=[];benchSelectionMode=false;pendingMove=null;warningFocus=grouped?'unplaced':warningKey(state,w);selected=grouped?null:w.students[0]??null;selectedBench=seatBench(studentSeat(selected))?.id??null;highlight=[];renderRoom();renderContext();renderUnplaced();const bench=selectedBench||w.benches[0];if(bench)focusBench(bench);if(grouped||selected&&!studentSeat(selected))$('#unplaced').scrollIntoView({block:'nearest'});return;}
  if(target.dataset.alternative){const index=Number(target.dataset.alternative),candidate=alternatives[index];commit(()=>{state.assignments=clone(candidate.assignments);alternativeIndex=index;},{keepAlternatives:true});return;}
  if(target.dataset.editRule){const rule=state.rules.find(r=>r.id===target.dataset.editRule);if(rule.roomId&&state.rooms.some(r=>r.id===rule.roomId)&&rule.roomId!==state.activeRoomId)openRoom(rule.roomId);ruleDialog(rule);return;}
  if(target.dataset.classRule){classRuleDialog(target.dataset.classRule);return;}
  if(target.dataset.yearRule){yearRuleDialog(JSON.parse(target.dataset.yearRule));return;}
  if(target.dataset.deleteYearRule){commit(()=>{state.settings.yearRules=state.settings.yearRules.filter(rule=>yearPairKey(...rule.years)!==target.dataset.deleteYearRule);});toast('Leerjaarregel verwijderd.');return;}
  if(target.dataset.deleteRule){commit(()=>state.rules=state.rules.filter(r=>r.id!==target.dataset.deleteRule));return;}
  if(target.dataset.loadPlan||target.dataset.copyPlan){const copy=Boolean(target.dataset.copyPlan),p=plans.find(p=>p.id===(target.dataset.loadPlan||target.dataset.copyPlan));commit(()=>{state=initializeRooms(migrateState(p.state));state.planId=copy?null:p.id;});selected=null;selectedBench=null;highlight=[];closeModal();render();if(copy)saveDialog(true);else yearErrorsDialog();return;}
  if(target.dataset.loadList){const list=lists.find(l=>l.id===target.dataset.loadList);if(!list||!validState({...defaults(),students:list.students}))return toast('Deze lijst is ongeldig.');commit(()=>updateStudentList(state,clone(list.students),{replace:true}));selected=null;selectedBench=null;closeModal();render();yearErrorsDialog();return;}
  const action=target.dataset.action;
  if(action==='fix-years')yearErrorsDialog();
  if(action==='class-layouts')roomsUI.classesDialog();
  if(action==='add-section')sectionDialog();
  if(action==='add-year-rule')yearRuleDialog();
  if(action==='import')importDialog();if(action==='add-rule')ruleDialog();if(action==='save-list')saveList();if(action==='lists')listsDialog();if(action==='edit-student')editStudent();
  if(action==='close-context'){benchSelection=[];benchSelectionMode=false;warningFocus=null;pendingMove=null;selected=null;selectedBench=null;highlight=[];renderRoom();renderContext();renderUnplaced();}
  if(['enable-selected-benches','disable-selected-benches'].includes(action)){
    const ids=[...benchSelection],enabled=action==='enable-selected-benches';if(!ids.length)return;
    commit(()=>{state.settings.disabled=enabled?state.settings.disabled.filter(id=>!ids.includes(id)):[...new Set([...state.settings.disabled,...ids])];if(enabled&&state.settings.layout?.kind==='custom'){state.settings.layout=clone(state.settings.layout);for(const b of state.settings.layout.benches)if(ids.includes(b.id))b.enabled=true;}});
    toast(`${ids.length} banken ${enabled?'geactiveerd':'gedeactiveerd'}.`);
  }
  if(action==='move-student'){pendingMove=selected;renderContext();if(pendingMove)toast('Kies een doelplaats.');}
  if(action==='fixed-position')ruleDialog(locationRule(state,selected),{fixed:true,apply:true});
  if(action==='disable-bench')commit(()=>{const bench=BY_BENCH[selectedBench],off=state.settings.disabled.includes(selectedBench)||bench?.enabled===false;state.settings.disabled=off?state.settings.disabled.filter(id=>id!==selectedBench):[...state.settings.disabled,selectedBench];if(off&&bench?.custom&&bench.enabled===false){state.settings.layout=clone(state.settings.layout);state.settings.layout.benches.find(b=>b.id===selectedBench).enabled=true;}});
  if(['disable-chair','swap-disabled-chair'].includes(action)){
    const bench=BY_BENCH[selectedBench];if(!bench||benchCapacity(bench)!==2)return;
    const seats=[`${bench.id}:0`,`${bench.id}:1`],disabled=state.settings.disabledSeats??[],side=disabled.includes(seats[0])?0:1,off=disabled.includes(seats[side]);
    if(action==='swap-disabled-chair'&&!off)return;
    commit(()=>{state.settings.disabledSeats=disabled.filter(seat=>!seats.includes(seat));if(action==='swap-disabled-chair'||!off)state.settings.disabledSeats.push(seats[action==='swap-disabled-chair'?1-side:1]);state.distribution.reviewed=false;});
  }
  if(action==='remove')removeStudent(selected);
  if(action==='clear')deleteStudentsDialog();
});
document.addEventListener('click',event=>{
  document.querySelectorAll('.overflow-menu[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('button'))menu.open=false;});
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||$('#modal').open)return;
  const menus=[...document.querySelectorAll('.overflow-menu[open]')];
  menus.forEach(menu=>menu.open=false);menus[0]?.querySelector('summary').focus();
});
document.addEventListener('change',event=>{const t=event.target;if(t.dataset.sectionToggle)commit(()=>state.settings.sections.find(s=>s.id===t.dataset.sectionToggle).enabled=t.checked);if(t.dataset.ruleCategory){const id=t.id,enabled=t.checked;const section=t.closest('[data-rules-section]');if(section)section.open=enabled;rulesSectionOpen.set(t.dataset.ruleCategory,enabled);commit(()=>state.settings[`${t.dataset.ruleCategory}RulesEnabled`]=enabled);document.getElementById(id)?.focus({preventScroll:true});}if(t.id==='default-class-type')commit(()=>{if(state.settings.classRules.default.type==='none'&&t.value!=='none')state.settings.classRules.default.priority='Verplicht';state.settings.classRules.default.type=t.value;});if(t.id==='default-class-priority')commit(()=>state.settings.classRules.default.priority=t.value);if(t.id==='default-class-across-benches')commit(()=>state.settings.classRules.default.acrossBenches=t.checked);});
let sectionDrag=null;
function clearSectionDrag() {
  sectionDrag=null;
  document.querySelectorAll('.section-item').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));
}
$('#sidebar-content').addEventListener('pointerdown',event=>{
  const handle=event.target.closest('[data-section-handle]');
  if(!handle||event.button!==0)return;
  sectionDrag={id:handle.dataset.sectionHandle,x:event.clientX,y:event.clientY,handle,moved:false};
  handle.setPointerCapture(event.pointerId);
});
$('#sidebar-content').addEventListener('pointermove',event=>{
  if(!sectionDrag||Math.hypot(event.clientX-sectionDrag.x,event.clientY-sectionDrag.y)<5)return;
  sectionDrag.moved=true;event.preventDefault();
  document.querySelectorAll('.section-item').forEach(el=>el.classList.remove('drop-before','drop-after'));
  sectionDrag.handle.closest('.section-item').classList.add('dragging');
  const sidebar=$('.left-sidebar'),bounds=sidebar.getBoundingClientRect();
  if(event.clientY<bounds.top+35)sidebar.scrollTop-=12;
  if(event.clientY>bounds.bottom-35)sidebar.scrollTop+=12;
  const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-section-id]');
  if(row&&row.dataset.sectionId!==sectionDrag.id)row.classList.add(event.clientY>row.getBoundingClientRect().top+row.clientHeight/2?'drop-after':'drop-before');
});
$('#sidebar-content').addEventListener('pointerup',event=>{
  if(!sectionDrag)return;
  const source=sectionDrag.id,moved=sectionDrag.moved,handle=sectionDrag.handle;
  if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);
  const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-section-id]');
  const after=row&&event.clientY>row.getBoundingClientRect().top+row.clientHeight/2,target=row?.dataset.sectionId;
  clearSectionDrag();
  if(!moved||!target||source===target)return;
  commit(()=>{const index=state.settings.sections.findIndex(s=>s.id===source);const [section]=state.settings.sections.splice(index,1);const targetIndex=state.settings.sections.findIndex(s=>s.id===target);state.settings.sections.splice(targetIndex+(after?1:0),0,section);});
});
$('#sidebar-content').addEventListener('pointercancel',clearSectionDrag);
$('#sidebar-content').addEventListener('keydown',event=>{const handle=event.target.closest('[data-section-handle]');if(handle&&['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();reorderSection(handle.dataset.sectionHandle,event.key==='ArrowUp'?-1:1);}});
function chooseBenches(ids,{additive=false,toggle=false,label=''}={}) {
  const base=benchSelection.length?benchSelection:!selected&&selectedBench?[selectedBench]:[];
  benchSelection=mergeSelection(base,ids,{additive,toggle}).filter(id=>BY_BENCH[id]);benchSelectionLabel=additive?'':label;
  selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;renderRoom();renderContext();renderUnplaced();
}
function clickRoomAxis(axis,event) {
  const column=axis.dataset.roomColumn,row=Number(axis.dataset.roomRow),ids=axisBenchIds(BENCHES,column?{column}:{row});
  chooseBenches(ids,{additive:event.ctrlKey||event.metaKey,label:column?`Kolom ${column}`:`Stoelrij ${row}`});
  $('#room').querySelector(column?`[data-room-column="${column}"]`:`[data-room-row="${row}"]`)?.focus({preventScroll:true});
}
function roomPoint(event) {return new DOMPoint(event.clientX,event.clientY).matrixTransform($('#room').getScreenCTM().inverse());}
function clickSeat(seat) {
  if(!seat)return;benchSelection=[];
  const id=seat.dataset.student,target=seat.dataset.seat;
  if(pendingMove&&person(pendingMove)&&!person(pendingMove).absent) {const moving=pendingMove;move(moving,target);selectStudent(moving,false);return;}
  if(id){selectStudent(id,false);return;}
  warningFocus=null;pendingMove=null;selected=null;selectedBench=seatBench(target).id;highlight=[selectedBench];renderRoom();renderContext();renderUnplaced();
}
let drag=null,suppressRoomClick=false,unplacedDrag=null;
$('#unplaced').addEventListener('pointerdown',event=>{
  const pupil=event.target.closest('[data-unplaced]');if(!pupil||event.button!==0)return;
  unplacedDrag={id:pupil.dataset.unplaced,x:event.clientX,y:event.clientY,pointerId:event.pointerId};
  $('#unplaced').setPointerCapture(event.pointerId);event.preventDefault();
});
document.addEventListener('pointermove',event=>{
  if(unplacedDrag?.pointerId!==event.pointerId)return;
  if(Math.hypot(event.clientX-unplacedDrag.x,event.clientY-unplacedDrag.y)>6)$('#unplaced').style.cursor='grabbing';
});
document.addEventListener('pointerup',event=>{
  if(unplacedDrag?.pointerId!==event.pointerId)return;
  const origin=unplacedDrag;unplacedDrag=null;$('#unplaced').style.cursor='';
  if($('#unplaced').hasPointerCapture(event.pointerId))$('#unplaced').releasePointerCapture(event.pointerId);
  if(Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>6){
    suppressRoomClick=true;setTimeout(()=>suppressRoomClick=false,0);
    const destination=document.elementFromPoint(event.clientX,event.clientY)?.closest('#room [data-seat]');
    if(destination)move(origin.id,destination.dataset.seat);
  }else selectUnplacedStudent(origin.id);
});
document.addEventListener('pointercancel',()=>{unplacedDrag=null;$('#unplaced').style.cursor='';});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!unplacedDrag)return;
  if($('#unplaced').hasPointerCapture(unplacedDrag.pointerId))$('#unplaced').releasePointerCapture(unplacedDrag.pointerId);
  unplacedDrag=null;$('#unplaced').style.cursor='';
});
$('#room').addEventListener('pointerdown',event=>{
  if(event.button!==0)return;
  if(event.target.closest('[data-room-column],[data-room-row]'))return;
  const bench=event.target.closest('[data-bench]');
  if(benchSelectionMode||event.ctrlKey||event.metaKey||!bench){
    drag={kind:'selection',start:roomPoint(event),x:event.clientX,y:event.clientY,pointerId:event.pointerId,moved:false,bench:bench?.dataset.bench,additive:event.ctrlKey||event.metaKey||benchSelectionMode,base:[...(benchSelection.length?benchSelection:!selected&&selectedBench?[selectedBench]:[])]};$('#room').setPointerCapture(event.pointerId);event.preventDefault();return;
  }
  const el=event.target.closest('[data-seat]');
  if(el?.dataset.student){drag={id:el.dataset.student,seat:el.dataset.seat,x:event.clientX,y:event.clientY,pointerId:event.pointerId,moved:false};$('#room').setPointerCapture(event.pointerId);}
});
$('#room').addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6)drag.moved=true;
  if(drag.kind==='selection'&&drag.moved){const rect=selectionRect(drag.start,roomPoint(event)),box=$('#room-selection-box');box.removeAttribute('hidden');for(const [key,value] of Object.entries(rect))box.setAttribute(key,value);const ids=mergeSelection(drag.base,benchesInRect(BENCHES,rect),{additive:drag.additive});$('#room').querySelectorAll('[data-bench]').forEach(el=>el.classList.toggle('bulk-selected',ids.includes(el.dataset.bench)));}
  else if(drag.moved)$('#room').style.cursor='grabbing';
});
$('#room').addEventListener('pointerup',event=>{
  if(!drag||event.pointerId!==drag.pointerId)return;
  const origin=drag;drag=null;$('#room').style.cursor='';
  if($('#room').hasPointerCapture(event.pointerId))$('#room').releasePointerCapture(event.pointerId);
  // Handle the original seat explicitly: capture can retarget the browser's click to the SVG.
  suppressRoomClick=true;setTimeout(()=>suppressRoomClick=false,0);
  if(origin.kind==='selection'){
    if(origin.moved){benchSelection=origin.base;chooseBenches(benchesInRect(BENCHES,selectionRect(origin.start,roomPoint(event))),{additive:origin.additive});}
    else if(origin.bench)chooseBenches([origin.bench],{additive:origin.additive,toggle:origin.additive});
    else if(!origin.additive)chooseBenches([]);
    else renderRoom();
    return;
  }
  if(origin.moved||Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>6){const dest=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-seat]');if(dest)move(origin.id,dest.dataset.seat);}
  else clickSeat(document.querySelector(`[data-seat="${origin.seat}"]`));
});
$('#room').addEventListener('pointercancel',()=>{drag=null;$('#room').style.cursor='';renderRoom();});
$('#room').addEventListener('click',event=>{if(suppressRoomClick)return;const axis=event.target.closest('[data-room-column],[data-room-row]');if(axis){clickRoomAxis(axis,event);return;}const b=event.target.closest('[data-bench]');if(b&&(benchSelectionMode||event.ctrlKey||event.metaKey)){chooseBenches([b.dataset.bench],{additive:true,toggle:true});return;}const seat=event.target.closest('[data-seat]');if(seat){clickSeat(seat);return;}if(b){benchSelection=[];warningFocus=null;pendingMove=null;selected=null;selectedBench=b.dataset.bench;highlight=[selectedBench];renderRoom();renderContext();return;}selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;renderRoom();renderContext();renderUnplaced();});
$('#room').addEventListener('keydown',event=>{const axis=event.target.closest('[data-room-column],[data-room-row]');if(axis&&['Enter',' '].includes(event.key)){event.preventDefault();clickRoomAxis(axis,event);}});
$('#select-benches').onclick=()=>{benchSelectionMode=!benchSelectionMode;selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;renderRoom();renderContext();};
$('#search').oninput=event=>{
  const query=event.target.value.trim().toLocaleLowerCase('nl'),positions=new Map();
  for(const room of state.rooms){const view=roomState(state,room.id);for(const [seat,id] of Object.entries(view.assignments))positions.set(id,seatCode(seat,view.settings));}
  const roomName=id=>state.rooms.find(r=>r.id===ownValue(state.studentRooms,id))?.name||'Nog geen lokaal';
  const matches=state.students.filter(p=>[p.name,p.class,roomName(p.id),positions.get(p.id)||''].some(value=>value.toLocaleLowerCase('nl').includes(query)));
  $('#search-results').innerHTML=query?matches.slice(0,20).map(p=>`<button class="search-result" data-person="${esc(p.id)}">${esc(p.name)} · ${esc(p.class)}<small>${esc(roomName(p.id))} · ${esc(positions.get(p.id)||'Nog niet geplaatst')}${p.absent?' · afwezig':''}</small></button>`).join('')||'<p class="muted">Geen leerling of plaats gevonden.</p>':'';if(query&&matches.length===1)selectStudent(matches[0].id);
};
$('#generate').onclick=()=>generationDialog();
$('#warnings-check').onclick=()=>{render();toast(`${analysis.warnings.length} waarschuwingen · ${analysis.evaluated} persoonlijke regels gecontroleerd. Niemand is verplaatst.`);};
$('#undo').onclick=()=>history();$('#redo').onclick=()=>history(true);$('#save').onclick=()=>saveDialog();$('#open-plans').onclick=plansDialog;
if(!projectSession){$('#save').textContent='Plan bewaren';$('#open-plans').textContent='Mijn plannen';}
$('#color-mode').onchange=event=>{colorMode=event.target.value;renderRoom();};$('#fit').onclick=fitRoom;$('#overview').onclick=()=>{zoomMode='overview';renderRoom();};$('#zoom-in').onclick=()=>{zoomMode='custom';zoom=Math.min(3,zoom+.1);renderRoom();};$('#zoom-out').onclick=()=>{zoomMode='custom';zoom=Math.max(.1,zoom-.1);renderRoom();};
$('#zoom-label').onchange=()=>{const value=$('#zoom-label').value.trim();if(!/^\d+(?:[.,]\d+)?\s*%?$/.test(value)){toast('Vul een zoompercentage van 10 tot 300 in.');renderRoom();return;}zoomMode='custom';zoom=Math.min(3,Math.max(.1,parseFloat(value.replace(',','.'))/100));renderRoom();};
$('#zoom-label').onkeydown=event=>{if(event.key==='Enter'){$('#zoom-label').dispatchEvent(new Event('change'));$('#zoom-label').blur();}};
function expandRoom(value=!expanded) { expanded=value;document.body.classList.toggle('room-expanded',expanded);(expanded?$('.toolbar-space'):$('#save')).before($('.header-history'));$('#expand-room').textContent=expanded?'⛶ Werkruimte verkleinen':'⛶ Werkruimte vergroten';$('#expand-room').setAttribute('aria-pressed',String(expanded));requestAnimationFrame(()=>{renderRoom();if(selectedBench)focusBench(selectedBench);}); }
$('#expand-room').onclick=()=>expandRoom();
document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)||$('#modal').open)return;if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();history(event.key.toLowerCase()==='y'||event.shiftKey);}if(event.key==='Escape'){if(benchSelection.length||benchSelectionMode||drag?.kind==='selection'){benchSelection=[];benchSelectionMode=false;drag=null;renderRoom();renderContext();return;}if(pendingMove){pendingMove=null;renderContext();return;}if(expanded){expandRoom(false);return;}warningFocus=null;selected=null;selectedBench=null;highlight=[];renderRoom();renderContext();renderUnplaced();}if(event.key==='Delete'&&selected)removeStudent(selected);});
// Rendering a context action replaces its button before the click bubbles here.
// Use the original event path so that action does not count as clicking away.
document.addEventListener('click',event=>{if(selected&&!$('#modal').open&&!event.composedPath().some(node=>node instanceof Element&&node.matches('#context,#room,#unplaced,#warning-list,[data-person],[data-seat],#search,#search-results,[data-unplaced]'))){selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;renderRoom();renderContext();renderUnplaced();}});
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))closeModal();});
const attendanceUI=createAttendanceUI({getState:()=>state,esc,calendarControls:calendarControlsMarkup,saveAttendance:()=>{if(busy)return toast('Wacht tot de planner klaar is.');commit(()=>saveCalendarAttendance(state,attendanceDate(state)),{keepWeekly:true,keepAlternatives:true});toast('Aanwezigheden bewaard.');$('#attendance-status').focus({preventScroll:true});},resetAttendance:()=>{if(busy)return toast('Wacht tot de planner klaar is.');commit(()=>resetStudentAttendance(state),{keepWeekly:true,keepAlternatives:true});toast('Aanwezigheden gereset.');$('#attendance-reset').focus({preventScroll:true});},setColors:enabled=>{commit(()=>{state.attendanceColorsEnabled=enabled;},{keepWeekly:true,keepAlternatives:true});$('#attendance-seat-colors').focus({preventScroll:true});}});
const roomsUI=createRoomUI({getState:()=>state,getBusy:()=>busy,commit,openRoom,toast,autoDistribute:makeAutomaticRoomPlan,editLocation:id=>ruleDialog(locationRule(state,id),{fixed:true,apply:true,pupilId:id,roomOnly:true}),showTab:value=>{tab=value;render();}});
const weeklyUI=createWeeklyUI({getState:()=>state,commit:(change)=>commit(change,{keepWeekly:true}),toast,clearSelection:()=>{benchSelection=[];benchSelectionMode=false;selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;}});
const calendarUI=createCalendarUI({getState:()=>state,getBusy:()=>busy,setEnabled:enabled=>calendarPreference.setEnabled(enabled),commit:change=>commit(change,{keepWeekly:true}),modal,closeModal,toast,esc,validateDay:validState,clearSelection:()=>{benchSelection=[];benchSelectionMode=false;selected=null;selectedBench=null;highlight=[];pendingMove=null;warningFocus=null;}});
window.desktop?.projects?.onBeforeClose(()=>projectSession.flush());
render();write(KEY,state);yearErrorsDialog();
if(DEVELOPER_MODE)window.desktop.developerInfo().then(info=>{developerInfo=info;renderDeveloperDetails();}).catch(()=>{developerInfo={electron:'onbekend',node:'onbekend',storagePath:'Opslagpad niet beschikbaar'};renderDeveloperDetails();});
let roomResizeFrame=null;
new ResizeObserver(()=>{
  if(roomResizeFrame!==null)cancelAnimationFrame(roomResizeFrame);
  roomResizeFrame=requestAnimationFrame(()=>{roomResizeFrame=null;renderRoom();});
}).observe($('#room-viewport'));

