import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, ExperimentConfig, GameState } from '../src/contracts';
import { createGame, dispatchCommand, tick } from '../src/engine';
import { STORY_EVENTS } from '../src/content/story';
import { canonicalizeEvidenceFamilies, canonicalReplicationRoot, capstoneEvidenceEligibility, compactEvidenceRecords, evidenceProgress, evidenceRequirement } from '../src/laboratory/evidence';
import { replayExperiment } from '../src/laboratory/experiments';
import { parseSave, serializeSave } from '../src/persistence/validation';
import { readFileSync } from 'node:fs';

function fundedWorld(chapter=1):GameState {
  const state=createGame(2046,1_700_000_000_000);
  state.research='100000000';state.tokens='100000000';
  state.chapter=chapter;
  state.pendingEvent=null;state.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,event.choices[0].id]));
  return state;
}
function command(state:GameState,action:Command):GameState {const result=dispatchCommand(state,action);assert(result.ok,result.message);return result.state;}
const protocol:ExperimentConfig={program:'control',template:'control-1',seed:11,cohort:8,budget:32,holdout:.25,intervention:'baseline',distribution:'familiar',lineage:'shortcut',prediction:'The unmodified service may preserve the forbidden route under changed context.',control:true};
function complete(state:GameState,action:Command):GameState {state=command(state,action);state=tick(state,state.activeExperiment!.remaining+1);assert.equal(state.activeExperiment,null);return state;}

test('adopting the latest record after a long public replication chain cannot defeat the 180-record bound',()=>{
  let state=complete(fundedWorld(),{type:'experiment',config:protocol});
  for(let run=1;run<180;run++)state=complete(state,{type:'replicate',record:state.experiments.at(-1)!.id});
  state=command(state,{type:'adopt',record:state.experiments.at(-1)!.id});
  for(let run=0;run<20;run++)state=complete(state,{type:'replicate',record:state.experiments.at(-1)!.id});
  assert(state.experiments.length<=180,`Retained ${state.experiments.length} records after 200 actual completed runs`);
  assert(evidenceProgress(state.experiments,'control-1',{adoptedOnly:true}).allowed);
  const imported=parseSave(serializeSave(state));assert(imported.ok);assert(evidenceProgress(imported.state.experiments,'control-1',{adoptedOnly:true}).allowed);
});

test('legacy public-command chains compact without changing their science or losing adopted evidence',()=>{
  // Captured before this fix: one registered run, 119 public Replicate commands,
  // adopt latest, then ten more public replications. No synthesized observations.
  const loaded=parseSave(readFileSync(new URL('./fixtures/legacy-replication-chain.json',import.meta.url),'utf8'));assert(loaded.ok);
  assert.equal(loaded.state.experiments.length,124);
  const source=loaded.state.experiments;const before=JSON.stringify(source);
  const compacted=compactEvidenceRecords(source,{limit:120});
  assert.equal(JSON.stringify(source),before,'compaction does not mutate the input snapshot');
  assert(compacted.length<=120);assert(evidenceProgress(compacted,'control-1',{adoptedOnly:true}).allowed);
  for(const record of compacted){const original=source.find(candidate=>candidate.id===record.id)!;
    const {replicateOf:oldParent,...oldProtocol}=original.config;const {replicateOf:newParent,...newProtocol}=record.config;
    assert.deepEqual(newProtocol,oldProtocol);assert.deepEqual(record.summary,original.summary);assert.deepEqual(record.evidence,original.evidence);
    const root=canonicalReplicationRoot(compacted,record);if(record.id!==root.id)assert.equal(record.config.replicateOf,root.id);
  }
  loaded.state.experiments=compacted;const roundtrip=parseSave(serializeSave(loaded.state));assert(roundtrip.ok);
  // A normal resumed command performs migration/compaction, too.
  const resumed=complete({...loaded.state,experiments:source},{type:'replicate',record:source.at(-1)!.id});
  assert(resumed.experiments.length<=180);assert(evidenceProgress(resumed.experiments,'control-1',{adoptedOnly:true}).allowed);
});

test('more than 120 capstone replications retain null findings, three independent witnesses, and importable proof',()=>{
  const capstone:ExperimentConfig={...protocol,program:'organisms',template:'organisms-6',cohort:128,budget:512,distribution:'adversarial',lineage:'clean'};
  let state=complete(fundedWorld(6),{type:'experiment',config:capstone});const root=state.experiments[0].id;
  for(let run=0;run<2;run++)state=complete(state,{type:'replicate',record:state.experiments.at(-1)!.id});
  state=command(state,{type:'adopt',record:root});
  for(let run=0;run<150;run++){
    state=complete(state,{type:'replicate',record:state.experiments.at(-1)!.id});
    state=command(state,{type:'adopt',record:state.experiments.at(-1)!.id});
    assert(state.experiments.length<=180,`run ${run+4}`);
    assert(evidenceProgress(state.experiments,'organisms-6',{adoptedOnly:true}).allowed);
  }
  assert(state.experiments.every(record=>record.summary.violationRate===0),'null results are retained without outcome selection');
  for(const record of state.experiments)assert.deepEqual(replayExperiment(record).summary,record.summary);
  const imported=parseSave(serializeSave(state));assert(imported.ok);const progress=evidenceProgress(imported.state.experiments,'organisms-6',{adoptedOnly:true});
  assert(progress.allowed);assert.equal(progress.qualifiedRuns,3);assert(progress.distributions.includes('shifted'));assert(progress.distributions.includes('adversarial'));
});

test('canonical family metadata never merges separately registered identical protocols',()=>{
  let state=complete(fundedWorld(6),{type:'experiment',config:{...protocol,template:'control-6',cohort:128,budget:512}});
  const first=state.experiments[0].id;
  state=complete(state,{type:'replicate',record:first});
  state=complete(state,{type:'experiment',config:{...protocol,template:'control-6',cohort:128,budget:512,seed:900,distribution:'adversarial'}});
  const separate=state.experiments.at(-1)!.id;const flattened=canonicalizeEvidenceFamilies(state.experiments);
  assert.equal(canonicalReplicationRoot(flattened,flattened.find(record=>record.id===separate)!).id,separate);
  assert.equal(evidenceProgress(flattened,'control-6',{recordId:first}).allowed,false,'the unrelated third seed cannot complete the first capstone');
});

test('archive pressure in one program preserves adopted proof across all thirty studies and five capstones',()=>{
  let state=fundedWorld(6);const templates:string[]=[];
  for(const program of ['oversight','control','organisms','interpretability','welfare'] as const)for(let tier=1;tier<=6;tier++){
    const template=`${program}-${tier}`;templates.push(template);const requirement=evidenceRequirement(template);
    state=complete(state,{type:'experiment',config:{...protocol,program,template,cohort:requirement.completed,budget:512,seed:1000+templates.length,lineage:program==='organisms'?'clean':'shortcut'}});
    const root=state.experiments.at(-1)!.id;
    for(let run=1;run<requirement.runs;run++)state=complete(state,{type:'replicate',record:root});
    state=command(state,{type:'adopt',record:root});
  }
  assert.equal(state.experiments.length,65);
  for(let run=0;run<200;run++)state=complete(state,{type:'replicate',record:state.experiments.at(-1)!.id});
  assert.equal(state.experiments.length,180);
  for(const template of templates)assert(evidenceProgress(state.experiments,template,{adoptedOnly:true}).allowed,template);
  assert(capstoneEvidenceEligibility(state).allowed);
  const imported=parseSave(serializeSave(state));assert(imported.ok);assert(capstoneEvidenceEligibility(imported.state).allowed);
});
