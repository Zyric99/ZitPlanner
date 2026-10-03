import { AREAS, PRIORITIES, CLASS_RULE_TYPES, YEAR_RULE_TYPES, RULE_TYPES, REMOVED_RULE_TYPES, yearPairKey, benchesFor, letterRange, validSeat as engineValidSeat, disabledSeatsValid, defaults } from './engine.mjs';
import { layoutValid } from './layout.mjs';
import { roomSystemValid } from './rooms.mjs';
import { weeklyPlansValid } from './weekly-planner.mjs';
import { STUDY_DAYS } from './student-import.mjs';
import { normalizeYear } from './student-year.mjs';

export function validState(state) {try{return validateState(state);}catch{return false;}}

// Validate all associated records before changing the current project. Filtering
// malformed plans or lists here would silently discard part of a backup.
export function validProjectBackup(data) {
  try {
    if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==undefined&&![1,2].includes(data.version)||!validState(data.state))return false;
    const validRecords=(records,check)=>records===undefined||Array.isArray(records)&&records.every(record=>record&&typeof record.id==='string'&&record.id.trim()&&check(record))&&new Set(records.map(record=>record.id)).size===records.length;
    return validRecords(data.plans,plan=>validState(plan.state))&&validRecords(data.lists,list=>typeof list.name==='string'&&list.name.trim()&&Array.isArray(list.students)&&validState({...defaults(),students:list.students}));
  }catch{return false;}
}

function validateState(s) {
  if (!s || !Array.isArray(s.students) || !Array.isArray(s.rules) || !s.settings || !s.assignments || typeof s.assignments !== 'object' || Array.isArray(s.assignments) || !Array.isArray(s.locks) || !Array.isArray(s.benchLocks) || typeof s.name !== 'string') return false;
  if(s.settings.layout!==undefined&&!layoutValid(s.settings.layout)||!roomSystemValid(s))return false;
  if(!weeklyPlansValid(s.weeklyPlans,s))return false;
  const BY_BENCH=Object.fromEntries(benchesFor(s.settings).map(b=>[b.id,b]));
  if(s.hiddenWarnings!==undefined&&(!Array.isArray(s.hiddenWarnings)||!s.hiddenWarnings.every(key=>typeof key==='string')))return false;
  if (!['rows','disabled'].every(k => Array.isArray(s.settings[k]))) return false;
  if(!disabledSeatsValid(s.settings))return false;
  if(!['classRulesEnabled','yearRulesEnabled','studentRulesEnabled'].every(k=>s.settings[k]===undefined||typeof s.settings[k]==='boolean'))return false;
  if (s.settings.sections !== undefined) {
    if (!Array.isArray(s.settings.sections) || !s.settings.sections.every(section => section && typeof section.id === 'string' && section.id && typeof section.from==='string' && typeof section.to==='string' && /^[A-Z]$/.test(section.from) && /^[A-Z]$/.test(section.to) && section.from<=section.to && typeof section.enabled === 'boolean') || new Set(s.settings.sections.map(section=>section.id)).size!==s.settings.sections.length) return false;
  } else if (!Array.isArray(s.settings.areas) || !s.settings.areas.every(a=>AREAS.includes(a))) return false;
  const validRelation=(rule,types)=>rule&&Object.hasOwn(types,rule.type)&&PRIORITIES.includes(rule.priority)&&(rule.acrossBenches===undefined||typeof rule.acrossBenches==='boolean');
  if(s.settings.classRules!==undefined) {
    const classes=s.settings.classRules;
    if(!classes||!validRelation(classes.default,CLASS_RULE_TYPES)||!classes.overrides||typeof classes.overrides!=='object'||Array.isArray(classes.overrides)||!Object.entries(classes.overrides).every(([klass,rule])=>klass.trim()&&validRelation(rule,CLASS_RULE_TYPES)))return false;
  } else if(typeof s.settings.separateClasses!=='boolean'||!PRIORITIES.includes(s.settings.classPriority))return false;
  if(s.settings.yearRules!==undefined) {
    const years=s.settings.yearRules;
    if(!Array.isArray(years)||!years.every(rule=>validRelation(rule,YEAR_RULE_TYPES)&&Array.isArray(rule.years)&&rule.years.length===2&&rule.years.every(year=>typeof year==='string'&&year.trim()))||new Set(years.map(rule=>yearPairKey(...rule.years))).size!==years.length)return false;
  } else if(typeof s.settings.mixYears!=='boolean'||!PRIORITIES.includes(s.settings.yearPriority))return false;
  if (!s.settings.rows.every(r => Number.isInteger(r) && r >= 1 && r <= 8) || !s.settings.disabled.every(b => BY_BENCH[b])) return false;
  if (!s.students.every(p => p && ['id','name','class'].every(k => typeof p[k] === 'string' && p[k].trim()) && (p.year===undefined||typeof p.year==='string') && typeof p.absent === 'boolean')) return false;
  if(!s.students.every(p=>p.yearOverride===undefined||p.yearOverride&&typeof p.yearOverride.class==='string'&&typeof p.yearOverride.year==='string'&&!!normalizeYear(p.yearOverride.year)))return false;
  if(!s.students.every(p=>['firstName','lastName'].every(key=>p[key]===undefined||typeof p[key]==='string')&&(p.eveningStudy===undefined||p.eveningStudy&&typeof p.eveningStudy==='object'&&!Array.isArray(p.eveningStudy)&&STUDY_DAYS.every(day=>['Ja','Nee',''].includes(p.eveningStudy[day])))))return false;
  const ids=new Set(s.students.map(p=>p.id));
  if (ids.size!==s.students.length || !s.locks.every(id=>ids.has(id)) || !s.benchLocks.every(id=>BY_BENCH[id])) return false;
  if (s.settings.placementMode!==undefined&&!['random','ordered'].includes(s.settings.placementMode)) return false;
  if (s.settings.ordered!==undefined&&(!s.settings.ordered || !['columns','rows'].includes(s.settings.ordered.axis) || !['left','right'].includes(s.settings.ordered.horizontal) || !['top','bottom'].includes(s.settings.ordered.vertical) || ![0,1].includes(s.settings.ordered.seatSide))) return false;
  const startRows=s.settings.ordered?.startRows;
  if(startRows!==undefined&&(!startRows||typeof startRows!=='object'||Array.isArray(startRows)||!Object.entries(startRows).every(([letter,row])=>/^[A-Z]$/.test(letter)&&Number.isInteger(row)&&row>=1&&row<=8)))return false;
  if (!s.rules.every(r=>r && typeof r.id==='string' && r.id.trim() && (Object.hasOwn(RULE_TYPES,r.type)||REMOVED_RULE_TYPES.includes(r.type)) && PRIORITIES.includes(r.priority) && (r.acrossBenches===undefined||typeof r.acrossBenches==='boolean') && Array.isArray(r.students) && r.students.length && new Set(r.students).size===r.students.length && r.students.every(id=>ids.has(id)) && (!['preferArea','avoidArea'].includes(r.type) || letterRange(r.area)) && (r.type!=='fixed'||(r.roomId?typeof r.roomId==='string'&&(r.seat===undefined||typeof r.seat==='string'&&/^[a-zA-Z0-9_-]+:\d+$/.test(r.seat)):engineValidSeat(r.seat,s.settings))))) return false;
  if(new Set(s.rules.map(r=>r.id)).size!==s.rules.length)return false;
  if (!s.rules.every(r => [...REMOVED_RULE_TYPES,'fixed'].includes(r.type) ? r.students.length===1 : r.type==='group' ? r.students.length>=2 : r.students.length===2)) return false;
  const assigned=Object.entries(s.assignments);
  return assigned.every(([seat,id])=>engineValidSeat(seat,s.settings) && ids.has(id)) && new Set(assigned.map(([,id])=>id)).size===assigned.length;
}

