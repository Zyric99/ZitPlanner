import { ownValue } from './id-record.mjs';
import { currentRoom, roomStats, newRoom, duplicateRoom, deleteRoom, assignRoom, DISTRIBUTION_MODES, roomState, classRoomId, assignClassRoom, studentLocationRoomId, participatingRoomIds } from './rooms.mjs';
import { locationRule } from './location-rules.mjs';
import { createGridEditor } from './grid-editor.mjs';
import { evaluate } from './engine.mjs';
import { warningGroups } from './warning-state.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=selector=>document.querySelector(selector),clone=value=>structuredClone(value);
const templates={empty:'Leeg lokaal',default:'Kopie van het standaardlokaal'};

export function createRoomUI({getState,commit,openRoom,toast,autoDistribute,editLocation,getBusy=()=>false,showTab}) {
  const host=$('#rooms-workspace');let editor=null,suppressPupilClick=false,studentDrag=null,selectedPupil=null,lastVisibleTab=null,autoResult=null;const searchTerms=new Map();
  const gridEditor=createGridEditor({host,toast,onClose:()=>{editor=null;renderLibrary();},onSave:saved=>{editor=null;commit(()=>{const state=getState(),room=state.rooms.find(r=>r.id===saved.id);room.layout=saved.layout;room.settings.disabled=[];if(room.id===state.activeRoomId){state.settings.layout=clone(saved.layout);state.settings.disabled=[];}state.distribution.reviewed=false;});toast('Opstelling bewaard. Bestaande geldige zitplaatsen blijven behouden.');}});
  const renderEditor=()=>gridEditor.render();
  const editorAction=action=>gridEditor.action(action);
  function renderTabs(){
    const state=getState(),bar=$('#layout-tabs'),left=bar.scrollLeft,targets=participatingRoomIds(state);
    bar.innerHTML=state.rooms.map(room=>{const active=room.id===state.activeRoomId,classes=Object.keys(state.classRooms).filter(c=>state.classRooms[c]===room.id),included=targets.includes(room.id);return `<div class="layout-tab ${active?'current':''} ${included?'':'excluded'}"><button role="tab" id="layout-tab-${esc(room.id)}" data-layout-open="${esc(room.id)}" aria-selected="${active}" aria-controls="room-viewport" tabindex="${active?'0':'-1'}" title="${esc(room.name)}${classes.length?' · '+esc(classes.join(', ')):''}${included?'':' · Niet in automatische verdeling'}"><span class="tab-indicator"></span><span class="tab-name">${esc(room.name)}</span></button></div>`;}).join('');
    bar.scrollLeft=left;
    // Only move the tab strip horizontally on navigation. scrollIntoView also
    // scrolled the hidden classroom's page ancestors during every editor update.
    if(lastVisibleTab!==state.activeRoomId){const active=bar.querySelector('[aria-selected="true"]')?.parentElement;if(active){const a=active.getBoundingClientRect(),b=bar.getBoundingClientRect();if(a.left<b.left)bar.scrollLeft+=a.left-b.left;else if(a.right>b.right)bar.scrollLeft+=a.right-b.right;}lastVisibleTab=state.activeRoomId;}
    $('#room-viewport').setAttribute('role','tabpanel');$('#room-viewport').setAttribute('aria-labelledby',`layout-tab-${state.activeRoomId}`);
    if(!$('#generate').disabled)$('#generate').textContent='✦  Indeling maken…';
    $('#generate').title='Indeling maken';
    $('#layout-participates').checked=targets.includes(state.activeRoomId);$('#layout-participates').disabled=[...Object.values(state.classRooms),...state.students.map(p=>studentLocationRoomId(state,p.id))].includes(state.activeRoomId);$('#layout-participation-note').textContent=$('#layout-participates').disabled?'Dit lokaal heeft toegewezen klassen of vastgezette leerlingen.':'';
  }
  function render(tab) {
    const state=getState(),workspace=['rooms','distribution'].includes(tab);
    document.body.classList.toggle('room-management',workspace);host.hidden=!workspace;host.dataset.mode=tab;
    $('#active-room').innerHTML=state.rooms.map(room=>`<option value="${esc(room.id)}" ${room.id===state.activeRoomId?'selected':''}>${esc(room.name)}</option>`).join('');
    renderTabs();
    $('.room-top strong').textContent=currentRoom(state).name;
    if(!workspace)return;
    if(editor&&tab==='rooms')return renderEditor();
    if(tab==='rooms')renderLibrary();else renderDistribution();
  }
  function renderLibrary() {
    const state=getState();host.innerHTML=`<div class="rooms-heading"><div><h2>Lokalen</h2></div><button class="button primary" data-room-action="new">＋ Nieuw lokaal</button></div><div class="room-library">${state.rooms.map(room=>{const s=roomStats(state,room);return `<article class="room-library-card"><div class="room-card-title"><h3>${esc(room.name)}</h3><span>Eigen opstelling</span></div><strong>${s.benches} banken · ${s.seats} plaatsen</strong><p>${s.enabled} ingeschakeld · ${s.disabled} uitgeschakeld<br>${s.capacity} beschikbare plaatsen · ${s.assigned} leerlingen</p><div class="room-card-actions"><button class="button primary small" data-room-open="${esc(room.id)}">Zitplaatsen openen</button><button class="button small" data-room-edit="${esc(room.id)}">Opstelling bewerken</button><details class="overflow-menu"><summary class="button small" aria-label="${esc(room.name)} beheren">⋯</summary><div class="menu-items"><button data-room-rename="${esc(room.id)}">Naam wijzigen</button><button data-room-copy="${esc(room.id)}">Dupliceren</button><button data-room-template="${esc(room.id)}">Als sjabloon bewaren</button><button class="danger" data-room-delete="${esc(room.id)}" ${state.rooms.length===1?'disabled':''}>Lokaal verwijderen</button></div></details></div></article>`;}).join('')}</div>`;
  }
  function simpleDialog(title,body,saveLabel,onSave) {
    const modal=$('#modal');modal.classList.remove('ordered-modal','custom-ordered');$('#modal-content').innerHTML=`<div class="modal-head"><h2>${title}</h2><button class="icon-button" data-close aria-label="Sluiten">×</button></div><div class="modal-body">${body}<div id="room-dialog-error" role="alert"></div></div><div class="modal-actions"><button class="button" data-close>Annuleren</button><button class="button primary" id="room-dialog-save">${saveLabel}</button></div>`;modal.showModal();$('#room-dialog-save').onclick=onSave;
  }
  const close=()=>$('#modal').close();
  function newDialog(fromTabs=false) {
    const saved=getState().roomTemplates??[];
    simpleDialog('Nieuw lokaal',`<label class="field">Tabnaam<input id="new-room-name" placeholder="Bijvoorbeeld Science Room" value="Nieuw lokaal" maxlength="100"></label><label class="field">Begin met<select id="new-room-template">${Object.entries(templates).map(([key,label])=>`<option value="${key}" ${fromTabs&&key==='default'?'selected':''}>${label}</option>`).join('')}${saved.map((t,i)=>`<option value="saved-${i}">${esc(t.name)} (bewaard)</option>`).join('')}</select></label>`,'Lokaal maken',()=>{
      const name=$('#new-room-name').value.trim(),type=$('#new-room-template').value;if(!name)return;
      let id;commit(()=>{const room=newRoom(getState(),name,type.startsWith('saved-')?'empty':type);if(type.startsWith('saved-')){const t=saved[Number(type.slice(6))];room.layout=clone(t.layout);room.settings=clone(t.settings);}id=room.id;if(fromTabs){getState().participatingRooms.push(id);getState().distribution.reviewed=false;}});close();if(fromTabs)openRoom(id);else editRoom(id);
    });
    $('#new-room-name').focus();$('#new-room-name').select();
  }
  function deleteDialog(id){
    const state=getState(),room=state.rooms.find(r=>r.id===id);if(!room||state.rooms.length===1)return;
    const classes=Object.keys(state.classRooms).filter(c=>state.classRooms[c]===id),others=state.rooms.filter(r=>r.id!==id);
    simpleDialog('Lokaal verwijderen',`<p><strong>${esc(room.name)}</strong> verwijderen? Dit kun je ongedaan maken.</p>${classes.length?`<p>Toegewezen klassen: <strong>${classes.map(esc).join(', ')}</strong>. Kies eerst hun nieuwe opstelling.</p><label class="field">Klassen verplaatsen naar<select id="delete-room-replacement"><option value="">Kies een opstelling…</option>${others.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label><p>Hun oude zitplaatsen en pins worden vrijgemaakt. Maak daarna een nieuwe indeling in het gekozen lokaal.</p>`:'<p>Leerlingen uit dit lokaal blijven in de lijst en krijgen Nog geen lokaal.</p>'}`,'Lokaal verwijderen',()=>{
      const replacementId=$('#delete-room-replacement')?.value||null;
      if(classes.length&&!replacementId){$('#room-dialog-error').textContent='Kies een vervangende opstelling voor deze klassen.';return;}
      commit(()=>deleteRoom(getState(),id,{replacementId}));close();toast('Tab verwijderd.');
    });
  }
  function classesDialog(){
    const state=getState(),classes=[...new Set([...state.students.map(p=>p.class),...Object.keys(state.classRooms)])].sort((a,b)=>a.localeCompare(b,'nl',{numeric:true}));
    simpleDialog('Klassen aan lokalen koppelen',`<div class="class-layout-list">${classes.map((klass,i)=>`<label class="class-layout-row"><span><strong>${esc(klass)}</strong><small>${state.students.filter(p=>p.class===klass&&!p.absent).length} aanwezig</small></span><select data-class-layout="${i}" aria-label="Opstelling voor klas ${esc(klass)}"><option value="">Automatische verdeling</option>${state.rooms.map(r=>`<option value="${esc(r.id)}" ${classRoomId(state,klass)===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select></label>`).join('')||'<p>Voeg eerst leerlingen met hun klas toe.</p>'}</div><div id="class-layout-capacity" role="status"></div><p>Verplaatsen naar een andere opstelling maakt eerdere zitplaatsen en pins vrij. De opstellingen zelf blijven behouden.</p>`,'Toewijzingen bewaren',()=>{const changes=classes.map((klass,i)=>[klass,$(`[data-class-layout="${i}"]`).value]);try{const checked=clone(getState());for(const [klass,id] of changes)if(classRoomId(checked,klass)!==(id||null))assignClassRoom(checked,klass,id||null);}catch(error){$('#room-dialog-error').textContent=error.message;return;}commit(()=>{for(const [klass,id] of changes)if(classRoomId(getState(),klass)!==(id||null))assignClassRoom(getState(),klass,id||null);});close();toast('Klastoewijzingen bewaard. Indelen gebruikt deze opstellingen.');});
    const capacity=()=>{const counts=new Map();for(const [i,klass] of classes.entries()){const id=$(`[data-class-layout="${i}"]`).value;if(id)counts.set(id,(counts.get(id)||0)+state.students.filter(p=>p.class===klass&&!p.absent).length);}$('#class-layout-capacity').innerHTML=[...counts].map(([id,n])=>{const r=state.rooms.find(r=>r.id===id),s=roomStats(state,r);return `<div class="class-layout-count ${n>s.capacity?'over-capacity':''}">${esc(r.name)}: ${n} leerlingen / ${s.capacity} plaatsen${n>s.capacity?' · '+(n-s.capacity)+' blijven mogelijk ongeplaatst':''}</div>`;}).join('');};
    document.querySelectorAll('[data-class-layout]').forEach(select=>select.onchange=capacity);capacity();
  }
  function nameDialog(id,copy=false,template=false,fromTabs=false) {
    const state=getState(),room=state.rooms.find(r=>r.id===id);
    simpleDialog(template?'Lokaalsjabloon bewaren':copy?'Lokaal dupliceren':'Lokaalnaam wijzigen',`<label class="field">Naam<input id="room-name" value="${esc(room.name+(copy?' (kopie)':''))}" maxlength="100"></label>`,'Bewaren',()=>{const name=$('#room-name').value.trim();if(!name)return;let created;commit(()=>{if(template){state.roomTemplates??=[];state.roomTemplates.push({id:crypto.randomUUID(),name,layout:clone(room.layout),settings:clone(room.settings)});}else if(copy){created=duplicateRoom(state,id,name);if(fromTabs){state.participatingRooms.push(created.id);state.distribution.reviewed=false;}}else room.name=name;});close();if(created&&fromTabs)openRoom(created.id);toast(template?'Sjabloon bewaard.':'Lokaal bewaard.');});
    $('#room-name').focus();$('#room-name').select();
  }
  function editRoom(id) {
    const state=getState(),room=state.rooms.find(r=>r.id===id);if(!room)return;
    editor={id};gridEditor.open(room);showTab('rooms');renderEditor();
  }
  function renderDistribution() {
    const state=getState(),participating=new Set(participatingRoomIds(state)),active=state.students.filter(p=>!p.absent),unassigned=active.filter(p=>!ownValue(state.studentRooms,p.id)),outside=active.filter(p=>ownValue(state.studentRooms,p.id)&&!participating.has(ownValue(state.studentRooms,p.id)));
    const hasClasses=state.students.some(p=>p.class?.trim())||Object.keys(state.classRooms).length>0;
    host.innerHTML=`<div class="rooms-heading"><div><h2>Verdeling over lokalen</h2></div><div><button class="button" data-room-action="class-layouts">Klassen aan lokalen koppelen</button></div></div><div class="distribution-controls"><label>Verdeling<select id="distribution-mode">${Object.entries(DISTRIBUTION_MODES).map(([key,label])=>`<option value="${key}" ${state.distribution.mode===key?'selected':''}>${label}</option>`).join('')}</select></label><button class="button primary" data-room-action="auto-distribute" ${!participating.size||getBusy()?'disabled':''}>${getBusy()?'Automatisch indelen…':'Auto · verdelen en indelen'}</button></div><p class="distribution-help">Zitregels gaan voor de gekozen verdeling.</p><div class="distribution-summary"><strong>${active.length} aanwezige leerlingen</strong><span>${unassigned.length} zonder lokaal</span><span>${outside.length} in een niet-deelnemend lokaal</span><span>${state.participatingRooms.reduce((n,id)=>n+roomStats(state,state.rooms.find(r=>r.id===id)).capacity,0)} beschikbare plaatsen</span></div><div class="distribution-rooms">${state.rooms.map(room=>distributionCard(room,participating)).join('')}${hasClasses?'':`<article class="distribution-room unassigned-room" data-drop-room=""><h3>Nog geen lokaal</h3><p>${unassigned.length} leerlingen</p><div class="distribution-pupils">${unassigned.map(pupil).join('')}</div></article>`}</div>${outside.length?'<div class="inline-errors">Er staan leerlingen in lokalen die niet meedoen. Vink die lokalen aan, verplaats hun leerlingen of verdeel opnieuw.</div>':''}${unassigned.length?'<div class="inline-errors">Leerlingen zonder lokaal krijgen nog geen zitplaats. Verdeel of wijs ze handmatig toe.</div>':''}<div id="distribution-auto-result" role="status">${autoResult?`<div class="${autoResult.complete?'auto-success':'inline-errors'}">${autoResult.complete?'Alle aanwezige leerlingen zijn geplaatst; alle ingeschakelde regels zijn gevolgd.':`Geen indeling zonder conflicten gevonden: ${autoResult.unplaced.length} leerlingen zonder zitplaats · ${autoResult.warnings.length} waarschuwingen.`}${autoResult.warnings.length?`<ul>${autoResult.warnings.slice(0,10).map(w=>`<li>${esc(w.message)}</li>`).join('')}</ul>`:''}</div>`:''}</div><div id="manual-room-panel"></div>`;
    renderManualPanel();attachDistributionDrag();
    host.querySelectorAll('[data-distribution-search]').forEach(input=>{
      const filter=()=>{
        const query=input.value.trim().toLocaleLowerCase('nl');searchTerms.set(input.dataset.distributionSearch,input.value);
        const card=input.closest('.distribution-room');let found=0;
        card.querySelectorAll('[data-room-pupil]').forEach(button=>{const p=getState().students.find(p=>p.id===button.dataset.roomPupil);button.hidden=!`${p.name} ${p.class}`.toLocaleLowerCase('nl').includes(query);if(!button.hidden)found++;});
        card.querySelector('[data-search-count]').textContent=query?`${found} gevonden`:'';
      };
      input.oninput=filter;filter();
    });
    $('#distribution-mode').onchange=event=>commit(()=>{getState().distribution.mode=event.target.value;getState().distribution.reviewed=false;});
    host.querySelectorAll('[data-room-participates]').forEach(input=>{if([...Object.values(state.classRooms),...state.students.map(p=>studentLocationRoomId(state,p.id))].includes(input.dataset.roomParticipates)){input.disabled=true;input.title='Dit lokaal heeft toegewezen klassen of vastgezette leerlingen en doet altijd mee.';}input.onchange=()=>commit(()=>{const state=getState();state.participatingRooms=input.checked?[...new Set([...state.participatingRooms,input.dataset.roomParticipates])]:state.participatingRooms.filter(id=>id!==input.dataset.roomParticipates);state.distribution.reviewed=false;});});
  }
  function distributionCard(room,participating) {
    const state=getState(),s=roomStats(state,room),view=roomState(state,room.id),groups=warningGroups(view,evaluate(view).warnings),people=state.students.filter(p=>!p.absent&&ownValue(state.studentRooms,p.id)===room.id);
    return `<article class="distribution-room ${s.overflow?'over-capacity':''} ${!participating.has(room.id)?'not-participating':''}" data-drop-room="${esc(room.id)}"><label class="room-participates"><input type="checkbox" data-room-participates="${esc(room.id)}" ${participating.has(room.id)?'checked':''}><strong>${esc(room.name)}</strong></label><div class="room-occupancy"><strong>${s.assigned} / ${s.capacity}</strong> leerlingen</div><small>${s.enabled} banken beschikbaar · ${s.disabled} uitgeschakeld<br>${s.seated} zitplaatsen toegewezen · ${groups.active.length} waarschuwingen${groups.hidden.length?` · ${groups.hidden.length} verborgen`:''}</small>${s.overflow?`<div class="room-overflow" role="alert">⚠ ${s.overflow} leerlingen boven de capaciteit. Zij kunnen zonder zitplaats blijven.</div>`:''}${!participating.has(room.id)?'<p class="room-note">Dit lokaal doet niet mee aan automatisch verdelen of gezamenlijk plaatsen.</p>':''}<div class="distribution-room-actions"><button class="button small" data-room-open="${esc(room.id)}">Zitplaatsen openen →</button><input type="search" data-distribution-search="${esc(room.id)}" aria-label="Leerlingen zoeken in ${esc(room.name)}" placeholder="Leerling zoeken…" value="${esc(searchTerms.get(room.id)||'')}"></div><small data-search-count role="status"></small><div class="distribution-pupils">${people.map(pupil).join('')||''}</div></article>`;
  }
  function pupil(p) {return `<button class="distribution-pupil ${p.id===selectedPupil?'selected':''}" data-room-pupil="${esc(p.id)}"><strong>${esc(p.name)}${locationRule(getState(),p.id)?' · ⌑':''}</strong><small>${esc(p.class)} · leerjaar ${esc(p.year)}</small></button>`;}
  function renderManualPanel() {
    const state=getState(),p=state.students.find(p=>p.id===selectedPupil),panel=$('#manual-room-panel');if(!panel)return;
    panel.innerHTML=p?`<div class="manual-room"><div><strong>${esc(p.name)}</strong></div><button class="icon-button" data-room-action="close-pupil" aria-label="Leerling sluiten">×</button><select id="manual-destination" aria-label="Lokaal voor ${esc(p.name)}"><option value="">Nog geen lokaal</option>${state.rooms.map(room=>{const s=roomStats(state,room);return `<option value="${esc(room.id)}" ${ownValue(state.studentRooms,p.id)===room.id?'selected':''}>${esc(room.name)} · ${s.assigned}/${s.capacity}${s.assigned>=s.capacity?' (vol)':''}</option>`;}).join('')}</select><button class="button" data-room-action="assign">Lokaal toewijzen</button><button class="button" data-room-action="pin-room" >${locationRule(state,p.id)?'Vaste locatie aanpassen':'Vaste locatie instellen'}</button></div>`:'';
  }
  function manualAssign(id,roomId) {
    const state=getState(),room=state.rooms.find(r=>r.id===roomId),stats=room&&roomStats(state,room),overflow=stats&&ownValue(state.studentRooms,id)!==roomId&&stats.assigned>=stats.capacity;
    if(studentLocationRoomId(state,id)&&studentLocationRoomId(state,id)!==roomId)return toast('Deze leerling is vastgezet in dit lokaal. Pas eerst de vaste locatie aan.');
    const target=classRoomId(state,state.students.find(p=>p.id===id)?.class);if(target&&target!==roomId)return toast('Deze klas heeft een vast lokaal. Pas de toewijzing aan via Klassen aan lokalen koppelen in Verdeling over lokalen.');
    const apply=()=>{commit(()=>assignRoom(getState(),id,roomId));toast(room?`Leerling toegewezen aan ${room.name}.`:'Leerling heeft nog geen lokaal.');};
    if(overflow)simpleDialog('Lokaal is vol',`<p>${esc(room.name)} heeft ${stats.assigned} leerlingen en ${stats.capacity} beschikbare plaatsen. Deze overplaatsing overschrijdt de capaciteit.</p><p>De bankcapaciteiten blijven gelijk; een leerling kan zonder zitplaats blijven. Je kunt de leerling later naar een ander lokaal verplaatsen.</p>`,'Toch toewijzen',()=>{close();apply();});else apply();
  }
  function attachDistributionDrag() {
    host.onpointerdown=event=>{const el=event.target.closest('[data-room-pupil]');if(!el||event.button!==0)return;studentDrag={id:el.dataset.roomPupil,x:event.clientX,y:event.clientY,moved:false,el};host.setPointerCapture(event.pointerId);};
    host.onpointermove=event=>{if(!studentDrag||Math.hypot(event.clientX-studentDrag.x,event.clientY-studentDrag.y)<6)return;studentDrag.moved=true;studentDrag.el.classList.add('dragging');host.querySelectorAll('[data-drop-room]').forEach(el=>el.classList.remove('drop-target'));document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-room]')?.classList.add('drop-target');const main=host.closest('main'),bounds=main.getBoundingClientRect();if(event.clientY>bounds.bottom-40)main.scrollTop+=15;if(event.clientY<bounds.top+40)main.scrollTop-=15;};
    host.onpointerup=event=>{if(!studentDrag)return;const d=studentDrag;studentDrag=null;if(host.hasPointerCapture(event.pointerId))host.releasePointerCapture(event.pointerId);d.el.classList.remove('dragging');host.querySelectorAll('[data-drop-room]').forEach(el=>el.classList.remove('drop-target'));const dest=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-drop-room]');suppressPupilClick=true;setTimeout(()=>suppressPupilClick=false,0);selectedPupil=!d.moved&&selectedPupil===d.id?null:d.id;if(d.moved&&dest)manualAssign(d.id,dest.dataset.dropRoom);host.querySelectorAll('[data-room-pupil]').forEach(el=>el.classList.toggle('selected',el.dataset.roomPupil===selectedPupil));renderManualPanel();};
    host.onpointercancel=()=>{studentDrag=null;renderDistribution();};
  }
  host.addEventListener('click',event=>{
    if(suppressPupilClick)return;const t=event.target.closest('button');if(!t)return;
    if(t.dataset.roomPupil){selectedPupil=selectedPupil===t.dataset.roomPupil?null:t.dataset.roomPupil;host.querySelectorAll('[data-room-pupil]').forEach(el=>el.classList.toggle('selected',el.dataset.roomPupil===selectedPupil));renderManualPanel();return;}
    if(t.dataset.roomOpen)return openRoom(t.dataset.roomOpen);
    if(t.dataset.roomEdit)return editRoom(t.dataset.roomEdit);
    if(t.dataset.roomRename)return nameDialog(t.dataset.roomRename);
    if(t.dataset.roomCopy)return nameDialog(t.dataset.roomCopy,true);
    if(t.dataset.roomTemplate)return nameDialog(t.dataset.roomTemplate,false,true);
    if(t.dataset.roomDelete)return deleteDialog(t.dataset.roomDelete);
    if(t.dataset.editorAction)return editorAction(t.dataset.editorAction);
    const action=t.dataset.roomAction;
    if(action==='new')newDialog();
    if(action==='class-layouts')classesDialog();
    if(action==='cancel-edit'){if(gridEditor.dirty)simpleDialog('Opstelling sluiten',`<p>De wijzigingen in deze opstelling zijn nog niet opgeslagen.</p>`,'Wijzigingen weggooien',()=>{close();gridEditor.close();});else gridEditor.close();}
    if(action==='auto-distribute')autoDistribute();
    if(action==='pin-room'&&selectedPupil)editLocation(selectedPupil);
    if(action==='close-pupil')clearPupil();
    if(action==='assign'&&selectedPupil)manualAssign(selectedPupil,$('#manual-destination').value);
  });
  function clearPupil(){selectedPupil=null;host.querySelectorAll('[data-room-pupil]').forEach(el=>el.classList.remove('selected'));renderManualPanel();}
  document.addEventListener('click',event=>{if(selectedPupil&&!studentDrag&&!suppressPupilClick&&!event.target.closest('[data-room-pupil],#manual-room-panel,#modal'))clearPupil();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal').open)clearPupil();});
  $('#active-room').onchange=event=>openRoom(event.target.value);
  $('#new-layout-tab').onclick=()=>newDialog(true);
  $('#layout-participates').onchange=event=>{const checked=event.target.checked;commit(()=>{const state=getState();state.participatingRooms=checked?[...new Set([...state.participatingRooms,state.activeRoomId])]:state.participatingRooms.filter(id=>id!==state.activeRoomId);state.distribution.reviewed=false;});};
  $('#layout-tabs').onclick=event=>{const tabButton=event.target.closest('[data-layout-open]');if(tabButton)openRoom(tabButton.dataset.layoutOpen);};
  $('#layout-tabs').ondblclick=event=>{const button=event.target.closest('[data-layout-open]');if(button)nameDialog(button.dataset.layoutOpen);};
  $('#layout-tabs').onkeydown=event=>{const buttons=[...document.querySelectorAll('[data-layout-open]')],index=buttons.indexOf(event.target);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;if(next!==undefined){event.preventDefault();const id=buttons[next].dataset.layoutOpen;openRoom(id);document.querySelector(`[data-layout-open="${CSS.escape(id)}"]`).focus();}if(event.key==='F2'){event.preventDefault();nameDialog(buttons[index].dataset.layoutOpen);}};
  document.querySelectorAll('[data-layout-action]').forEach(button=>button.onclick=()=>{const id=getState().activeRoomId;$('.layout-menu').open=false;const action=button.dataset.layoutAction;if(action==='rename')nameDialog(id);if(action==='copy')nameDialog(id,true,false,true);if(action==='edit')editRoom(id);if(action==='delete')deleteDialog(id);});
  $('#edit-active-room').onclick=()=>editRoom(getState().activeRoomId);
  return {render,editRoom,classesDialog,showAutoResult:result=>{autoResult=result;},clearAutoResult:()=>{autoResult=null;},get isEditing(){return !!editor;},history:redo=>{if(!editor||host.hidden||host.dataset.mode!=='rooms')return false;editorAction(redo?'redo':'undo');return true;}};
}
