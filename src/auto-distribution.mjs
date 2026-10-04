import { ownValue, setOwnValue } from './id-record.mjs';
import { enabledSeats, evaluate, generate, PRIORITIES, studentRulesFor } from './engine.mjs';
import { applyClassAssignments, captureRoom, classRoomId, distributeRooms, normalizeRooms, participatingRoomIds, roomState } from './rooms.mjs';

const clone=value=>structuredClone(value);
function compare(a,b){for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>1e-8)return a[i]<b[i]?-1:1;return 0;}
function shuffle(values,random){const result=[...values];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}

// Room strategies are preferences below every seating-rule priority. Bounds
// ignore seating relationships, so reaching them with no violations is enough
// to stop; otherwise the bounded search can trade distribution for better rules.
function distributionPreference(base,targets,forced) {
  const active=base.students.filter(p=>!p.absent),mode=base.distribution.mode;
  const capacities=targets.map(id=>enabledSeats(roomState(base,id).settings).length);
  const roomIndex=new Map(targets.map((id,i)=>[id,i]));
  const groupKey=p=>mode==='yearsSpread'?p.year:p.class;
  const fixed=targets.map(()=>0),groupSizes=new Map(),fixedGroups=new Map();
  for(const p of active) {
    const key=groupKey(p);groupSizes.set(key,(groupSizes.get(key)||0)+1);
    if(!fixedGroups.has(key))fixedGroups.set(key,targets.map(()=>0));
    const i=roomIndex.get(forced.get(p.id));
    if(i!==undefined){fixed[i]++;fixedGroups.get(key)[i]++;}
  }
  const limits=capacities.map((capacity,i)=>Math.max(capacity,fixed[i]));
  const balancedCounts=(total,minimum,maximum)=>{
    const counts=[...minimum];
    for(let left=total-counts.reduce((n,c)=>n+c,0);left>0;left--) {
      let next=-1;
      for(let i=0;i<counts.length;i++)if(counts[i]<maximum[i]&&(next<0||counts[i]<counts[next]||counts[i]===counts[next]&&(2*counts[i]+1)/Math.max(1,capacities[i])<(2*counts[next]+1)/Math.max(1,capacities[next])))next=i;
      if(next<0)break;counts[next]++;
    }
    return counts;
  };
  const squares=counts=>counts.reduce((n,c)=>n+c*c,0);
  const occupancy=counts=>counts.reduce((n,c,i)=>n+c*c/Math.max(1,capacities[i]),0);
  const balanced=balancedCounts(active.length,fixed,limits),ideal=[...fixed];
  let left=active.length-ideal.reduce((n,c)=>n+c,0);
  for(let i=0;i<ideal.length;i++){const added=Math.min(left,limits[i]-ideal[i]);ideal[i]+=added;left-=added;}
  let spreadBound=0;
  for(const [key,size] of groupSizes){const minimum=fixedGroups.get(key),maximum=limits.map((capacity,i)=>capacity-fixed[i]+minimum[i]);spreadBound+=squares(balancedCounts(size,minimum,maximum));}
  return state=>{
    const counts=targets.map(()=>0),groups=new Map();
    for(const p of active){const i=roomIndex.get(ownValue(state.studentRooms,p.id));if(i===undefined)continue;counts[i]++;const key=groupKey(p);if(!groups.has(key))groups.set(key,targets.map(()=>0));groups.get(key)[i]++;}
    if(mode==='capacity')return counts.map((count,i)=>ideal[i]-count);
    if(mode==='classesTogether') {
      let fragments=0,splitPairs=0;
      for(const group of groups.values()){fragments+=Math.max(0,group.filter(Boolean).length-1);const size=group.reduce((n,c)=>n+c,0);splitPairs+=(size*size-squares(group))/2;}
      return [fragments,splitPairs];
    }
    const balance=[squares(counts)-squares(balanced),occupancy(counts)-occupancy(balanced)];
    return mode==='balanced'?balance:[[...groups.values()].reduce((n,group)=>n+squares(group),0)-spreadBound,...balance];
  };
}

// These relations must not disappear just because their pupils were split
// between rooms. Distance/separation rules are satisfied by different rooms.
export function evaluateCrossRoomRules(state,detailed=true) {
  const score=[0,0,0],warnings=[],people=new Map(state.students.filter(p=>!p.absent).map(p=>[p.id,p]));
  for(const student of people.values())if(!state.rooms.some(room=>room.id===ownValue(state.studentRooms,student.id))) {
    if(detailed)warnings.push({type:'unplaced',priority:'Verplicht',students:[student.id],benches:[],ruleId:'lokaal',crossRoom:true,message:`${student.name} heeft nog geen lokaal of zitplaats.`});
  }
  for(const rule of studentRulesFor(state)) {
    const members=rule.students.map(id=>people.get(id));
    if(members.some(p=>!p))continue;
    const rooms=members.map(p=>ownValue(state.studentRooms,p.id));
    const fixed=rule.type==='fixed'&&rule.roomId&&rooms[0]!==rule.roomId;
    const missingRoom=rooms.some(id=>!state.rooms.some(room=>room.id===id));
    const split=['together','near','area'].includes(rule.type)&&(missingRoom||new Set(rooms).size>1);
    if(!fixed&&!split)continue;
    const priority=fixed?'Verplicht':rule.priority;
    score[Math.max(0,PRIORITIES.indexOf(priority))]++;
    if(detailed)warnings.push({type:rule.type,priority,students:rule.students,benches:[],ruleId:rule.id,crossRoom:true,
      message:fixed?`${members[0].name}: de vaste-positieregel verwijst naar een ander of ontbrekend lokaal.`:`${members.map(p=>p.name).join(' en ')}: de regel wordt niet gevolgd omdat ${missingRoom?'minstens één leerling nog geen lokaal heeft':'zij in verschillende lokalen zitten'}.`});
  }
  return {score,warnings};
}

// Search memberships and seats together. The best candidate is retained even
// when a temporary worse move is used to escape a local minimum.
export function autoDistributeRooms(source,{attempts=4,iterations=4500,random=Math.random,onProgress=()=>{},preferredPositions={}}={}) {
  attempts=Math.max(1,Math.floor(attempts)||1);
  const base=clone(source);captureRoom(base);applyClassAssignments(base);
  const active=base.students.filter(p=>!p.absent),activeIds=new Set(active.map(p=>p.id)),rules=studentRulesFor(base);
  const pinnedRooms=new Map();
  for(const room of base.rooms)for(const id of room.locks)if(activeIds.has(id))pinnedRooms.set(id,room.id);
  // Auto always respects existing seat pins and enabled fixed positions.
  base.participatingRooms=[...new Set([...participatingRoomIds(base),...pinnedRooms.values(),...rules.filter(r=>r.type==='fixed'&&base.rooms.some(room=>room.id===r.roomId)).map(r=>r.roomId)])];
  const targets=participatingRoomIds(base);if(!targets.length)throw Error('Kies minstens één deelnemend lokaal.');
  const singleRoom=targets.length===1;
  if(singleRoom)attempts=1;
  const forced=new Map();
  for(const p of active) {
    const fixed=rules.find(r=>r.type==='fixed'&&r.students[0]===p.id&&targets.includes(r.roomId));
    const room=ownValue(base.studentRoomPins,p.id)||classRoomId(base,p.class)||pinnedRooms.get(p.id)||fixed?.roomId;
    if(room)forced.set(p.id,room);
  }
  let best=null,bestScore=null;
  const distributionScore=singleRoom?()=>[0]:distributionPreference(base,targets,forced);
  const distributionLength=distributionScore(base).length;
  const optimal=score=>score.slice(0,4+distributionLength).every(value=>Math.abs(value)<1e-8);
  const modes=[base.distribution.mode,...['balanced','classesSpread','yearsSpread','classesTogether','capacity'].filter(mode=>mode!==base.distribution.mode)];
  for(let attempt=0;attempt<attempts;attempt++) {
    const state=clone(base);
    if(singleRoom) {
      // There is no room choice, even when the room has too few seats.
      // Assign everyone first; only the ordinary seat planner needs to search.
      for(const p of active)setOwnValue(state.studentRooms,p.id,targets[0]);
      normalizeRooms(state);
    } else {
      state.students=shuffle(state.students,random);
      distributeRooms(state,modes[attempt%modes.length],{keepFixed:true});
    }
    // A fixed position belongs to its named room even when an unpinned pupil
    // previously had a different membership.
    for(const [id,room] of forced)setOwnValue(state.studentRooms,id,room);
    const views=targets.map(id=>roomState(state,id));
    for(const view of views) {
      view.settings={...view.settings,placementMode:'random'};
      const preferredSeats=Object.fromEntries(Object.entries(preferredPositions).filter(([,position])=>position.roomId===view.activeRoomId).map(([id,position])=>[id,position.seat]));
      view.assignments=generate(view,{random,iterations:singleRoom?iterations:250,preferredSeats}).assignments;
      state.rooms.find(r=>r.id===view.activeRoomId).assignments=view.assignments;
    }
    const positions=new Map(),slots=[],locked=new Set();
    for(const view of views) {
      const room=state.rooms.find(r=>r.id===view.activeRoomId);
      for(const seat of enabledSeats(view.settings))slots.push({view,seat});
      for(const [seat,id] of Object.entries(view.assignments)) {
        const place={view,seat};positions.set(id,place);
        if(room.locks.includes(id)||rules.some(r=>r.type==='fixed'&&r.students[0]===id&&r.roomId===room.id&&r.seat===seat))locked.add(id);
      }
    }
    const movable=active.filter(p=>!locked.has(p.id));
    const score=()=>{
      const totals=evaluateCrossRoomRules(state,false).score;
      let sharing=0;
      for(const view of views){const result=evaluate(view,view.assignments,false);for(let i=0;i<3;i++)totals[i]+=result.score[i];sharing+=result.score[3];}
      const changed=active.filter(p=>ownValue(preferredPositions,p.id)&&positions.has(p.id)&&(positions.get(p.id).view.activeRoomId!==ownValue(preferredPositions,p.id).roomId||positions.get(p.id).seat!==ownValue(preferredPositions,p.id).seat)).length;
      return [active.length-positions.size,...totals,...distributionScore(state),changed,sharing];
    };
    const remember=candidateScore=>{
      if(bestScore&&compare(candidateScore,bestScore)>=0)return;
      state.assignments=state.rooms.find(r=>r.id===state.activeRoomId).assignments;
      best=clone(state);bestScore=[...candidateScore];
    };
    let current=score();remember(current);
    for(let step=0;!singleRoom&&step<iterations&&movable.length&&slots.length;step++) {
      if(optimal(bestScore))break;
      const id=movable[Math.floor(random()*movable.length)].id,target=slots[Math.floor(random()*slots.length)],from=positions.get(id),other=target.view.assignments[target.seat];
      const destination=target.view.activeRoomId;
      if(other===id||locked.has(other)||forced.has(id)&&forced.get(id)!==destination||other&&forced.has(other)&&forced.get(other)!==from?.view.activeRoomId)continue;
      const oldRoom=ownValue(state.studentRooms,id),otherRoom=other?ownValue(state.studentRooms,other):null;
      if(from){if(other)from.view.assignments[from.seat]=other;else delete from.view.assignments[from.seat];}
      target.view.assignments[target.seat]=id;setOwnValue(state.studentRooms,id,destination);positions.set(id,target);
      if(other){setOwnValue(state.studentRooms,other,from?.view.activeRoomId??null);if(from)positions.set(other,from);else positions.delete(other);}
      const candidate=score(),difference=candidate.findIndex((value,i)=>Math.abs(value-current[i])>1e-8);
      const temperature=.4*(1-step/Math.max(1,iterations))+.015;
      const accept=compare(candidate,current)<=0||difference>0&&random()<Math.exp(-(candidate[difference]-current[difference])/temperature);
      if(accept){current=candidate;remember(candidate);}
      else {
        if(from)from.view.assignments[from.seat]=id;
        if(other)target.view.assignments[target.seat]=other;else delete target.view.assignments[target.seat];
        setOwnValue(state.studentRooms,id,oldRoom);if(from)positions.set(id,from);else positions.delete(id);
        if(other){setOwnValue(state.studentRooms,other,otherRoom);positions.set(other,target);}
      }
    }
    if(!singleRoom)onProgress(attempt+1,attempts);
    if(optimal(bestScore))break;
  }
  best.students=clone(source.students);
  const activeRoom=best.rooms.find(r=>r.id===best.activeRoomId);
  best.assignments=activeRoom.assignments;best.locks=activeRoom.locks;best.hiddenWarnings=activeRoom.hiddenWarnings;
  normalizeRooms(best);best.distribution={...base.distribution,keepFixed:true,reviewed:true};
  const warnings=targets.flatMap(id=>evaluate(roomState(best,id)).warnings.map(w=>({...w,roomId:id}))).concat(evaluateCrossRoomRules(best).warnings);
  const seated=new Set(targets.flatMap(id=>Object.values(roomState(best,id).assignments)));
  const unplaced=active.filter(p=>!seated.has(p.id)).map(p=>p.id);
  return {state:best,score:bestScore,unplaced,warnings,complete:!unplaced.length&&!warnings.length};
}
