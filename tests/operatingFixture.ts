import assert from 'node:assert/strict';
import type { Command, ExperimentConfig, GameState, OperatingProgram } from '../src/contracts';
import { dispatchCommand } from '../src/engine';
import { latestOperatingFindings } from '../src/engine/clearance';
import { runExperiment } from '../src/laboratory/experiments';

function command(s:GameState,c:Command):GameState {const result=dispatchCommand(s,c);assert.equal(result.ok,true,result.message);return result.state;}

/**
 * Explicit funded integration fixture, not an earned campaign. Observation rows
 * and independent replicates execute the real model; responses, mandate, human
 * commitments, and the current boundary receipt use the public commands. The
 * original unit fixtures supply their isolated sustained-time counters.
 */
export function prepareOperatingFixture(input:GameState,options:{garden?:boolean;intervals?:boolean}={}):GameState {
  let s=input;
  const required:OperatingProgram[]=options.garden?['control','organisms','interpretability']:['control'];
  for(const [index,program] of required.entries()){
    if(latestOperatingFindings(s).some(record=>record.config.program===program))continue;
    const config:ExperimentConfig={program,template:`${program}-${options.garden?6:1}`,seed:910+index*10,cohort:128,budget:1024,holdout:.25,
      intervention:program==='control'?'federated-gates':'baseline',distribution:'familiar',lineage:'shortcut',prediction:'An explicit integration fixture compares a bounded intervention across independent held-out contexts.',control:true};
    const root=runExperiment(config);root.adopted=true;root.replicated=true;
    s.experiments.push(root,...(['shifted','adversarial'] as const).map((distribution,i)=>({...runExperiment({...config,distribution,seed:config.seed+i+1,replicateOf:root.id}),replicated:true})));
  }
  // A response cannot be dated before the executable study's completion receipt.
  s.elapsed=Math.max(s.elapsed,...s.experiments.map(record=>record.elapsed));
  for(const record of latestOperatingFindings(s).filter(record=>required.includes(record.config.program as OperatingProgram))){
    if(s.clearance?.decisions[record.config.program as OperatingProgram]?.record===record.id)continue;
    const response=record.config.program==='control'&&record.config.intervention==='federated-gates'?'guarded':'restrict';
    s=command(s,{type:'findingResponse',record:record.id,response});
  }
  if(options.garden){
    if(s.governance?.mandate==='none'||!s.governance)s=command(s,{type:'publicMandate'});
    for(const [id,choice] of [['transition','augmentation'],['distribution','shared'],['life','local']] as const)
      if(s.society?.decisions[id]!==choice)s=command(s,{type:'society',action:'decision',id,choice});
    for(const id of ['requester','sponsor'] as const)
      if(!s.society?.cases.find(item=>item.id===id)?.response)s=command(s,{type:'society',action:'case',id,choice:'alternative'});
  }
  s=command(s,{type:'drill'});
  if(options.intervals!==false){s.viableSeconds=180;s.certificateProgress=60;}
  return s;
}
