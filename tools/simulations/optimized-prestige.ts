/** Six real worlds, linked only by public prestige commands. No installed fixtures. */
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Command,ConstitutionId,GameState,Policy} from '../../src/contracts';
import {createGame,dispatchCommand,prestigeEligibility,getResaleRefund,getCost,constitutionEligibility} from '../../src/engine';
import {decimal,scaleFor} from '../../src/engine/amounts';
import {getStoryEconomy} from '../../src/engine/storyEconomy';
import {getValidationCatalog,parseSave,serializeSave} from '../../src/persistence';
import {CANDIDATES,simulate,type Trace,type Strategy} from './optimized';

const sequence:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
type ChainTrace=Trace&{world:number;worldId:string;cycle:number};
export type ConstitutionStrategies=Partial<Record<ConstitutionId,{strategy:Strategy;policyOverride?:Partial<Policy>}>>;
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const ledger=(s:GameState)=>({id:s.id,constitution:s.constitution,cycle:s.legacy.cycle,elapsed:s.elapsed,chapter:s.chapter,ending:s.ending,tokens:s.tokens,research:s.research,lifetime:s.lifetime,useful:s.useful,seeds:s.legacy.seeds,patterns:s.legacy.patterns,charters:s.legacy.charters,efficiency:s.legacy.efficiency,certificateTier:s.certificateTier,contracts:s.legacy.contracts,claims:s.legacy.claims,viableCycles:s.legacy.viableCycles,metrics:s.metrics,storyEconomy:getStoryEconomy(s),decisions:Object.keys(s.decisions).length,projects:s.projects.length,experiments:s.experiments.length,mastered:s.mastered});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function ensure(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
async function sourceFingerprint(){
 const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>join(e.parentPath,e.name));files.push('package.json','package-lock.json');
 const entries=[];for(const file of files.sort())entries.push({path:relative(process.cwd(),resolve(file)).replaceAll('\\','/'),sha256:hash(await readFile(file,'utf8'))});
 return {files:entries,sha256:hash(JSON.stringify(entries))};
}
function expectedArchived(s:GameState){const {legacy:_legacy,...checkpoint}=structuredClone(s);for(const record of checkpoint.experiments.slice(0,-10))record.observations=[];return checkpoint;}

export async function runPrestigeChain(output:string,policies:ConstitutionStrategies={},worldLimit=6,certificateQuota=3){
 const directory=resolve(output);ensure(directory.includes('simulations-v3'),'Use a simulations-v3 output directory.');await mkdir(directory,{recursive:true});
 const sourceBefore=await sourceFingerprint();await writeFile(join(directory,'source-before.json'),JSON.stringify(sourceBefore,null,2));
 let state=createGame(1701,0),totalSeconds=0;const trace:ChainTrace[]=[],worlds:unknown[]=[],transitions:unknown[]=[];
 const initialStrategy=CANDIDATES.find(c=>c.id==='recoverable-shortcuts')!;
 ensure(Number.isInteger(worldLimit)&&worldLimit>=1&&worldLimit<=6,'The chain contains one to six actual worlds.');
 ensure(Number.isInteger(certificateQuota)&&certificateQuota>=3&&certificateQuota<=1000,'Certificate quota must be between3and1000.');
 await writeFile(join(directory,'chain-configuration.json'),JSON.stringify({sequence,initialStrategy,policies,worldLimit,certificateQuota,selection:'World 1 uses the established fresh Commons winner. Later worlds use supplied finite-search constitutional winners, or the same default policy if none is supplied. Certificate quota comes from the separate controlled Commons quota probe; transferred policies are not globally re-optimized.'},null,2));
 const save=async(name:string,s:GameState)=>{const text=serializeSave(s);const validation=parseSave(text,getValidationCatalog());ensure(validation.ok,`${name} failed save validation: ${validation.ok?'':validation.message}`);await writeFile(join(directory,name+'.json'),text);return hash(JSON.stringify(s));};
 const apply=(world:number,command:Command)=>{const before=state,r=dispatchCommand(state,command);trace.push({kind:'command',world,worldId:before.id,cycle:before.legacy.cycle,at:before.elapsed,command,ok:r.ok,message:r.message});ensure(r.ok,`World${world} command ${JSON.stringify(command)} rejected: ${r.message}`);state=r.state;return before;};
 for(let i=0;i<worldLimit;i++){
  const world=i+1;ensure(state.constitution===sequence[i],`World${world} constitution mismatch.`);ensure(!state.ending,'A fresh active world is required.');
  await save(`world-${world}-start`,state);
  if(world===2){
   ensure(prestigeEligibility(state,'refit').allowed,'Later active world must be eligible for an earned Refit.');
   const before=apply(world,{type:'prestige',layer:'refit'});
   const checks={sameWorld:state.id===before.id,sameCycle:state.legacy.cycle===before.legacy.cycle,oneSeedSpent:state.legacy.seeds===before.legacy.seeds-1,noPatternReward:state.legacy.patterns===before.legacy.patterns,noNewContracts:equal(state.legacy.contracts,before.legacy.contracts),decisionsPreserved:equal(state.decisions,before.decisions),storyLedgerPreserved:equal(getStoryEconomy(state),getStoryEconomy(before)),researchReset:state.research==='0',starterAmount:decimal(state.tokens).eq(scaleFor(state.legacy.cycle).mul(250)),giftCannotBeResold:decimal(getResaleRefund(state,'helper',1)).eq(0),newEvidenceRequired:state.viableSeconds===0&&state.certificateProgress===0};
   ensure(Object.values(checks).every(Boolean),'Refit failed a conservation invariant.');
   transitions.push({world,layer:'refit',before:ledger(before),after:ledger(state),checks});await save(`world-${world}-after-refit`,state);
  }
  const before=state,startLedger=ledger(state),existingContracts=state.legacy.contracts.length;
  const selected=world===1?{strategy:initialStrategy}:policies[state.constitution]??{strategy:initialStrategy};
  const result=simulate(selected.strategy,{initialState:state,stopAtEnding:true,certificatesPerWorld:certificateQuota,maxHours:24,policyOverride:selected.policyOverride});
  trace.push(...result.trace.map(row=>({...row,world,worldId:before.id,cycle:before.legacy.cycle})));state=result.finished;totalSeconds+=result.report.seconds;
  await writeFile(join(directory,`world-${world}-report.json`),JSON.stringify(result.report,null,2));await writeFile(join(directory,`world-${world}-commands.jsonl`),result.trace.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const stateSha256=await save(`world-${world}-ending`,state);
  await writeFile(join(directory,'chain-commands.jsonl'),trace.map(r=>JSON.stringify(r)).join('\n')+'\n');
  ensure(state.ending==='garden',`World${world} did not finish Garden: ${JSON.stringify(result.report.endingEligibility.garden)}.`);
  const newContracts=state.legacy.contracts.slice(existingContracts),familyIds=new Set(newContracts.map(c=>c.id));
  const checks={constitutionCompliant:constitutionEligibility(state).allowed,newEvidence:state.projects.length===60&&state.experiments.length>=65,newCertificates:newContracts.length>=3,uniqueNewClaims:familyIds.size===newContracts.length&&newContracts.every(c=>!before.legacy.claims.includes(c.id)),correctFamily:newContracts.every(c=>c.family===state.constitution&&c.cycle===state.legacy.cycle),seedsMatchCertificates:state.legacy.seeds===before.legacy.seeds+10*newContracts.length,patternsMatchCertificates:state.legacy.patterns===before.legacy.patterns+newContracts.length,efficiencyMatchesCertificates:state.legacy.efficiency===before.legacy.efficiency+newContracts.length,earnedLifetimeMatches:decimal(getStoryEconomy(state).tokens.earned).eq(state.lifetime),grantsWithinCap:decimal(getStoryEconomy(state).tokens.granted).lte(getStoryEconomy(state).tokens.maxBudget),researchGrantsWithinCap:decimal(getStoryEconomy(state).research.granted).lte(getStoryEconomy(state).research.maxBudget),currentBandViable:state.legacy.viableCycles.includes(state.legacy.cycle)};
  ensure(Object.values(checks).every(Boolean),`World${world} failed a world conservation invariant.`);
  const endingLedger=ledger(state),nextConstitution=sequence[i+1]??'commons',layer=world%2===0?'reframe':'reinitialize';
  const eligibility=Object.fromEntries(['refit','reinitialize','reframe'].map(l=>[l,prestigeEligibility(state,l as 'refit'|'reinitialize'|'reframe')]));
  ensure(prestigeEligibility(state,layer).allowed,`World${world} ${layer} unavailable: ${prestigeEligibility(state,layer).reason}`);
  const previous=apply(world,{type:'prestige',layer,constitution:nextConstitution,modules:[]});
  await save(`world-${world}-after-${layer}`,state);
  await writeFile(join(directory,'chain-commands.jsonl'),trace.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const oldBranch=state.legacy.branches.find(b=>b.id===previous.id),newlyRedeemed=state.legacy.contracts.filter(c=>c.redeemed&&!previous.legacy.contracts.find(old=>old.id===c.id)?.redeemed);
  const transitionChecks={resourcesReset:state.tokens==='0'&&state.research==='0'&&state.lifetime==='0'&&state.useful==='0',evidenceReset:state.experiments.length===0&&state.projects.length===0&&state.mastered.length===0,worldChanged:state.id!==previous.id,constitutionChosen:state.constitution===nextConstitution,noCreatedContracts:equal(state.legacy.contracts.map(c=>c.id),previous.legacy.contracts.map(c=>c.id)),oldWorldPreserved:!!oldBranch?.checkpoint&&equal(oldBranch.checkpoint,expectedArchived(previous)),claimsPreserved:equal(state.legacy.claims,previous.legacy.claims),discoveredPreserved:equal(state.legacy.discovered,previous.legacy.discovered),historyRetained:previous.legacy.branches.every(old=>state.legacy.branches.some(current=>current.id===old.id)),cycleChange:state.legacy.cycle===previous.legacy.cycle+(layer==='reframe'?1:0),charterChange:state.legacy.charters===previous.legacy.charters+(layer==='reframe'?1:0),seeds:state.legacy.seeds===(layer==='reframe'?0:previous.legacy.seeds),patterns:state.legacy.patterns===(layer==='reframe'?0:previous.legacy.patterns),efficiency:state.legacy.efficiency===(layer==='reframe'?0:previous.legacy.efficiency),certificateRedemption:layer==='reframe'?newlyRedeemed.length===3&&new Set(newlyRedeemed.map(c=>c.family)).size>=2:newlyRedeemed.length===0,pricesScale:decimal(getCost(state,'helper',1).cost).eq(scaleFor(state.legacy.cycle).mul(15))};
  ensure(Object.values(transitionChecks).every(Boolean),`World${world} ${layer} failed conservation: ${JSON.stringify(transitionChecks)}`);
  transitions.push({world,layer,eligibility,before:endingLedger,after:ledger(state),redeemed:newlyRedeemed.map(c=>c.id),checks:transitionChecks});
  await save(`world-${world}-after-${layer}`,state);
  const summary={world,constitution:sequence[i],strategy:selected.strategy,policyOverride:selected.policyOverride??{},cycle:before.legacy.cycle,seconds:result.report.seconds,commands:result.report.commands,ending:previous.ending,newCertificates:newContracts.length,start:startLedger,endingLedger,checks,transition:layer,stateSha256};worlds.push(summary);
  await writeFile(join(directory,'chain-commands.jsonl'),trace.map(r=>JSON.stringify(r)).join('\n')+'\n');
  await writeFile(join(directory,'chain-progress.json'),JSON.stringify({worlds,transitions,totalSeconds},null,2));
  console.log(JSON.stringify({world,constitution:sequence[i],cycle:before.legacy.cycle,seconds:result.report.seconds,ending:previous.ending,newCertificates:newContracts.length,transition:layer,nextCycle:state.legacy.cycle,totalSeconds}));
 }
 const sourceAfter=await sourceFingerprint();await writeFile(join(directory,'source-after.json'),JSON.stringify(sourceAfter,null,2));
 const report={createdAt:new Date().toISOString(),method:`${worldLimit} consecutive actual earned worlds. Each is played through public commands and ticks; all transitions and one active-world Refit (when world 2 is included) are actual public transactions. Engine time excludes human reading and interaction. No legacy or resource injection. Finite policy, not a global optimum.`,starting:{seed:1701,time:0,constitution:'commons',modules:[]},sequence:sequence.slice(0,worldLimit),initialStrategy,policies,certificateQuota,worlds,transitions,totalSeconds,totalCommands:trace.filter(r=>r.kind==='command').length,totalTicks:trace.filter(r=>r.kind==='tick').length,refits:transitions.filter((t:any)=>t.layer==='refit').length,reinitializations:transitions.filter((t:any)=>t.layer==='reinitialize').length,reframes:transitions.filter((t:any)=>t.layer==='reframe').length,final:ledger(state),sourceUnchanged:sourceBefore.sha256===sourceAfter.sha256,sourceBefore:sourceBefore.sha256,sourceAfter:sourceAfter.sha256,runnerSha256:hash(await readFile('tools/simulations/optimized-prestige.ts','utf8')),baseRunnerSha256:hash(await readFile('tools/simulations/optimized.ts','utf8'))};
 await save('chain-final',state);await writeFile(join(directory,'chain-report.json'),JSON.stringify(report,null,2));return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=process.argv.slice(2),value=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};const output=value('--out')??'qa/simulations-v3/optimized/diagnostic-1';const policies=value('--policies')?JSON.parse(await readFile(value('--policies')!,'utf8')) as ConstitutionStrategies:{};const report=await runPrestigeChain(output,policies,Number(value('--worlds')??6),Number(value('--certificates')??3));console.log(JSON.stringify({complete:true,totalSeconds:report.totalSeconds,reframes:report.reframes,sourceUnchanged:report.sourceUnchanged,output}));}
