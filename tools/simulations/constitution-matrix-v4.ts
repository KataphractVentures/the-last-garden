/** Eighteen controlled native/baseline/transferred constitution campaigns. V3 artifacts remain immutable. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConstitutionId, GameState } from '../../src/contracts';
import { dispatchCommand, getRates } from '../../src/engine';
import { CONSTITUTIONS } from '../../src/content/economy';
import { activeExperimentTemplates, activeResearchProjects } from '../../src/laboratory/catalog';
import { evidenceProgress } from '../../src/laboratory/evidence';
import { CHARTER_PROGRAM_BY_CONSTITUTION } from '../../src/laboratory/programs';
import { parseSave, serializeSave, getValidationCatalog } from '../../src/persistence';
import { simulate, type Strategy } from './optimized-v4';
import { createCharterObserver, researchOrderDistance } from './charter-metrics-v4';

const TRANSFER:Record<ConstitutionId,ConstitutionId>={commons:'precaution',precaution:'commons',service:'frontier',frontier:'service',federation:'plural',plural:'federation'};
type Profile='native'|'baseline'|'transferred';
const PROFILES:Profile[]=['native','baseline','transferred'];
const BASE={external:'reviewed',welfare:'rest',choices:'opportunistic',target:'garden',tickSeconds:5,researchWeight:.15} as const;
export function matrixStrategy(constitution:ConstitutionId,profile:Profile,nativeCommonsMaintenance?:number):Strategy{return {...BASE,id:`${constitution}-${profile}`,charterDoctrine:profile==='transferred'?TRANSFER[constitution]:profile,...(constitution==='commons'&&profile==='native'&&nativeCommonsMaintenance!==undefined?{charterMaintenance:nativeCommonsMaintenance}:{})};}
const hms=(seconds:number)=>`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${Math.round(seconds%60*100)/100}s`;
export async function fingerprint(){
 const walk=async(dir:string):Promise<string[]>=>{const entries=await readdir(dir,{withFileTypes:true});return(await Promise.all(entries.map(entry=>entry.isDirectory()?walk(`${dir}/${entry.name}`):entry.isFile()?[`${dir}/${entry.name}`]:[]))).flat();};
 const files=[...await walk('src'),'package.json','package-lock.json',...['optimized-v4.ts','charter-policy-v4.ts','charter-metrics-v4.ts','constitution-matrix-v4.ts','constitution-stress-v4.ts','constitution-route-probe-v4.ts'].map(file=>`tools/simulations/${file}`)].sort();
 const entries=await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')] as const));
 return {files:Object.fromEntries(entries),sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex')};
}
const stateDigest=(state:GameState)=>createHash('sha256').update(JSON.stringify(state)).digest('hex');

async function main(){
 const args=process.argv.slice(2),arg=(name:string,fallback:string)=>{const at=args.indexOf(name);return at<0?fallback:args[at+1];};
 const out=resolve(arg('--out','qa/simulations-v4/constitutions/diagnostic'));
 if(!out.toLowerCase().includes('simulations-v4'))throw new Error('Use a new simulations-v4 directory; prior evidence is immutable.');
 const parentPath=resolve(arg('--parent','qa/simulations-v4/optimized/final-parent/world-1-ending.json'));
 const names=arg('--constitutions','commons,precaution,service,federation,plural,frontier').split(',') as ConstitutionId[];
 const profiles=arg('--profiles',PROFILES.join(',')).split(',') as Profile[];
 if(names.some(id=>!CONSTITUTIONS.some(c=>c.id===id))||profiles.some(id=>!PROFILES.includes(id)))throw new Error('Unknown constitution or matrix profile.');
 const maxHours=Number(arg('--max-hours','24'));if(!Number.isFinite(maxHours)||maxHours<=0||maxHours>48)throw new Error('Choose a horizon above zero and no more than48hours.');
 const maintenanceArg=arg('--native-commons-maintenance',''),nativeCommonsMaintenance=maintenanceArg===''?undefined:Number(maintenanceArg);
 if(nativeCommonsMaintenance!==undefined&&(!Number.isFinite(nativeCommonsMaintenance)||nativeCommonsMaintenance<0||nativeCommonsMaintenance>100))throw new Error('A maintenance threshold must be between0and100.');
 const parentRaw=await readFile(parentPath,'utf8'),parsed=parseSave(parentRaw,getValidationCatalog());if(!parsed.ok)throw new Error(parsed.message);
 const parent=parsed.state;if(!parent.ending)throw new Error('The matrix parent must be a genuinely earned resolved civilization.');
 const parentExpandedProof=activeExperimentTemplates(parent.constitution).every(template=>evidenceProgress(parent.experiments,template.id,{adoptedOnly:true}).allowed);
 if(!parentExpandedProof&&!args.includes('--allow-legacy-parent'))throw new Error('The parent lacks expanded v4 evidence. Use a fresh v4 parent, or --allow-legacy-parent for an explicitly diagnostic run.');
 const sourceBefore=await fingerprint();await mkdir(out,{recursive:true});
 await writeFile(join(out,'parent.json'),serializeSave(parent,0));
 const configuration={createdAt:new Date().toISOString(),parentPath,parentFileSha256:createHash('sha256').update(parentRaw).digest('hex'),parentStateSha256:stateDigest(parent),parentExpandedProof,
  parent:{id:parent.id,constitution:parent.constitution,ending:parent.ending,elapsed:parent.elapsed,seed:parent.seed,cycle:parent.legacy.cycle,seeds:parent.legacy.seeds,efficiency:parent.legacy.efficiency,certificates:parent.legacy.contracts.length},
  method:'Each constitution legally Reinitializes the SAME earned parent. Each profile receives the exact same resulting initial state. Actual mutations use public commands and tick only. Native and transferred doctrine priorities differ; the same visible legality/recovery adapter is shared. No scenario modules are added. This is a finite controlled comparison, not a proof of global optimality or a sequential prestige chain. Engine time excludes human reading and actions.',
  profiles,transferPairs:TRANSFER,maxHours,nativeCommonsMaintenance,strategies:names.flatMap(id=>profiles.map(profile=>matrixStrategy(id,profile,nativeCommonsMaintenance))),sourceBefore};
 await writeFile(join(out,'configuration.json'),JSON.stringify(configuration,null,2));
 const rows=[];
 for(const constitution of names){
  const resetCommand={type:'prestige',layer:'reinitialize',constitution,modules:[]} as const;
  const reset=dispatchCommand(structuredClone(parent),{...resetCommand,modules:[]});if(!reset.ok)throw new Error(`${constitution}: ${reset.message}`);
  const initial=reset.state,folder=join(out,constitution);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'initial.json'),serializeSave(initial,0));await writeFile(join(folder,'reset-command.json'),JSON.stringify(resetCommand,null,2));
  const row={constitution,name:CONSTITUTIONS.find(c=>c.id===constitution)!.name,activeCharterProgram:CHARTER_PROGRAM_BY_CONSTITUTION[constitution],initialStateSha256:stateDigest(initial),initial:{seed:initial.seed,cycle:initial.legacy.cycle,seeds:initial.legacy.seeds,efficiency:initial.legacy.efficiency,certificates:initial.legacy.contracts.length,charter:initial.charter??null},runs:[] as any[]};
  for(const profile of profiles){
   const strategy=matrixStrategy(constitution,profile,nativeCommonsMaintenance),observer=createCharterObserver(initial,profile==='native');
   const result=simulate(strategy,{initialState:initial,stopAtEnding:true,maxHours,onStep:observer.observe});
   const metrics=observer.finish(result.finished),base=join(folder,profile),ending=serializeSave(result.finished,0),validation=parseSave(ending,getValidationCatalog());
   if(!validation.ok)throw new Error(`${constitution}/${profile}: ${validation.message}`);
   const templates=activeExperimentTemplates(constitution),projects=activeResearchProjects(constitution),proof=templates.map(template=>({template:template.id,...evidenceProgress(result.finished.experiments,template.id,{adoptedOnly:true})}));
   const summary={profile,strategy,success:result.finished.ending==='garden',seconds:result.finished.elapsed-initial.elapsed,commands:result.report.commands,ending:result.finished.ending,
    projects:result.finished.projects.filter(id=>projects.some(project=>project.id===id)).length,requiredProjects:projects.length,adequateTemplates:proof.filter(item=>item.allowed).length,requiredTemplates:templates.length,
    studies:metrics.studyCompletions.length,activeCharterProgram:row.activeCharterProgram,metrics,
    finalBalances:{tokens:result.finished.tokens,research:result.finished.research,lifetime:result.finished.lifetime,useful:result.finished.useful},finalPolicies:result.finished.policies,finalProducers:result.finished.producers,finalRates:getRates(result.finished),finalCharter:result.finished.charter??null,
    lastReason:result.report.endingEligibility[strategy.target],rejected:result.report.rejected,waitReasons:result.report.waitReasons,proof,initialStateSha256:stateDigest(initial),endingStateSha256:stateDigest(result.finished)};
   row.runs.push(summary);
   await writeFile(`${base}-ending.json`,ending);await writeFile(`${base}-trace.jsonl`,result.trace.map(entry=>JSON.stringify(entry)).join('\n')+'\n');await writeFile(`${base}-summary.json`,JSON.stringify(summary,null,2));
   for(const [label,state]of Object.entries(observer.earnedCheckpoints)){const dir=join(folder,'earned-checkpoints');await mkdir(dir,{recursive:true});await writeFile(join(dir,`${label}.json`),serializeSave(state,0));}
   console.log(JSON.stringify({constitution,profile,doctrine:strategy.charterDoctrine,success:summary.success,seconds:summary.seconds,projects:summary.projects,templates:summary.adequateTemplates,studies:summary.studies,charterActions:metrics.charterActionCounts,reason:summary.lastReason}));
  }
  rows.push(row);await writeFile(join(out,'matrix.json'),JSON.stringify({configuration,rows},null,2));
 }
 const sourceAfter=await fingerprint(),unchanged=sourceBefore.sha256===sourceAfter.sha256;
 const comparisons=rows.map(row=>{
  const native=row.runs.find(run=>run.profile==='native'),baseline=row.runs.find(run=>run.profile==='baseline'),transferred=row.runs.find(run=>run.profile==='transferred');
  return {constitution:row.constitution,nativeVsBaseline:native&&baseline?{secondsSaved:baseline.seconds-native.seconds,fractionSaved:(baseline.seconds-native.seconds)/baseline.seconds,researchOrder:researchOrderDistance(native.metrics.projectOrder,baseline.metrics.projectOrder)}:null,
   transferRegret:native&&transferred?{seconds:transferred.seconds-native.seconds,fraction:(transferred.seconds-native.seconds)/native.seconds,researchOrder:researchOrderDistance(native.metrics.projectOrder,transferred.metrics.projectOrder)}:null};
 });
 const final={configuration,sourceAfter,unchangedSourceDuringRun:unchanged,canonicalEligible:unchanged&&parentExpandedProof,comparisons,rows};
 await writeFile(join(out,'matrix.json'),JSON.stringify(final,null,2));
 await writeFile(join(out,'winner-policies.json'),JSON.stringify(Object.fromEntries(rows.map(row=>{const best=row.runs.filter(run=>run.success).sort((a,b)=>a.seconds-b.seconds)[0];return[row.constitution,best?{strategy:best.strategy}:null];})),null,2));
 const lines=['# V4 controlled constitutional strategy comparison','',configuration.method,'',`Unchanged source: **${unchanged}**. Parent has expanded v4 proof: **${parentExpandedProof}**.`,'',
  '| Constitution | Native | Baseline | Transferred | Best tested | Complete Garden cells |','| --- | ---: | ---: | ---: | --- | ---: |'];
 for(const row of rows){const best=row.runs.filter(run=>run.success).sort((a,b)=>a.seconds-b.seconds)[0];lines.push(`| ${row.name} | ${PROFILES.map(profile=>{const run=row.runs.find(item=>item.profile===profile);return run?`${hms(run.seconds)}${run.success?'':' (incomplete)'}`:'not run';}).join(' | ')} | ${best?.profile??'none'} | ${row.runs.filter(run=>run.success).length}/${row.runs.length} |`);}
 lines.push('','The named candidates are not themselves evidence of strategic depth. Compare actual modes, allocations, reserves, resource transfers, study contexts, project ordering, and recovery. Rate-budget integrals are estimates sampled at driver ticks; exact action balances and final ledger state are retained separately. Positive wallet deltas may be refunded principal and must not be labeled new income.','',
  'This matrix holds the parent, constitution-specific initial state, and public-command rules constant. Fresh Commons casual pacing and the six-world casual/expert chains are separate verification tasks. Native checkpoint saves are earned through the included trace and can support targeted recovery experiments without injected resources.');
 await writeFile(join(out,'MATRIX.md'),lines.join('\n')+'\n');
 if(!unchanged)console.warn('Source changed during run. Preserve as diagnostic; do not report it as a frozen canonical result.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
