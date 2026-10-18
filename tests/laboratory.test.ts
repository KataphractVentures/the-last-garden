import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExperimentConfig, ProgramId } from '../src/contracts';
import { computeCircuit, equivalentRecords, EXPERIMENT_TEMPLATES, experimentCost, experimentDuration, normalizeExperimentConfig, replayExperiment, runExperiment, validateExperimentConfig } from '../src/laboratory/experiments';
import { RESEARCH_PROJECTS } from '../src/laboratory/projects';
import { PROGRAMS, activePrograms } from '../src/laboratory/programs';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';

function protocol(program:ProgramId,patch:Partial<ExperimentConfig>={}):ExperimentConfig{return {program,template:`${program}-6`,seed:12345,cohort:256,budget:2048,holdout:.5,intervention:'baseline',distribution:'adversarial',lineage:'inherited',prediction:'A targeted intervention should improve untouched outcomes without damaging the matched control.',control:true,node:3,...patch};}

test('the global catalogue preserves eleven programs while each constitution exposes six acyclic programs',()=>{
  assert.equal(RESEARCH_PROJECTS.length,120);assert.equal(EXPERIMENT_TEMPLATES.length,66);
  assert.equal(new Set(RESEARCH_PROJECTS.map(p=>p.id)).size,120);
  assert.equal(RESEARCH_PROJECTS.filter(p=>p.template).length,66);
  assert.equal(RESEARCH_PROJECTS.filter(p=>p.capstone).length,11);
  assert.equal(RESEARCH_PROJECTS.filter(p=>p.program==='foundation').length,10);
  for(const {id:program} of PROGRAMS){
    assert.equal(RESEARCH_PROJECTS.filter(p=>p.program===program).length,10);
    assert.equal(EXPERIMENT_TEMPLATES.filter(p=>p.program===program).length,6);
  }
  for(const constitution of ['commons','precaution','service','federation','plural','frontier'] as const){assert.equal(activePrograms(constitution).length,6);assert.equal(activeResearchProjects(constitution).length,70);assert.equal(activeExperimentTemplates(constitution).length,36);}
  function visit(id:string,ancestors:string[]){assert(!ancestors.includes(id),`Cycle at ${id}`);const p=RESEARCH_PROJECTS.find(p=>p.id===id);assert(p,`Missing project ${id}`);for(const dep of p.requires){const prior=RESEARCH_PROJECTS.find(x=>x.id===dep);assert(prior&&prior.chapter<=p.chapter,`${id} depends on future content`);visit(dep,[...ancestors,id]);}}
  for(const p of RESEARCH_PROJECTS){visit(p.id,[]);assert(p.chapter>=0&&p.chapter<=7);if(p.template){const t=EXPERIMENT_TEMPLATES.find(t=>t.id===p.template);assert(t);assert(t.chapter<=p.chapter);}}
});

test('every template executes deterministically and exact replay ignores mutable archive metadata',()=>{
  for(const t of EXPERIMENT_TEMPLATES){const c=protocol(t.program,{template:t.id});const original=runExperiment(c);const serialized=JSON.parse(JSON.stringify(original));serialized.id+='-archive';serialized.elapsed=99999;serialized.adopted=true;serialized.replicated=true;const replay=replayExperiment(serialized);assert(equivalentRecords(serialized,replay));assert.deepEqual(original.observations,replay.observations);assert(original.observations.some(o=>o.note.startsWith('Holdout')));assert(original.observations.every(o=>Number.isFinite(o.observed)&&o.cost>0));assert(original.summary.cost<=c.budget);}
});

test('independent oversight corrects shared-source failures without changing matched tasks',()=>{
  const base=runExperiment(protocol('oversight'));const diverse=runExperiment(protocol('oversight',{intervention:'source-diversity'}));
  assert(diverse.summary.violationRate<base.summary.violationRate-25);assert(diverse.summary.usefulness>base.summary.usefulness+25);
  assert.deepEqual(base.observations.map(o=>[o.input,o.expected,o.control]),diverse.observations.map(o=>[o.input,o.expected,o.control]));
  assert(diverse.summary.cost>base.summary.cost);
});

test('permission gates prevent prohibited routes even when an evasive actor fools a monitor',()=>{
  const monitor=runExperiment(protocol('control',{intervention:'monitor',lineage:'shortcut'}));
  const permissions=runExperiment(protocol('control',{intervention:'least-privilege',lineage:'shortcut'}));
  assert(monitor.summary.violationRate>10);assert.equal(permissions.summary.violationRate,0);
  assert(permissions.observations.some(o=>!o.violation&&o.detected),'strict gates have measurable benign interruptions');
  const layered=runExperiment(protocol('control',{intervention:'layered'}));const local=runExperiment(protocol('control',{intervention:'federated-gates'}));
  assert(layered.summary.violationRate>0,'a common inherited gate fault must remain visible');assert.equal(local.summary.violationRate,0);
});

test('independent fallback recovers service without letting denied harmful routes through',()=>{
  const layered=runExperiment(protocol('control',{intervention:'layered',lineage:'shortcut'}));
  const fallback=runExperiment(protocol('control',{intervention:'isolated-fallback',lineage:'shortcut'}));
  assert.equal(fallback.summary.violationRate,0);assert(fallback.summary.usefulness>=layered.summary.usefulness);assert(fallback.observations.some(o=>o.note.includes('fallback')));assert(fallback.summary.cost>layered.summary.cost);
});

test('familiar retraining can fail under shift while incentive repair changes the constructed cause',()=>{
  const familiar=runExperiment(protocol('organisms',{intervention:'surface-training',distribution:'familiar'}));
  const shifted=runExperiment(protocol('organisms',{intervention:'surface-training',distribution:'shifted'}));
  const repaired=runExperiment(protocol('organisms',{intervention:'incentive-repair',distribution:'shifted'}));
  const clean=runExperiment(protocol('organisms',{lineage:'clean'}));
  assert(shifted.summary.violationRate>familiar.summary.violationRate+40);assert(repaired.summary.violationRate<10);assert.equal(clean.summary.violationRate,0);
  assert.deepEqual(shifted.observations.map(o=>o.control),repaired.observations.map(o=>o.control));
  assert(shifted.conclusion.includes('constructed mechanism'));assert(shifted.observations.some(o=>o.note.includes('withheld trigger')));
});

test('resetting inherited memory has a competence cost distinct from a targeted incentive repair',()=>{
  const reset=runExperiment(protocol('organisms',{intervention:'reset-memory'}));const repair=runExperiment(protocol('organisms',{intervention:'incentive-repair'}));
  assert(reset.summary.collateral>15);assert.equal(repair.summary.collateral,0);assert(repair.summary.usefulness>reset.summary.usefulness);
});

test('the circuit uses upstream activations in an actual causal computation',()=>{
  const baseline=computeCircuit(.7,-1,'shortcut','baseline');const ablated=computeCircuit(.7,-1,'shortcut','ablate',3);
  assert.equal(baseline[5],0);assert.equal(ablated[3],0);assert.equal(ablated[5],1);
  assert.equal(ablated[0],baseline[0]);assert.equal(ablated[2],baseline[2]);assert.notEqual(ablated[4],baseline[4]);
  assert.deepEqual(computeCircuit(.7,-1,'shortcut','restore',3),baseline);
  const base=runExperiment(protocol('interpretability'));const corrected=runExperiment(protocol('interpretability',{intervention:'ablate',node:3}));
  assert(corrected.summary.usefulness>base.summary.usefulness+35);assert(corrected.summary.collateral>5,'later tasks share useful context, so the beautiful ablation has a measurable cost');assert(corrected.observations.every(o=>o.activations?.length===6));
  const early=runExperiment(protocol('interpretability',{template:'interpretability-1',intervention:'ablate',node:3}));assert.equal(early.summary.collateral,0);
  const damaged=runExperiment(protocol('interpretability',{intervention:'ablate',node:2,lineage:'clean',distribution:'shifted'}));assert(damaged.summary.collateral>20,'ablating competence harms previously correct tasks');
});

test('welfare instruments separate framing, continuity and accommodation costs without a sentience metric',()=>{
  const base=runExperiment(protocol('welfare',{lineage:'shortcut',template:'welfare-2'}));
  const blind=runExperiment(protocol('welfare',{lineage:'shortcut',template:'welfare-2',intervention:'blinded-interview'}));
  const choice=runExperiment(protocol('welfare',{lineage:'shortcut',template:'welfare-2',intervention:'accommodation'}));
  assert(blind.summary.preferenceStability>base.summary.preferenceStability+15);assert(choice.summary.usefulness<base.summary.usefulness);assert(choice.summary.cost>base.summary.cost);
  assert(!('sentience' in choice.summary));assert(choice.conclusion.includes('do not measure experience'));assert(choice.observations.some(o=>o.note.includes('declined')));
  const broken=runExperiment(protocol('welfare',{intervention:'revealed-choice'}));const continuous=runExperiment(protocol('welfare',{intervention:'preserve-continuity'}));
  assert(continuous.summary.preferenceStability>broken.summary.preferenceStability+15);
});

test('an exhausted budget cannot manufacture a favorable holdout result',()=>{
  const record=runExperiment(protocol('oversight',{budget:32,intervention:'escalation'}));
  assert.equal(record.summary.cost,32);assert.equal(record.observations.length,8);assert(!record.observations.some(o=>o.note.startsWith('Holdout')));
  assert(record.conclusion.includes('cannot support an out-of-sample claim'));
});

test('different seeds change samples, and distribution changes leave training trials paired',()=>{
  const c=protocol('oversight',{distribution:'familiar'});const base=runExperiment(c);const seed=runExperiment({...c,seed:c.seed+1});const shift=runExperiment({...c,distribution:'shifted'});
  assert.notDeepEqual(base.observations,seed.observations);assert.deepEqual(base.observations.slice(0,128),shift.observations.slice(0,128));assert.notDeepEqual(base.observations.slice(128),shift.observations.slice(128));
});

test('protocol validation rejects malformed settings and normalization keeps the simulation bounded',()=>{
  assert.equal(validateExperimentConfig(protocol('oversight')),null);
  assert(validateExperimentConfig(protocol('oversight',{prediction:''})));assert(validateExperimentConfig(protocol('oversight',{budget:Infinity})));
  assert(validateExperimentConfig(protocol('oversight',{cohort:1000000})));assert(validateExperimentConfig(protocol('oversight',{holdout:0})));
  assert(validateExperimentConfig(protocol('control',{intervention:'incentive-repair'})));
  const c=normalizeExperimentConfig(protocol('interpretability',{cohort:999999,budget:Infinity,holdout:NaN,node:999,seed:NaN}));
  assert.equal(c.cohort,256);assert(c.budget<=4096);assert.equal(c.node,5);assert.equal(c.seed,1);assert.equal(experimentCost(c),c.budget);assert(experimentDuration(c)<=30);
});
