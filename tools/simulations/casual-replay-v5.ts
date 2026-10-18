/** Independent command/tick replay for one completed casual v5 trace. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createGame, dispatchCommand, tick} from '../../src/engine/index.ts';
import {parseSave, validateSaveState} from '../../src/persistence/validation.ts';
import type {GameState} from '../../src/contracts.ts';

const directory=path.resolve(process.argv[2]??'');
const allowed=path.resolve('qa/simulations-v5/casual');
if(!directory.startsWith(allowed+path.sep))throw new Error('Provide a saved casual v5 run directory.');
const sha=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const source=JSON.parse(fs.readFileSync(path.join(directory,'source-manifest.json'),'utf8'));
const changed=source.files.filter((entry:{path:string;sha256:string})=>sha(fs.readFileSync(entry.path))!==entry.sha256);
if(changed.length)throw new Error(`Replay needs identical source: ${changed.map((entry:{path:string})=>entry.path).join(', ')}`);
const rows=fs.readFileSync(path.join(directory,'actions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const initial=rows.find(row=>row.type==='init');
let state=createGame(initial.seed,initial.now),commands=0,ticks=0,checkedStates=0;
const checks:{file:string;equal:boolean;valid:boolean;commandIndex:number}[]=[];
const sorted=(input:any):any=>input&&typeof input==='object'?(Array.isArray(input)?input.map(sorted):Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,sorted(value)]))):input;
const canonical=(input:unknown):string=>JSON.stringify(sorted(JSON.parse(JSON.stringify(input))));
function checkSave(file:string){
 const text=fs.readFileSync(path.join(directory,file),'utf8');
 const parsed=parseSave(text);
 if(!parsed.ok)throw new Error(`Stored save rejected: ${file}`);
 const expected=JSON.parse(text).state as GameState;
 const equal=canonical(state)===canonical(expected);
 checks.push({file,equal,valid:true,commandIndex:commands});
 if(!equal)throw new Error(`Replay diverged at ${file}`);
}
for(const row of rows){
 if(row.type==='command'){
  if(row.command.type==='finish')checkSave(`world-${row.world}-before-ending.json`);
  if(row.command.type==='prestige'&&row.command.layer==='refit')checkSave('world-2-before-refit.json');
  const result=dispatchCommand(state,row.command);
  if(result.ok!==row.ok||result.message!==row.message)throw new Error(`Command receipt mismatch at ${commands}: ${JSON.stringify(row.command)}`);
  state=result.state;commands++;
 }else if(row.type==='tick'){
  const before=state.elapsed;state=tick(state,row.seconds);ticks++;
  if(Math.abs((state.elapsed-before)-row.actualSeconds)>1e-7)throw new Error(`Elapsed-time mismatch at tick ${ticks}`);
 }else if(row.type==='refit-observation')checkSave('world-2-after-refit.json');
 else if(row.type==='transition')checkSave(`world-${row.world}-after-${row.layer}.json`);
 else if(row.type==='world-complete')checkSave(`world-${row.world}-ending.json`);
 if(row.type==='command'||row.type==='tick'){
  const valid=validateSaveState(state);checkedStates++;
  if(!valid.ok)throw new Error(`Replay invalid at command ${commands}, tick ${ticks}: ${JSON.stringify(valid)}`);
 }
}
checkSave('final-state.json');
const report={passed:checks.every(check=>check.equal),sourceAggregateSha256:source.sourceAggregateSha256,commands,ticks,checkedStates,checks,scope:'Deterministic public-command replay from a fresh createGame, comparing command receipts, tick elapsed time, every intermediate validation, and saved earned checkpoints. No injected resources or loaded earned state used to advance the run.'};
fs.writeFileSync(path.join(directory,'replay-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
