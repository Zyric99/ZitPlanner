// A student's room pin and seat pin are both the same mandatory location rule.
export const locationRule = (state,id) => state.rules.find(r=>r.type==='fixed'&&r.students[0]===id);
export const locationRoomId = (state,id) => state.settings.studentRulesEnabled===false?null:locationRule(state,id)?.roomId;

export function setLocationRule(state,rule) {
  const index=state.rules.findIndex(r=>r.id===rule.id||r.type==='fixed'&&r.students[0]===rule.students[0]);
  state.rules=state.rules.filter(r=>r.id!==rule.id&&!(r.type==='fixed'&&r.students[0]===rule.students[0]));
  state.rules.splice(index<0?state.rules.length:Math.min(index,state.rules.length),0,rule);
  delete state.studentRoomPins?.[rule.students[0]];
  state.locks=state.locks.filter(id=>id!==rule.students[0]);
  for(const room of state.rooms??[])room.locks=room.locks.filter(id=>id!==rule.students[0]);
}

// Run at a persistence boundary, never while the planner uses temporary locks.
export function migrateLocationPins(state) {
  const rooms=state.rooms??[{id:'standaardlokaal',assignments:state.assignments,locks:state.locks}];
  const candidates=new Map();
  for(const [id,roomId] of Object.entries(state.studentRoomPins??{}))candidates.set(id,{roomId});
  for(const room of rooms) {
    const active=!state.rooms||room.id===state.activeRoomId;
    const assignments=active?state.assignments:room.assignments,locks=active?state.locks:room.locks;
    for(const id of locks??[]) {
      const seat=Object.keys(assignments).find(seat=>assignments[seat]===id);
      if(seat)candidates.set(id,{roomId:room.id,seat});
    }
  }
  for(const [id,position] of candidates)if(state.students.some(p=>p.id===id)) {
    const old=locationRule(state,id);
    // Pins previously took precedence over conflicting fixed-position rules.
    let ruleId=old?.id??`legacy-location:${id}`;
    while(!old&&state.rules.some(r=>r.id===ruleId))ruleId+=':pin';
    const rule={...old,id:ruleId,type:'fixed',students:[id],priority:'Verplicht',...position};
    // A room-only legacy pin can override a fixed rule in another room. That
    // old room's chair must not silently become a fixed chair in the new room.
    if(position.seat===undefined&&old?.roomId!==position.roomId)delete rule.seat;
    if(old?.seat!==rule.seat)delete rule.positionCode;
    setLocationRule(state,rule);
  }
  state.studentRoomPins={};state.locks=[];
  for(const room of state.rooms??[])room.locks=[];
  return state;
}
