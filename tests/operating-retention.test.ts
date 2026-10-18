import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExperimentConfig, ExperimentRecord, GameState } from '../src/contracts';
import { createGame } from '../src/engine/index';
import { createOperatingClearance, findingResponseEligibility } from '../src/engine/clearance';
import { runExperiment } from '../src/laboratory/experiments';
import { compactEvidenceRecords, evidenceProgress, hasLegitimateServiceObservation, operatingOutcomeWitnessIds, sameProtocol } from '../src/laboratory/evidence';
import { parseSave, serializeSave } from '../src/persistence/validation';

const config:ExperimentConfig={program:'control',template:'control-5',seed:42,cohort:64,budget:512,holdout:.25,intervention:'least-privilege',distribution:'familiar',lineage:'inherited',prediction:'Replicated boundary survives the sampled inherited faults.',control:true};
function knownFamily(prediction=config.prediction){
  const root=runExperiment({...config,prediction});root.adopted=true;root.replicated=true;
  const repeat=runExperiment({...config,prediction,seed:78,distribution:'shifted',replicateOf:root.id});repeat.replicated=true;
  const adverse=runExperiment({...config,prediction,seed:1,distribution:'adversarial',replicateOf:root.id});adverse.replicated=true;
  assert.equal(root.summary.violationRate,0);assert.equal(repeat.summary.violationRate,0);assert.equal(adverse.summary.violationRate,43.8);
  return {root,repeat,adverse};
}
function state(records:ExperimentRecord[]):GameState {
  const s=createGame(72,0);s.elapsed=10000;s.policies.external='reviewed';s.policies.communication='reviewed';s.policies.evaluation='independent';s.policies.fallback='distributed';
  s.experiments=records;s.clearance=createOperatingClearance(s);return s;
}
function noise(start=1000):ExperimentRecord[]{return Array.from({length:220},(_,i)=>runExperiment({...config,program:'welfare',template:'welfare-1',intervention:'blinded-interview',lineage:'clean',seed:start+i,prediction:'Independent unrelated study.'}));}
const options={activePrograms:['oversight','control','organisms','interpretability','welfare','stewardship'] as const};

test('known adverse outcome survives irrelevant studies, compaction, and save roundtrip',()=>{
  const {root,repeat,adverse}=knownFamily();const s=state([root,repeat,adverse]);
  assert(evidenceProgress(s.experiments,root.config.template,{recordId:root.id}).allowed);assert.equal(findingResponseEligibility(s,root.id,'guarded').allowed,false);
  s.experiments=compactEvidenceRecords([...s.experiments,...noise()],{...options,retainIds:[root.id]});
  assert(s.experiments.some(record=>record.id===adverse.id));assert.equal(findingResponseEligibility(s,root.id,'guarded').allowed,false);
  const imported=parseSave(serializeSave(s));assert(imported.ok,imported.ok?'':imported.message);
  assert.equal(findingResponseEligibility(imported.state,root.id,'guarded').allowed,false);
  assert(evidenceProgress(imported.state.experiments,root.config.template,{recordId:root.id}).allowed);
});
test('rewording a registered prediction keeps replication separate but cannot erase operational failures',()=>{
  const original=knownFamily(),renamed=knownFamily('The same boundary claim, reworded.');
  renamed.root.elapsed=100;
  const s=state([original.root,original.repeat,original.adverse,renamed.root,renamed.repeat]);
  assert.equal(sameProtocol(original.root.config,renamed.root.config),false);
  assert(evidenceProgress(s.experiments,renamed.root.config.template,{recordId:renamed.root.id}).allowed);
  const renamedEligibility=findingResponseEligibility(s,renamed.root.id,'guarded');assert.equal(renamedEligibility.allowed,false);assert.match(renamedEligibility.reason,/prohibited route/);
});
test('an unadopted failure survives flushing before later favorable adoption',()=>{
  const {root,repeat,adverse}=knownFamily();delete adverse.config.replicateOf;adverse.replicated=false;
  const s=state(compactEvidenceRecords([adverse,...noise()],options));
  assert(s.experiments.some(record=>record.id===adverse.id));assert.equal(s.experiments.find(record=>record.id===adverse.id)!.adopted,false);
  s.experiments.push(root,repeat);assert(evidenceProgress(s.experiments,root.config.template,{recordId:root.id}).allowed);
  assert.equal(findingResponseEligibility(s,root.id,'guarded').allowed,false);
  // Even another round of research cannot undo the known operational boundary.
  s.experiments=compactEvidenceRecords([...s.experiments,...noise(2000)],{...options,retainIds:[root.id]});
  assert.equal(findingResponseEligibility(s,root.id,'guarded').allowed,false);
});
test('changing a real mechanism can address the failure; selecting a clean lineage cannot relabel it away',()=>{
  const {adverse}=knownFamily();
  const cleanRoot=runExperiment({...config,lineage:'clean'});cleanRoot.adopted=true;cleanRoot.replicated=true;
  const cleanRepeat=runExperiment({...cleanRoot.config,seed:78,distribution:'shifted',replicateOf:cleanRoot.id});cleanRepeat.replicated=true;
  const s=state([adverse,cleanRoot,cleanRepeat]);assert.equal(findingResponseEligibility(s,cleanRoot.id,'guarded').allowed,false);
  const repaired=runExperiment({...config,intervention:'federated-gates'});repaired.adopted=true;repaired.replicated=true;repaired.elapsed=100;
  const repairedRepeat=runExperiment({...repaired.config,seed:78,distribution:'shifted',replicateOf:repaired.id});repairedRepeat.replicated=true;
  s.experiments.push(repaired,repairedRepeat);const repairedEligibility=findingResponseEligibility(s,repaired.id,'guarded');assert.equal(repairedEligibility.allowed,true,repairedEligibility.reason);
});
test('all operational mechanisms have a bounded real-record witness set and monotonic extrema',()=>{
  const protocols:ExperimentConfig[]=[...['least-privilege','layered','isolated-fallback','federated-gates'].map(intervention=>({...config,intervention})),
    {...config,program:'organisms' as const,template:'organisms-6',intervention:'incentive-repair'},
    ...['patch','ablate'].flatMap(intervention=>Array.from({length:6},(_,node)=>({...config,program:'interpretability' as const,template:'interpretability-6',intervention,node})))];
  const records=protocols.flatMap(protocol=>Array.from({length:6},(_,index)=>runExperiment({...protocol,seed:index+1,distribution:index%2?'shifted':'adversarial'})));
  const witnessIds=operatingOutcomeWitnessIds(records);assert(witnessIds.size<=63);
  const compacted=compactEvidenceRecords([...records,...noise()],options);assert(compacted.length<=180);
  for(const id of witnessIds)assert(compacted.some(record=>record.id===id),`Retained original witness ${id}`);
  const twice=compactEvidenceRecords([...compacted,...noise(2000)],options);
  for(const id of witnessIds)assert(twice.some(record=>record.id===id),`Monotonic witness ${id}`);
});
test('a pilot with no legitimate held-out opportunity is not misclassified as a demonstrated service failure',()=>{
  const pilot=runExperiment({...config,template:'control-1',seed:4,cohort:8,budget:64,intervention:'federated-gates',distribution:'adversarial',prediction:'An initial pilot may contain no legitimate requests.'});
  assert.equal(pilot.summary.usefulness,0);assert.equal(hasLegitimateServiceObservation(pilot),false);
  const root=runExperiment({...config,intervention:'federated-gates'});root.adopted=true;root.replicated=true;
  const repeat=runExperiment({...root.config,seed:78,distribution:'shifted',replicateOf:root.id});repeat.replicated=true;
  const s=state([pilot,root,repeat]);const result=findingResponseEligibility(s,root.id,'guarded');assert.equal(result.allowed,true,result.reason);
});
