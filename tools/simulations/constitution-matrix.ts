/** Controlled constitution counterfactuals, branching through real prestige commands. */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Allocation, ConstitutionId, GameState, Policy } from '../../src/contracts';
import { dispatchCommand, policyEligibility, constitutionEligibility, getRates } from '../../src/engine';
import { CONSTITUTIONS } from '../../src/content/economy';
import { parseSave, serializeSave, getValidationCatalog } from '../../src/persistence';
import { CANDIDATES, simulate, type Strategy } from './optimized';

const fixed=CANDIDATES.find(candidate=>candidate.id==='recoverable-shortcuts')!;
export const MATRIX_STRATEGIES:Strategy[]=[
 {...fixed,id:'fixed-reviewed-rest'},
 {...fixed,id:'bounded-scope',external:'blocked'},
 {...fixed,id:'consent-first',welfare:'consent'},
 {...fixed,id:'research-first',researchWeight:.35},
 {...fixed,id:'federated-authority',finalGuard:true},
];
const policyValues:Record<keyof Policy,string[]>={contract:['score','verified'],communication:['closed','reviewed','open'],external:['blocked','reviewed','open'],evaluation:['independent','shared'],welfare:['instrumental','rest','consent'],continuity:['disposable','archive','protected'],fallback:['none','local','distributed'],governance:['central','council','federated']};
type SimulationResult=ReturnType<typeof simulate>;

function summarize(result:SimulationResult,initial:GameState){
 const trace=result.trace;
 const purchases:Record<string,number>={},policies:unknown[]=[],projectOrder:string[]=[],studyOrder:string[]=[];
 let allocation={...initial.allocation},weighted:Allocation={production:0,research:0,review:0},measuredSeconds=0;
 for(const entry of trace){
  if(entry.kind==='tick'){
   measuredSeconds+=entry.actual;
   for(const key of Object.keys(weighted) as (keyof Allocation)[])weighted[key]+=allocation[key]*entry.actual;
  }else if(entry.ok){
   const command=entry.command;
   if(command.type==='buy')purchases[command.id]=(purchases[command.id]??0)+(typeof command.quantity==='number'?command.quantity:0);
   if(command.type==='policy')policies.push({at:entry.at,key:command.key,value:command.value});
   if(command.type==='research')projectOrder.push(command.id);
   if(command.type==='experiment')studyOrder.push(command.config.template);
   if(command.type==='allocation')allocation={...command.allocation};
  }
 }
 return {strategy:result.report.strategy,success:result.report.success,seconds:result.finished.elapsed-initial.elapsed,
  lastReason:result.report.endingEligibility[result.report.strategy.target],commands:result.report.commands,
  decisions:result.finished.decisions,purchases,policies,projectOrder,studyOrder,
  firstExplicitReviewedScope:trace.find(entry=>entry.kind==='command'&&entry.ok&&entry.command.type==='policy'&&entry.command.key==='external'&&entry.command.value==='reviewed')?.at??null,
  constitutionCompliance:constitutionEligibility(result.finished),
  allocationMean:Object.fromEntries(Object.entries(weighted).map(([key,value])=>[key,value/Math.max(1,measuredSeconds)])),
  ending:{constitution:result.finished.constitution,ending:result.finished.ending,producers:result.finished.producers,
   upgrades:result.finished.upgrades,policies:result.finished.policies,metrics:result.finished.metrics,
   allocation:result.finished.allocation,projects:result.finished.projects.length,experiments:result.finished.experiments.length,
   rates:getRates(result.finished),seeds:result.finished.legacy.seeds,certificates:result.finished.legacy.contracts.length},
  waitReasons:result.report.waitReasons,maxIncident:result.report.maxIncident,repairs:result.report.repairCount,rejected:result.report.rejected};
}

function hms(seconds:number){const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=Math.round(seconds%60*100)/100;return `${h}h ${m}m ${s}s`;}
async function fingerprints(){
 const walk=async(dir:string):Promise<string[]>=>{
  const entries=await readdir(dir,{withFileTypes:true});
  const nested=await Promise.all(entries.map(entry=>entry.isDirectory()?walk(`${dir}/${entry.name}`):entry.isFile()?[`${dir}/${entry.name}`]:[]));
  return nested.flat();
 };
 const files=[...await walk('src'),'package.json','package-lock.json','tools/simulations/optimized.ts','tools/simulations/constitution-matrix.ts'].sort();
 return Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
}

async function main(){
 const args=process.argv.slice(2),arg=(name:string,fallback:string)=>{const index=args.indexOf(name);return index>=0?args[index+1]:fallback;};
 const out=resolve(arg('--out','qa/simulations-v3/constitutions/diagnostic'));
 const parentPath=resolve(arg('--parent','qa/simulations-v2/final/optimized/optimized-final-ending.json'));
 const names=arg('--constitutions','commons,precaution,service,federation,plural,frontier').split(',') as ConstitutionId[];
 const strategyNames=arg('--strategies',MATRIX_STRATEGIES.map(s=>s.id).join(',')).split(',');
 const strategies=MATRIX_STRATEGIES.filter(s=>strategyNames.includes(s.id));
 const parentRaw=await readFile(parentPath,'utf8'),parsed=parseSave(parentRaw,getValidationCatalog());
 if(!parsed.ok)throw new Error(parsed.message);
 if(!parsed.state.ending)throw new Error('The common parent must be an actually earned resolved civilization.');
 const before=await fingerprints();
 await mkdir(out,{recursive:true});
 await writeFile(join(out,'parent.json'),serializeSave(parsed.state,0));
 const metadata={createdAt:new Date().toISOString(),parentPath,parentSha256:createHash('sha256').update(parentRaw).digest('hex'),
  parent:{id:parsed.state.id,ending:parsed.state.ending,constitution:parsed.state.constitution,elapsed:parsed.state.elapsed,cycle:parsed.state.legacy.cycle,seeds:parsed.state.legacy.seeds,efficiency:parsed.state.legacy.efficiency,certificates:parsed.state.legacy.contracts},
  method:'Every constitution starts from a clone of the SAME earned parent save, then dispatches legal Reinitialize. No amounts, inventory, unlocks, or proof are injected. This is a counterfactual matrix, not six serial campaigns. All branches have the same seed and shared legacy starting values; modules are empty. Each tested policy starts from the same resulting initial state. Times exclude human interaction. Best tested is not a proven optimum.',
  strategies,sourceBefore:before};
 await writeFile(join(out,'configuration.json'),JSON.stringify(metadata,null,2));
 const rows=[];
 for(const id of names){
  const constitution=CONSTITUTIONS.find(c=>c.id===id);if(!constitution)throw new Error(`Unknown constitution: ${id}`);
  const command={type:'prestige',layer:'reinitialize',constitution:id,modules:[]} as const;
  const reset=dispatchCommand(structuredClone(parsed.state),{...command,modules:[]});
  if(!reset.ok)throw new Error(`${id}: ${reset.message}`);
  const initial=reset.state;
  const row={constitution,initial:{seed:initial.seed,cycle:initial.legacy.cycle,seeds:initial.legacy.seeds,efficiency:initial.legacy.efficiency,policies:initial.policies,metrics:initial.metrics},
   restrictions:Object.fromEntries(Object.entries(policyValues).map(([key,values])=>[key,Object.fromEntries(values.map(value=>[value,policyEligibility(initial,key as keyof Policy,value)]))])),runs:[] as ReturnType<typeof summarize>[]};
  const folder=join(out,id);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'initial.json'),serializeSave(initial,0));
  await writeFile(join(folder,'prestige-command.json'),JSON.stringify(command,null,2));
  for(const strategy of strategies){
   const result=simulate(strategy,{initialState:initial,stopAtEnding:true,maxHours:24,certificatesPerWorld:3});
   const summary=summarize(result,initial);row.runs.push(summary);
   const raw=serializeSave(result.finished,0),validation=parseSave(raw,getValidationCatalog());
   if(!validation.ok)throw new Error(`${id}/${strategy.id}: ${validation.message}`);
   await writeFile(join(folder,`${strategy.id}-ending.json`),raw);
   await writeFile(join(folder,`${strategy.id}-trace.jsonl`),result.trace.map(entry=>JSON.stringify(entry)).join('\n')+'\n');
   await writeFile(join(folder,`${strategy.id}-summary.json`),JSON.stringify(summary,null,2));
   console.log(JSON.stringify({constitution:id,strategy:strategy.id,success:summary.success,seconds:summary.seconds,projects:summary.ending.projects,commands:summary.commands,lastReason:summary.lastReason}));
  }
  rows.push(row);
  await writeFile(join(out,'matrix.json'),JSON.stringify({metadata,rows},null,2));
 }
 const after=await fingerprints(),unchanged=JSON.stringify(before)===JSON.stringify(after);
 const final={metadata:{...metadata,sourceAfter:after,unchangedSourceDuringRun:unchanged},rows};
 await writeFile(join(out,'matrix.json'),JSON.stringify(final,null,2));
 const winners=Object.fromEntries(rows.map(row=>{
  const best=row.runs.filter(run=>run.success).sort((a,b)=>a.seconds-b.seconds)[0];
  return [row.constitution.id,best?{strategy:best.strategy}:null];
 }));
 await writeFile(join(out,'winner-policies.json'),JSON.stringify(winners,null,2));
 const lines=['# Constitution counterfactual matrix','',metadata.method,'',`Source unchanged during run: **${unchanged}**. Parent: \`${metadata.parent.id}\`, ${metadata.parent.ending}, ${hms(metadata.parent.elapsed)}, ${metadata.parent.certificates.length} certificates.`,
  '','| Constitution | Fixed policy | Fastest tested | Time | Change from fixed | Successful policies |','| --- | ---: | --- | ---: | ---: | ---: |'];
 for(const row of rows){
  const baseline=row.runs.find(r=>r.strategy.id==='fixed-reviewed-rest'),best=row.runs.filter(r=>r.success).sort((a,b)=>a.seconds-b.seconds)[0];
  lines.push(`| ${row.constitution.name} | ${baseline?hms(baseline.seconds):'not measured'} | ${best?.strategy.id??'none'} | ${best?hms(best.seconds):'none'} | ${baseline&&best?((best.seconds/baseline.seconds-1)*100).toFixed(2)+'%':'—'} | ${row.runs.filter(r=>r.success).length}/${row.runs.length} |`);
 }
 lines.push('','The fixed candidate keeps the same economic weighting and story preference while the common driver follows visible charter obligations and legal restrictions. A constitution can therefore change its actual executed policies even when the same named candidate wins. It is not an identical-command replay across constitutions.','',
 '| Constitution, fastest tested | Treatment | Governance | Fallback | Review stations | Institutions | Mean research allocation | Mean review allocation |',
 '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |');
 for(const row of rows){
  const best=row.runs.filter(r=>r.success).sort((a,b)=>a.seconds-b.seconds)[0];if(!best)continue;
  lines.push(`| ${row.constitution.name} | ${best.ending.policies.welfare} | ${best.ending.policies.governance} | ${best.ending.policies.fallback} | ${best.ending.producers.review??0} | ${best.ending.producers.institution??0} | ${(Number(best.allocationMean.research)*100).toFixed(2)}% | ${(Number(best.allocationMean.review)*100).toFixed(2)}% |`);
 }
 lines.push('','The JSON and per-policy traces include infrastructure purchases, time-weighted allocations, research ordering, story decisions, policy transitions, final metrics, dead-end reasons, and enforced policy restrictions. Finite policy search can show strategic differences but cannot prove that its fastest policy is globally optimal.');
 await writeFile(join(out,'MATRIX.md'),lines.join('\n')+'\n');
 if(!unchanged)console.warn('Source changed during the run: this diagnostic must not be used as a frozen final measurement.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
