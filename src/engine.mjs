import { ownValue } from './id-record.mjs';
import { customBenches, customSeatGeometry, tableBounds, GRID, benchSeatCode } from './layout.mjs';
import { defaultClassroom } from './default-room.mjs';
import { migrateLocationPins } from './location-rules.mjs';
export { parseStudents } from './student-import.mjs';
export const AREAS = ['A–J', 'K', 'L–U', 'V–Y', 'Z'];
export const DEFAULT_SECTION_ORDER = ['A–J', 'L–U', 'V–Y', 'K', 'Z'];
export const ROOM = { width: 2800, height: 810, columnStep: 100, rowStep: 166 };
export const sectionLabel = section => section.from === section.to ? section.from : `${section.from}–${section.to}`;
export const containsBench = (section, bench) => !!section && bench.letter >= section.from && bench.letter <= section.to;
export function letterRange(label) {
  if (typeof label !== 'string' || !/^[A-Z](?:–[A-Z])?$/.test(label)) return null;
  const [from, to = from] = label.split('–');
  return from <= to ? { from, to } : null;
}
export function defaultSections(enabled = AREAS) {
  return DEFAULT_SECTION_ORDER.map(label => { const [from, to = from] = label.split('–'); return { id: `area-${from}${to}`, from, to, enabled: enabled.includes(label), builtin: true }; });
}
export function sectionsFor(settings) { return settings.sections ?? defaultSections(settings.areas ?? AREAS); }
export function migrateState(state) {
  const migrated = structuredClone(state);
  migrated.hiddenWarnings ??= [];
  migrated.settings.sections = sectionsFor(migrated.settings);
  migrated.settings.placementMode ??= 'random';
  migrated.settings.disabledSeats ??= [];
  migrated.settings.ordered = { axis: 'columns', horizontal: 'left', vertical: 'top', seatSide: 0, startRows: {}, ...migrated.settings.ordered };
  migrated.settings.classRules ??= { default: { type: migrated.settings.separateClasses===false?'none':'gap', priority: migrated.settings.classPriority||'Voorkeur' }, overrides: {} };
  migrated.settings.yearRules ??= migrated.settings.mixYears===false?[]:defaultYearRules(migrated.settings.yearPriority||'Voorkeur');
  // Older plans already applied these categories: preserve their behavior.
  migrated.settings.classRulesEnabled ??= true;
  migrated.settings.yearRulesEnabled ??= true;
  migrated.settings.studentRulesEnabled ??= true;
  for(const key of ['separateClasses','mixYears','classPriority','yearPriority'])delete migrated.settings[key];
  migrated.rules = migrated.rules.filter(rule => !REMOVED_RULE_TYPES.includes(rule.type));
  // Convert occupied bench locks into individual pins; empty seats become usable again.
  migrated.locks = [...new Set([...migrated.locks, ...Object.entries(migrated.assignments)
    .filter(([seat]) => migrated.benchLocks.includes(seatBench(seat,migrated.settings)?.id)).map(([,id]) => id)])];
  migrated.benchLocks = [];
  delete migrated.settings.areas;
  return migrateLocationPins(migrated);
}
export function benchPriority(settings, bench) {
  if(settings.layout?.kind==='custom')return 0;
  const enabled = sectionsFor(settings).filter(section => section.enabled);
  const index = enabled.findIndex(section => containsBench(section, bench));
  return index < 0 ? enabled.length : index;
}
export const PRIORITIES = ['Verplicht', 'Voorkeur', 'Zachte voorkeur'];
export const REMOVED_RULE_TYPES = ['front', 'back', 'left', 'right', 'middle', 'aisle', 'preferArea', 'avoidArea'];
export const RULE_TYPES = {
  separate: 'Niet aan dezelfde bank', adjacent: 'Niet direct naast elkaar', gap: 'Minstens één bank ertussen', far: 'Zo ver mogelijk uit elkaar', near: 'Dicht bij elkaar', together: 'Aan dezelfde bank', area: 'In hetzelfde gebied', group: 'Groep uit elkaar', fixed: 'Vaste locatie'
};
export const CLASS_RULE_TYPES = { none:'Geen beperking', separate:'Niet aan dezelfde bank', adjacent:'Niet direct naast elkaar', gap:'Minstens één bank ertussen', far:'Zo ver mogelijk spreiden' };
export const YEAR_RULE_TYPES = { none:'Geen beperking', separate:'Niet aan dezelfde bank', adjacent:'Niet direct naast elkaar', gap:'Minstens één bank ertussen', far:'Zo ver mogelijk spreiden' };
export const defaultYearRules = (priority='Voorkeur') => [{ years:['3','4'], type:'separate', priority }];
export const yearPairKey = (a,b) => JSON.stringify([a,b].sort());
export const classRuleFor = (settings,klass) => (settings.classRules?.overrides&&Object.hasOwn(settings.classRules.overrides,klass)?settings.classRules.overrides[klass]:null) || settings.classRules?.default || { type:settings.separateClasses===false?'none':'gap', priority:settings.classPriority||'Voorkeur' };
export const yearRuleFor = (settings,a,b) => (settings.yearRules??(settings.mixYears===false?[]:defaultYearRules(settings.yearPriority))).find(rule=>yearPairKey(...rule.years)===yearPairKey(a,b));
export const BENCHES = [];
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (let col = 0; col < 26; col++) {
  const letter = letters[col];
  const area = col < 10 ? AREAS[0] : col === 10 ? 'K' : col < 21 ? AREAS[2] : col < 25 ? AREAS[3] : 'Z';
  const blocks = col === 10 ? [1, 2] : col >= 21 && col <= 24 ? [0, 1, 2] : col === 25 ? [1] : [0, 1, 2, 3];
  const x = 38 + col * ROOM.columnStep + (col >= 10 ? 35 : 0) + (col >= 11 ? 35 : 0) + (col >= 21 ? 38 : 0);
  for (const block of blocks) BENCHES.push({ id: `${letter}${block * 2 + 1}`, letter, col, block, area, x, y: 92 + block * ROOM.rowStep, facing: col < 10 ? 'left' : col === 10 ? 'down' : 'right', aisle: [9, 10, 11, 20, 21, 25].includes(col), label: `${letter} ${block * 2 + 1}–${block * 2 + 2}` });
}
export const BY_BENCH = Object.fromEntries(BENCHES.map(b => [b.id, b]));
export const benchesFor = settings => customBenches(settings?.layout)?.filter(b=>b.kind==='student')??BENCHES;
const customBenchLookup = new WeakMap();
function customBenchById(layout,id) {
  // Layout edits replace the layout object, as with the drawing geometry cache.
  if(!customBenchLookup.has(layout)) {
    const byId=new Map();
    for(const bench of customBenches(layout))if(bench.kind==='student'&&!byId.has(bench.id))byId.set(bench.id,bench);
    customBenchLookup.set(layout,byId);
  }
  return customBenchLookup.get(layout).get(id);
}
export const seatBench = (seat,settings) => settings?.layout?.kind==='custom'?customBenchById(settings.layout,seat?.split(':')[0]):BY_BENCH[seat?.split(':')[0]];
export const benchCapacity = bench => bench?.capacity??2;
export const validSeat = (seat,settings) => {const b=seatBench(seat,settings),index=Number(seat?.split(':')[1]);return typeof seat==='string'&&/^[a-zA-Z0-9_-]+:(?:0|[1-9]\d*)$/.test(seat)&&!!b&&Number.isInteger(index)&&index>=0&&index<benchCapacity(b);};
const customSeatCode = benchSeatCode;
export const seatCode = (seat,settings) => {if(!validSeat(seat,settings))return '';const b=seatBench(seat,settings),i=Number(seat.split(':')[1]);return b.custom&&!b.legacyCodes?customSeatCode(b,i):`${b.letter}${b.block*2+i+1}`;};
export function seatLabel(seat,settings) {
  const b=seatBench(seat,settings),i=Number(seat?.split(':')[1]);
  if(!validSeat(seat,settings))return b?.custom&&Number.isInteger(i)&&i>=0?`${customSeatCode(b,i)} · deze plaats bestaat niet meer`:'Onbekende positie';
  return seatCode(seat,settings);
}
export const roomStudents = state => state.students.filter(s=>!state.studentRooms||ownValue(state.studentRooms,s.id)===state.activeRoomId);
const seatRow = seat => seatBench(seat).block*2+Number(seat.split(':')[1])+1;
function columnStartOrder(settings,seats) {
  const direction=settings.ordered?.vertical==='bottom'?-1:1,columns=new Map();
  for(const seat of seats){const letter=seatBench(seat).letter;if(!columns.has(letter))columns.set(letter,[]);columns.get(letter).push(seat);}
  const ranks=new Map(),sides=new Map();
  for(const [letter,places] of columns) {
    const start=settings.ordered?.startRows?.[letter];
    if(!Number.isInteger(start)||start<1||start>8)continue;
    // Walk all eight row numbers in the selected direction, wrapping once.
    // Filtering to existing enabled seats naturally skips missing or disabled rows.
    const offset=seat=>((seatRow(seat)-start)*direction+8)%8;
    places.sort((a,b)=>offset(a)-offset(b));
    sides.set(letter,Number(places[0].split(':')[1]));
    const benches=[...new Set(places.map(seat=>seatBench(seat).id))];
    benches.forEach((id,i)=>ranks.set(id,i));
  }
  return {ranks,sides};
}
export function orderedSeats(settings) {
  const options = { axis: 'columns', horizontal: 'left', vertical: 'top', seatSide: 0, startRows: {}, ...settings.ordered };
  const horizontal = options.horizontal === 'right' ? -1 : 1, vertical = options.vertical === 'bottom' ? -1 : 1;
  const seats=enabledSeats(settings);
  if(settings.layout?.kind==='custom')return seats.sort((a,b)=>{const x=seatBench(a,settings),y=seatBench(b,settings);return (options.axis==='rows'?vertical*(x.block-y.block)||horizontal*(x.col-y.col):horizontal*(x.col-y.col)||vertical*(x.block-y.block))||Number(a.split(':')[1]!==String(options.seatSide))-Number(b.split(':')[1]!==String(options.seatSide))||a.localeCompare(b,'nl',{numeric:true});});
  const {ranks,sides}=columnStartOrder(settings,seats);
  const rowRank=bench=>ranks.get(bench.id)??(vertical===1?bench.block:3-bench.block);
  return seats.sort((a,b) => {
    const x=seatBench(a), y=seatBench(b);
    return benchPriority(settings,x)-benchPriority(settings,y)
      || (options.axis==='rows' ? rowRank(x)-rowRank(y) || horizontal*(x.col-y.col) : horizontal*(x.col-y.col) || rowRank(x)-rowRank(y))
      || Number(a.split(':')[1] !== String(sides.get(x.letter)??options.seatSide))-Number(b.split(':')[1] !== String(sides.get(y.letter)??options.seatSide));
  });
}
export function seatGeometry(bench,index) {
  if(bench.custom)return customSeatGeometry(bench,index);
  const horizontal=bench.area==='K';
  const x=horizontal?bench.x-12+index*47:bench.x+4;
  const y=horizontal?bench.y+23:bench.y+8+index*53;
  return { x,y,w:horizontal?43:57,chairX:horizontal?x+8:bench.facing==='right'?bench.x-15:bench.x+67,chairY:horizontal?bench.y-8:y+7,chairWidth:horizontal?27:13,chairHeight:horizontal?18:27 };
}
// More visual whitespace must not silently change existing distance rules.
const logicalX = bench => bench.col + (bench.col>=10?35/83:0) + (bench.col>=11?35/83:0) + (bench.col>=21?38/83:0);
const logicalBenchCache = new WeakMap();
function relationBench(bench) {
  if(bench.layoutVersion!==2)return bench;
  // Grid-room coordinates belong to sorting; position and facing belong to drawing.
  // A one-seat table retains the same footprint for distance and adjacency rules.
  if(!logicalBenchCache.has(bench))logicalBenchCache.set(bench,{...bench,x:bench.logicalX*GRID,y:bench.logicalY*GRID,facing:'down',capacity:Math.max(2,benchCapacity(bench))});
  return logicalBenchCache.get(bench);
}
function benchDistance(a,b,gridSteps=false) {
  if(a.custom||b.custom) {
    const x=relationBench(a),y=relationBench(b);
    const dx=x.x+tableBounds(x).width/2-y.x-tableBounds(y).width/2,dy=x.y+tableBounds(x).height/2-y.y-tableBounds(y).height/2;
    return (gridSteps?Math.abs(dx)+Math.abs(dy):Math.hypot(dx,dy))/(GRID*5);
  }
  const dx=logicalX(a)-logicalX(b),dy=a.block-b.block;
  return gridSteps?Math.abs(dx)+Math.abs(dy):Math.hypot(dx,dy);
}
export function distance(a,b) {return benchDistance(a,b);}
export function adjacentSeats(first,second,acrossBenches=true,settings) {
  const a=seatBench(first,settings),b=seatBench(second,settings);
  if(!a||!b||first===second)return false;
  if((a.layoutVersion===2||b.layoutVersion===2)&&(!validSeat(first,settings)||!validSeat(second,settings)))return false;
  if(a.id===b.id)return a.custom?Math.abs(Number(first.split(':')[1])-Number(second.split(':')[1]))===1:true;
  if(a.custom||b.custom) {
    if(!acrossBenches)return false;
    const logicalA=relationBench(a),logicalB=relationBench(b);
    const x=seatGeometry(logicalA,Number(first.split(':')[1])),y=seatGeometry(logicalB,Number(second.split(':')[1]));
    const sameX=Math.abs(x.x+x.w/2-y.x-y.w/2)<.001,sameY=Math.abs(x.y-y.y)<.001;
    if(!sameX&&!sameY)return false;
    const u=tableBounds(logicalA),v=tableBounds(logicalB);
    const gap=sameX?Math.max(u.y,v.y)-Math.min(u.y+u.height,v.y+v.height):Math.max(u.x,v.x)-Math.min(u.x+u.width,v.x+v.width);
    return gap>=0&&gap<=GRID*2;
  }
  if(!acrossBenches||(a.col!==b.col&&a.block!==b.block)||distance(a,b)>1.05)return false;
  const x=seatGeometry(a,Number(first.split(':')[1])),y=seatGeometry(b,Number(second.split(':')[1]));
  // Bench proximity alone is insufficient: staggered seats are diagonal.
  return Math.abs(x.x+x.w/2-y.x-y.w/2)<.001||Math.abs(x.y-y.y)<.001;
}
export function enabledSeats(settings) {
  const disabledSeats=new Set(settings.disabledSeats??[]);
  if(settings.layout?.kind==='custom')return benchesFor(settings).filter(b=>b.enabled&&!settings.disabled.includes(b.id)).flatMap(b=>Array.from({length:benchCapacity(b)},(_,i)=>`${b.id}:${i}`)).filter(seat=>!disabledSeats.has(seat));
  const sections = sectionsFor(settings).filter(section => section.enabled);
  return BENCHES.filter(b => sections.some(section => containsBench(section, b)) && !settings.disabled.includes(b.id)).flatMap(b => [0, 1].filter(i => settings.rows.includes(b.block * 2 + i + 1)).map(i => `${b.id}:${i}`)).filter(seat=>!disabledSeats.has(seat));
}
export const disabledSeatsValid=settings=>settings.disabledSeats===undefined||Array.isArray(settings.disabledSeats)&&new Set(settings.disabledSeats).size===settings.disabledSeats.length&&settings.disabledSeats.every(seat=>validSeat(seat,settings));
// Only import/compatibility tests construct this pre-grid state. Live defaults
// always carry the shared, editable classroom format.
export function legacyDefaults() {
  return { students: [], rules: [], hiddenWarnings: [], settings: { sections: defaultSections(), rows: [1,2,3,4,5,6,7,8], disabled: [], disabledSeats: [], classRulesEnabled:false, yearRulesEnabled:true, studentRulesEnabled:true, classRules:{default:{type:'none',priority:'Voorkeur'},overrides:{}}, yearRules:defaultYearRules(), placementMode: 'random', ordered: { axis: 'columns', horizontal: 'left', vertical: 'top', seatSide: 0, startRows: {} } }, assignments: {}, locks: [], benchLocks: [], name: 'Nieuwe indeling', modified: new Date().toISOString() };
}
export function defaults() {const state=legacyDefaults();state.settings.classRules.default.priority='Verplicht';state.settings.studentRulesEnabled=false;state.settings.yearRules=[];state.settings.layout=defaultClassroom();return state;}
export const studentRulesFor = state => state.settings.studentRulesEnabled===false ? [] : state.rules;
export function sampleStudents() {
  const names = ['Emma Peeters','Noah Janssens','Olivia Maes','Liam Jacobs','Mila Mertens','Lucas Willems','Louise Claes','Finn Goossens','Sofie Wouters','Arthur De Smet','Elise Vermeulen','Milan De Vos','Lotte De Clercq','Julien Dubois','Amélie Laurent','Seppe Hendrickx','Nora Van Damme','Victor Martens','Marie Van den Berg','Adam Van Acker','Fien Coppens','Louis De Meyer','Ella Stevens','Mathis De Winter','Anna Verstraeten','Leon Van Leeuwen','Lena Hermans','Oscar Michiels','Liv Verbeek','Jules De Backer','Alice Van de Velde','Ferre De Wilde','Julia Van Hove','Elias Smets','Camille Dupont','Ruben Dierckx','Charlotte Van Loon','Bram Van Dyck','Zoë Vandenbroucke','Tuur Pauwels','Hanne De Bruyn','Daan Van Dijk','Maud Segers','Wout Van den Broeck','Laura Aerts','Stijn De Jonge','Eva Van Dam','Niels Lemmens'];
  return names.map((name, i) => ({ id: `demo-${i}`, name, class: ['3A','3B','4A','4B'][i % 4], year: String(i % 4 < 2 ? 3 : 4), absent: false }));
}
function entries(state, assignments) {
  const byId = new Map(roomStudents(state).map(s => [s.id, s]));
  const seen=new Set();
  return Object.entries(assignments).filter(([seat, id]) => {
    if(!byId.has(id)||byId.get(id).absent||!validSeat(seat,state.settings)||seen.has(id))return false;
    seen.add(id);return true;
  }).map(([seat, id]) => ({ seat, student: byId.get(id), bench: seatBench(seat,state.settings) }));
}
function ruleCost(type, a, b, area) {
  switch (type) {
    case 'separate': return +(a.id === b.id);
    // A diagonal crosses a row and a column, so it counts as two table steps.
    case 'gap': case 'group': return +(benchDistance(a,b,true) < 1.9);
    case 'far': return Math.max(0, 6 - distance(a,b)) / 6;
    case 'near': return Math.max(0, distance(a,b) - 1.5) / 6;
    case 'together': return +(a.id !== b.id);
    case 'area': return +(a.area !== b.area);
    default: return 0;
  }
}
const relationCost=(rule,a,b,settings)=>rule.type==='adjacent'?+adjacentSeats(a.seat,b.seat,rule.acrossBenches!==false,settings):ruleCost(rule.type,a.bench,b.bench,rule.area);
function unresolvedRuleCost(rule,active,placed) {
  if(rule.type==='fixed'||REMOVED_RULE_TYPES.includes(rule.type))return 0;
  const members=rule.students.filter(id=>active.has(id));
  if(rule.type==='group'?members.length<2:members.length!==rule.students.length)return 0;
  const seated=members.filter(id=>placed.has(id)).length;
  // Each relationship with a waiting member is unresolved, rather than free.
  return (members.length*(members.length-1)-seated*(seated-1))/2;
}
export function evaluate(state, assignments = state.assignments, detailed = true, layoutRanks = null) {
  const benchFor=seat=>seatBench(seat,state.settings),labelFor=seat=>seatLabel(seat,state.settings);
  const placed = entries(state, assignments), lookup = new Map(placed.map(e => [e.student.id, e]));
  const score = [0,0,0,0,0], warnings = [], available = new Set(enabledSeats(state.settings));
  let classChecks=0,yearChecks=0;
  const classRelations=state.settings.classRulesEnabled===false?new Map():new Map(placed.map(p=>[p.student.class,classRuleFor(state.settings,p.student.class)])),yearRelations=new Map();
  for(const rule of state.settings.yearRulesEnabled===false?[]:state.settings.yearRules??(state.settings.mixYears===false?[]:defaultYearRules(state.settings.yearPriority))) {
    const pairs=rule.years[0]===rule.years[1]?[rule.years]:[rule.years,[...rule.years].reverse()];
    for(const [a,b] of pairs){if(!yearRelations.has(a))yearRelations.set(a,new Map());yearRelations.get(a).set(b,rule);}
  }
  const add = (priority, cost, type, people, message, ruleId) => {
    if (!cost) return;
    score[Math.max(0, PRIORITIES.indexOf(priority))] += cost;
    if (detailed) warnings.push({ id: `${ruleId || type}-${people.map(p => p.student.id).join('-')}`, type, priority, students: people.map(p => p.student.id), benches: [...new Set(people.map(p => p.bench.id))], message, ruleId });
  };
  for (const p of placed) if (!available.has(p.seat)) add('Verplicht', 1, 'unavailable', [p], `${p.student.name} zit op een uitgeschakelde plaats.`, 'plaats');
  const activeStudents=roomStudents(state).filter(student=>!student.absent),byId=new Map(activeStudents.map(student=>[student.id,student])),seenIds=new Map();
  for(const [seat,id] of Object.entries(assignments)) {
    const student=byId.get(id);if(!student)continue;
    if(!validSeat(seat,state.settings)) {
      score[0]++;
      if(detailed)warnings.push({id:`plaats-${id}-${seat}`,type:'unavailable',priority:'Verplicht',students:[id],benches:[benchFor(seat)?.id??seat.split(':')[0]],message:`${student.name} zit op ${labelFor(seat)}. Deze plaats bestaat niet meer.`,ruleId:'plaats'});
    }
    if(seenIds.has(id)) {
      score[0]++;
      if(detailed)warnings.push({id:`duplicate-${id}-${seat}`,type:'duplicate',priority:'Verplicht',students:[id],benches:[...new Set([benchFor(seenIds.get(id))?.id,benchFor(seat)?.id].filter(Boolean))],message:`${student.name} is meer dan één keer geplaatst.`,ruleId:'plaats'});
    } else seenIds.set(id,seat);
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j], same = a.bench.id === b.bench.id;
    if(state.settings.classRulesEnabled!==false&&a.student.class&&a.student.class===b.student.class) {
      const rule=classRelations.get(a.student.class);
      if(rule.type!=='none') {
        classChecks++;
        const cost=relationCost(rule,a,b,state.settings)*(rule.type==='gap'&&same?3:1);
        if(cost)add(rule.priority,cost,'class',[a,b],detailed?`${a.student.name} en ${b.student.name} uit klas ${a.student.class}: klasregel ‘${CLASS_RULE_TYPES[rule.type]}’ niet gevolgd. ${same?`Zij delen bank ${a.bench.label}.`:`Zij zitten op banken ${a.bench.label} en ${b.bench.label}.`}${rule.type==='far'?' De gewenste afstand is minimaal zes bankafstanden.':''}`:'',detailed?`klas:${a.student.class}`:undefined);
      }
    }
    if(a.student.year&&b.student.year) {
      const rule=yearRelations.get(a.student.year)?.get(b.student.year);
      if(rule&&rule.type!=='none') {
        yearChecks++;
        const cost=relationCost(rule,a,b,state.settings);
        if(cost)add(rule.priority,cost,'year',[a,b],detailed?`${a.student.year===b.student.year?`${a.student.name} en ${b.student.name} uit leerjaar ${a.student.year}`:`${a.student.name} (leerjaar ${a.student.year}) en ${b.student.name} (leerjaar ${b.student.year})`}: leerjaarregel ‘${YEAR_RULE_TYPES[rule.type]}’ niet gevolgd. ${same?`Zij delen bank ${a.bench.label}.`:`Zij zitten ${rule.type==='adjacent'?'direct naast elkaar ':''}op banken ${a.bench.label} en ${b.bench.label}.`}${rule.type==='far'?' De gewenste afstand is minimaal zes bankafstanden.':''}`:'',detailed?`leerjaar:${yearPairKey(...rule.years)}`:undefined);
      }
    }
    if (same) score[3] += 1;
  }
  let evaluated = 0, inactive = 0, partial = 0;
  for (const rule of studentRulesFor(state)) {
    if (REMOVED_RULE_TYPES.includes(rule.type)) continue;
    if (rule.type === 'fixed') {
      const student = roomStudents(state).find(s=>s.id===rule.students[0]), actual=lookup.get(student?.id), target=rule.seat?benchFor(rule.seat):null;
      if(rule.roomId&&state.activeRoomId&&rule.roomId!==state.activeRoomId){inactive++;continue;}
      if (!student || student.absent) { inactive++; continue; }
      evaluated++;
      if(!rule.seat)continue;
      if (actual?.seat !== rule.seat) {
        const affected=[actual].filter(Boolean);
        add('Verplicht',1,'fixed',affected,`${student.name} hoort op ${target?labelFor(rule.seat):rule.positionCode?`${rule.positionCode} · deze plaats bestaat niet meer`:labelFor(rule.seat)}${actual ? `, maar zit op ${labelFor(actual.seat)}` : ', maar is nog niet geplaatst'}. De vaste-positieregel is niet gevolgd.`,rule.id);
        if (detailed) {
          const warning=warnings[warnings.length-1];
          warning.students=[...new Set([student.id,...warning.students])];
          if(target)warning.benches=[...new Set([...warning.benches,target.id])];
        }
      }
      continue;
    }
    const members = rule.students.map(id => lookup.get(id)).filter(Boolean);
    // Absent pupils and pupils assigned to another room are inactive here.
    // A present pupil awaiting a valid seat still makes the rule unresolved.
    const missing=rule.students.map(id=>byId.get(id)).filter(student=>student&&!lookup.has(student.id));
    const relevant=rule.type==='group'?rule.students.filter(id=>byId.has(id)).length>=2:rule.students.every(id=>byId.has(id));
    score[Math.max(0,PRIORITIES.indexOf(rule.priority))]+=unresolvedRuleCost(rule,byId,lookup);
    if(detailed&&relevant&&missing.length)warnings.push({id:`${rule.id}-unplaced`,type:rule.type,priority:rule.priority,students:[...new Set([...members.map(member=>member.student.id),...missing.map(student=>student.id)])],benches:[...new Set(members.map(member=>member.bench.id))],message:`${missing.map(student=>student.name).join(', ')} ${missing.length===1?'heeft':'hebben'} nog geen geldige plaats. De regel ‘${RULE_TYPES[rule.type]}’ kan nog niet worden gevolgd.`,ruleId:rule.id});
    if (rule.type === 'group') {
      if (members.length < 2) { inactive++; continue; }
      if (members.length !== rule.students.length) partial++;
    } else if (members.length !== rule.students.length) { inactive++; continue; }
    evaluated++;
    if (members.length === 1) {
      const a = members[0]; add(rule.priority, ruleCost(rule.type,a.bench,null,rule.area), rule.type, [a], `${a.student.name}: de regel ‘${RULE_TYPES[rule.type]}${rule.area ? ` ${rule.area}` : ''}’ is niet gevolgd.`,rule.id);
    } else for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j]; add(rule.priority, relationCost(rule,a,b,state.settings),rule.type,[a,b],`${a.student.name} en ${b.student.name}: de regel ‘${RULE_TYPES[rule.type]}’ is niet gevolgd.${rule.type === 'far' ? ' De gewenste afstand is minimaal zes bankafstanden.' : ''}`,rule.id);
    }
  }
  if(detailed)for(const student of activeStudents.filter(student=>!lookup.has(student.id)))warnings.push({id:`unplaced-${student.id}`,type:'unplaced',priority:'Verplicht',students:[student.id],benches:[],message:`${student.name} heeft nog geen geldige zitplaats.`,ruleId:'plaats'});
  // Filling preferences are considered only after all seating-rule priorities.
  const occupied = new Set(placed.map(p => p.bench.id));
  if(state.settings.placementMode==='ordered'&&placed.length) {
    const rank=layoutRanks||new Map([...new Set(orderedSeats(state.settings).map(s=>benchFor(s).id))].map((id,i)=>[id,i]));
    for(const p of placed)score[4]+=rank.get(p.bench.id)??rank.size;
  } else {
    for (const p of placed) score[4] += benchPriority(state.settings, p.bench);
    const benches=[...occupied].map(id=>benchFor(`${id}:0`));
    for(let i=0;i<benches.length;i++)for(let j=i+1;j<benches.length;j++)score[4]+=.65/(1+distance(benches[i],benches[j])**2);
  }
  return { warnings, score, evaluated, inactive, partial, classChecks, yearChecks };
}
function compare(a,b) { for (let i = 0; i < a.length; i++) { if (Math.abs(a[i]-b[i]) > 1e-8) return a[i] < b[i] ? -1 : 1; } return 0; }
function shuffle(items, random) { const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random()*(i+1)); [out[i],out[j]] = [out[j],out[i]]; } return out; }
export function generate(state, { random = Math.random, iterations = 1800, preferredSeats = null } = {}) {
  const benchFor=seat=>seatBench(seat,state.settings);
  const seats = enabledSeats(state.settings), active = roomStudents(state).filter(s => !s.absent);
  const activeIds = new Set(active.map(s => s.id)), assignments = {}, lockedSeats = new Set(), lockedIds = new Set();
  for (const [seat,id] of Object.entries(state.assignments)) if (activeIds.has(id) && !lockedIds.has(id) && validSeat(seat,state.settings) && (state.locks.includes(id) || state.benchLocks.includes(benchFor(seat)?.id))) { assignments[seat]=id; lockedSeats.add(seat); lockedIds.add(id); }
  for (const b of state.benchLocks) for (let i=0;i<benchCapacity(benchFor(`${b}:0`));i++) lockedSeats.add(`${b}:${i}`);
  // Pins win over an incompatible fixed-position rule. Conflicts remain warnings.
  for (const rule of studentRulesFor(state).filter(r=>r.type==='fixed')) {
    const id=rule.students[0];
    if(!rule.seat||!activeIds.has(id)||lockedIds.has(id)||!validSeat(rule.seat,state.settings)||assignments[rule.seat]||(rule.roomId&&state.activeRoomId&&rule.roomId!==state.activeRoomId))continue;
    assignments[rule.seat]=id;lockedSeats.add(rule.seat);lockedIds.add(id);
  }
  // A weekly seat preference follows seating rules, but precedes packing and
  // random filling. It is deliberately not a pin: the search may move it.
  const preferred=preferredSeats?new Map(Object.entries(preferredSeats).filter(([id,seat])=>activeIds.has(id)&&seats.includes(seat))):null;
  const scoreFor=(candidate,ranks,partial=false)=>{
    const score=evaluate(state,candidate,false,ranks).score;
    // Missing-member costs can fall as a partial exact-search plan is filled.
    // Remove them from its lower bound so feasible completions are not pruned.
    if(partial) {
      const placed=new Set(Object.values(candidate));
      for(const rule of studentRulesFor(state))score[Math.max(0,PRIORITIES.indexOf(rule.priority))]-=unresolvedRuleCost(rule,activeIds,placed);
    }
    if(!preferred)return score;
    const positions=new Map(Object.entries(candidate).map(([seat,id])=>[id,seat]));
    return [...score.slice(0,3),[...preferred].reduce((n,[id,seat])=>n+(positions.get(id)!==seat),0),...score.slice(3)];
  };
  for(const [id,seat] of preferred??[])if(!lockedIds.has(id)&&!assignments[seat]&&!lockedSeats.has(seat))assignments[seat]=id;
  const seeded=new Set(Object.values(assignments));
  const ordered=state.settings.placementMode==='ordered';
  if(ordered) {
    // Keep ordered regeneration repeatable, including the improvement search.
    let seed=31;
    random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  }
  const remaining = ordered ? active.filter(s => !seeded.has(s.id)) : shuffle(active.filter(s => !seeded.has(s.id)),random);
  const free = seats.filter(s => !lockedSeats.has(s)), freeByBench = new Map();
  for (const seat of free.filter(s=>!assignments[s])) { const b = benchFor(seat).id; if (!freeByBench.has(b)) freeByBench.set(b,[]); freeByBench.get(b).push(seat); }
  const occupiedBenches = new Set(Object.keys(assignments).map(s => benchFor(s).id));
  const byPriority = (a,b) => benchPriority(state.settings,benchFor(a))-benchPriority(state.settings,benchFor(b));
  const side=state.settings.ordered?.seatSide??0;
  const columnSides=ordered&&state.settings.layout?.kind!=='custom'?columnStartOrder(state.settings,seats).sides:new Map();
  const primary = shuffle([...freeByBench.values()].filter(ss => !occupiedBenches.has(benchFor(ss[0]).id)).map(ss => ss.find(s=>s.endsWith(`:${side}`))||ss[0]),random).sort(byPriority);
  const secondary = shuffle(free.filter(s => !assignments[s]&&!primary.includes(s)),random).sort(byPriority);
  const order = [...primary,...secondary];
  const ranks=ordered?new Map([...new Set(orderedSeats(state.settings).map(s=>benchFor(s).id))].map((id,i)=>[id,i])):null;
  if(ordered) {
    // Greedily choose the best suitable position; equal choices follow the configured order.
    const sequence=orderedSeats(state.settings).filter(s=>free.includes(s));
    for(const student of remaining) {
      let best=null,score=null;
      for(const seat of sequence) {
        if(assignments[seat])continue;
        assignments[seat]=student.id;
        const candidate=scoreFor(assignments,ranks);
        delete assignments[seat];
        if(!score||compare(candidate,score)<0){best=seat;score=candidate;}
      }
      if(best)assignments[best]=student.id;
    }
  } else remaining.slice(0,order.length).forEach((student,i) => { assignments[order[i]] = student.id; });
  let bestScore = scoreFor(assignments,ranks);
  const waiting=new Set(active.filter(student=>!Object.values(assignments).includes(student.id)).map(student=>student.id));
  const movable = free;
  for (let k = 0; k < iterations && movable.length && (movable.length>1||waiting.size); k++) {
    const occupiedMovable = Object.keys(assignments).filter(seat => !lockedSeats.has(seat) && free.includes(seat));
    if (!occupiedMovable.length) break;
    if(waiting.size&&random()<.25) {
      const seat=occupiedMovable[Math.floor(random()*occupiedMovable.length)],id=[...waiting][Math.floor(random()*waiting.size)],previous=assignments[seat];
      assignments[seat]=id;const score=scoreFor(assignments,ranks);
      // Keep the current seated group on ties; only better rule scores admit
      // a waiting pupil. Cardinality, pins and fixed positions stay unchanged.
      if(compare(score.slice(0,3),bestScore.slice(0,3))<0){waiting.delete(id);waiting.add(previous);bestScore=score;}
      else assignments[seat]=previous;
      continue;
    }
    let a = occupiedMovable[Math.floor(random()*occupiedMovable.length)], b = movable[Math.floor(random()*movable.length)];
    const sharingRules = studentRulesFor(state).filter(r => r.type === 'together');
    if (sharingRules.length && random() < .2) {
      const rule = sharingRules[Math.floor(random()*sharingRules.length)];
      const first = Object.keys(assignments).find(seat => assignments[seat] === rule.students[0]);
      const second = Object.keys(assignments).find(seat => assignments[seat] === rule.students[1]);
      if (first && second && !lockedSeats.has(first)) {
        const partnerSeat = free.find(seat=>benchFor(seat).id===benchFor(second).id&&seat!==second&&seat!==first);
        if (free.includes(partnerSeat)) { a = first; b = partnerSeat; }
      }
    }
    if (a === b || assignments[a] === assignments[b]) continue;
    const va = assignments[a], vb = assignments[b];
    if (vb) assignments[a]=vb; else delete assignments[a];
    if (va) assignments[b]=va; else delete assignments[b];
    const score = scoreFor(assignments,ranks);
    if (compare(score,bestScore) > 0) {
      if (va) assignments[a]=va; else delete assignments[a];
      if (vb) assignments[b]=vb; else delete assignments[b];
    } else bestScore=score;
  }
  // Random proposals can miss an available correction. Check every move and
  // swap or waiting-list replacement with a remaining rule violation.
  // A bounded scan keeps large, contradictory plans responsive.
  let repairBudget=Math.min(6000,Math.max(600,iterations*3));
  if(iterations>0)for(let pass=0;pass<4&&repairBudget>0&&bestScore.slice(0,3).some(value=>value>1e-8);pass++) {
    const affected=new Set(evaluate(state,assignments).warnings.flatMap(warning=>warning.students));
    const sources=Object.keys(assignments).filter(seat=>!lockedSeats.has(seat)&&free.includes(seat));
    let correction=null,correctionScore=bestScore;
    scan:for(const a of sources) {
      // A missing rule member may need to replace an otherwise unconstrained
      // seated pupil, so replacements consider every unlocked occupant.
      for(const id of waiting) {
        if(--repairBudget<0)break scan;
        const previous=assignments[a];assignments[a]=id;
        const score=scoreFor(assignments,ranks);assignments[a]=previous;
        if(compare(score.slice(0,3),correctionScore.slice(0,3))<0){correction={seat:a,id,previous};correctionScore=score;}
      }
      if(!affected.has(assignments[a]))continue;
      for(const b of movable) {
        if(a===b)continue;
        if(--repairBudget<0)break scan;
        const va=assignments[a],vb=assignments[b];
        if(vb)assignments[a]=vb;else delete assignments[a];assignments[b]=va;
        const score=scoreFor(assignments,ranks);
        assignments[a]=va;if(vb)assignments[b]=vb;else delete assignments[b];
        if(compare(score.slice(0,3),correctionScore.slice(0,3))<0){correction={a,b,va,vb};correctionScore=score;}
      }
    }
    if(!correction)break;
    if(correction.seat){const {seat,id,previous}=correction;assignments[seat]=id;waiting.delete(id);waiting.add(previous);}
    else {const {a,b,va,vb}=correction;if(vb)assignments[a]=vb;else delete assignments[a];assignments[b]=va;}
    bestScore=correctionScore;
  }
  // Some corrections require several simultaneous moves, with no improving
  // intermediate swap. Search small seating problems exhaustively up to a
  // work limit, while retaining all pins and exact-position rules.
  const seatedIds=Object.entries(assignments).filter(([seat])=>!lockedSeats.has(seat)).map(([,id])=>id);
  const searchIds=[...seatedIds,...waiting],targetCount=seatedIds.length;
  if(iterations>0&&searchIds.length<=6&&movable.length<=12&&bestScore.slice(0,3).some(value=>value>1e-8)) {
    const candidate=Object.fromEntries(Object.entries(assignments).filter(([seat])=>lockedSeats.has(seat))),oldSeats=new Map(Object.entries(assignments).map(([seat,id])=>[id,seat]));
    const sequence=ordered?orderedSeats(state.settings).filter(seat=>movable.includes(seat)):movable;
    let work=50000,solution=null;
    const search=(index,count)=>{
      if(--work<0)return;
      if(count>targetCount||count+searchIds.length-index<targetCount)return;
      if(compare(scoreFor(candidate,ranks,true).slice(0,3),bestScore.slice(0,3))>0)return;
      if(index===searchIds.length) {
        const score=scoreFor(candidate,ranks);
        const substitution=Object.values(solution??assignments).some(id=>!Object.values(candidate).includes(id));
        if(compare(score,bestScore)<0&&(!substitution||compare(score.slice(0,3),bestScore.slice(0,3))<0)){solution={...candidate};bestScore=score;}
        return;
      }
      const id=searchIds[index],current=oldSeats.get(id);
      if(count<targetCount)for(const seat of current?[current,...sequence.filter(seat=>seat!==current)]:sequence) {
        if(candidate[seat])continue;
        candidate[seat]=id;search(index+1,count+1);delete candidate[seat];
        if(work<0||bestScore.slice(0,3).every(value=>value<=1e-8))break;
      }
      if(work>=0&&count+searchIds.length-index-1>=targetCount)search(index+1,count);
    };
    search(0,0);
    if(solution){for(const seat of Object.keys(assignments))delete assignments[seat];Object.assign(assignments,solution);}
  }
  // Use one consistent seat side on singly occupied benches, unless pinned or fixed.
  for(const [seat,id] of Object.entries(assignments)) {
    const preferred=`${benchFor(seat).id}:${columnSides.get(benchFor(seat).letter)??side}`;
    if(seat!==preferred&&!lockedSeats.has(seat)&&!lockedSeats.has(preferred)&&seats.includes(preferred)&&!assignments[preferred]) {
      delete assignments[seat];assignments[preferred]=id;
      // Seat alignment is part of adjacency: cosmetic side normalization must
      // not turn a valid diagonal placement into a direct-neighbor violation.
      const score=scoreFor(assignments,ranks);
      if(compare(score,bestScore)>0){delete assignments[preferred];assignments[seat]=id;}
      else bestScore=score;
    }
  }
  if(ordered) {
    // Finish ordered filling with deterministic moves. An empty later bench
    // can relieve unnecessary sharing, which precedes compact filling.
    // Every rule, weekly-seat preference and sharing score must stay as good.
    const rankFor=seat=>ranks.get(benchFor(seat).id);
    while(true) {
      const sources=Object.keys(assignments).filter(seat=>!lockedSeats.has(seat)&&free.includes(seat));
      const counts=new Map();
      for(const seat of Object.keys(assignments)){const id=benchFor(seat).id;counts.set(id,(counts.get(id)??0)+1);}
      const last=Math.max(-1,...sources.map(rankFor));
      const shared=seat=>counts.get(benchFor(seat).id)>1;
      const canUnshare=sources.some(shared);
      const targets=orderedSeats(state.settings).filter(seat=>!lockedSeats.has(seat)&&!counts.has(benchFor(seat).id)&&(rankFor(seat)<last||canUnshare));
      let move=null,moveScore=bestScore;
      for(const target of targets)for(const from of sources) {
        if(rankFor(from)<=rankFor(target)&&!shared(from))continue;
        const id=assignments[from];delete assignments[from];assignments[target]=id;
        const score=scoreFor(assignments,ranks);
        delete assignments[target];assignments[from]=id;
        if(score.slice(0,-1).every((value,i)=>value<=bestScore[i]+1e-8)&&compare(score,moveScore)<0){move={from,target,id};moveScore=score;}
      }
      if(!move)break;
      delete assignments[move.from];assignments[move.target]=move.id;bestScore=moveScore;
    }
  }
  return { assignments, unplaced: active.filter(s => !Object.values(assignments).includes(s.id)).map(s => s.id), ...evaluate(state,assignments) };
}
