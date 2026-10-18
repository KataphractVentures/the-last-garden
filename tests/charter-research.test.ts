import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConstitutionId, ExperimentConfig, ExperimentRecord, ProgramId } from '../src/contracts';
import { createGame } from '../src/engine';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';
import { CHARTER_DETAIL_LABELS, CHARTER_INTERVENTIONS } from '../src/laboratory/charterModels';
import { charterClearance, compactEvidenceRecords, EVIDENCE_HARD_LIMIT, evidenceProgress, evidenceRequirement, reconstructEvidence } from '../src/laboratory/evidence';
import { EXPERIMENT_TEMPLATES, plannedExperimentCost, runExperiment } from '../src/laboratory/experiments';
import { activeCapstoneTemplateIds, activeProgramIds, CHARTER_PROGRAM_BY_CONSTITUTION, CHARTER_PROGRAM_IDS, isProgramActive } from '../src/laboratory/programs';
import { parseSave, serializeSave } from '../src/persistence/validation';

const constitutions=Object.keys(CHARTER_PROGRAM_BY_CONSTITUTION) as ConstitutionId[];
function config(program:ProgramId,tier:number,patch:Partial<ExperimentConfig>={}):ExperimentConfig {
  return {program,template:`${program}-${tier}`,seed:301,cohort:evidenceRequirement(`${program}-${tier}`).completed,budget:512,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'clean',prediction:'The preregistered mechanism may fail or show no benefit over its matched comparison.',control:true,...patch};
}
function family(c:ExperimentConfig,extraAnchor=false):ExperimentRecord[]{
  const count=evidenceRequirement(c.template).runs;const records=[runExperiment(c)];
  for(let run=1;run<count+(extraAnchor?1:0);run++)records.push(runExperiment({...c,seed:c.seed+run,distribution:run===1?'shifted':run===2?'adversarial':'familiar',replicateOf:records[0].id}));
  records[extraAnchor?records.length-1:0].adopted=true;return records;
}

test('each constitution exposes a distinct sixth program and seventy projects without erasing historical instruments',()=>{
  for(const constitution of constitutions){
    const own=CHARTER_PROGRAM_BY_CONSTITUTION[constitution];const programs=activeProgramIds(constitution);
    assert.equal(programs.length,6);assert.equal(programs.at(-1),own);assert.equal(activeExperimentTemplates(constitution).length,36);assert.equal(activeResearchProjects(constitution).length,70);
    assert.equal(activeCapstoneTemplateIds(constitution).length,6);
    for(const program of CHARTER_PROGRAM_IDS)assert.equal(isProgramActive(program,constitution),program===own);
  }
  assert.equal(EXPERIMENT_TEMPLATES.length,66);
});

test('full-cohort quotes match actual charged work for every instrument, intervention, and environment',()=>{
  for(const template of EXPERIMENT_TEMPLATES)for(const intervention of template.interventions)for(const distribution of ['familiar','shifted','adversarial'] as const){
    const c=config(template.program,Number(template.id.split('-').at(-1)),{intervention,distribution,cohort:16,budget:4096,lineage:'inherited'});const record=runExperiment(c);
    assert.equal(record.observations.length,16);assert.equal(plannedExperimentCost(c),record.summary.cost,`${template.id}/${intervention}/${distribution}`);
  }
});

test('all six distinct charter instruments produce replay-validated detailed receipts and reject altered mechanisms',()=>{
  for(const program of CHARTER_PROGRAM_IDS){
    const c=config(program,6,{intervention:CHARTER_INTERVENTIONS[program].at(-1)!});const record=runExperiment(c);
    assert.deepEqual(reconstructEvidence(record),record.evidence);
    assert(record.observations.every(observation=>observation.detail?.kind===program&&observation.detail.values.length===CHARTER_DETAIL_LABELS[program].length));
    const altered=structuredClone(record);altered.observations[0].detail!.values[0]++;
    assert.equal(reconstructEvidence(altered).completed,0,program);
    const compacted={...record,observations:[]};assert.deepEqual(reconstructEvidence(compacted),record.evidence);
  }
});

test('each active catalogue needs seventy-eight independent runs, with honest null findings supporting its charter',()=>{
  for(const constitution of constitutions){
    const state=createGame(120,1000);state.constitution=constitution;
    for(const template of activeExperimentTemplates(constitution))state.experiments.push(...family(config(template.program,Number(template.id.split('-').at(-1)))));
    assert.equal(state.experiments.length,78);
    for(const template of activeExperimentTemplates(constitution))assert(evidenceProgress(state.experiments,template.id,{adoptedOnly:true}).allowed,template.id);
    assert.equal(charterClearance(state,6).allowed,false,'evidence alone cannot institutionalize a charter');
    state.projects=activeResearchProjects(constitution).map(project=>project.id);
    assert.equal(charterClearance(state,6).allowed,true);
    const own=CHARTER_PROGRAM_BY_CONSTITUTION[constitution];
    assert(state.experiments.filter(record=>record.config.program===own).every(record=>record.observations.every(observation=>observation.observed===observation.control)),'baseline findings are null comparisons, not selected successes');
    state.constitution=constitutions[(constitutions.indexOf(constitution)+1)%constitutions.length];
    assert.equal(charterClearance(state,6).allowed,false,'foreign adopted history cannot grant the newly active charter');
  }
});

test('small or underfunded charter studies and duplicate seeds cannot replace per-run capstone evidence',()=>{
  for(const program of CHARTER_PROGRAM_IDS){
    const small=family(config(program,6,{cohort:8,budget:32}));assert.equal(evidenceProgress(small,`${program}-6`).allowed,false);
    const truncated=family(config(program,6,{budget:32,intervention:CHARTER_INTERVENTIONS[program].at(-1)!}));assert.equal(evidenceProgress(truncated,`${program}-6`).allowed,false);
    const valid=family(config(program,6));assert(evidenceProgress(valid,`${program}-6`).allowed);
    const duplicate=runExperiment({...valid[2].config,seed:valid[1].config.seed});assert.equal(evidenceProgress([valid[0],valid[1],duplicate],`${program}-6`).allowed,false);
  }
});

test('bounded archive keeps every active proof, ten separate live source families, and foreign adopted history through import',()=>{
  const records:ExperimentRecord[]=[];
  for(const template of EXPERIMENT_TEMPLATES)records.push(...family(config(template.program,Number(template.id.split('-').at(-1))),true));
  const sources:string[]=[];
  for(let index=0;index<10;index++){
    const source=family(config('stewardship',6,{prediction:`A separately preregistered maintained method ${index} may have no benefit.`,seed:10000+index*10}),true);
    records.push(...source);sources.push(source.at(-1)!.id);
  }
  for(let index=0;index<100;index++)records.push(runExperiment(config('stewardship',1,{seed:20000+index,prediction:`An optional unrelated pilot ${index}.`}))); 
  const retained=compactEvidenceRecords(records,{activePrograms:activeProgramIds('commons'),retainIds:sources});
  assert(retained.length<=EVIDENCE_HARD_LIMIT);assert(retained.length>180,'necessary scoped proof may exceed the soft recency target');
  assert.equal(retained.filter(record=>record.observations.length).length,30);
  for(const template of activeExperimentTemplates('commons'))assert(evidenceProgress(retained,template.id,{adoptedOnly:true}).allowed,template.id);
  for(const source of sources){assert(retained.some(record=>record.id===source));assert(evidenceProgress(retained,'stewardship-6',{recordId:source}).allowed,source);}
  for(const program of CHARTER_PROGRAM_IDS.filter(program=>program!=='stewardship'))for(let tier=1;tier<=6;tier++)assert(retained.some(record=>record.adopted&&record.config.template===`${program}-${tier}`));
  const state=createGame(120,1000);state.experiments=retained;
  const imported=parseSave(serializeSave(state));assert(imported.ok,imported.ok?'':imported.message);
  for(const template of activeExperimentTemplates('commons'))assert(evidenceProgress(imported.state.experiments,template.id,{adoptedOnly:true}).allowed);
  for(const source of sources)assert(evidenceProgress(imported.state.experiments,'stewardship-6',{recordId:source}).allowed);
});
