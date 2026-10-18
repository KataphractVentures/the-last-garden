/** Independent v5 trace verifier. It executes no player decision policy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createGame, dispatchCommand, getCost, getResaleRefund, prestigeEligibility, tick, worldCycle } from '../../src/engine';
import { decimal, scaleFor } from '../../src/engine/amounts';
import { getStoryEconomy } from '../../src/engine/storyEconomy';
import { evidenceProgress } from '../../src/laboratory/evidence';
import { activeExperimentTemplates, activeResearchProjects } from '../../src/laboratory/catalog';
import { MAX_SAVE_BYTES, serializeSave, validateSaveState } from '../../src/persistence/validation';
import { parseSave, getValidationCatalog } from '../../src/persistence';
import { operatingScope, operatingClearanceEligibility } from '../../src/engine/clearance';
import { governanceGardenEligibility } from '../../src/governance';
import { societyEndingEligibility } from '../../src/society';
import type { Command, GameState } from '../../src/contracts';

const args=process.argv.slice(2);
const arg=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const directory=arg('--casual')??arg('--optimized');
assert(directory,'Pass --casual <chain directory> or --optimized <chain directory>.');
const casual=Boolean(arg('--casual'));
const output=arg('--output')??`qa/simulations-v5/audit/replay-${casual?'casual':'optimized'}.json`;
const hash=(bytes:string|Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifestPath=path.join(directory,casual?'source-manifest.json':'source-before.json');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const freezePath=arg('--freeze');
const freeze=freezePath?JSON.parse(fs.readFileSync(freezePath,'utf8')):manifest;
assert.equal(hash(JSON.stringify(manifest.files)),manifest.sourceAggregateSha256??manifest.sha256,'Manifest aggregate does not match its file list.');
function checkSource(){for(const file of freeze.files){
 assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Frozen source changed: ${file.path}`);
 const runFile=manifest.files.find((entry:any)=>entry.path===file.path);
 // Simulation manifests cover src/ and package files. The root freeze also
 // covers Vite's build configuration, which the engine replay does not load.
 if(runFile)assert.equal(runFile.sha256,file.sha256,`Run source differs from freeze: ${file.path}`);
 else assert.equal(file.path,'vite.config.ts',`A simulation dependency is absent from the recorded manifest: ${file.path}`);
}}
checkSource();
const tracePath=path.join(directory,arg('--trace')??(casual?'actions.jsonl':'chain-commands.jsonl'));
const traceBytes=fs.readFileSync(tracePath);
const throughWorld=arg('--through-world')===undefined?undefined:Number(arg('--through-world'));
if(throughWorld!==undefined)assert(Number.isInteger(throughWorld)&&throughWorld>=1&&throughWorld<=6);
const traceText=traceBytes.toString('utf8');
const completeLines=throughWorld===undefined?traceText:traceText.slice(0,traceText.lastIndexOf('\n')+1);
const rows=completeLines.trim().split('\n').map(line=>JSON.parse(line)).filter(row=>throughWorld===undefined||(row.world??1)<=throughWorld);
const init=casual?rows.find(row=>row.type==='init'):{seed:1701,now:0};
assert(init,'No fresh initialization in casual trace.');
const snapshots=fs.readdirSync(directory).filter(name=>name.endsWith('.ts.txt')||['policy.json','winner-policy.json','chain-configuration.json','runner-manifest.json','runner-manifest-before.json','harness-manifest.json'].includes(name)).map(name=>({path:path.join(directory,name),sha256:hash(fs.readFileSync(path.join(directory,name)))}));
if(casual)assert.equal(hash(fs.readFileSync(path.join(directory,'policy.json'))),init.policySha256,'Casual policy snapshot differs from trace declaration.');
const harnessPath=path.join(directory,'harness-manifest.json');
if(fs.existsSync(harnessPath)){const data=JSON.parse(fs.readFileSync(harnessPath,'utf8'));for(const entry of Array.isArray(data)?data:data.files)assert.equal(hash(fs.readFileSync(path.join(directory,entry.file))),entry.sha256,`Harness snapshot mismatch: ${entry.file}`);}
const runnersPath=path.join(directory,'runner-manifest.json');
if(fs.existsSync(runnersPath)){const data=JSON.parse(fs.readFileSync(runnersPath,'utf8'));for(const entry of Array.isArray(data)?data:data.files)assert.equal(hash(fs.readFileSync(path.join(directory,path.basename(entry.path)+'.txt'))),entry.sha256,`Runner snapshot mismatch: ${entry.path}`);}
for(const file of manifest.files.filter((entry:any)=>entry.path.startsWith('tools/'))){const snapshot=path.join(directory,path.basename(file.path)+'.txt');if(fs.existsSync(snapshot))assert.equal(hash(fs.readFileSync(snapshot)),file.sha256,`Archived driver mismatch: ${snapshot}`);}
let state=createGame(init.seed,init.now);
const checkpointPrefix=arg('--checkpoint-prefix');
const checkpointFiles=fs.readdirSync(directory).filter(name=>checkpointPrefix?name===`${checkpointPrefix}-ending.json`||name===`${checkpointPrefix}-before-ending.json`:/^world-\d+-(start|ending|before-ending|before-refit|after-refit|after-reinitialize|after-reframe|before-human-requester|before-human-sponsor)\.json$/.test(name)||['final-state.json','chain-final.json'].includes(name)).filter(name=>throughWorld===undefined||Number(name.match(/^world-(\d+)-/)?.[1]??Infinity)<=throughWorld);
const key=(s:GameState)=>`${s.id}|${s.commandSeq}|${s.elapsed}`;
const checkpoints=checkpointFiles.map(name=>{
 const file=path.join(directory,name),bytes=fs.readFileSync(file,'utf8'),parsed=parseSave(bytes,getValidationCatalog());
 assert(parsed.ok,parsed.ok?'':`${file}: ${parsed.message}`);
 return {file,state:parsed.state,key:key(parsed.state),matched:false,sha256:hash(bytes)};
});
const checkpointsByKey=new Map<string,typeof checkpoints>();
for(const entry of checkpoints)checkpointsByKey.set(entry.key,[...(checkpointsByKey.get(entry.key)??[]),entry]);
function compareCheckpoints(){for(const entry of checkpointsByKey.get(key(state))??[])if(!entry.matched){
 // JSON omits optional properties whose in-memory value is undefined (for
 // example an unresolved branch's optional ending). Compare serialized state.
 assert(isDeepStrictEqual(JSON.parse(JSON.stringify(state)),entry.state),`Exact serialized checkpoint mismatch: ${entry.file}`);entry.matched=true;
}}
function ledgerCheck(s:GameState){
 const economy=getStoryEconomy(s);
 for(const currency of ['tokens','research'] as const)assert(decimal(economy[currency].granted).lte(decimal(economy[currency].earned).mul('.1')),`${currency} grants exceed 10% earned in ${s.id}`);
 assert(decimal(economy.tokens.earned).eq(s.lifetime),'Only actual earned production may enter lifetime.');
 assert.equal(new Set(s.legacy.claims).size,s.legacy.claims.length,'Duplicate certificate claim');
 assert.equal(new Set(s.legacy.contracts.map(c=>c.id)).size,s.legacy.contracts.length,'Duplicate certificate contract');
 assert.deepEqual(s.legacy.claims,s.legacy.contracts.map(c=>c.id),'Claims and contracts must correspond.');
 assert.equal(s.settings.speed,1,'Accelerated playtest speed is forbidden for this comparison.');
}
const transitions:any[]=[],endings:any[]=[],certificates:any[]=[];
const catalog=getValidationCatalog();let validatedStates=0,largestSaveBytes=0;
function validateCurrent(index:number){const result=validateSaveState(state,catalog);assert(result.ok,result.ok?'':`Intermediate row ${index}: ${result.message}`);const bytes=Buffer.byteLength(serializeSave(state,1792080000000));largestSaveBytes=Math.max(largestSaveBytes,bytes);assert(bytes<=MAX_SAVE_BYTES,`Intermediate row ${index}: save exceeds 5 MiB`);validatedStates++;}
function inspectCommand(before:GameState,after:GameState,command:Command,world:number){
 ledgerCheck(after);
 if(command.type==='certify'){
  assert(operatingClearanceEligibility(before,{fresh:true}).allowed,'Certificate lacks current scoped clearance.');
  assert.equal(before.clearance?.scope,operatingScope(before));
  assert.equal(before.clearance?.observation?.revision,before.clearance?.revision);
  assert(before.clearance!.observation!.observedAt>=before.clearance!.changedAt,'A historical observation authorized changed scope.');
  assert.equal(after.legacy.claims.length,before.legacy.claims.length+1);
  assert.deepEqual(after.legacy.claims.slice(0,-1),before.legacy.claims);
  assert.equal(after.legacy.seeds,before.legacy.seeds+10+2*before.modules.length);
  assert.equal(after.legacy.patterns,before.legacy.patterns+1);
  assert.equal(after.legacy.efficiency,before.legacy.efficiency+1);
  assert.equal(worldCycle(before),before.legacy.cycle);assert(!before.flags.includes('replay-only'));
  certificates.push({world,elapsed:before.elapsed,contract:after.legacy.contracts.at(-1)});
 }
 if(command.type==='finish'){
  const templates=activeExperimentTemplates(after.constitution),projects=activeResearchProjects(after.constitution);
  const evidence=templates.map(t=>({template:t.id,...evidenceProgress(after.experiments,t.id,{adoptedOnly:true})}));
  if(after.ending==='garden'){assert.equal(evidence.length,36);assert(evidence.every(proof=>proof.allowed),'Garden lacks all 36 independently supported adopted templates.');assert.equal(projects.length,70);assert(projects.every(project=>after.projects.includes(project.id)));assert(after.charter?.established);assert.equal(after.charter.appliedTier,6);assert(operatingClearanceEligibility(before,{garden:true,fresh:true}).allowed);assert(governanceGardenEligibility(before).allowed);assert(societyEndingEligibility(before).allowed);}
  endings.push({world,id:after.id,constitution:after.constitution,cycle:worldCycle(after),elapsed:after.elapsed,ending:after.ending,
   projects:after.projects.length,studies:after.experiments.length,adequateTemplates:evidence.filter(p=>p.allowed).length,evidence,storyEconomy:getStoryEconomy(after),clearance:after.clearance,governance:after.governance,society:after.society});
  console.log(JSON.stringify({verifiedEnding:world,constitution:after.constitution,cycle:worldCycle(after),elapsed:after.elapsed,ending:after.ending,adequateTemplates:evidence.filter(p=>p.allowed).length}));
 }
 if(command.type!=='prestige')return;
 const layer=command.layer;
 assert.deepEqual(after.legacy.claims,before.legacy.claims,'Prestige may not mint claims.');
 assert.deepEqual(after.legacy.discovered,before.legacy.discovered);
 if(layer==='refit'){
  assert.equal(after.id,before.id);assert.equal(worldCycle(after),worldCycle(before));
  assert.equal(after.legacy.seeds,before.legacy.seeds-1);assert.equal(after.legacy.patterns,before.legacy.patterns);
  assert.equal(after.legacy.efficiency,before.legacy.efficiency);assert.deepEqual(after.legacy.contracts,before.legacy.contracts);
  assert.deepEqual(after.decisions,before.decisions);assert.deepEqual(after.policies,before.policies);
  assert.deepEqual(after.charter,before.charter,'Refit erased funded institutional commitments.');
  assert.deepEqual(after.governance,before.governance,'Refit erased public decision rights.');
  assert.deepEqual(after.society,before.society,'Refit erased community obligations or harmful mandates.');
  assert.deepEqual(after.clearance?.decisions,before.clearance?.decisions,'Refit erased scientific operating responses.');
  assert.equal(after.clearance?.observation,null,'Refit preserved stale technical clearance.');
  assert.deepEqual(getStoryEconomy(after),getStoryEconomy(before));
  assert(decimal(after.tokens).eq(scaleFor(worldCycle(after)).mul(25*10**Math.min(3,before.chapter))));
  assert.equal(after.research,'0');assert(decimal(getResaleRefund(after,'helper',1)).eq(0));
  assert.equal(after.viableSeconds,0);assert.equal(after.certificateProgress,0);
  assert(!after.flags.some(f=>f==='current-clearance'||f.startsWith('pending-fresh-evidence:')));
 }else{
  assert.notEqual(after.id,before.id);assert.equal(after.elapsed,0);assert.equal(after.chapter,1);
  for(const property of ['tokens','research','lifetime','useful'] as const)assert.equal(after[property],'0');
  for(const property of ['experiments','projects','mastered','upgrades'] as const)assert.equal(after[property].length,0);
  assert.equal(after.charter?.kind,after.constitution);assert.equal(after.charter?.completed,0);assert.equal(after.charter?.appliedTier,0);assert.equal(after.charter?.automation,null);
  assert.equal(Object.keys(after.decisions).length,0);assert(Object.values(after.producers).every(n=>n===0));
  assert.equal(after.governance?.mandate,'none','New civilization inherited unelected public authority.');
  assert.equal(after.governance?.reviews.length,0,'New civilization inherited scope grants.');
  assert(Object.values(after.society?.decisions??{}).every(value=>value===null),'New civilization inherited community choices.');
  assert(after.society?.cases.every(record=>record.response===null),'New civilization inherited resolved human requests.');
  assert.equal(after.clearance?.observation,null,'New civilization inherited boundary evidence.');
  assert.equal(Object.keys(after.clearance?.decisions??{}).length,0,'New civilization inherited operating decisions without its own science.');
  assert.deepEqual(after.legacy.contracts.map(c=>c.id),before.legacy.contracts.map(c=>c.id));
  assert.equal(after.legacy.cycle,before.legacy.cycle+(layer==='reframe'?1:0));
  assert.equal(after.legacy.charters,before.legacy.charters+(layer==='reframe'?1:0));
  for(const property of ['seeds','patterns','efficiency'] as const)assert.equal(after.legacy[property],layer==='reframe'?0:before.legacy[property]);
  const redeemed=after.legacy.contracts.filter(c=>c.redeemed&&!before.legacy.contracts.find(old=>old.id===c.id)?.redeemed);
  assert.equal(redeemed.length,layer==='reframe'?3:0);
  if(layer==='reframe'){assert(new Set(redeemed.map(c=>c.family)).size>=2);assert(redeemed.every(c=>c.cycle===before.legacy.cycle));}
  const branch=after.legacy.branches.find(b=>b.id===before.id);assert(branch?.checkpoint,'Previous world was not preserved.');
  const {legacy:_,...expected}=structuredClone(before);for(const record of expected.experiments.slice(0,-10))record.observations=[];
  assert.deepEqual(branch.checkpoint,expected,'Archived civilization mismatch.');assert.equal(branch.cycle,worldCycle(before));
  assert(decimal(getCost(after,'helper',1).cost).eq(scaleFor(worldCycle(after)).mul(15)));
 }
 transitions.push({world,layer,beforeId:before.id,afterId:after.id,beforeCycle:worldCycle(before),afterCycle:worldCycle(after),
  claims:after.legacy.claims.length,seeds:after.legacy.seeds,patterns:after.legacy.patterns,charters:after.legacy.charters,efficiency:after.legacy.efficiency});
}
let commands=0,successes=0,ticks=0,requestedSeconds=0,actualSeconds=0;
const started=performance.now();compareCheckpoints();validateCurrent(-1);
for(const [index,row]of rows.entries()){
 const kind=row.type??row.kind;
 if(kind==='command'){
  if(!casual)assert.equal(state.elapsed,row.at,`Command clock ${index}`);
  assert(row.commandId===undefined,'Undeclared command-id deduplication is not part of this replay.');
  const before=state,result=dispatchCommand(state,row.command,row.commandId);
  assert.equal(result.ok,row.ok,`Command status ${index}`);assert.equal(result.message,row.message,`Command response ${index}`);
  state=result.state;commands++;if(result.ok){successes++;inspectCommand(before,state,row.command,row.world??1);}
  if(casual){assert.equal(state.elapsed,row.engineSeconds,`Command elapsed ${index}`);assert.equal(state.tokens,row.tokens);assert.equal(state.research,row.research);assert.equal(state.pendingEvent,row.pending);}
 }else if(kind==='tick'){
  if(!casual)assert.equal(state.elapsed,row.at,`Tick clock ${index}`);
  const before=state.elapsed,seconds=casual?row.seconds:row.requested;assert(seconds<=43200,'Oversized tick discards time at the engine limit.');
  state=tick(state,seconds);const actual=state.elapsed-before;
  assert.equal(actual,casual?row.actualSeconds:row.actual,`Tick duration ${index}`);
  if(casual){assert.equal(state.elapsed,row.engineSeconds,`Tick elapsed ${index}`);assert.equal(state.pendingEvent,row.pending);assert.equal(requestedSeconds+seconds,row.wallSeconds,`Modeled wall clock ${index}`);}
  ticks++;requestedSeconds+=seconds;actualSeconds+=actual;ledgerCheck(state);
 }
 if(kind==='command'||kind==='tick'){validateCurrent(index);if((commands+ticks)%1000===0)console.log(JSON.stringify({progress:index,commands,ticks,world:row.world??1,elapsed:state.elapsed,validatedStates}));}
 compareCheckpoints();
}
for(const checkpoint of checkpoints)assert(checkpoint.matched,`Exported checkpoint was never reproduced: ${checkpoint.file}`);
const expectedWorlds=Number(arg('--worlds')??throughWorld??6),minimumReframes=Number(arg('--min-reframes')??2);
assert.equal(endings.length,expectedWorlds,'Unexpected number of completed worlds.');assert.equal(endings.filter(e=>e.ending==='garden').length,expectedWorlds);
assert(transitions.filter(t=>t.layer==='reframe').length>=minimumReframes,'Insufficient earned Reframes.');
const branchProbe:any[]=[];
if(expectedWorlds===6){
 const finalId=state.id,old=checkpoints.find(entry=>/world-6-ending\.json$/.test(entry.file))!.state;
 const expectedOldCost=getCost(old,'helper',1).cost;
 let probe=state;
 for(const id of [old.id,finalId,old.id]){
  const before=probe,result=dispatchCommand(probe,{type:'branch',id});assert(result.ok,result.message);probe=result.state;
  assert.deepEqual(probe.legacy.claims,state.legacy.claims);assert.deepEqual(probe.legacy.contracts,state.legacy.contracts);
  assert.equal(probe.legacy.seeds,state.legacy.seeds);assert.equal(probe.legacy.patterns,state.legacy.patterns);assert.equal(probe.legacy.charters,state.legacy.charters);
  if(id===old.id){
   assert.equal(worldCycle(probe),worldCycle(old));assert.equal(getCost(probe,'helper',1).cost,expectedOldCost);assert.equal(probe.elapsed,old.elapsed);
   assert.equal(probe.tokens,old.tokens);assert(probe.flags.includes('replay-only'));assert(!prestigeEligibility(probe,'reframe').allowed);
  }else{assert.equal(probe.elapsed,0);assert.equal(probe.tokens,'0');assert.equal(worldCycle(probe),state.legacy.cycle);}
  assert.equal(probe.legacy.branches.find(branch=>branch.id===old.id)!.cycle,worldCycle(old));
  if(id===old.id)assert.deepEqual(probe.charter,old.charter,'Resumed historical charter changed.');
  if(id===old.id){assert.deepEqual(probe.governance,old.governance,'Branch changed independent authority.');assert.deepEqual(probe.society,old.society,'Branch erased human consequences.');assert.deepEqual(probe.clearance,old.clearance,'Branch changed scoped evidence.');}
  const checked=validateSaveState(probe,catalog);assert(checked.ok,checked.ok?'':checked.message);
  branchProbe.push({from:before.id,to:probe.id,worldCycle:worldCycle(probe),sharedCycle:probe.legacy.cycle,elapsed:probe.elapsed,helperCost:getCost(probe,'helper',1).cost,
   replayOnly:probe.flags.includes('replay-only'),claimsPreserved:true,noInactiveProduction:true});
 }
}
checkSource();
const result={auditedAt:new Date().toISOString(),kind:casual?'casual':'optimized',manifestPath,sourceAggregateSha256:manifest.sourceAggregateSha256??manifest.sha256,
 throughWorld:throughWorld??null,
 frozenSourceSha256:freeze.sourceAggregateSha256??freeze.sha256,sourceFilesChecked:freeze.files.length,snapshots,tracePath,traceSha256:hash(traceBytes),records:rows.length,commands,successes,ticks,requestedSeconds,actualSeconds,validatedStates,largestSaveBytes,
 replayWallSeconds:(performance.now()-started)/1000,exactStateMatch:true,checkpoints:checkpoints.map(({state:_,key:__,...entry})=>entry),endings,transitions,certificates,branchProbe,
 limitations:'This independent verifier replays declared commands and ticks from fresh initialization. It verifies engine legality and exact exported states, not human realism or mathematical optimality.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({kind:result.kind,commands,ticks,endings:endings.length,refits:transitions.filter(t=>t.layer==='refit').length,reframes:transitions.filter(t=>t.layer==='reframe').length,
 checkpoints:checkpoints.length,actualSeconds,requestedSeconds,replayWallSeconds:result.replayWallSeconds,exactStateMatch:true,output}));
