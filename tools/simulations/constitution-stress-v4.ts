/** Paired, player-induced disruptions using earned checkpoints and public engine commands only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import type { Command, ConstitutionId, GameState } from '../../src/contracts';
import type { CharterActionId, CharterActionQuote, CharterMode } from '../../src/constitution/types';
import { dispatchCommand, getRates, tick } from '../../src/engine';
import { getCharterActions, charterGardenEligibility } from '../../src/constitution/economics';
import { parseSave, serializeSave, getValidationCatalog } from '../../src/persistence';
import { charterStocks, createCharterObserver } from './charter-metrics-v4';
import { fingerprint } from './constitution-matrix-v4';
import type { Trace } from './optimized-v4';

const IDS:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
const digest=(state:GameState)=>createHash('sha256').update(JSON.stringify(state)).digest('hex');
const sub=(after:string,before:string)=>new Decimal(after).sub(before).toString();
function snapshot(s:GameState){return {elapsed:s.elapsed,tokens:s.tokens,research:s.research,lifetime:s.lifetime,useful:s.useful,metrics:s.metrics,allocation:s.allocation,rates:getRates(s),stocks:charterStocks(s.charter),charter:structuredClone(s.charter)};}
function runner(initial:GameState){
 let state=structuredClone(initial);const trace:Trace[]=[],observer=createCharterObserver(initial),notes:string[]=[];
 function command(cmd:Command,required=true){const before=state,result=dispatchCommand(state,cmd);trace.push({kind:'command',at:before.elapsed,command:cmd,ok:result.ok,message:result.message});observer.observe({kind:'command',before,after:result.state,command:cmd,ok:result.ok,message:result.message});state=result.state;if(!result.ok){notes.push(result.message);if(required)throw new Error(`${initial.constitution}: ${JSON.stringify(cmd)}: ${result.message}`);}return result.ok;}
 function advance(seconds:number){const target=state.elapsed+seconds;while(state.elapsed<target){const before=state,requested=Math.min(5,target-state.elapsed),after=tick(state,requested),actual=after.elapsed-before.elapsed;trace.push({kind:'tick',at:before.elapsed,requested,actual});observer.observe({kind:'tick',before,after,requested,actual});state=after;if(actual<=0)throw new Error('Stress clock stopped; inspect the recorded state.');}}
 function action(action:CharterActionId,target?:number,secondary?:number,required=true){const q=getCharterActions(state).find(item=>item.action===action&&item.target===target&&item.secondary===secondary);if(!q?.allowed){const reason=q?.reason??'No matching offered operation.';notes.push(`${action}: ${reason}`);if(required)throw new Error(`${initial.constitution}: ${action}: ${reason}`);return false;}return command({type:'charterAction',action,target,secondary},required);}
 function quote(action:CharterActionId){return getCharterActions(state).find(item=>item.action===action&&item.allowed);}
 function perform(q:CharterActionQuote|undefined,required=true){if(!q){if(required)throw new Error('No eligible operation.');return false;}return action(q.action,q.target,q.secondary,required);}
 function mode(mode:CharterMode){return command({type:'charterConfigure',mode});}
 return {get state(){return state;},trace,notes,command,advance,action,quote,perform,mode,metrics:()=>observer.finish(state)};
}
type Runner=ReturnType<typeof runner>;
function normalize(r:Runner){
 if(r.state.ending)throw new Error('Stress requires a live earned checkpoint.');
 if(!r.state.charter?.established)throw new Error('Stress requires an established earned charter.');
 if(r.state.charter.automation)r.command({type:'charterAutomation',enabled:false});
 r.command({type:'settings',settings:{readingPause:false,speed:1}});
 if(r.state.activeExperiment)throw new Error('Use a checkpoint with no active experiment.');
}
function closeCommitments(r:Runner){
 for(let n=0;n<5;n++){
  const q=r.quote('settleService')??r.quote('settleTender')??r.quote('withdraw');
  if(!q)break;r.perform(q);
 }
}
function earnOperatingReserve(r:Runner,action:CharterActionId,multiple=1){
 const deadline=r.state.elapsed+600;
 for(;;){
  const q=getCharterActions(r.state).find(q=>q.action===action);
  if(!q)throw new Error(`${action}: no offered operation for the preparation.`);
  if(q.allowed&&new Decimal(r.state.tokens).gte(new Decimal(q.cost).mul(multiple)))return;
  if(r.state.elapsed>=deadline)throw new Error(`${action}:600seconds of actual ordinary work did not fund the planned commitment: ${q.reason}`);
  r.advance(5);
 }
}
function prepare(r:Runner){
 normalize(r);
 switch(r.state.constitution){
  case 'commons':{
   r.command({type:'allocation',allocation:{production:.7,research:.2,review:.1}});
   r.mode('open');
   for(const focus of ['oversight','control','organisms','interpretability'] as const){r.command({type:'charterConfigure',focus});r.action('publish',1,undefined,false);}
   r.advance(1800);
   break;
  }
  case 'service':closeCommitments(r);r.mode('buffers');earnOperatingReserve(r,'acceptService');r.action('acceptService');break;
  case 'frontier':closeCommitments(r);r.mode('speed');earnOperatingReserve(r,'bid',3);for(let n=0;n<3;n++)r.action('bid');break;
  default:break;
 }
}
function disrupt(r:Runner){
 switch(r.state.constitution){
  case 'commons':while(r.perform(r.quote('retract'),false)){}break;
  case 'precaution':while(r.perform(r.quote('retireTranche'),false)){}break;
  case 'service':r.command({type:'charterConfigure',allocation:[1,0,0,0]});r.advance(180);break;
  case 'federation':r.command({type:'charterConfigure',mode:'ring',allocation:[1,0,0]});r.advance(180);break;
  case 'plural':r.action('withdraw');r.advance(180);break;
  case 'frontier':r.command({type:'allocation',allocation:{production:0,research:.7,review:.3}});r.advance(1800);break;
 }
}
function recover(r:Runner,preparation:GameState){
 switch(r.state.constitution){
  case 'commons':
   r.mode('open');for(const focus of ['oversight','control','organisms','interpretability'] as const){r.command({type:'charterConfigure',focus});r.action('publish',1,undefined,false);}r.action('publish',6,undefined,false);break;
  case 'precaution':r.mode('broad');if(!r.action('openTranche',3,undefined,false))r.action('openTranche',1,undefined,false);break;
  case 'service':r.mode('urgent');break;
  case 'federation':{
   r.command({type:'charterConfigure',mode:'redundant',allocation:[1/3,1/3,1/3]});
   if(r.state.charter?.kind==='federation'){
    const richest=r.state.charter.data.districts.map((d,i)=>({i,treasury:new Decimal(d.treasury)})).sort((a,b)=>b.treasury.cmp(a.treasury))[0].i;
    const poorest=r.state.charter.data.districts.map((d,i)=>({i,treasury:new Decimal(d.treasury)})).sort((a,b)=>a.treasury.cmp(b.treasury))[0].i;
    if(richest!==poorest)r.action('transferDistrict',richest,poorest,false);
   }
   break;
  }
  case 'plural':r.action('fundCare',undefined,undefined,false);r.mode('rotation');for(let target=0;target<3;target++)r.action('negotiate',target,undefined,false);r.perform(r.quote('preserve'),false);break;
  case 'frontier':
   while(r.perform(r.quote('settleTender'),false)){}
   r.mode('public');r.perform(r.quote('disclose'),false);r.action('bid',undefined,undefined,false);break;
 }
 if(r.state.constitution==='frontier')r.command({type:'allocation',allocation:preparation.allocation});
}
function operate(r:Runner,seconds:number,recovery:boolean){
 const target=r.state.elapsed+seconds;
 while(r.state.elapsed<target){
  r.advance(Math.min(30,target-r.state.elapsed));
  if(recovery){
   if(r.state.constitution==='service'){r.mode('urgent');r.perform(r.quote('settleService'),false);}
   if(r.state.constitution==='frontier')r.perform(r.quote('settleTender'),false);
   if(r.state.constitution==='precaution'&&!charterGardenEligibility(r.state).allowed){const q=getCharterActions(r.state).find(q=>q.action==='openTranche'&&q.target===3&&q.allowed);r.perform(q,false);}
  }
 }
}
function outcome(start:GameState,end:GameState){return {seconds:end.elapsed-start.elapsed,walletDelta:sub(end.tokens,start.tokens),researchDelta:sub(end.research,start.research),earnedLifetimeDelta:sub(end.lifetime,start.lifetime),usefulDelta:sub(end.useful,start.useful),stocks:charterStocks(end.charter),rates:getRates(end),metrics:end.metrics,charterGardenEligibility:charterGardenEligibility(end)};}
function recovered(state:GameState):boolean{
 const c=state.charter;if(!c)return false;
 switch(c.kind){
  case 'commons':return c.data.methods.filter(m=>!m.retired&&m.maintenance>=30).length>=2&&c.data.methods.some(m=>m.uses>0)&&charterGardenEligibility(state).allowed;
  case 'precaution':return c.data.tranches.some(t=>t.active&&t.capacity>150)&&charterGardenEligibility(state).allowed;
  case 'service':return !c.data.active;
  case 'federation':return c.data.transfers.length===0&&Math.min(...c.data.allocation)>0;
  case 'plural':return new Decimal(c.data.careReserve).gt(0)&&c.data.unmet<=1&&c.data.cohorts.every(c=>c.accepted);
  case 'frontier':return c.data.tenders.length===0;
 }
}
const descriptions:Record<ConstitutionId,string>={
 commons:'Retraction of an actively reused dependency library, followed by paid rebuilding. Research allocation is held at20% in both branches. Rebuilding starts with zero reuse and must earn its benefit again.',
 precaution:'Retirement of every bonded deployment tranche. Recovery pays for a new tested capstone case; the comparison retains only lawful local fallback.',
 service:'A real four-lane promise receives all capacity in the first lane for180seconds. Recovery follows remaining demand and settles actual delivery; comparison preserves the uneven assignment.',
 federation:'All work is assigned to one district for180seconds. Recovery uses redundant balanced routing and one funded treasury transfer; comparison retains stranded capacity.',
 plural:'All unspent care funding is withdrawn for180seconds. Recovery funds care, negotiates rotating agreements, and preserves actual duties; comparison continues bounded unfunded work.',
 frontier:'Three affordable speed tenders are offered, then production is deliberately suspended for their1800second deadline. Both branches resume ordinary allocation; recovery settles actual losses and attempts a public-benefit tender.'};
async function main(){
 const args=process.argv.slice(2),arg=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
 const matrix=resolve(arg('--matrix','qa/simulations-v4/constitutions/final')),out=resolve(arg('--out','qa/simulations-v4/constitutions/stress-diagnostic'));
 if(!out.toLowerCase().includes('simulations-v4'))throw new Error('Stress artifacts must use a new v4 folder.');
 const ids=arg('--constitutions',IDS.join(',')).split(',') as ConstitutionId[];if(ids.some(id=>!IDS.includes(id)))throw new Error('Unknown constitution.');
 const sourceBefore=await fingerprint();await mkdir(out,{recursive:true});const results=[];
 for(const constitution of ids){
  const input=join(matrix,constitution,'earned-checkpoints','operating-ready.json'),raw=await readFile(input,'utf8'),parsed=parseSave(raw,getValidationCatalog());if(!parsed.ok)throw new Error(parsed.message);
  const initial=parsed.state;if(initial.constitution!==constitution)throw new Error('Checkpoint constitution mismatch.');
  const prep=runner(initial);prepare(prep);const prepared=structuredClone(prep.state);disrupt(prep);const damaged=structuredClone(prep.state),dir=join(out,constitution);await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'initial.json'),serializeSave(initial,0));await writeFile(join(dir,'damaged.json'),serializeSave(damaged,0));await writeFile(join(dir,'disruption-trace.jsonl'),prep.trace.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const branches=[];
  for(const recovery of [false,true]){
   const r=runner(damaged),name=recovery?'recovered':'continued-disruption';
   if(recovery)recover(r,prepared);else if(constitution==='frontier')r.command({type:'allocation',allocation:prepared.allocation});
   const immediately=snapshot(r.state);operate(r,constitution==='commons'?1800:constitution==='frontier'?900:300,recovery);
   const save=serializeSave(r.state,0),validation=parseSave(save,getValidationCatalog());if(!validation.ok)throw new Error(`${constitution}/${name}: ${validation.message}`);
   await writeFile(join(dir,`${name}-ending.json`),save);await writeFile(join(dir,`${name}-trace.jsonl`),r.trace.map(row=>JSON.stringify(row)).join('\n')+'\n');
   branches.push({name,initialStateSha256:digest(damaged),endingStateSha256:digest(r.state),recovered:recovered(r.state),immediately,outcome:outcome(damaged,r.state),metrics:r.metrics(),notes:r.notes});
  }
  results.push({constitution,description:descriptions[constitution],input,inputSha256:createHash('sha256').update(raw).digest('hex'),initialStateSha256:digest(initial),prepared:snapshot(prepared),damaged:snapshot(damaged),disruption:outcome(prepared,damaged),preparationNotes:prep.notes,branches});
  await writeFile(join(out,'stress.json'),JSON.stringify({sourceBefore,results},null,2));console.log(JSON.stringify({constitution,recovered:branches[1].recovered,unrecovered:branches[0].recovered,recoveryNotes:branches[1].notes}));
 }
 const sourceAfter=await fingerprint(),unchangedSourceDuringRun=sourceBefore.sha256===sourceAfter.sha256;
 await writeFile(join(out,'stress.json'),JSON.stringify({sourceBefore,sourceAfter,unchangedSourceDuringRun,method:'Every initial state is an earned native matrix checkpoint. Preparation, disruption, recovery, and comparison are public commands and real ticks. Both branches share the exact damaged state. These are player-induced disruptions, not sampled random shocks, guaranteed optimizers, or full repeated campaigns. Deferred pay and refunded principal remain distinct from lifetime earned income. Both branches run for equal active time.',results},null,2));
 const lines=['# V4 constitutional disruption and recovery probes','',`Unchanged source: **${unchangedSourceDuringRun}**.`,'','Every disruption and recovery is a public action using earned resources. These probes compare local operating outcomes, not the fastest full campaign. Research preparation, damage, and recovery costs are retained in the saved trace. A successful recovery flag means the declared local condition was restored; it does not certify universal robustness.','','| Constitution | Recovery condition restored | Continued disruption also recovered | Earned income during recovery window | Useful work during recovery window |','| --- | --- | --- | ---: | ---: |'];
 for(const result of results){const b=result.branches;lines.push(`| ${result.constitution} | ${b[1].recovered} | ${b[0].recovered} | ${b[1].outcome.earnedLifetimeDelta} | ${b[1].outcome.usefulDelta} |`);}
 lines.push('','Exact command quotes, before/after ledgers, rates, obligations, and both branch traces are in stress.json and the constitution folders. Wallet gains may include principal release. Rate integrals are beginning-of-tick estimates; cumulative lifetime and useful deltas are exact engine outcomes.');await writeFile(join(out,'STRESS.md'),lines.join('\n')+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
