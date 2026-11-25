const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const{spawnSync}=require('node:child_process');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
test('deployment backs up server-only source files before incoming tracked files are checked out',{skip:process.platform==='win32'&&!fs.existsSync(bash)},()=>{
 const repo=fs.mkdtempSync(path.join(os.tmpdir(),'crm-deploy-collision-'));
 const run=(command,args,options={})=>{const result=spawnSync(command,args,{cwd:repo,encoding:'utf8',...options});assert.equal(result.status,0,result.stderr||result.stdout);return result.stdout.trim();};
 run('git',['init']);run('git',['config','user.name','Deployment Test']);run('git',['config','user.email','test@example.test']);run('git',['config','core.autocrlf','false']);
 fs.writeFileSync(path.join(repo,'README'),'base');run('git',['add','.']);run('git',['commit','-m','base']);const base=run('git',['rev-parse','HEAD']);
 fs.mkdirSync(path.join(repo,'backend/src/services'),{recursive:true});const file='backend/src/services/financeApprovedClients.js';fs.writeFileSync(path.join(repo,file),'incoming tracked version');run('git',['add','.']);run('git',['commit','-m','incoming']);const incoming=run('git',['rev-parse','HEAD']);run('git',['checkout','--detach',base]);
 fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});fs.writeFileSync(path.join(repo,file),'manual server version');fs.writeFileSync(path.join(repo,'notes.txt'),'retain unrelated file');
 const source=fs.readFileSync(path.resolve(__dirname,'../../scripts/deploy-production.sh'),'utf8');const helper=source.slice(source.indexOf('preserve_untracked_checkout_collisions() {'),source.indexOf('\nrollback_deployment() {'));
 const appDir=run(bash,['-c','pwd']);
 run(bash,['-c',`set -eu
UNTRACKED_RECOVERY_DIR=""
UNTRACKED_RECOVERY_FILES=()
${helper}
preserve_untracked_checkout_collisions
git checkout --detach "$EXPECTED_SHA"`],{env:{...process.env,APP_DIR:appDir,EXPECTED_SHA:incoming}});
 assert.equal(fs.readFileSync(path.join(repo,file),'utf8'),'incoming tracked version');assert.equal(fs.readFileSync(path.join(repo,'notes.txt'),'utf8'),'retain unrelated file');
 const backup=fs.readdirSync(repo).find(name=>name.startsWith('.deployment-recovery.'));assert.ok(backup);assert.equal(fs.readFileSync(path.join(repo,backup,file),'utf8'),'manual server version');
});
