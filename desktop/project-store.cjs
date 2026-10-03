const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Only the main process chooses paths. Renderer requests use opaque project IDs.
class ProjectStore {
  constructor(directory) { this.directory=path.resolve(directory);this.queue=Promise.resolve(); }
  async diagnostics() {
    // Fixed, main-process paths only; inspecting metadata never writes or migrates data.
    const inspect=async(name,describe)=>{
      const file=path.join(this.directory,name);
      try { return {file,exists:true,...describe(JSON.parse(await fs.readFile(file,'utf8')))}; }
      catch(error) { return {file,exists:error.code!=='ENOENT',available:false,...(error.code!=='ENOENT'?{error:error.message}:{})}; }
    };
    const [defaultLayout,legacyBackup]=await Promise.all([
      inspect('default-layout.json',value=>({available:Array.isArray(value?.rooms)&&value.rooms.length>0,rooms:value?.rooms?.length??0})),
      inspect('legacy-backup.json',value=>{
        const hasSave=['klaslokaal-v1','klaslokaal-v1-plans','klaslokaal-v1-lists'].some(key=>typeof value?.[key]==='string');
        let rooms=null;
        try { const state=JSON.parse(value?.['klaslokaal-v1']);if(Array.isArray(state?.rooms))rooms=state.rooms.length; } catch {}
        return {available:true,hasSave,rooms};
      }),
    ]);
    return {projectDirectory:this.directory,defaultLayout,legacyBackup,starter:await this.starterInfo()};
  }
  run(task) { const result=this.queue.then(task,task);this.queue=result.catch(()=>{});return result; }
  file(id) { if(typeof id!=='string'||!/^\w[\w-]{0,100}$/.test(id))throw Error('Ongeldig project-ID.');return path.join(this.directory,`${id}.json`); }
  async read(file) {
    try { return JSON.parse(await fs.readFile(file,'utf8')); }
    catch(error) {
      if(error.code==='ENOENT')return null;
      // Recover only parse failures. Permission errors must remain visible.
      if(!(error instanceof SyntaxError))throw error;
      try { return JSON.parse(await fs.readFile(`${file}.bak`,'utf8')); }
      catch { throw Error(`Projectbestand beschadigd: ${path.basename(file)}. Het bestand is niet overschreven.`); }
    }
  }
  async atomic(file,value,{backup=true}={}) {
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temporary=`${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary,JSON.stringify(value,null,2),'utf8');
      // Retain the last readable version; never replace a good backup with corrupt JSON.
      try { if(backup){JSON.parse(await fs.readFile(file,'utf8'));await fs.copyFile(file,`${file}.bak`);} }
      catch(error) { if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error; }
      await fs.rename(temporary,file);
    } finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
  }
  check(document) {
    if(!document||document.version!==2||!document.state||typeof document.state.name!=='string'||!Array.isArray(document.state.students)||!Array.isArray(document.state.rooms)||!Array.isArray(document.plans)||!Array.isArray(document.lists))throw Error('Ongeldig projectbestand.');
    this.file(document.id);return document;
  }
  async listing() {
    let files;try {files=await fs.readdir(this.directory);}catch(error){if(error.code==='ENOENT')return [];throw error;}
    const projects=[];
    for(const file of files.filter(name=>/^[\w-]+\.json$/.test(name)&&!['workspace.json','default-layout.json','legacy-backup.json','starter-settings.json'].includes(name))) {
      try { const document=this.check(await this.read(path.join(this.directory,file)));if(file!==`${document.id}.json`)continue;projects.push({id:document.id,name:document.state.name,modified:document.modified,students:document.state.students.length,rooms:document.state.rooms.length}); }
      catch {projects.push({id:file.slice(0,-5),name:file,error:'Dit project kan niet worden gelezen.'});}
    }
    return projects.sort((a,b)=>(b.modified??'').localeCompare(a.modified??''));
  }
  startup() { return this.run(async()=>{
    const manifest=await this.read(path.join(this.directory,'workspace.json'));
    let id=manifest?.activeProjectId;
    if(!id){const projects=await this.listing();if(projects.length){id=projects.find(p=>!p.error)?.id;if(!id)throw Error('De projectmap bevat alleen onleesbare projecten.');}}
    const document=id?this.check(await this.read(this.file(id))):null;
    const template=await this.read(path.join(this.directory,'default-layout.json'));
    return {document,template,starter:await this.starterInfo(),directory:this.directory,file:id?this.file(id):null};
  }); }
  bootstrap({state,plans,lists,template,legacy}) { return this.run(async()=>{
    if(await this.read(path.join(this.directory,'workspace.json')))throw Error('Er bestaat al een projectwerkruimte. Open de app opnieuw.');
    if(legacy)await this.atomic(path.join(this.directory,'legacy-backup.json'),legacy);
    await this.atomic(path.join(this.directory,'default-layout.json'),template);
    const document={version:2,id:randomUUID(),created:new Date().toISOString(),modified:new Date().toISOString(),state,plans,lists};
    await this.atomic(this.file(document.id),document);
    for(const plan of plans) {
      const saved={...document,id:randomUUID(),created:plan.created??document.created,state:plan.state,plans:[]};
      await this.atomic(this.file(saved.id),saved);
    }
    await this.atomic(path.join(this.directory,'workspace.json'),{version:2,activeProjectId:document.id});
    return {document,template,directory:this.directory,file:this.file(document.id)};
  }); }
  save(document) { return this.run(async()=>{
    this.check(document);
    if(!await this.read(this.file(document.id)))throw Error('Het project bestaat niet meer.');
    document.modified=new Date().toISOString();await this.atomic(this.file(document.id),document);
    return {file:this.file(document.id),modified:document.modified,bytes:Buffer.byteLength(JSON.stringify(document,null,2),'utf8')};
  }); }
  list() {return this.run(()=>this.listing());}
  load(id) {return this.run(async()=>this.check(await this.read(this.file(id))));}
  activate(id) {return this.run(async()=>{this.check(await this.read(this.file(id)));await this.atomic(path.join(this.directory,'workspace.json'),{version:2,activeProjectId:id});return {file:this.file(id)};});}
  async createDocument({state,lists=[],plans=[]}) {
    const now=new Date().toISOString(),document=this.check({version:2,id:randomUUID(),created:now,modified:now,state,lists,plans});
    await this.atomic(this.file(document.id),document);
    await this.atomic(path.join(this.directory,'workspace.json'),{version:2,activeProjectId:document.id});
    return {document,file:this.file(document.id)};
  }
  create(payload) {return this.run(()=>this.createDocument(payload));}
  starterFile(id) {
    if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw Error('Ongeldig startproject-ID.');
    return path.join(this.directory,'starters',`${id}.json`);
  }
  async configuredStarter() {
    const settings=await this.read(path.join(this.directory,'starter-settings.json'))??{version:1,mode:'rooms'};
    if(settings.version!==1||!['rooms','project'].includes(settings.mode)||settings.mode==='project'&&!settings.starterId)throw Error('Ongeldige startpuntinstellingen.');
    if(!settings.starterId)return {settings,document:null,file:null};
    const file=this.starterFile(settings.starterId);
    try {
      const input=await this.read(file);if(!input)throw Error('Het bewaarde startproject ontbreekt.');
      const {normalizeStarterProject}=await import('../src/starter-project.mjs');
      return {settings,file,document:normalizeStarterProject(input)};
    }catch(error){return {settings,file,document:null,error:error.message};}
  }
  async starterInfo() {
    const configFile=path.join(this.directory,'starter-settings.json');
    try {
      const {settings,file,document,error}=await this.configuredStarter();
      const {starterPreview}=await import('../src/starter-project.mjs');
      return {mode:settings.mode,available:!!document,file,configFile,sourceName:settings.sourceName??null,configuredAt:settings.configuredAt??null,
        ...(document?starterPreview(document):{}),...(error?{projectError:error,...(settings.mode==='project'?{error}:{})}:{})};
    }catch(error){return {mode:'unknown',available:false,configFile,error:error.message};}
  }
  installStarter(document,sourceName) {return this.run(async()=>{
    const {normalizeStarterProject,packStarterProject}=await import('../src/starter-project.mjs');
    const starter=packStarterProject(normalizeStarterProject(document)),id=randomUUID(),file=this.starterFile(id);
    // Install immutable content first, then atomically select it. Failed selection
    // leaves the previous starter and its configuration untouched.
    await this.atomic(file,starter);
    try {await this.atomic(path.join(this.directory,'starter-settings.json'),{version:1,mode:'project',starterId:id,sourceName:path.basename(sourceName),configuredAt:new Date().toISOString()});}
    catch(error){await fs.rm(file,{force:true}).catch(()=>{});throw error;}
    return this.starterInfo();
  });}
  prepareStarterFromProject({projectId,roomIds}) {return this.run(async()=>{
    const source=this.check(await this.read(this.file(projectId)));
    const {selectStarterRooms}=await import('../src/starter-project.mjs');
    return {...selectStarterRooms(source,roomIds),sourceName:source.state.name};
  });}
  setStarterMode(mode) {return this.run(async()=>{
    if(!['rooms','project'].includes(mode))throw Error('Ongeldig startpunt.');
    let configured;
    try{configured=await this.configuredStarter();}catch(error){if(mode!=='rooms')throw error;configured={settings:{version:1}};}
    if(mode==='project'&&!configured.document)throw Error(configured.error??'Kies eerst een startproject.');
    await this.atomic(path.join(this.directory,'starter-settings.json'),{...configured.settings,version:1,mode});
    return this.starterInfo();
  });}
  async starterPayload(name) {
    if(typeof name!=='string'||!name.trim()||name.length>120)throw Error('Geef je project een naam.');
    const {settings,document,error}=await this.configuredStarter();
    if(settings.mode!=='project'||!document)throw Error(error??'Er is geen actief startproject.');
    const copy=structuredClone(document);copy.state.name=name.trim();copy.state.planId=null;copy.state.modified=new Date().toISOString();
    const {packStarterProject}=await import('../src/starter-project.mjs');
    return packStarterProject(copy);
  }
  createFromStarter({name}) {return this.run(async()=>this.createDocument(await this.starterPayload(name)));}
  resetToDefaults() {return this.run(async()=>{
    const info=await this.starterInfo();if(info.error)throw Error(info.error);
    let payload;
    if(info.mode==='project')payload=await this.starterPayload(info.name);
    else {
      const template=await this.read(path.join(this.directory,'default-layout.json'));
      const {emptyProjectState}=await import('../src/project-session.mjs');
      const {normalizeStarterProject,packStarterProject}=await import('../src/starter-project.mjs');
      if(!template)throw Error('Er is geen standaardset beschikbaar.');
      const source=normalizeStarterProject({version:1,state:template,plans:[],lists:[]});
      payload=packStarterProject({...source,state:emptyProjectState(source.state)});
    }
    const now=new Date().toISOString(),document=this.check({...payload,version:2,id:randomUUID(),created:now,modified:now});
    const backupDirectory=path.join(this.directory,'backups',`reset-${now.replace(/[:.]/g,'-')}-${randomUUID()}`);
    const preserved=new Set(['default-layout.json','legacy-backup.json','starter-settings.json']);
    const files=(await fs.readdir(this.directory,{withFileTypes:true})).filter(entry=>entry.isFile()).map(entry=>entry.name).filter(name=>{
      const base=name.replace(/\.bak$/,'');
      return /^[\w-]+\.json$/.test(base)&&!preserved.has(base);
    });
    const moved=[];let archived=false;await fs.mkdir(backupDirectory,{recursive:true});
    try {
      // Archive before replacing the active pointer; never discard existing data.
      for(const name of files){await fs.rename(path.join(this.directory,name),path.join(backupDirectory,name));moved.push(name);}
      archived=true;
      await this.atomic(this.file(document.id),document);
      await this.atomic(path.join(this.directory,'workspace.json'),{version:2,activeProjectId:document.id});
    }catch(error){
      await fs.rm(this.file(document.id),{force:true});
      if(archived||moved.includes('workspace.json'))await fs.rm(path.join(this.directory,'workspace.json'),{force:true});
      for(const name of moved.reverse())await fs.rename(path.join(backupDirectory,name),path.join(this.directory,name));
      throw error;
    }
    return {document,file:this.file(document.id),backupDirectory};
  });}
  setTemplate(state) {return this.run(async()=>{
    const {validDefaultSet}=await import('../src/default-set.mjs');
    const {unpackGridRoom}=await import('../src/grid-room.mjs');
    if(!validDefaultSet(JSON.parse(JSON.stringify(state),(_key,item)=>unpackGridRoom(item))))throw Error('Ongeldige standaardset.');
    await this.atomic(path.join(this.directory,'default-layout.json'),state);
    return {file:path.join(this.directory,'default-layout.json')};
  });}
}
module.exports={ProjectStore};
