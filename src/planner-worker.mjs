import { generate } from './engine.mjs';
import { roomState, applyClassAssignments, participatingRoomIds } from './rooms.mjs';
import { generateWeek } from './weekly-planner.mjs';
import { autoDistributeRooms } from './auto-distribution.mjs';
self.onmessage = ({data}) => {
  if(data.autoDistribution){try{self.postMessage({autoDistribution:autoDistributeRooms(data.state,{onProgress:(progress,total)=>self.postMessage({progress,total})})});}catch(error){self.postMessage({error:error.message});}return;}
  if(data.weekly){try{const weeklyPlans=generateWeek(data.state,{keepSeats:data.keepSeats,onProgress:(progress,total)=>self.postMessage({progress,total})});self.postMessage({weeklyPlans});}catch(error){self.postMessage({error:error.message});}return;}
  if(data.rooms) {
    applyClassAssignments(data.state);const ids=participatingRoomIds(data.state);
    const results=[];
    for(const id of ids){results.push({roomId:id,...generate(roomState(data.state,id))});self.postMessage({progress:results.length,total:ids.length});}
    self.postMessage({rooms:results});return;
  }
  const alternatives = [];
  for (let i=0;i<data.count;i++) { alternatives.push(generate(data.state)); self.postMessage({ progress:i+1,total:data.count }); }
  self.postMessage({ alternatives });
};
