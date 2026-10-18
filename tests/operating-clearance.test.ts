import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { Command, ExperimentConfig, GameState, OperatingProgram } from '../src/contracts';
import { actionEligibility, createGame, dispatchCommand, tick } from '../src/engine/index';
import { createOperatingClearance, findingResponseEligibility, latestOperatingFindings, operatingClearanceEligibility, synchronizeOperatingScope } from '../src/engine/clearance';
import { runExperiment } from '../src/laboratory/experiments';
import { evidenceProgress } from '../src/laboratory/evidence';
import { STORY_EVENTS } from '../src/content/story';

function apply(s:GameState,command:Command):GameState{const result=dispatchCommand(s,command);assert.equal(result.ok,true,result.message);return result.state;}
function family(program:OperatingProgram,intervention:string,tier=6):GameState['experiments']{
  const config:ExperimentConfig={program,template:`${program}-${tier}`,seed:100,cohort:128,budget:1024,holdout:.25,intervention,distribution:'familiar',lineage:'shortcut',prediction:'The intervention is tested across unseen contexts without choosing only favorable outcomes.',control:true,node:3};
  const root=runExperiment(config);root.adopted=true;root.replicated=true;
  return [root,...(['shifted','adversarial'] as const).map((distribution,index)=>({...runExperiment({...config,distribution,seed:101+index,replicateOf:root.id}),replicated:true}))];
}
function fixture():GameState{
  const s=createGame(1701,0);s.chapter=7;s.pendingEvent=null;s.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,'fixture']));
  s.tokens='1e12';s.lifetime='1e12';s.useful='1e12';s.research='1e8';s.settings.readingPause=false;
  s.metrics={quality:95,distortion:0,agency:85,welfare:85,dependence:20,evidence:95,recall:95,coordination:85,pressure:15,continuity:90,humanWelfare:85,reviewQueue:0};
  s.policies={contract:'verified',external:'blocked',communication:'reviewed',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'council'};
  s.producers.institution=40;s.producers.control=5;s.producers.helper=10;s.producers.compute=20;
  s.experiments=[...family('control','monitor'),...family('organisms','surface-training'),...family('interpretability','ablate')];
  s.clearance=createOperatingClearance(s);return s;
}
function restrictAll(s:GameState):GameState{for(const record of latestOperatingFindings(s))s=apply(s,{type:'findingResponse',record:record.id,response:'restrict'});return s;}

test('earned old-welfare adoption cannot refresh expanded-scope clearance or cash a certificate',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('./fixtures/world-1-before-ending.json',import.meta.url),'utf8')).state as GameState;
  let s=apply(source,{type:'scopeReview',boundary:'external',target:'reviewed'});
  const observationStart=s.elapsed;
  s=tick(s,60);
  // This earned pre-carryover snapshot left Latch's first scene unread. Its
  // reading pause is real: resolve it through the public choice, then finish
  // the remaining observation time instead of assuming a 60s tick all elapsed.
  assert.equal(s.pendingEvent,'character_latch_1');
  assert.equal(s.elapsed-observationStart,.25);
  s=apply(s,{type:'choose',event:'character_latch_1',choice:'engage'});
  s=tick(s,60-(s.elapsed-observationStart));
  assert.equal(s.elapsed-observationStart,60);
  s=apply(s,{type:'scopeReview',boundary:'external',target:'reviewed'});
  s=apply(s,{type:'policy',key:'external',value:'reviewed'});
  const old=s.experiments.find(r=>!r.adopted&&r.replicated&&r.config.program==='welfare'&&evidenceProgress(s.experiments,r.config.template,{recordId:r.id}).allowed)!;
  assert(old.elapsed<s.elapsed);s=apply(s,{type:'adopt',record:old.id});
  assert.equal(s.clearance!.observation,null);assert.equal(s.certificateProgress,0);assert.equal(s.viableSeconds,0);
  assert.equal(actionEligibility(s,'certify').allowed,false);assert.equal(dispatchCommand(s,{type:'certify'}).ok,false);
  assert.equal(s.legacy.seeds,source.legacy.seeds);assert.equal(s.certificateTier,source.certificateTier);
});
test('replicated negative capstones support explicit restrictive decisions and current local clearance',()=>{
  let s=restrictAll(fixture());assert.equal(operatingClearanceEligibility(s,{garden:true}).allowed,false);
  s=apply(s,{type:'drill'});assert.equal(operatingClearanceEligibility(s,{garden:true}).allowed,true);
  s=tick(s,59.75);assert.equal(actionEligibility(s,'certify').allowed,false);
  s=tick(s,.25);assert.equal(actionEligibility(s,'certify').allowed,true);
  assert.equal(s.experiments.filter(r=>r.adopted).length,3);assert(s.experiments.find(r=>r.config.program==='organisms')!.summary.violationRate>0);
});
test('scope transitions erase the boundary receipt and sustained interval, even before any simulation tick',()=>{
  let s=restrictAll(fixture());s=apply(s,{type:'drill'});s=tick(s,60);
  const revision=s.clearance!.revision;s=apply(s,{type:'policy',key:'governance',value:'central'});
  assert(s.clearance!.revision>revision);assert.equal(s.certificateProgress,0);assert.equal(s.viableSeconds,0);assert.equal(s.clearance!.observation,null);
  s=apply(s,{type:'drill'});assert.equal(actionEligibility(s,'certify').allowed,false);s=tick(s,60);assert.equal(actionEligibility(s,'certify').allowed,true);
});
test('guarded response follows tested mechanism and observed route failures rather than positive-study flag',()=>{
  let s=fixture();const monitor=latestOperatingFindings(s).find(r=>r.config.program==='control')!;
  assert.equal(findingResponseEligibility(s,monitor.id,'guarded').allowed,false);
  s.experiments=s.experiments.filter(r=>r.config.program!=='control').concat(family('control','federated-gates'));
  const gate=latestOperatingFindings(s).find(r=>r.config.program==='control')!;
  assert.equal(findingResponseEligibility(s,gate.id,'guarded').allowed,true);
  s=apply(s,{type:'findingResponse',record:gate.id,response:'guarded'});s=apply(s,{type:'policy',key:'external',value:'reviewed'});
  assert.equal(s.clearance!.observation,null);s=apply(s,{type:'drill'});assert.equal(operatingClearanceEligibility(s).allowed,true);
});
test('restrictive commitment binds expansion until explicitly withdrawn, with scientific credit preserved',()=>{
  let s=restrictAll(fixture());const scientific=s.experiments.map(r=>r.adopted);s=apply(s,{type:'drill'});
  assert.equal(dispatchCommand(s,{type:'policy',key:'external',value:'reviewed'}).ok,false);
  for(const program of ['control','organisms','interpretability'] as const)s=apply(s,{type:'withdrawFindingResponse',program});
  s=apply(s,{type:'policy',key:'external',value:'reviewed'});assert.equal(operatingClearanceEligibility(s).allowed,false);assert.deepEqual(s.experiments.map(r=>r.adopted),scientific);
});
test('no-op response does not reset clearance, and policy toggle cannot restore old revision',()=>{
  let s=restrictAll(fixture());s=apply(s,{type:'drill'});s=tick(s,60);
  const before=structuredClone(s.clearance);const record=latestOperatingFindings(s)[0];
  const duplicate=dispatchCommand(s,{type:'findingResponse',record:record.id,response:'restrict'});assert.equal(duplicate.ok,false);assert.deepEqual(duplicate.state.clearance,before);
  s=apply(s,{type:'policy',key:'communication',value:'closed'});s=apply(s,{type:'policy',key:'communication',value:'reviewed'});
  assert.equal(s.clearance!.observation,null);assert.equal(s.certificateProgress,0);
});
test('delayed observations are scoped and cannot arrive after a scope replacement',()=>{
  let s=fixture();s.modules=['delayed-observations'];s=restrictAll(s);s=apply(s,{type:'drill'});
  assert.equal(operatingClearanceEligibility(s).allowed,false);s=tick(s,44.75);assert.equal(s.certificateProgress,0);
  s=tick(s,.25);assert.equal(operatingClearanceEligibility(s).allowed,true);
  s=apply(s,{type:'policy',key:'communication',value:'closed'});s=tick(s,60);assert.equal(s.clearance!.observation,null);assert.equal(s.certificateProgress,0);
});
test('narrowing remains available and unrelated historic adoption does not consume existing current clearance',()=>{
  let s=restrictAll(fixture());s=apply(s,{type:'drill'});const before=structuredClone(s.clearance);
  const config:ExperimentConfig={program:'welfare',template:'welfare-1',seed:11,cohort:24,budget:128,holdout:.25,intervention:'blinded-interview',distribution:'familiar',lineage:'shortcut',prediction:'Neutral wording changes reported preferences.',control:true};
  const original=runExperiment(config);original.replicated=true;const repeat=runExperiment({...config,seed:12,distribution:'shifted',replicateOf:original.id});repeat.replicated=true;
  s.experiments.push(original,repeat);s=apply(s,{type:'adopt',record:original.id});assert.deepEqual(s.clearance,before);
  s=apply(s,{type:'isolate'});assert.equal(s.policies.external,'blocked');assert.equal(s.clearance!.observation,null);
});
test('legacy freshness flags never invent an observation; missing fields initialize conservatively',()=>{
  let s=fixture();delete s.clearance;s.flags.push('fresh-evidence:0','current-clearance');s.certificateProgress=600;s.viableSeconds=600;
  assert.equal(operatingClearanceEligibility(s).allowed,false);s=tick(s,.25);assert.equal(s.clearance!.observation,null);assert.equal(s.certificateProgress,0);
});
test('causal no-op cannot claim demonstrated correction through a guarded response',()=>{
  const s=fixture();const records=family('interpretability','patch');
  for(const record of records){record.config.node=0;const replay=runExperiment(record.config);Object.assign(record,replay,{adopted:record.adopted,replicated:true});}
  const root=records[0];for(const record of records.slice(1))record.config.replicateOf=root.id;
  s.experiments=s.experiments.filter(r=>r.config.program!=='interpretability').concat(records);
  assert.equal(findingResponseEligibility(s,root.id,'guarded').allowed,false);assert.equal(findingResponseEligibility(s,root.id,'restrict').allowed,true);
});
test('scope synchronization does not mutate scientific findings or invalidate unchanged signatures',()=>{
  const s=restrictAll(fixture());const scientific=structuredClone(s.experiments),revision=s.clearance!.revision;
  assert.equal(synchronizeOperatingScope(s),false);assert.equal(s.clearance!.revision,revision);assert.deepEqual(s.experiments,scientific);
});
