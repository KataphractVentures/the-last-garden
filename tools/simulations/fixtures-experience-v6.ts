/** Two earned browser checkpoints from legal, unchanged prefixes of the v5 casual trace. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createGame,dispatchCommand,tick} from '../../src/engine/index.ts';
import {parseSave,serializeSave,validateSaveState} from '../../src/persistence/validation.ts';

const output='qa/experience-v6/fixtures',input='qa/simulations-v5/casual/final/actions.jsonl';
fs.mkdirSync(output,{recursive:true});
const hash=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const traceBytes=fs.readFileSync(input),rows=traceBytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.world===1);
const init=rows.find(row=>row.type==='init');assert(init);
const baseline=JSON.parse(fs.readFileSync('qa/simulations-v5/source-freeze.json','utf8'));
const dependencies=baseline.files.filter((file:any)=>file.path.endsWith('.ts')&&!file.path.endsWith('.d.ts'));
for(const file of dependencies)assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Engine/content dependency changed: ${file.path}`);
let state=createGame(init.seed,init.now),commands=0,ticks=0;
const fixtures:any[]=[];
for(const [index,row]of rows.entries()){
  if(row.type==='command'){
    const result=dispatchCommand(state,row.command);assert.equal(result.ok,row.ok,`Receipt differs at row ${index+1}`);assert.equal(result.message,row.message,`Message differs at row ${index+1}`);state=result.state;commands++;
  }else if(row.type==='tick'){
    const before=state.elapsed;state=tick(state,row.seconds);assert.equal(state.elapsed-before,row.actualSeconds,`Tick differs at row ${index+1}`);ticks++;
  }else continue;
  assert.equal(state.elapsed,row.engineSeconds,`Engine clock differs at row ${index+1}`);
  if(row.type==='command'&&row.command.type==='advance'&&[3,6].includes(state.chapter)){
    assert.equal(state.pendingEvent,null);const validation=validateSaveState(state);assert(validation.ok,JSON.stringify(validation));
    const name=state.chapter===3?'chapter-3-before-public-decisions.json':'chapter-6-before-sponsor-decision.json';
    const file=`${output}/${name}`;assert(!fs.existsSync(file),'Do not overwrite a browser fixture.');
    const savedAt=Date.now(),save=serializeSave(state,savedAt),parsed=parseSave(save);assert(parsed.ok,JSON.stringify(parsed));
    fs.writeFileSync(file,save);
    fixtures.push({file,sha256:hash(save),traceRow:index+1,commands,ticks,cut:'Immediately after a successful public advance command',chapter:state.chapter,engineSeconds:state.elapsed,modeledWallSeconds:row.wallSeconds,pendingEvent:state.pendingEvent,publicMandate:state.governance?.mandate??'none',societyDecisions:state.society?.decisions??{},societyCases:state.society?.cases??[],savedAt,validation:'passed',source:'Unmodified prefix state; only serialized export timestamp is current to avoid importing artificial absence time.'});
    if(fixtures.length===2)break;
  }
}
assert.equal(fixtures.length,2);
for(const file of dependencies)assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Engine/content dependency changed during replay: ${file.path}`);
const report={trace:input,traceSha256:hash(traceBytes),baselineSource:baseline.sha256,unchangedMechanicsFiles:dependencies.length,fixtures,limitations:['Only commands/ticks through these prefixes were replayed. These are browser interaction checkpoints, not a new complete campaign run.','Every command receipt and tick duration was checked against the original trace. Each exported save passed strict validation and parse round-trip. No resources or state fields were injected.']};
fs.writeFileSync(`${output}/PROVENANCE.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
