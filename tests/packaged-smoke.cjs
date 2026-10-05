// Run with Node after npm run dist:win; exercises the actual packaged executable.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'dist', 'win-unpacked', 'Zitplanner.exe'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function launch(profile) {
  const port = await new Promise(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  const env = { ...process.env };
  delete env.KLASLOKAAL_PROJECT_DIR;
  delete env.KLASLOKAAL_LEGACY_STORAGE;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--disable-gpu'], { env, windowsHide: true, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  let socket;
  try {
    let target;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw Error('Packaged app exited: ' + child.exitCode);
      try {
        target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.includes('index.html'));
        if (target) break;
      } catch {}
      await delay(100);
    }
    assert.ok(target, 'Packaged renderer did not start');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const result = JSON.parse(event.data);
      if (!result.id || !pending.has(result.id)) return;
      const { resolve, reject, timer } = pending.get(result.id);
      clearTimeout(timer); pending.delete(result.id);
      result.error ? reject(Error(result.error.message)) : resolve(result.result);
    });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 30000);
      pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params }));
    });
    const js = async expression => {
      const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      const until = Date.now() + 30000;
      while (Date.now() < until) { try { if (await js(expression)) return; } catch {} await delay(100); }
      throw Error('Packaged UI timeout: ' + expression);
    };
    await wait("typeof document.querySelector('#open-plans')?.onclick === 'function' && !!window.desktop?.projects");
    return { js, wait, call, close: async () => {
      await js('window.close()');
      let timer;
      try { await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Packaged app close timeout')), 10000); })]); }
      finally { clearTimeout(timer); }
      socket.close();
    } };
  } catch (error) { socket?.close(); child.kill(); await exited; throw error; }
}

(async () => {
  const archive = path.join(path.dirname(executable), 'resources', 'app.asar');
  const files = asar.listPackage(archive).map(file => file.replaceAll('\\', '/'));
  assert.ok(files.includes('/src/planner-worker.mjs'));
  assert.ok(files.includes('/defaults/standaard-project.json'));
  assert.ok(!files.some(file => /^\/(projects|tests|artifacts|backups|node_modules)(\/|$)/.test(file)), 'Private or development data packaged');
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const profile = await fs.mkdtemp(path.join(root, 'artifacts', 'packaged-profile-'));
  let app;
  try {
    app = await launch(profile);
    const boot = await app.js('window.desktop.projects.startup()');
    assert.equal(boot.document.state.name, 'Standaard project');
    assert.equal(boot.document.state.students.length, 180);
    assert.equal((await app.js('window.desktop.projects.list()')).length, 1);
    assert.equal(path.resolve(boot.directory), path.join(profile, 'projects'));
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    await app.js("document.querySelector('#bench-grid-G3 .bench-table').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('[data-action=disable-chair]').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    assert.deepEqual((await app.js('window.desktop.projects.startup()')).document.state.settings.disabledSeats,['grid-G3:1']);
    assert.equal(await app.js("document.querySelector('[data-action=disable-chair]').textContent"),'Stoel G6 inschakelen');
    const contextClip=await app.js("(()=>{const r=document.querySelector('#context').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
    const contextShot=await app.call('Page.captureScreenshot',{format:'png',clip:contextClip});await fs.writeFile(path.join(root,'artifacts','chair-controls.png'),Buffer.from(contextShot.data,'base64'));
    await app.js("document.querySelector('[data-action=swap-disabled-chair]').click()");await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    await app.close();app=null;app=await launch(profile);
    assert.deepEqual((await app.js('window.desktop.projects.startup()')).document.state.settings.disabledSeats,['grid-G3:0']);
    await app.js("document.querySelector('#bench-grid-G3 .bench-table').dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('[data-action=disable-chair]').click()");await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    await app.js("document.querySelector('[data-tab=students]').click();document.querySelector('[data-action=clear]').click();document.querySelector('#clear-list-confirm').click()");
    await app.wait("document.querySelector('.local-label')?.textContent !== 'Bezig met opslaan…'");
    assert.equal(await app.js("document.querySelector('.local-label').textContent"), 'Automatisch opgeslagen', 'Clearing the standard project list must save successfully');
    const cleared = await app.js('window.desktop.projects.startup()');
    assert.equal(cleared.document.id, boot.document.id);
    assert.equal(cleared.document.state.name, 'Standaard project');
    assert.equal(cleared.document.state.students.length, 0);
    await app.js("document.querySelector('#undo').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    assert.equal((await app.js('window.desktop.projects.startup()')).document.state.students.length, 180);
    await app.js("document.querySelector('#redo').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    await app.close(); app = null;
    app = await launch(profile);
    const afterClear = await app.js('window.desktop.projects.startup()');
    assert.equal(afterClear.document.state.name, 'Standaard project');
    assert.equal(afterClear.document.state.students.length, 0);
    await app.js("document.querySelector('#open-plans').click()");await app.wait("document.querySelector('#reset-project')");
    await app.js("document.querySelector('#reset-project').click()");await app.wait("document.querySelector('#reset-project-no-backup')");
    assert.equal(await app.js("document.querySelector('.backup-location').textContent"),path.join(profile,'projects','backups'));
    assert.match(await app.js("document.querySelector('#modal-content').textContent"),/30 dagen.*eenmaal bij het starten/s);
    const resetClip=await app.js("(()=>{const r=document.querySelector('#modal').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
    const resetShot=await app.call('Page.captureScreenshot',{format:'png',clip:resetClip});await fs.writeFile(path.join(root,'artifacts','reset-project-options.png'),Buffer.from(resetShot.data,'base64'));
    const backupRoot=path.join(profile,'projects','backups'),beforeBackups=await fs.readdir(backupRoot);
    await app.js("document.querySelector('#reset-project-no-backup').click()");await app.wait("!document.querySelector('#modal').open&&document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    assert.equal((await app.js('window.desktop.projects.startup()')).document.state.students.length,180);assert.deepEqual(await fs.readdir(backupRoot),beforeBackups);
    await app.js("document.querySelector('#open-plans').click()");await app.wait("document.querySelector('#reset-project')");await app.js("document.querySelector('#reset-project').click()");await app.wait("document.querySelector('#reset-project-confirm')");
    await app.js("document.querySelector('#reset-project-confirm').click()");await app.wait("!document.querySelector('#modal').open&&document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    assert.equal((await fs.readdir(backupRoot)).filter(name=>name.startsWith('reset-')).length,1);
    const expired=path.join(backupRoot,`reset-2020-01-01T00-00-00-000Z-${randomUUID()}`);await fs.mkdir(expired);await fs.writeFile(path.join(expired,'snapshot.json'),'test expired backup');
    await app.close();app=null;app=await launch(profile);await assert.rejects(fs.access(expired),{code:'ENOENT'});assert.equal((await fs.readdir(backupRoot)).filter(name=>name.startsWith('reset-')).length,1);await fs.access(path.join(backupRoot,'standaard-project.json'));
    await app.js(`(async()=>{
      const api=window.desktop.projects,boot=await api.startup(),e=await import('./engine.mjs'),r=await import('./rooms.mjs'),g=await import('./grid-room.mjs');
      const state=r.initializeRooms(e.defaults());state.name='Standaard project';state.settings.studentRulesEnabled=true;state.settings.classRulesEnabled=true;state.settings.yearRulesEnabled=false;
      state.settings.classRules.default={type:'separate',priority:'Verplicht'};
      state.students=Array.from({length:4},(_,i)=>({id:'s'+i,name:'Testleerling '+i,class:i%2?'4B':'3A',year:i%2?'4':'3',absent:false}));
      r.newRoom(state,'Tweede lokaal');for(const room of state.rooms)room.layout=g.generateGrid(g.emptyGridRoom(),{from:'A',to:'A',rows:1});
      state.settings.layout=state.rooms[0].layout;state.participatingRooms=state.rooms.map(room=>room.id);r.distributeRooms(state,'balanced');
      await api.save({...boot.document,state});
    })()`);
    await app.call('Page.reload');
    await app.wait("typeof document.querySelector('#open-plans')?.onclick === 'function'");
    await app.js("document.querySelector('[data-tab=distribution]').click();document.querySelector('[data-room-action=auto-distribute]').click()");
    await app.wait("document.querySelector('[data-room-action=auto-distribute]')?.disabled === false && document.querySelector('#distribution-auto-result')?.textContent.includes('alle ingeschakelde regels zijn gevolgd')");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    const saved = await app.js('window.desktop.projects.startup()');
    assert.equal(saved.document.state.rooms.reduce((total, room) => total + Object.keys(room.assignments).length, 0), 4);
    const shot = await app.call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(root, 'artifacts', 'packaged-app.png'), Buffer.from(shot.data, 'base64'));
    await app.close(); app = null;
    app = await launch(profile);
    const reopened = await app.js('window.desktop.projects.startup()');
    assert.equal(reopened.document.id, saved.document.id);
    assert.deepEqual(reopened.document.state.rooms, saved.document.state.rooms);
    assert.equal((await app.js('window.desktop.projects.list()')).length, 1);
    // V2 must persist calendar/roll-call changes through the packaged IPC path.
    await app.js("(()=>{const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-06T12:00:00Z']));}static now(){return NativeDate.parse('2026-10-06T12:00:00Z');}};})()");
    const attendanceId = reopened.document.state.students[0].id;
    await app.js("document.querySelector('[data-tab=attendance]').click();document.querySelector('#sidebar-content [data-calendar-enabled]').click()");
    await app.js(`document.querySelector('[data-attendance="${attendanceId}"]').click();document.querySelector('#attendance-save').click()`);
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen' && document.querySelector('#attendance-save')?.textContent.includes('Bewaard')");
    const recorded = (await app.js('window.desktop.projects.startup()')).document.state;
    assert.equal(recorded.students.find(student => student.id === attendanceId).attendanceAbsent, true);
    assert.equal(recorded.calendar.selectedDate, '2026-10-06');
    assert.equal(recorded.calendar.days['2026-10-06'].attendanceSaved, true);
    assert.deepEqual(recorded.rooms, reopened.document.state.rooms, 'Roll call must preserve seating');
    await app.js("document.querySelector('#sidebar-content [data-calendar-open]').click();document.querySelector('[data-calendar-date=\"2026-10-08\"]').click();document.querySelector('[data-calendar-action=open]').click();document.querySelector('[data-calendar-start=previous]').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    const copied = (await app.js('window.desktop.projects.startup()')).document.state;
    assert.equal(copied.calendar.selectedDate, '2026-10-08');
    assert.ok(copied.students.every(student => !student.attendanceAbsent), 'Copied day starts present');
    assert.deepEqual(copied.rooms, recorded.rooms, 'Copied day retains seating');
    await app.js("document.querySelector('#sidebar-content [data-calendar-save-current]').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen'");
    await app.close(); app = null;
    app = await launch(profile);
    const afterCalendarRestart = (await app.js('window.desktop.projects.startup()')).document.state;
    assert.equal(afterCalendarRestart.calendar.enabled, true);
    assert.equal(afterCalendarRestart.calendar.selectedDate, '2026-10-08');
    assert.ok(afterCalendarRestart.calendar.days['2026-10-08']);
    await app.js("document.querySelector('[data-tab=attendance]').click();document.querySelector('#sidebar-content [data-calendar-open]').click();document.querySelector('[data-calendar-date=\"2026-10-06\"]').click();document.querySelector('[data-calendar-action=open]').click()");
    await app.wait("document.querySelector('.local-label')?.textContent === 'Automatisch opgeslagen' && document.querySelector('#attendance-save')?.textContent.includes('Bewaard')");
    const historic = (await app.js('window.desktop.projects.startup()')).document.state;
    assert.equal(historic.calendar.selectedDate, '2026-10-06');
    assert.equal(historic.students.find(student => student.id === attendanceId).attendanceAbsent, true);
    assert.deepEqual(historic.rooms, recorded.rooms);
    await app.close(); app = null;
    console.log('PASS packaged executable: clean contents, default seed, chair toggle/swap/restart, both reset options, expired-backup cleanup, clear-list save/undo/redo/restart, Auto persistence, calendar copying/restart and historical confirmed attendance.');
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
