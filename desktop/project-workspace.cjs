const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ProjectStore}=require('./project-store.cjs');
const STANDARD_NAME='Standaard project';
const BACKUP_RETENTION_DAYS=30;

// The old store remains the migration reader and supplies ordered, atomic writes.
// Live workspaces contain ordinary project documents plus one workspace manifest.
class ProjectWorkspace extends ProjectStore {
  file(id){if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw Error('Ongeldig project-ID.');return super.file(id);}
  async normalize(input){
    const {normalizeStarterProject,packStarterProject}=await import('../src/starter-project.mjs');
    return packStarterProject(normalizeStarterProject({...input,version:2}));
  }
  name(value){if(typeof value!=='string'||!value.trim()||value.trim().length>120)throw Error('Geef je project een naam van maximaal 120 tekens.');return value.trim();}
  async manifest(){const m=await this.read(path.join(this.directory,'workspace.json'));if(m?.version!==3)throw Error('Open de app opnieuw om de projectopslag te initialiseren.');this.file(m.standardProjectId);this.file(m.activeProjectId);return m;}
  async readDocument(id){const d=this.check(await this.read(this.file(id)));if(d.id!==id)throw Error('Het project-ID komt niet overeen met het bestand.');await this.normalize(d);return d;}
  baselineFile(){return path.join(this.directory,'backups','standaard-project.json');}
  cleanupBackups(now=Date.now()){return this.run(async()=>{
    const directory=path.resolve(this.directory,'backups');this.inside(directory);
    let entries;
    try{if((await fs.lstat(directory)).isSymbolicLink())return;entries=await fs.readdir(directory,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    const cutoff=now-BACKUP_RETENTION_DAYS*24*60*60*1000;
    for(const entry of entries){
      if(!entry.isDirectory()||entry.isSymbolicLink())continue;
      const match=/^(?:reset|verwijderd|migratie)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.exec(entry.name);
      if(!match)continue;
      const created=Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
      if(!Number.isFinite(created)||created>=cutoff)continue;
      const target=path.resolve(directory,entry.name);this.inside(target);
      if(path.dirname(target)!==directory)throw Error('Ongeldig backuppad.');
      await fs.rm(target,{recursive:true,force:true});
    }
  });}
  async backup(kind,files){
    const directory=path.resolve(this.directory,'backups',`${kind}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}`);
    this.inside(directory);await fs.mkdir(directory,{recursive:true});
    for(const name of files){const source=path.resolve(this.directory,name);this.inside(source);try{await fs.cp(source,path.join(directory,name),{recursive:true,errorOnExist:true});}catch(error){if(error.code!=='ENOENT')throw error;}}
    return directory;
  }
  inside(target){if(!path.resolve(target).startsWith(this.directory+path.sep))throw Error('Opslagpad valt buiten de projectmap.');}
  async listing(){const projects=await super.listing();const m=await this.read(path.join(this.directory,'workspace.json'));return projects.map(p=>({...p,standard:p.id===m?.standardProjectId})).sort((a,b)=>Number(b.standard)-Number(a.standard)||(b.modified??'').localeCompare(a.modified??''));}
  async migrate(manifest){
    const projects=await super.listing();
    const activeId=manifest?.activeProjectId??projects.find(p=>!p.error)?.id;
    const active=activeId?await this.readDocument(activeId):null;
    const configured=await super.configuredStarter();
    let source;
    if(configured.settings.mode==='project'){
      if(!configured.document)throw Error(configured.error??'Het bewaarde startproject ontbreekt.');
      source=configured.document;
    }else {
      const template=await this.read(path.join(this.directory,'default-layout.json'));
      if(template)source={state:template,plans:[],lists:[]};
      else if(active)source=active;
      else {const {factoryDefaultSet}=await import('../src/default-set.mjs');source={state:factoryDefaultSet(),plans:[],lists:[]};}
    }
    const normalized=await this.normalize(source);normalized.state.name=STANDARD_NAME;normalized.state.planId=null;
    const now=new Date().toISOString(),standard=this.check({...normalized,version:2,id:randomUUID(),created:now,modified:now});
    const entries=await fs.readdir(this.directory),files=entries.filter(n=>n.endsWith('.json')||n.endsWith('.json.bak')||n==='starters');
    const backupDirectory=await this.backup('migratie',files),retired=path.join(backupDirectory,'oude-opslag');await fs.mkdir(retired);
    const moved=[];
    try {
      await this.atomic(this.file(standard.id),standard);await this.atomic(this.baselineFile(),standard);
      for(const name of ['default-layout.json','default-layout.json.bak','starter-settings.json','starter-settings.json.bak','legacy-backup.json','legacy-backup.json.bak','starters']){
        const source=path.join(this.directory,name),target=path.join(retired,name);this.inside(source);this.inside(target);
        try{await fs.rename(source,target);moved.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}
      }
      await this.atomic(path.join(this.directory,'workspace.json'),{version:3,standardProjectId:standard.id,activeProjectId:active?.id??standard.id,migrationBackup:backupDirectory});
    }catch(error){for(const name of moved.reverse())await fs.rename(path.join(retired,name),path.join(this.directory,name));await fs.rm(this.file(standard.id),{force:true});throw error;}
    return this.manifest();
  }
  startup(){return this.run(async()=>{
    let m=await this.read(path.join(this.directory,'workspace.json'));
    if(m?.version!==3){
      let entries;try{entries=await fs.readdir(this.directory);}catch(error){if(error.code!=='ENOENT')throw error;entries=[];}
      if(entries.some(n=>n.endsWith('.json')))m=await this.migrate(m);
      else return {document:null,directory:this.directory,file:null,workspaceVersion:3};
    }
    const standard=await this.readDocument(m.standardProjectId),document=await this.readDocument(m.activeProjectId);
    return {document,directory:this.directory,file:this.file(document.id),standard:{id:standard.id,name:standard.state.name,students:standard.state.students.length,rooms:standard.state.rooms.length,file:this.file(standard.id)},workspaceVersion:3};
  });}
  bootstrap({state,plans=[],lists=[],legacy}){return this.run(async()=>{
    if(await this.read(path.join(this.directory,'workspace.json')))throw Error('Er bestaat al een projectwerkruimte. Open de app opnieuw.');
    const payload=await this.normalize({state,plans,lists});payload.state.name=STANDARD_NAME;payload.state.planId=null;
    const now=new Date().toISOString(),document=this.check({...payload,version:2,id:randomUUID(),created:now,modified:now});
    if(legacy)await this.atomic(path.join(this.directory,'backups','legacy-localStorage.json'),legacy);
    await this.atomic(this.file(document.id),document);await this.atomic(this.baselineFile(),document);
    // Named legacy snapshots remain available as separate independent projects.
    for(const plan of payload.plans){const id=randomUUID();await this.atomic(this.file(id),{...document,id,state:plan.state,plans:[]});}
    await this.atomic(path.join(this.directory,'workspace.json'),{version:3,activeProjectId:document.id,standardProjectId:document.id});
    return {document,directory:this.directory,file:this.file(document.id),standard:{id:document.id,name:STANDARD_NAME,rooms:state.rooms.length,students:state.students.length}};
  });}
  save(document){return this.run(async()=>{
    this.check(document);await this.normalize(document);await this.readDocument(document.id);
    const m=await this.manifest();if(document.id===m.standardProjectId&&document.state.name!==STANDARD_NAME)throw Error('Het standaardproject behoudt zijn naam.');
    document.modified=new Date().toISOString();await this.atomic(this.file(document.id),document);
    return {file:this.file(document.id),modified:document.modified,bytes:Buffer.byteLength(JSON.stringify(document,null,2),'utf8')};
  });}
  load(id){return this.run(()=>this.readDocument(id));}
  async setActive(id){await this.readDocument(id);const m=await this.manifest();await this.atomic(path.join(this.directory,'workspace.json'),{...m,activeProjectId:id});return {file:this.file(id)};}
  activate(id){return this.run(()=>this.setActive(id));}
  async createDocument(payload){
    const normalized=await this.normalize(payload);normalized.state.name=this.name(normalized.state.name);normalized.state.planId=null;
    const now=new Date().toISOString(),document=this.check({...normalized,version:2,id:randomUUID(),created:now,modified:now});
    await this.atomic(this.file(document.id),document);
    try{await this.setActive(document.id);}catch(error){await fs.rm(this.file(document.id),{force:true});throw error;}
    return {document,file:this.file(document.id)};
  }
  create(payload){return this.run(()=>this.createDocument(payload));}
  createEmpty({name}){return this.run(async()=>{
    const {blankProjectState}=await import('../src/project-session.mjs');
    return this.createDocument({state:blankProjectState(this.name(name)),plans:[],lists:[]});
  });}
  duplicate({id}){return this.run(async()=>{
    const source=await this.readDocument(id),base=source.state.name.replace(/ - kopie(?: \d+)?$/i,''),names=new Set((await this.listing()).map(p=>p.name.toLocaleLowerCase('nl')));
    let number=1,name;do{name=`${base.slice(0,100)} - kopie${number>1?' '+number:''}`;number++;}while(names.has(name.toLocaleLowerCase('nl')));
    const copy=structuredClone(source);copy.state.name=name;return this.createDocument(copy);
  });}
  rename({id,name}){return this.run(async()=>{
    const m=await this.manifest();if(id===m.standardProjectId)throw Error('Het standaardproject behoudt zijn naam.');
    const document=await this.readDocument(id);document.state.name=this.name(name);document.modified=new Date().toISOString();await this.atomic(this.file(id),document);return {document,file:this.file(id)};
  });}
  async resetSource(id){const m=await this.manifest();return id===m.standardProjectId?this.check(await this.read(this.baselineFile())):this.readDocument(m.standardProjectId);}
  resetPreview({id}){return this.run(async()=>{const target=await this.readDocument(id),source=await this.resetSource(id);await this.normalize(source);return {name:target.state.name,sourceName:source.state.name,rooms:source.state.rooms.length,students:source.state.students.length,rules:source.state.rules.length,lists:source.lists.length,plans:source.plans.length,backupDirectory:path.join(this.directory,'backups')};});}
  reset({id,backup=true}){return this.run(async()=>{
    if(typeof backup!=='boolean')throw Error('Ongeldige backupkeuze.');
    const old=await this.readDocument(id),source=await this.resetSource(id),normalized=await this.normalize(source),backupDirectory=backup?await this.backup('reset',[`${id}.json`,`${id}.json.bak`,'workspace.json']):null;
    const document={...old,...normalized,id,version:2,created:old.created,modified:new Date().toISOString()};document.state.name=old.state.name;document.state.planId=null;
    const manifest=await this.manifest();
    try{await this.atomic(this.file(id),document,{backup});await this.setActive(id);}catch(error){await this.atomic(this.file(id),old,{backup:false});await this.atomic(path.join(this.directory,'workspace.json'),manifest);throw error;}
    return {document,file:this.file(id),backupDirectory};
  });}
  delete({id}){return this.run(async()=>{
    const manifest=await this.manifest();if(id===manifest.standardProjectId)throw Error('Het standaardproject kan niet worden verwijderd.');
    const old=await this.readDocument(id),backupDirectory=await this.backup('verwijderd',[`${id}.json`,`${id}.json.bak`,'workspace.json']);
    const moved=[];
    try{
      if(id===manifest.activeProjectId)await this.setActive(manifest.standardProjectId);
      for(const name of [`${id}.json`,`${id}.json.bak`]){const source=path.join(this.directory,name),target=path.join(backupDirectory,`verwijderd-${name}`);this.inside(source);this.inside(target);try{await fs.rename(source,target);moved.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }catch(error){for(const name of moved.reverse())await fs.rename(path.join(backupDirectory,`verwijderd-${name}`),path.join(this.directory,name));await this.atomic(path.join(this.directory,'workspace.json'),manifest);throw error;}
    const activeId=id===manifest.activeProjectId?manifest.standardProjectId:manifest.activeProjectId;
    return {deletedId:old.id,document:await this.readDocument(activeId),file:this.file(activeId),backupDirectory};
  });}
  async diagnostics(){
    const m=await this.read(path.join(this.directory,'workspace.json'));let standard=null;
    if(m?.version===3){const d=await this.readDocument(m.standardProjectId);standard={id:d.id,name:d.state.name,file:this.file(d.id),rooms:d.state.rooms.length,students:d.state.students.length};}
    return {projectDirectory:this.directory,workspaceVersion:3,standard,backupDirectory:path.join(this.directory,'backups'),migrationBackup:m?.migrationBackup??null};
  }
}
module.exports={ProjectWorkspace,STANDARD_NAME};
