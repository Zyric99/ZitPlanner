import { captureRoom, initializeRooms, newRoom } from './rooms.mjs';
import { defaults } from './engine.mjs';
import { leaveWeeklyDay } from './weekly-planner.mjs';
import { packGridRoom, unpackGridRoom } from './grid-room.mjs';

const stringify=value=>JSON.stringify(value,(_key,item)=>packGridRoom(item));
const parse=json=>JSON.parse(json,(_key,item)=>unpackGridRoom(item));
const packed=value=>JSON.parse(stringify(value));
export function blankProjectState(name='Nieuw project') {
  const state=initializeRooms(defaults()),room=newRoom(state,'Lokaal 1','empty');
  state.name=name;state.rooms=[room];state.activeRoomId=room.id;state.participatingRooms=[room.id];
  state.settings={...state.settings,...structuredClone(room.settings),layout:structuredClone(room.layout)};
  state.settings.classRules={default:{type:'none',priority:'Verplicht'},overrides:{}};
  state.settings.yearRules=[];state.settings.classRulesEnabled=false;state.settings.yearRulesEnabled=false;
  state.students=[];state.rules=[];state.assignments={};state.locks=[];state.benchLocks=[];state.hiddenWarnings=[];
  state.studentRooms={};state.studentRoomPins={};state.classRooms={};state.roomTemplates=[];
  state.distribution={mode:'balanced',keepFixed:true,reviewed:false};state.planId=null;
  delete state.weeklyPlans;return state;
}
export function emptyProjectState(source,name='Nieuw project') {
  const state=structuredClone(source);
  if(state.weeklyPlans)leaveWeeklyDay(state);
  captureRoom(state);
  state.name=name;state.planId=null;state.students=[];state.rules=[];
  state.assignments={};state.locks=[];state.benchLocks=[];state.hiddenWarnings=[];
  state.studentRooms={};state.classRooms={};state.studentRoomPins={};state.distribution.reviewed=false;
  delete state.weeklyPlans;
  for(const room of state.rooms){room.assignments={};room.locks=[];room.hiddenWarnings=[];}
  state.modified=new Date().toISOString();return state;
}
export async function createProjectSession(api,storage,key,onStatus=()=>{}) {
  if(!api)return null;
  const boot=await api.startup(),values=new Map();
  let document=boot.document?parse(JSON.stringify(boot.document)):null;
  let template=boot.template?parse(JSON.stringify(boot.template)):null;
  let starter=boot.starter??{mode:'rooms',available:false};
  let file=boot.file,pending=Promise.resolve(),sequence=0;
  const rawLegacy=Object.fromEntries([key,`${key}-plans`,`${key}-lists`].map(k=>[k,storage.getItem(k)]));
  function select(next){document=next;values.set(key,next.state);values.set(`${key}-plans`,next.plans);values.set(`${key}-lists`,next.lists);}
  if(document)select(document);
  const session={
    get file(){return file;},get directory(){return boot.directory;},get id(){return document?.id;},get hasProject(){return !!document;},get standard(){return boot.standard?structuredClone(boot.standard):null;},
    read(k,fallback){if(values.has(k))return values.get(k);try{return parse(rawLegacy[k])??fallback;}catch{return fallback;}},
    async initialize(state,plans,lists){
      if(document)return;
      template=emptyProjectState(state);
      const result=await api.bootstrap({state:packed(state),plans:packed(plans),lists:packed(lists),template:packed(template),legacy:rawLegacy});
      select(parse(JSON.stringify(result.document)));file=result.file;boot.standard=result.standard??boot.standard;
    },
    save(k,value){
      values.set(k,value);
      if(!document)throw Error('Projectopslag is nog niet klaar.');
      document.state=values.get(key);document.plans=values.get(`${key}-plans`);document.lists=values.get(`${key}-lists`);
      const payload=packed(document),bytes=new TextEncoder().encode(JSON.stringify(payload,null,2)).length,serial=++sequence;
      onStatus({status:'Bezig met opslaan…',file,bytes,time:new Date().toISOString(),pending:true});
      pending=pending.catch(()=>{}).then(()=>api.save(payload)).then(result=>{
        if(serial===sequence)onStatus({status:'Automatisch opgeslagen',file:result.file,bytes:result.bytes??bytes,time:result.modified,pending:false});
      },error=>{onStatus({status:`Bewaren mislukt (${error.message})`,file,bytes,time:new Date().toISOString(),error,pending:false});throw error;});
      pending.catch(()=>{});return pending;
    },
    flush(){return pending;},list(){return api.list();},
    async open(id,valid){
      await pending;
      const next=parse(JSON.stringify(await api.load(id)));
      if(!valid(next.state))throw Error('Dit project bevat ongeldige gegevens.');
      const result=await api.activate(id);select(next);file=result.file;return next;
    },
    async create(name,{copy=false,valid}={}){
      await pending;
      if(boot.workspaceVersion===3){const result=copy?await api.duplicate({id:document.id}):await api.createEmpty({name});const next=parse(JSON.stringify(result.document));if(valid&&!valid(next.state))throw Error('Dit project bevat ongeldige gegevens.');select(next);file=result.file;return next;}
      if(!copy&&api.starterInfo)starter=await api.starterInfo();
      if(!copy&&starter.error)throw Error(starter.error);
      if(!copy&&starter.mode==='project') {
        const result=await api.createFromStarter({name}),next=parse(JSON.stringify(result.document));
        select(next);file=result.file;return document;
      }
      const state=copy?structuredClone(values.get(key)):emptyProjectState(template??values.get(key),name);
      state.name=name;state.planId=null;
      if(valid&&!valid(state))throw Error('De standaardopstelling bevat ongeldige gegevens.');
      const result=await api.create({state:packed(state),lists:packed(values.get(`${key}-lists`))});
      select(parse(JSON.stringify(result.document)));file=result.file;return document;
    },
    getDefaultLayout(){return template?structuredClone(template):null;},
    async duplicate(id){await pending;const result=await api.duplicate({id});const next=parse(JSON.stringify(result.document));select(next);file=result.file;return next;},
    async rename(id,name){await pending;const result=await api.rename({id,name});if(id===document.id){select(parse(JSON.stringify(result.document)));file=result.file;}return parse(JSON.stringify(result.document));},
    async resetPreview(){await pending;return api.resetPreview({id:document.id});},
    async reset({backup=true}={}){await pending;const result=await api.reset({id:document.id,backup});const next=parse(JSON.stringify(result.document));select(next);file=result.file;return {...result,document:next};},
    async remove(id){await pending;const result=await api.delete({id});const next=parse(JSON.stringify(result.document));select(next);file=result.file;return {...result,document:next};},
    get starter(){return structuredClone(starter);},
    async chooseStarter(controls){await pending;return controls.choose();},
    async prepareStarterFromProject(controls,payload){await pending;return controls.fromProject(payload);},
    async starterSource(id){await pending;return parse(JSON.stringify(await api.load(id)));},
    async confirmStarter(controls,token){await pending;const next=await controls.confirm(token);starter=next;return next;},
    async setStarterMode(controls,mode){await pending;const next=await controls.setMode(mode);starter=next;return next;},
    async resetToDefaults(reset){await pending;const result=await reset(),next=parse(JSON.stringify(result.document));select(next);file=result.file;return {...result,document:next};},
    get hasDefaultLayout(){return Array.isArray(template?.rooms)&&template.rooms.length>0;},
    async setDefaultLayout(state){await pending;const next=emptyProjectState(state);await api.setTemplate(packed(next));template=next;},
  };
  return session;
}
