import { BENCHES, defaults, enabledSeats, validSeat, disabledSeatsValid, evaluate, generate, studentRulesFor } from './engine.mjs';
import { locationRoomId, locationRule, setLocationRule } from './location-rules.mjs';
import { layoutValid, roomTemplate } from './layout.mjs';
import { defaultClassroom, rebuildReferenceRoom } from './default-room.mjs';

const clone=value=>structuredClone(value);
const roomKeys=['sections','rows','disabled','disabledSeats','placementMode','ordered'];
const localSettings=settings=>Object.fromEntries(roomKeys.map(key=>[key,clone(settings[key]??(key==='disabledSeats'?[]:defaults().settings[key]))]));
export const DISTRIBUTION_MODES={balanced:'Evenwichtig verdelen',capacity:'Capaciteit optimaal gebruiken',classesSpread:'Klassen spreiden',classesTogether:'Klassen samenhouden',yearsSpread:'Leerjaren spreiden'};
export const currentRoom=state=>state.rooms.find(room=>room.id===state.activeRoomId);
export function initializeRooms(state) {
  if(!state.rooms) {
    const room={id:'standaardlokaal',name:'Standaardlokaal',layout:clone(state.settings.layout??{kind:'builtin'}),settings:localSettings(state.settings),assignments:clone(state.assignments),locks:[...state.locks],hiddenWarnings:[...state.hiddenWarnings]};
    state.rooms=[room];state.activeRoomId=room.id;state.participatingRooms=[room.id];
    state.studentRooms=Object.fromEntries(state.students.map(p=>[p.id,room.id]));
    state.distribution={mode:'balanced',keepFixed:true,reviewed:true};
    for(const rule of state.rules)if(rule.type==='fixed')rule.roomId??=room.id;
  }
  state.distribution??={mode:'balanced',keepFixed:true,reviewed:false};
  state.classRooms??={};
  state.studentRoomPins??={};
  state.studentRoomPins=Object.fromEntries(Object.entries(state.studentRoomPins).filter(([id,room])=>state.students.some(p=>p.id===id)&&state.rooms.some(r=>r.id===room)));
  for(const room of [...state.rooms,...(state.roomTemplates??[])])room.settings.disabledSeats??=[];
  captureRoom(state);
  let rebuilt=false;
  for(const room of state.rooms)if(room.layout.kind==='builtin'){rebuildReferenceRoom(room,state.rules);rebuilt=true;}
  for(const template of state.roomTemplates??[])if(template.layout.kind==='builtin'){const rebuiltTemplate=rebuildReferenceRoom({...template,assignments:{}},[]);template.layout=rebuiltTemplate.layout;template.settings=rebuiltTemplate.settings;}
  if(rebuilt||!state.settings.layout)loadRoom(state,state.activeRoomId);
  return state;
}
export const classRoomId=(state,klass)=>Object.hasOwn(state.classRooms??{},klass)?state.classRooms[klass]:null;
export const studentLocationRoomId=(state,id)=>state.studentRoomPins?.[id]||locationRoomId(state,id);
export const participatingRoomIds=state=>[...new Set([...state.participatingRooms,...Object.values(state.classRooms??{}),...Object.values(state.studentRoomPins??{}),...studentRulesFor(state).filter(r=>r.type==='fixed').map(r=>r.roomId)])].filter(id=>state.rooms.some(r=>r.id===id));
export function applyClassAssignments(state) {
  captureRoom(state);
  const moved=new Set();
  for(const p of state.students){const id=classRoomId(state,p.class)||studentLocationRoomId(state,p.id);if(id&&state.rooms.some(r=>r.id===id)&&state.studentRooms[p.id]!==id){state.studentRooms[p.id]=id;moved.add(p.id);}}
  if(moved.size){for(const room of state.rooms){room.assignments=Object.fromEntries(Object.entries(room.assignments).filter(([,id])=>!moved.has(id)));room.locks=room.locks.filter(id=>!moved.has(id));}state.distribution.reviewed=false;}
  state.participatingRooms=participatingRoomIds(state);loadRoom(state,state.activeRoomId);
}
export function assignClassRoom(state,klass,roomId) {
  if(typeof klass!=='string'||!klass.trim()||roomId&&!state.rooms.some(r=>r.id===roomId))throw Error('Ongeldige klas of lokaalkeuze.');
  if(roomId&&state.students.some(p=>p.class===klass&&studentLocationRoomId(state,p.id)&&studentLocationRoomId(state,p.id)!==roomId))throw Error('Een leerling uit deze klas is vastgezet in een ander lokaal. Pas eerst de vaste locatie (lokaalpin) aan.');
  state.classRooms=roomId?{...state.classRooms,[klass]:roomId}:{...state.classRooms};if(!roomId)delete state.classRooms[klass];
  state.distribution.reviewed=false;applyClassAssignments(state);
}
export function captureRoom(state) {
  if(!state.rooms)return;
  const room=currentRoom(state);if(!room)return;
  room.settings=localSettings(state.settings);
  if(state.settings.layout?.kind==='custom')room.layout=clone(state.settings.layout);
  room.assignments=clone(state.assignments);room.locks=[...state.locks];room.hiddenWarnings=[...state.hiddenWarnings];
}
export function roomState(state,id) {
  const room=state.rooms.find(r=>r.id===id);if(!room)throw Error('Lokaal bestaat niet.');
  if(id===state.activeRoomId)return {...state,settings:{...state.settings},assignments:state.assignments};
  return {...state,activeRoomId:id,settings:{...state.settings,...room.settings,disabledSeats:room.settings.disabledSeats??[],layout:room.layout.kind==='custom'?room.layout:undefined},assignments:room.assignments,locks:room.locks,hiddenWarnings:room.hiddenWarnings,benchLocks:[]};
}
function loadRoom(state,id) {
  const room=state.rooms.find(r=>r.id===id);if(!room)return;
  state.activeRoomId=id;state.settings={...state.settings,...clone(room.settings)};
  if(room.layout.kind==='custom')state.settings.layout=clone(room.layout);else delete state.settings.layout;
  state.assignments=clone(room.assignments);state.locks=[...room.locks];state.hiddenWarnings=[...room.hiddenWarnings];state.benchLocks=[];
}
export function switchRoom(state,id) { captureRoom(state);loadRoom(state,id); }
export function normalizeRooms(state) {
  initializeRooms(state);captureRoom(state);
  applyClassAssignments(state);
  const ids=new Set(state.students.map(p=>p.id)),rooms=new Set(state.rooms.map(r=>r.id));
  state.participatingRooms=[...new Set(state.participatingRooms)].filter(id=>rooms.has(id));
  for(const [id,room] of Object.entries(state.studentRooms))if(!ids.has(id)||room!==null&&!rooms.has(room))delete state.studentRooms[id];
  for(const p of state.students)if(!Object.hasOwn(state.studentRooms,p.id)) {
    state.studentRooms[p.id]=state.participatingRooms.length===1?state.participatingRooms[0]:null;
    state.distribution.reviewed=false;
  }
  for(const room of state.rooms) {
    const settings={...state.settings,...room.settings,layout:room.layout.kind==='custom'?room.layout:undefined};
    room.settings.disabledSeats=(room.settings.disabledSeats??[]).filter(seat=>validSeat(seat,settings));
    const seated=new Set();
    room.assignments=Object.fromEntries(Object.entries(room.assignments).filter(([seat,id])=>{
      if(!ids.has(id)||state.studentRooms[id]!==room.id||state.students.find(p=>p.id===id)?.absent||!validSeat(seat,settings)||seated.has(id))return false;
      seated.add(id);return true;
    }));
    room.locks=room.locks.filter(id=>Object.values(room.assignments).includes(id));
  }
  if(!rooms.has(state.activeRoomId))state.activeRoomId=state.rooms[0].id;
  loadRoom(state,state.activeRoomId);
}
export function roomStats(state,room) {
  const view=roomState(state,room.id),seats=enabledSeats(view.settings);
  const benches=room.layout.kind==='builtin'?BENCHES:room.layout.benches.filter(b=>b.kind==='student');
  const enabled=new Set(seats.map(s=>s.split(':')[0]));
  const people=state.students.filter(p=>!p.absent&&state.studentRooms[p.id]===room.id);
  return {benches:benches.length,seats:benches.reduce((sum,b)=>sum+(b.capacity??2),0),capacity:seats.length,enabled:enabled.size,disabled:benches.length-enabled.size,assigned:people.length,seated:Object.values(view.assignments).length,warnings:evaluate(view).warnings.length,overflow:Math.max(0,people.length-seats.length)};
}
export function newRoom(state,name,template='empty') {
  const room={id:crypto.randomUUID(),name,layout:['builtin','default'].includes(template)?defaultClassroom():roomTemplate(template),settings:localSettings(defaults().settings),assignments:{},locks:[],hiddenWarnings:[]};
  state.rooms.push(room);return room;
}
export function duplicateRoom(state,id,name) {
  captureRoom(state);const source=state.rooms.find(r=>r.id===id);
  const room={...clone(source),id:crypto.randomUUID(),name,assignments:{},locks:[],hiddenWarnings:[]};
  if(source.layout.kind==='builtin')rebuildReferenceRoom(room,[]);
  state.rooms.push(room);return room;
}
export function deleteRoom(state,id,{replacementId=null}={}) {
  if(state.rooms.length===1)throw Error('Bewaar minstens één lokaal.');
  const classes=Object.keys(state.classRooms??{}).filter(klass=>state.classRooms[klass]===id);
  if(classes.length&&(!replacementId||replacementId===id||!state.rooms.some(r=>r.id===replacementId)))throw Error('Kies eerst een ander lokaal voor de toegewezen klassen.');
  state.studentRoomPins=Object.fromEntries(Object.entries(state.studentRoomPins??{}).filter(([,room])=>room!==id));
  for(const klass of classes)assignClassRoom(state,klass,replacementId);
  captureRoom(state);state.rooms=state.rooms.filter(r=>r.id!==id);
  state.participatingRooms=state.participatingRooms.filter(x=>x!==id);
  for(const [student,room] of Object.entries(state.studentRooms))if(room===id)state.studentRooms[student]=null;
  // Seat-specific rules stay traceable after deleting a room, but are inactive.
  state.distribution.reviewed=false;
  loadRoom(state,state.activeRoomId===id?state.rooms[0].id:state.activeRoomId);
}
export function assignRoom(state,studentId,roomId) {
  if(!state.students.some(p=>p.id===studentId)||roomId&&!state.rooms.some(r=>r.id===roomId))throw Error('Ongeldige lokaalkeuze.');
  const target=classRoomId(state,state.students.find(p=>p.id===studentId).class);
  if(target&&target!==roomId)throw Error('Deze klas heeft een vast lokaal. Pas eerst de klastoewijzing aan.');
  if(studentLocationRoomId(state,studentId)&&state.rooms.some(r=>r.id===studentLocationRoomId(state,studentId))&&studentLocationRoomId(state,studentId)!==roomId)throw Error('Deze leerling is vastgezet in een lokaal. Pas eerst de vaste locatie (lokaalpin) aan.');
  if(state.studentRooms[studentId]===(roomId||null))return;
  captureRoom(state);
  for(const room of state.rooms){room.assignments=Object.fromEntries(Object.entries(room.assignments).filter(([,id])=>id!==studentId));room.locks=room.locks.filter(id=>id!==studentId);}
  state.studentRooms[studentId]=roomId||null;state.distribution.reviewed=false;
  loadRoom(state,state.activeRoomId);
}
export function pinStudentRoom(state,studentId,roomId=null) {
  if(!state.students.some(p=>p.id===studentId)||roomId&&!state.rooms.some(r=>r.id===roomId))throw Error('Ongeldige leerling of lokaalkeuze.');
  const pupil=state.students.find(p=>p.id===studentId),klassRoom=classRoomId(state,pupil.class);
  if(roomId&&klassRoom&&klassRoom!==roomId)throw Error('Deze klas heeft een vast lokaal. Pas eerst de klastoewijzing aan.');
  if(roomId) {
    const old=locationRule(state,studentId);
    setLocationRule(state,{id:old?.id??crypto.randomUUID(),type:'fixed',students:[studentId],roomId,priority:'Verplicht'});
    state.settings.studentRulesEnabled=true;
    applyClassAssignments(state);
  } else {
    state.rules=state.rules.filter(r=>!(r.type==='fixed'&&r.students[0]===studentId));
    delete state.studentRoomPins?.[studentId];
  }
  state.distribution.reviewed=false;
}
export function distributeRooms(state,mode='balanced',{keepFixed=true}={}) {
  if(!Object.hasOwn(DISTRIBUTION_MODES,mode))throw Error('Onbekende verdeling.');
  captureRoom(state);
  applyClassAssignments(state);
  const rooms=participatingRoomIds(state).map(id=>state.rooms.find(r=>r.id===id)).filter(Boolean);
  const capacity=new Map(rooms.map(r=>[r.id,roomStats(state,r).capacity])),counts=new Map(rooms.map(r=>[r.id,0])),groups=new Map(rooms.map(r=>[r.id,new Map()]));
  const previous={...state.studentRooms},assignment={},protectedIds=new Set();
  if(keepFixed) {
    for(const room of rooms)for(const id of room.locks)protectedIds.add(id);
    for(const rule of studentRulesFor(state))if(rule.type==='fixed'&&rooms.some(r=>r.id===rule.roomId))protectedIds.add(rule.students[0]);
  }
  const active=state.students.filter(p=>!p.absent),groupKey=p=>mode==='yearsSpread'?p.year:p.class;
  const add=(p,room)=>{assignment[p.id]=room.id;counts.set(room.id,counts.get(room.id)+1);const g=groups.get(room.id);g.set(groupKey(p),(g.get(groupKey(p))||0)+1);};
  for(const p of active){const room=rooms.find(r=>r.id===(classRoomId(state,p.class)||studentLocationRoomId(state,p.id)));if(room)add(p,room);}
  for(const p of active.filter(p=>protectedIds.has(p.id)&&!assignment[p.id])) {
    const fixed=studentRulesFor(state).find(r=>r.type==='fixed'&&r.students.includes(p.id)&&rooms.some(room=>room.id===r.roomId));
    const room=rooms.find(r=>r.id===(fixed?.roomId||previous[p.id]));if(room)add(p,room);
  }
  const remaining=active.filter(p=>!assignment[p.id]),grouped=new Map();
  for(const p of remaining){const key=groupKey(p);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(p);}
  const batches=[...grouped.values()].sort((a,b)=>b.length-a.length||groupKey(a[0]).localeCompare(groupKey(b[0]),'nl',{numeric:true}));
  const sequence=mode==='classesTogether'?batches.flat():remaining;
  for(const p of sequence) {
    const available=rooms.filter(r=>counts.get(r.id)<capacity.get(r.id));
    if(!available.length){assignment[p.id]=null;continue;}
    const key=groupKey(p),batchSize=grouped.get(key).filter(p=>!Object.hasOwn(assignment,p.id)).length;
    available.sort((a,b)=>{
      const ca=counts.get(a.id),cb=counts.get(b.id),ga=groups.get(a.id).get(key)||0,gb=groups.get(b.id).get(key)||0;
      if(mode==='capacity')return rooms.indexOf(a)-rooms.indexOf(b);
      if(mode==='classesTogether')return (capacity.get(b.id)-cb>=batchSize)-(capacity.get(a.id)-ca>=batchSize)||gb-ga||(capacity.get(b.id)-cb)-(capacity.get(a.id)-ca)||rooms.indexOf(a)-rooms.indexOf(b);
      if(['classesSpread','yearsSpread'].includes(mode)&&ga!==gb)return ga-gb;
      return ca-cb||ca/Math.max(1,capacity.get(a.id))-cb/Math.max(1,capacity.get(b.id))||rooms.indexOf(a)-rooms.indexOf(b);
    });
    add(p,available[0]);
  }
  for(const p of active)assignRoom(state,p.id,assignment[p.id]||null);
  state.distribution={mode,keepFixed,reviewed:false};captureRoom(state);
  return {unassigned:active.filter(p=>!state.studentRooms[p.id]).map(p=>p.id),overflow:rooms.filter(r=>roomStats(state,r).overflow).map(r=>r.id)};
}
export function generateAllRooms(state,options={}) {
  applyClassAssignments(state);const results=[];
  for(const id of participatingRoomIds(state)) {
    const view=roomState(state,id),result=generate(view,options),room=state.rooms.find(r=>r.id===id);
    room.assignments=result.assignments;results.push({roomId:id,...result});
  }
  loadRoom(state,state.activeRoomId);return results;
}
export function roomSystemValid(state) {
  if(state.rooms===undefined)return true;
  if(!Array.isArray(state.rooms)||!state.rooms.length||state.rooms.length>50||!state.rooms.every(r=>r&&typeof r.id==='string'&&r.id)||!Array.isArray(state.students)||!state.students.every(p=>p&&typeof p.id==='string')||new Set(state.rooms.map(r=>r.id)).size!==state.rooms.length)return false;
  const ids=new Set(state.students.map(p=>p.id)),roomIds=new Set(state.rooms.map(r=>r.id));
  if(state.studentRoomPins!==undefined&&(!state.studentRoomPins||typeof state.studentRoomPins!=='object'||Array.isArray(state.studentRoomPins)||!Object.entries(state.studentRoomPins).every(([id,room])=>ids.has(id)&&roomIds.has(room)&&(!classRoomId(state,state.students.find(p=>p.id===id).class)||classRoomId(state,state.students.find(p=>p.id===id).class)===room))))return false;
  if(state.classRooms!==undefined&&(!state.classRooms||typeof state.classRooms!=='object'||Array.isArray(state.classRooms)||!Object.entries(state.classRooms).every(([klass,id])=>klass.trim()&&roomIds.has(id))))return false;
  if(!roomIds.has(state.activeRoomId)||!Array.isArray(state.participatingRooms)||!state.participatingRooms.every(id=>roomIds.has(id))||!state.studentRooms||typeof state.studentRooms!=='object'||Array.isArray(state.studentRooms)||!Object.entries(state.studentRooms).every(([id,room])=>ids.has(id)&&(room===null||roomIds.has(room))))return false;
  if(state.distribution!==undefined&&(!state.distribution||!Object.hasOwn(DISTRIBUTION_MODES,state.distribution.mode)||typeof state.distribution.keepFixed!=='boolean'||typeof state.distribution.reviewed!=='boolean'))return false;
  const settingsValid=settings=>settings&&roomKeys.every(key=>key==='disabledSeats'||Object.hasOwn(settings,key))&&['rows','disabled','sections'].every(key=>Array.isArray(settings[key]))&&settings.rows.every(r=>Number.isInteger(r)&&r>=1&&r<=8)&&settings.disabled.every(id=>typeof id==='string')&&settings.sections.every(s=>s&&typeof s.id==='string'&&typeof s.enabled==='boolean'&&/^[A-Z]$/.test(s.from)&&/^[A-Z]$/.test(s.to)&&s.from<=s.to)&&['random','ordered'].includes(settings.placementMode)&&settings.ordered&&['columns','rows'].includes(settings.ordered.axis)&&['left','right'].includes(settings.ordered.horizontal)&&['top','bottom'].includes(settings.ordered.vertical)&&[0,1].includes(settings.ordered.seatSide);
  if(state.roomTemplates!==undefined&&(!Array.isArray(state.roomTemplates)||!state.roomTemplates.every(t=>t&&typeof t.id==='string'&&typeof t.name==='string'&&t.name.trim()&&layoutValid(t.layout)&&settingsValid(t.settings)&&disabledSeatsValid({...t.settings,layout:t.layout.kind==='custom'?t.layout:undefined}))))return false;
  return state.rooms.every(room=>typeof room.name==='string'&&room.name.trim()&&layoutValid(room.layout)&&settingsValid(room.settings)&&disabledSeatsValid({...room.settings,layout:room.layout.kind==='custom'?room.layout:undefined})&&typeof room.assignments==='object'&&room.assignments!==null&&!Array.isArray(room.assignments)&&Array.isArray(room.locks)&&room.locks.every(id=>ids.has(id))&&Array.isArray(room.hiddenWarnings)&&room.hiddenWarnings.every(key=>typeof key==='string')&&Object.entries(room.assignments).every(([seat,id])=>ids.has(id)&&state.studentRooms[id]===room.id&&validSeat(seat,{...room.settings,layout:room.layout.kind==='custom'?room.layout:undefined}))&&new Set(Object.values(room.assignments)).size===Object.values(room.assignments).length);
}
