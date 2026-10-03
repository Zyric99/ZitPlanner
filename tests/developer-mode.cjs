const { spawnSync } = require('node:child_process');
const electron = require('electron');
const path = require('node:path');

for(const value of [undefined,'False','True']){
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.KLASLOKAAL_DEV_MODE;delete env.KLASLOKAAL_LEGACY_STORAGE;
  if(value!==undefined)env.KLASLOKAAL_DEV_MODE=value;
  const result=spawnSync(electron,[path.join(__dirname,'desktop-workspace.cjs')],{env,encoding:'utf8',timeout:45000,windowsHide:true});
  if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||String(result.error||'Projectcontrole mislukt'));process.exit(1);}
  process.stdout.write(result.stdout);
}
for(const value of ['False','True']){
  const env={...process.env,KLASLOKAAL_DEV_MODE:value,KLASLOKAAL_LEGACY_STORAGE:'True'};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(electron,[path.join(__dirname,'desktop-legacy-dev.cjs')],{env,encoding:'utf8',timeout:30000,windowsHide:true});
  if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||String(result.error||'Legacycontrole mislukt'));process.exit(1);}
  process.stdout.write(result.stdout);
}
