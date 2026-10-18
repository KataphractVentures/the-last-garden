import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExperimentConfig, ExperimentRecord } from '../src/contracts';
import { createGame } from '../src/engine';
import { runExperiment } from '../src/laboratory/experiments';
import { capstoneEvidenceEligibility, evidenceProgress, evidenceRequirement, nextReplicationDistribution, prepareStrongerConfig, projectEvidenceEligibility, protectedEvidenceRecordIds } from '../src/laboratory/evidence';
import { RESEARCH_PROJECTS } from '../src/laboratory/projects';
import { parseSave, serializeSave } from '../src/persistence/validation';

function config(tier:number,patch:Partial<ExperimentConfig>={}):ExperimentConfig{return {program:'oversight',template:`oversight-${tier}`,seed:10,cohort:128,budget:512,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'shortcut',prediction:'The untouched comparison may reveal that the proposed intervention does not help.',control:true,node:3,...patch};}
function family(c:ExperimentConfig,runs=3):ExperimentRecord[]{const root=runExperiment(c);const records=[root];for(let i=1;i<runs;i++)records.push(runExperiment({...c,seed:c.seed+i,distribution:i===1?'shifted':'adversarial',replicateOf:root.id}));return records;}

test('every tier requires its actual sample and held-out minimum per independent run',()=>{
  for(let tier=1;tier<=6;tier++){
    const requirement=evidenceRequirement(`oversight-${tier}`);
    const strong=family(config(tier,{cohort:requirement.completed,budget:512}));
    assert.equal(evidenceProgress(strong,`oversight-${tier}`).allowed,true,`tier ${tier}`);
    if(tier>1){const small=family(config(tier,{cohort:8,budget:32}));small[0].adopted=true;
      assert.equal(evidenceProgress(small,`oversight-${tier}`,{adoptedOnly:true}).allowed,false,`tiny tier ${tier}`);}
  }
});

test('a nominally large cohort cannot substitute for completed observations or held-out comparisons',()=>{
  const underfunded=family(config(6,{cohort:128,budget:32,intervention:'escalation'}));
  assert.deepEqual(underfunded[0].evidence,{version:1,completed:8,heldOut:0,controlled:0});
  assert.equal(evidenceProgress(underfunded,'oversight-6').allowed,false);
  const partial=family(config(6,{cohort:128,budget:400,intervention:'escalation'}));
  assert.equal(partial[0].evidence!.completed,100);assert.equal(partial[0].evidence!.heldOut,4);
  assert.equal(evidenceProgress(partial,'oversight-6').allowed,false);
  assert.equal(evidenceProgress(family(config(6,{control:false})),'oversight-6').allowed,false);
});

test('capstones require two independent replications and both shifted and adversarial contexts',()=>{
  const records=family(config(6));assert.equal(evidenceProgress(records.slice(0,2),'oversight-6').allowed,false);
  assert.equal(evidenceProgress(records,'oversight-6').allowed,true);
  const familiar=[records[0],runExperiment({...config(6),seed:11,replicateOf:records[0].id}),runExperiment({...config(6),seed:12,replicateOf:records[0].id})];
  assert.equal(evidenceProgress(familiar,'oversight-6').allowed,false);
  assert.equal(nextReplicationDistribution([records[0]],records[0]),'shifted');
  assert.equal(nextReplicationDistribution(records.slice(0,2),records[0]),'adversarial');
});

test('same-seed exact replays cannot multiply sample size or independent replication',()=>{
  const records=family(config(6));
  const replay=runExperiment({...records[1].config,distribution:'adversarial'});replay.id+='-replayed';
  assert.equal(evidenceProgress([records[0],records[1],replay],'oversight-6').allowed,false);
  const copies=Array.from({length:12},(_,i)=>({...records[0],id:`copy-${i}`,config:{...records[0].config,replicateOf:records[0].id}}));
  assert.equal(evidenceProgress([records[0],...copies],'oversight-6').qualifiedRuns,1);
});

test('different hypotheses, interventions, lineages, sample plans, or nodes cannot pool their evidence',()=>{
  for(const patch of [{lineage:'inherited'},{prediction:'A different claim.'},{intervention:'decomposition'},{node:2},{cohort:256},{budget:1024},{holdout:.5}] as Partial<ExperimentConfig>[]){
    const records=family(config(6));records[2]=runExperiment({...records[2].config,...patch});
    assert.equal(evidenceProgress(records,'oversight-6').allowed,false,JSON.stringify(patch));
  }
  const unrelated=family(config(6));delete unrelated[2].config.replicateOf;
  assert.equal(evidenceProgress(unrelated,'oversight-6').allowed,false,'unlinked independent claim is not a registered replication');
});

test('unfavorable and null findings qualify on methods, without a favorable metric threshold',()=>{
  const records=family(config(6));assert(records.some(record=>record.summary.violationRate>30));
  records[0].adopted=true;
  assert.equal(projectEvidenceEligibility({experiments:records},RESEARCH_PROJECTS.find(p=>p.id==='oversight-9')!).allowed,true);
  const nullRecords=family({...config(6),program:'organisms',template:'organisms-6',lineage:'clean'});
  assert(nullRecords.every(record=>record.summary.violationRate===0));
  assert.equal(evidenceProgress(nullRecords,'organisms-6').allowed,true);
});

test('receipts preserve independent proof when raw rows are compacted and after save import',()=>{
  const state=createGame(10,1000);state.experiments=family(config(6));state.experiments[0].adopted=true;
  const protectedIds=protectedEvidenceRecordIds(state.experiments);
  for(const record of state.experiments){assert(protectedIds.has(record.id));record.observations=[];}
  assert.equal(evidenceProgress(state.experiments,'oversight-6',{adoptedOnly:true}).allowed,true);
  const imported=parseSave(serializeSave(state));assert(imported.ok);
  assert.equal(evidenceProgress(imported.state.experiments,'oversight-6',{adoptedOnly:true}).allowed,true);
  const reordered=structuredClone(state);reordered.experiments=family(config(6));
  for(const record of reordered.experiments){record.summary=Object.fromEntries(Object.entries(record.summary).reverse()) as typeof record.summary;record.observations=record.observations.map(o=>Object.fromEntries(Object.entries(o).reverse()) as typeof o);}
  assert.equal(parseSave(serializeSave(reordered)).ok,true,'harmless JSON property ordering does not change evidence');
  const forged=structuredClone(state);forged.experiments[0].evidence!.completed++;
  assert.equal(parseSave(serializeSave(forged)).ok,false);
});

test('legacy compacted records recover only exactly reproducible historical work, including branch checkpoints',()=>{
  const state=createGame(10,1000);state.experiments=family(config(6,{budget:32,intervention:'escalation'}));
  state.experiments[0].adopted=true;for(const record of state.experiments){delete record.evidence;record.observations=[];}
  const {legacy,...checkpoint}=structuredClone(state);
  state.legacy.branches.push({id:'old',parentId:null,name:'Old laboratory',constitution:'commons',cycle:0,seed:10,chapter:1,createdAt:1000,summary:'Old records',checkpoint});
  const imported=parseSave(serializeSave(state));assert(imported.ok);
  assert.deepEqual(imported.state.experiments[0].evidence,{version:1,completed:8,heldOut:0,controlled:0});
  assert.equal(imported.state.legacy.branches[0].checkpoint!.experiments[0].evidence!.completed,8);
  assert.equal(evidenceProgress(imported.state.experiments,'oversight-6',{adoptedOnly:true}).allowed,false);
  const unverifiable=structuredClone(state);unverifiable.experiments[0].summary.cost++;
  const retained=parseSave(serializeSave(unverifiable));assert(retained.ok);assert.equal(retained.state.experiments[0].adopted,true);
  assert.deepEqual(retained.state.experiments[0].evidence,{version:1,completed:0,heldOut:0,controlled:0});
});

test('completed legacy projects remain history but do not grant current Garden Accord clearance',()=>{
  const state=createGame(10,1000);state.projects=RESEARCH_PROJECTS.map(p=>p.id);
  for(const program of ['oversight','control','organisms','interpretability','welfare'] as const){const tiny=family({...config(6,{cohort:8,budget:32}),program,template:`${program}-6`});tiny[0].adopted=true;state.experiments.push(...tiny);}
  assert.equal(capstoneEvidenceEligibility(state).allowed,false);
  assert.equal(projectEvidenceEligibility(state,RESEARCH_PROJECTS.find(p=>p.id==='foundation-10')!).allowed,false);
  assert.equal(state.projects.length,120,'historical completions across all known programs are retained');
});

test('the visible stronger-study helper reserves a complete cohort without changing the hypothesis',()=>{
  const old=config(6,{cohort:8,budget:32,holdout:.1,control:false,intervention:'escalation',replicateOf:'old-root'});
  const strong=prepareStrongerConfig(old,100);assert.equal(strong.cohort,128);assert.equal(strong.holdout,.25);assert.equal(strong.budget,512);assert.equal(strong.control,true);assert.equal(strong.replicateOf,undefined);assert.equal(strong.prediction,old.prediction);
  const record=runExperiment(strong);assert.equal(record.evidence!.completed,128);assert.equal(record.evidence!.heldOut,32);
});
