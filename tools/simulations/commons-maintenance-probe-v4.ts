/** Finite, fresh-world policy comparison. No game-state edits or earned fixtures. */
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {CANDIDATES,simulate,type Strategy} from './optimized-v4';
import {decimal} from '../../src/engine/amounts';
import {serializeSave,parseSave,getValidationCatalog} from '../../src/persistence';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const runners=['tools/simulations/optimized-v4.ts','tools/simulations/charter-policy-v4.ts','tools/simulations/commons-maintenance-probe-v4.ts'];
async function fingerprint(){
 const walk=async(directory:string):Promise<string[]>=>{const entries=await readdir(directory,{withFileTypes:true});return(await Promise.all(entries.map(entry=>entry.isDirectory()?walk(`${directory}/${entry.name}`):[`${directory}/${entry.name}`]))).flat();};
 const files=[...await walk('src'),'package.json','package-lock.json',...runners].sort();
 const entries=await Promise.all(files.map(async path=>({path,sha256:hash(await readFile(path,'utf8'))})));
 return {files:entries,sha256:hash(JSON.stringify(entries))};
}
const args=process.argv.slice(2),argument=(name:string,fallback:string)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const directory=resolve(argument('--out','qa/simulations-v4/optimized/maintenance-probe'));
if(!directory.includes('simulations-v4'))throw new Error('Use a new simulations-v4 output directory.');
const thresholds=argument('--thresholds','70,85,95,99').split(',').map(Number);
if(thresholds.some(n=>!Number.isFinite(n)||n<0||n>99))throw new Error('Invalid maintenance threshold.');
await mkdir(directory,{recursive:true});
const before=await fingerprint();await writeFile(join(directory,'source-before.json'),JSON.stringify(before,null,2));
for(const path of runners)await writeFile(join(directory,path.split('/').at(-1)+'.txt'),await readFile(path,'utf8'));
const rows=[];
for(const threshold of thresholds){
 const strategy:Strategy={...CANDIDATES.find(c=>c.id==='recoverable-shortcuts')!,id:`native-commons-maintenance-${threshold}`,charterDoctrine:'native',charterMaintenance:threshold};
 const operations:unknown[]=[],actions:Record<string,number>={};let spentTokens=decimal(0),spentResearch=decimal(0),maintenanceTokens=decimal(0),maintenanceResearch=decimal(0);
 const result=simulate(strategy,{stopAtEnding:true,certificatesPerWorld:1000,maxHours:24,onStep:step=>{
  if(step.kind!=='command'||!step.ok||step.command?.type!=='charterAction')return;
  const {action,target}=step.command,tokens=decimal(step.before.tokens).sub(step.after.tokens),research=decimal(step.before.research).sub(step.after.research);
  actions[action]=(actions[action]??0)+1;
  spentTokens=spentTokens.add(tokens);spentResearch=spentResearch.add(research);
  if(action==='maintain'){maintenanceTokens=maintenanceTokens.add(tokens);maintenanceResearch=maintenanceResearch.add(research);}
  const prior=step.before.charter?.kind==='commons'?step.before.charter.data.methods.find(m=>m.id===target):undefined;
  const after=step.after.charter?.kind==='commons'?step.after.charter.data.methods.find(m=>m.id===target):undefined;
  operations.push({at:step.before.elapsed,action,target,tokens:tokens.toString(),research:research.toString(),conditionBefore:prior?.maintenance,conditionAfter:after?.maintenance});
 }});
 const save=async(label:string,state:typeof result.finished)=>{const raw=serializeSave(state,0),parsed=parseSave(raw,getValidationCatalog());if(!parsed.ok)throw new Error(`${threshold}/${label}: ${parsed.message}`);await writeFile(join(directory,`${threshold}-${label}.json`),raw);};
 await save('before-ending',result.beforeEnding);await save('ending',result.finished);
 await writeFile(join(directory,`${threshold}-report.json`),JSON.stringify(result.report,null,2));
 await writeFile(join(directory,`${threshold}-trace.jsonl`),result.trace.map(row=>JSON.stringify(row)).join('\n')+'\n');
 const row={threshold,strategy,success:result.finished.ending==='garden',seconds:result.report.seconds,commands:result.report.commands,projects:result.finished.projects.length,studies:result.finished.experiments.length,adoptions:result.finished.experiments.filter(r=>r.adopted).length,certificates:result.finished.legacy.contracts.length,actions,allOperatingCosts:{tokens:spentTokens.toString(),research:spentResearch.toString()},maintenanceCosts:{tokens:maintenanceTokens.toString(),research:maintenanceResearch.toString()},operations,rejected:result.report.rejected};
 rows.push(row);await writeFile(join(directory,'candidate-ledger.json'),JSON.stringify({thresholds,rows},null,2));
 console.log(JSON.stringify({...row,operations:undefined,strategy:undefined}));
}
const after=await fingerprint(),winner=[...rows].filter(row=>row.success).sort((a,b)=>a.seconds-b.seconds||a.commands-b.commands)[0];
const report={method:'Four independent fresh createGame(1701,0) native Commons campaigns. Only the maintenance condition threshold differs. Actual mutations are dispatchCommand and tick; all traces and validated saves retained. Select fastest successful engine time, then fewer commands for a tie. Excludes human interaction/reading time. Finite tested set, not a proven global optimum.',thresholds,rows,winner,sourceUnchanged:before.sha256===after.sha256,sourceBefore:before.sha256,sourceAfter:after.sha256};
await writeFile(join(directory,'source-after.json'),JSON.stringify(after,null,2));
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
await writeFile(join(directory,'winner-policy.json'),JSON.stringify({commons:{strategy:winner?.strategy}},null,2));
console.log(JSON.stringify({complete:true,winner:winner?.threshold,seconds:winner?.seconds,sourceUnchanged:report.sourceUnchanged,directory}));
