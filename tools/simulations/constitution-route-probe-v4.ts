/** Isolates Federation route costs, arrival delay and spare capacity at the SAME uneven allocation. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import type { Command, GameState } from '../../src/contracts';
import { dispatchCommand, getRates, tick } from '../../src/engine';
import { getCharterActions } from '../../src/constitution/economics';
import { getValidationCatalog, parseSave, serializeSave } from '../../src/persistence';
import { createCharterObserver } from './charter-metrics-v4';
import { fingerprint } from './constitution-matrix-v4';
import type { Trace } from './optimized-v4';

const args=process.argv.slice(2),arg=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const input=resolve(arg('--input','qa/simulations-v4/constitutions/stress-final/federation/damaged.json')),out=resolve(arg('--out','qa/simulations-v4/constitutions/federation-route-final'));
if(!out.toLowerCase().includes('simulations-v4'))throw new Error('Use a new v4 artifact folder.');
const raw=await readFile(input,'utf8'),parsed=parseSave(raw,getValidationCatalog());if(!parsed.ok)throw new Error(parsed.message);
const initial=parsed.state;if(initial.charter?.kind!=='federation'||!initial.charter.established||initial.ending)throw new Error('Use a live, earned Federation disruption checkpoint.');
const sourceBefore=await fingerprint(),rows=[];await mkdir(out,{recursive:true});await writeFile(join(out,'initial.json'),serializeSave(initial,0));
for(const mode of ['ring','hub','redundant'] as const){
 let state:GameState=structuredClone(initial);const observer=createCharterObserver(initial),trace:Trace[]=[];
 const command=(command:Command)=>{const before=state,result=dispatchCommand(state,command);trace.push({kind:'command',at:before.elapsed,command,ok:result.ok,message:result.message});observer.observe({kind:'command',before,after:result.state,command,ok:result.ok,message:result.message});if(!result.ok)throw new Error(result.message);state=result.state;};
 command({type:'charterConfigure',mode});
 if(state.charter?.kind!=='federation')throw new Error('Unexpected charter.');
 const districts=state.charter.data.districts,source=districts.map((d,i)=>({i,value:new Decimal(d.treasury)})).sort((a,b)=>b.value.cmp(a.value))[0].i,destination=districts.map((d,i)=>({i,value:new Decimal(d.treasury)})).sort((a,b)=>a.value.cmp(b.value))[0].i;
 const quote=getCharterActions(state).find(q=>q.action==='transferDistrict'&&q.target===source&&q.secondary===destination);if(!quote?.allowed)throw new Error(quote?.reason??'No funded transfer offered.');
 command({type:'charterAction',action:'transferDistrict',target:source,secondary:destination});
 const committed=structuredClone(state.charter!.kind==='federation'?state.charter!.data.transfers.at(-1):undefined),rates=getRates(state);let arrivedAfter:number|null=null;
 for(let n=0;n<30;n++){
  const before=state,after=tick(before,1),actual=after.elapsed-before.elapsed;trace.push({kind:'tick',at:before.elapsed,requested:1,actual});observer.observe({kind:'tick',before,after,requested:1,actual});state=after;
  if(actual!==1)throw new Error('Route probe clock stopped.');
  if(arrivedAfter===null&&state.charter?.kind==='federation'&&!state.charter.data.transfers.some(t=>t.id===committed?.id))arrivedAfter=state.elapsed-initial.elapsed;
 }
 const save=serializeSave(state,0),validation=parseSave(save,getValidationCatalog());if(!validation.ok)throw new Error(validation.message);
 await writeFile(join(out,`${mode}-ending.json`),save);await writeFile(join(out,`${mode}-trace.jsonl`),trace.map(row=>JSON.stringify(row)).join('\n')+'\n');
 rows.push({mode,allocation:initial.charter.data.allocation,committed,arrivedAfter,rates,earnedIncome:new Decimal(state.lifetime).sub(initial.lifetime).toString(),usefulWork:new Decimal(state.useful).sub(initial.useful).toString(),walletDelta:new Decimal(state.tokens).sub(initial.tokens).toString(),metrics:observer.finish(state)});
}
const sourceAfter=await fingerprint(),unchangedSourceDuringRun=sourceBefore.sha256===sourceAfter.sha256;
await writeFile(join(out,'routes.json'),JSON.stringify({input,inputSha256:createHash('sha256').update(raw).digest('hex'),sourceBefore,sourceAfter,unchangedSourceDuringRun,method:'Same earned state, same uneven assignment, same funded transfer principal and source/destination; only the publicly chosen route changes. Thirty active seconds for each branch. Arrival, consumed route fee, and useful work are measured independently. This is a local mechanism comparison, not a campaign optimum.',rows},null,2));
await writeFile(join(out,'ROUTES.md'),['# Federation route counterfactual','','The assignment and earned parent remain fixed; only the route changes.','','| Route | Principal | Fee consumed | Arrival seconds | Useful work in30seconds |','| --- | ---: | ---: | ---: | ---: |',...rows.map(row=>`| ${row.mode} | ${row.committed?.amount} | ${row.committed?.fee} | ${row.arrivedAfter} | ${row.usefulWork} |`),'','The redundant route can recover some work stranded by this deliberately uneven assignment. Faster arrival and lower fees are different benefits; this local comparison does not claim that one route dominates all full campaigns.'].join('\n')+'\n');
console.log(JSON.stringify(rows.map(({mode,committed,arrivedAfter,usefulWork})=>({mode,principal:committed?.amount,fee:committed?.fee,arrivedAfter,usefulWork}))));
