import { classRuleFor, yearRuleFor } from './engine.mjs';

export const warningPriorityClass=warning=>warning.priority==='Verplicht'?'warning-required':warning.priority==='Zachte voorkeur'?'warning-soft':'warning-preference';

// A pupil with overlapping violations shows the strongest active priority.
export function warningHighlights(warnings) {
  const students=new Map(),benches=new Map(),rank={'warning-required':0,'warning-preference':1,'warning-soft':2};
  for(const warning of warnings){
    const style=warningPriorityClass(warning);
    for(const [map,ids] of [[students,warning.students],[benches,warning.benchSpecific?warning.benches:[]]]){
      for(const id of ids)if(!map.has(id)||rank[style]<rank[map.get(id)])map.set(id,style);
    }
  }
  return {students,benches};
}

// A continuing violation follows its rule and pupils, even after a seat swap.
// Changing the rule creates a new warning; bench coordinates are only details.
export function warningKey(state, warning) {
  const pupils=warning.students.map(id=>state.students.find(p=>p.id===id));
  let definition=[];
  let relationship;
  if(warning.type==='class') {
    const klass=pupils[0]?.class,rule=classRuleFor(state.settings,klass);
    definition=[klass,rule.type,rule.priority];
    relationship=rule;
  } else if(warning.type==='year') {
    const years=pupils.map(p=>p?.year).sort(),rule=yearRuleFor(state.settings,...years);
    definition=[years,rule?.type,rule?.priority];
    relationship=rule;
  } else {
    const rule=state.rules.find(r=>r.id===warning.ruleId);
    if(rule)definition=[rule.type,rule.priority,rule.seat??null,[...rule.students].sort(),...(rule.type==='fixed'?[rule.roomId??null]:[])];
    relationship=rule;
  }
  // Keep existing hidden-warning keys unchanged for the original enabled scope.
  if(relationship?.type==='adjacent'&&relationship.acrossBenches===false)definition.push(['acrossBenches',false]);
  return JSON.stringify([warning.type,warning.ruleId??null,definition,[...warning.students].sort()]);
}

export function reconcileHiddenWarnings(state, warnings) {
  const current=new Set(warnings.map(w=>warningKey(state,w)));
  return [...new Set(state.hiddenWarnings??[])].filter(key=>{
    if(current.has(key))return true;
    // A master switch suspends checking; it does not resolve the violation.
    // Recheck saved hidden preferences when the category is enabled again.
    try{const [type,ruleId]=JSON.parse(key);return type==='class'&&state.settings.classRulesEnabled===false||type==='year'&&state.settings.yearRulesEnabled===false||state.settings.studentRulesEnabled===false&&state.rules.some(rule=>rule.id===ruleId);}catch{return false;}
  });
}

export function warningGroups(state, warnings) {
  const hiddenKeys=new Set(state.hiddenWarnings??[]),active=[],hidden=[];
  warnings.forEach((warning,index)=>{
    const key=warningKey(state,warning);
    (hiddenKeys.has(key)?hidden:active).push({warning,index,key});
  });
  return {active,hidden};
}

// Group only the presentation. Individual violations retain their saved keys.
export function aggregateUnplacedWarnings(entries) {
  const unplaced=entries.filter(entry=>entry.warning.type==='unplaced');
  if(unplaced.length<2)return entries;
  const first=unplaced[0],students=[...new Set(unplaced.flatMap(entry=>entry.warning.students))];
  const grouped={...first,indices:unplaced.map(entry=>entry.index),warning:{...first.warning,students,crossRoom:false,message:`${students.length} leerlingen hebben nog geen geldige zitplaats.`}};
  return entries.flatMap(entry=>entry===first?[grouped]:entry.warning.type==='unplaced'?[]:[entry]);
}
