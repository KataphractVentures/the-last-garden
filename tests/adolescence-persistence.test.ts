import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GameState } from '../src/contracts';
import type { GovernanceState } from '../src/governance/types';
import type { SocietyState } from '../src/society/types';
import { createGame } from '../src/engine';
import { createOperatingClearance, operatingScope, registerBoundaryObservation } from '../src/engine/clearance';
import { createGovernanceState, applyGovernanceCommand } from '../src/governance';
import { createCharterEconomy } from '../src/constitution/economics';
import { runExperiment } from '../src/laboratory/experiments';
import { getValidationCatalog } from '../src/persistence';
import { parseSave, serializeSave, validateSaveState } from '../src/persistence/validation';

type AuditState=GameState & {governance?:GovernanceState;society?:SocietyState};
const catalog=getValidationCatalog();

// A compact structural fixture retains complete observations and real finding
// text; engine-behavior tests separately earn and apply the corresponding decisions.
function currentWorld():AuditState {
  const state:AuditState=createGame(617,1000);
  state.elapsed=1000;state.chapter=7;state.pendingEvent=null;
  const record=runExperiment({program:'control',template:'control-1',seed:17,cohort:32,budget:128,holdout:.25,intervention:'least-privilege',distribution:'familiar',lineage:'clean',prediction:'The permission edge should confine the tested route.',control:true});
  record.elapsed=100;record.adopted=true;state.experiments=[record];
  state.clearance=createOperatingClearance(state);
  state.clearance.decisions.control={program:'control',record:record.id,response:'restrict',decidedAt:120,claim:record.conclusion,limitation:record.limitation};
  registerBoundaryObservation(state,90);
  state.governance=createGovernanceState(state);
  assert.equal(applyGovernanceCommand(state,{type:'publicMandate'}).ok,true);
  state.society={version:1,introducedAt:500,legacyBaseline:true,
    decisions:{transition:'augmentation',distribution:'services',life:'local'},
    communities:[
      {id:'harbor',income:70,access:80,ownership:15,transition:60,projectContinuity:70,meaning:75},
      {id:'riverside',income:65,access:82,ownership:20,transition:65,projectContinuity:75,meaning:80},
      {id:'hill',income:78,access:81,ownership:65,transition:60,projectContinuity:80,meaning:85},
    ],
    cases:[{id:'requester',response:'comply',resolvedAt:700,harm:0,repairStartedAt:750,repaired:true},{id:'sponsor',response:'appeal',resolvedAt:800,harm:0,repairStartedAt:null,repaired:false}],
    transitionRemaining:10,lastPaidRate:'1.23456789123456789e+30',spent:'9.123456789123456789e+40',funding:.8,
    receipts:[{time:600,kind:'decision',id:'transition',choice:'augmentation',title:'The transition commitment',text:'Skills and household resources have a separate history.'},{time:700,kind:'human-misuse',id:'requester',choice:'comply',title:'A harmful mandate',text:'The controller’s request was followed.'},{time:750,kind:'repair',id:'requester',choice:'restitution',title:'Repair begins',text:'Restitution remains separate from productive output.'}],
  };
  return state;
}
function withCheckpoint(state:AuditState):AuditState {
  const archived=structuredClone(state);archived.id='archived-audit-world';
  const {legacy:_legacy,...checkpoint}=archived;
  state.legacy.branches.push({id:archived.id,parentId:null,name:'Earlier public compact',constitution:archived.constitution,cycle:0,seed:archived.seed,chapter:archived.chapter,createdAt:1000,summary:'A preserved historical decision.',checkpoint});
  return state;
}
function expectInvalid(source:AuditState,mutate:(state:AuditState)=>void,pattern?:RegExp){
  const candidate=structuredClone(source);mutate(candidate);const result=validateSaveState(candidate,catalog);
  assert.equal(result.ok,false);if(!result.ok&&pattern)assert.match(result.message,pattern);
}

test('current operating, public, and social records round-trip exactly in active and archived worlds',()=>{
  const source=withCheckpoint(currentWorld()),before=structuredClone(source);
  const result=parseSave(serializeSave(source,2000),catalog);
  assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok)assert.deepEqual(result.state,source);
  assert.deepEqual(source,before,'validation must never mutate the input');
});

test('a queued delayed observation retains its future arrival time on export and import',()=>{
  const source=currentWorld();source.modules=['delayed-observations'];source.clearance=createOperatingClearance(source);registerBoundaryObservation(source,83);
  assert.equal(source.clearance.observation?.availableAt,1045);
  const result=parseSave(serializeSave(source),catalog);assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok)assert.deepEqual(result.state,source);
});

test('legacy active and archived histories stay absent rather than acquiring invented public choices or clearance',()=>{
  const source=withCheckpoint(currentWorld());delete source.clearance;delete source.governance;delete source.society;
  const checkpoint=source.legacy.branches[0].checkpoint!;delete checkpoint.clearance;delete (checkpoint as AuditState).governance;delete (checkpoint as AuditState).society;
  const before=structuredClone(source),result=parseSave(serializeSave(source),catalog);assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok){
    for(const world of [result.state,result.state.legacy.branches[0].checkpoint!])for(const key of ['clearance','governance','society'])assert.equal(Object.hasOwn(world,key),false);
    assert.deepEqual(result.state,source);
  }
  assert.deepEqual(source,before);
});

test('earned pre-audit campaign and checkpoint exports remain importable without retrospective new-system history',()=>{
  const text=readFileSync(new URL('./fixtures/garden.save.json',import.meta.url),'utf8');
  const parsed=parseSave(text,catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  if(parsed.ok){
    for(const key of ['clearance','governance','society'])assert.equal(Object.hasOwn(parsed.state,key),false);
    const roundtrip=parseSave(serializeSave(parsed.state),catalog);assert.ok(roundtrip.ok,roundtrip.ok?'':roundtrip.message);
    if(roundtrip.ok)assert.deepEqual(roundtrip.state,parsed.state);
  }
});

test('stale scope receipts lose clearance and sustained counters while preserving findings and public history',()=>{
  const source=withCheckpoint(currentWorld());source.policies.external='reviewed';source.viableSeconds=180;source.certificateProgress=200;
  const checkpoint=source.legacy.branches[0].checkpoint!;checkpoint.policies.communication='reviewed';checkpoint.viableSeconds=180;checkpoint.certificateProgress=200;
  const before=structuredClone(source),result=validateSaveState(source,catalog);assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok){
    for(const world of [result.state,result.state.legacy.branches[0].checkpoint!]){
      assert.equal(world.clearance?.scope,operatingScope(world));assert.equal(world.clearance?.observation,null);
      assert.equal(world.viableSeconds,0);assert.equal(world.certificateProgress,0);assert.equal(world.clearance?.decisions.control?.response,'restrict');
      assert.deepEqual((world as AuditState).society,source.society);
    }
  }
  assert.deepEqual(source,before);
});

test('an observation from an older revision is invalidated without dropping the research response',()=>{
  const source=currentWorld();source.clearance!.revision=2;source.viableSeconds=180;source.certificateProgress=180;
  const result=validateSaveState(source,catalog);assert.ok(result.ok,result.ok?'':result.message);
  if(result.ok){assert.equal(result.state.clearance?.observation,null);assert.equal(result.state.viableSeconds,0);assert.equal(result.state.certificateProgress,0);assert.deepEqual(result.state.clearance?.decisions,source.clearance?.decisions);}
});

test('stale receipt normalization cannot overflow the supported revision range',()=>{
  const source=currentWorld();source.clearance!.revision=1e9;source.clearance!.observation!.revision=1e9;source.policies.external='reviewed';
  const before=structuredClone(source),result=validateSaveState(source,catalog);assert.equal(result.ok,false);
  if(!result.ok)assert.match(result.message,/revision range/);assert.deepEqual(source,before);
});

test('operating receipts reject invented findings, altered claims, future clocks, and unknown fields',()=>{
  const source=currentWorld();
  for(const mutate of [
    (s:AuditState)=>{s.clearance!.decisions.control!.record='missing';},
    (s:AuditState)=>{s.experiments[0].adopted=false;},
    (s:AuditState)=>{s.clearance!.decisions.control!.claim='All deployments are safe.';},
    (s:AuditState)=>{s.clearance!.decisions.control!.decidedAt=50;},
    (s:AuditState)=>{s.clearance!.observation!.observedAt=1001;},
    (s:AuditState)=>{s.clearance!.observation!.availableAt=1001;},
    (s:AuditState)=>{s.clearance!.revision=Infinity;},
    (s:AuditState)=>{(s.clearance as unknown as Record<string,unknown>).grantsAllScopes=true;},
  ])expectInvalid(source,mutate);
});

test('public authority rejects fabricated timestamps, duplicate grants, and malformed compact verification',()=>{
  const source=currentWorld();source.governance!.reviews=[{boundary:'external',from:'blocked',target:'reviewed',requestedAt:800,status:'approved',decidedAt:860,attempts:2,reason:'Conditions met.'}];
  source.governance!.actor={capability:30,terms:'inspection',acceptedAt:600,verifiedAt:720,verified:true,observedSeconds:120,reason:'Reciprocal observation.'};
  const valid=parseSave(serializeSave(source),catalog);assert.ok(valid.ok,valid.ok?'':valid.message);if(valid.ok)assert.deepEqual(valid.state,source);
  for(const mutate of [
    (s:AuditState)=>{s.flags=s.flags.filter(flag=>flag!=='independent_authority');},
    (s:AuditState)=>{s.governance!.reviews.push({...s.governance!.reviews[0]});},
    (s:AuditState)=>{s.governance!.reviews[0].decidedAt=799;},
    (s:AuditState)=>{s.governance!.reviews[0].status='pending';},
    (s:AuditState)=>{s.governance!.reviews[0].from='open';},
    (s:AuditState)=>{s.governance!.actor.terms='none';},
    (s:AuditState)=>{s.governance!.actor.verifiedAt=null;},
    (s:AuditState)=>{s.governance!.actor.observedSeconds=241;},
  ])expectInvalid(source,mutate);
});

test('social histories reject impossible restitution, mismatched choices, malformed shares, and receipt floods',()=>{
  const source=currentWorld();
  for(const mutate of [
    (s:AuditState)=>{s.society!.introducedAt=1001;},
    (s:AuditState)=>{s.society!.decisions.transition='mandate';},
    (s:AuditState)=>{s.society!.communities[0].ownership=90;},
    (s:AuditState)=>{s.society!.communities[0].access=101;},
    (s:AuditState)=>{s.society!.cases[1].harm=10;},
    (s:AuditState)=>{s.society!.cases[0].repairStartedAt=null;},
    (s:AuditState)=>{s.society!.receipts[0].choice='mandate';},
    (s:AuditState)=>{s.society!.receipts=Array.from({length:33},()=>s.society!.receipts[0]);},
    (s:AuditState)=>{s.society!.funding=1.01;},
    (s:AuditState)=>{s.society!.spent='Infinity';},
  ])expectInvalid(source,mutate);
});

test('invalid new fields cannot be hidden inside an inactive branch checkpoint',()=>{
  const source=withCheckpoint(currentWorld());
  expectInvalid(source,s=>{s.legacy.branches[0].checkpoint!.clearance!.decisions.control!.record='missing';},/checkpoint.*record/);
  expectInvalid(source,s=>{(s.legacy.branches[0].checkpoint as AuditState).society!.receipts[0].time=2000;},/checkpoint.*receipts/);
  expectInvalid(source,s=>{(s.legacy.branches[0].checkpoint as AuditState).governance!.actor.capability=-1;},/checkpoint.*actor/);
});

test('Federation returnable capital is bounded by current funds and never inferred for older balances',()=>{
  const source=currentWorld();source.constitution='federation';source.charter=createCharterEconomy('federation');assert.equal(source.charter?.kind,'federation');
  if(source.charter?.kind!=='federation')return;
  source.charter.data.districts[0].treasury='1000';source.charter.data.districts[0].returnable='300';source.clearance=createOperatingClearance(source);
  let parsed=parseSave(serializeSave(source),catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);if(parsed.ok)assert.deepEqual(parsed.state,source);
  expectInvalid(source,s=>{if(s.charter?.kind==='federation')s.charter.data.districts[0].returnable='1001';},/returnable/);
  delete source.charter.data.districts[0].returnable;
  parsed=parseSave(serializeSave(source),catalog);assert.ok(parsed.ok,parsed.ok?'':parsed.message);
  if(parsed.ok&&parsed.state.charter?.kind==='federation')assert.equal(Object.hasOwn(parsed.state.charter.data.districts[0],'returnable'),false);
});
