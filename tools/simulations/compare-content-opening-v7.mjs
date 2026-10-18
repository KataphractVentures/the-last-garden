import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const currentDirectory=path.resolve(process.argv[2]??'qa/opening-v7/pacing/content-final');
const priorDirectory=path.resolve('qa/opening-v7/pacing/final');
const current=JSON.parse(fs.readFileSync(path.join(currentDirectory,'chain-report.json'),'utf8'));
const prior=JSON.parse(fs.readFileSync(path.join(priorDirectory,'chain-report.json'),'utf8'));
const read=directory=>fs.readFileSync(path.join(directory,'actions.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
const now=read(currentDirectory),before=read(priorDirectory);
const commands=rows=>rows.filter(row=>row.type==='command').map(row=>({world:row.world,command:row.command,ok:row.ok,engineSeconds:row.engineSeconds}));
assert.deepEqual(commands(now),commands(before),'Public commands or their active timing changed.');
const ticks=rows=>rows.filter(row=>row.type==='tick');
const nowTicks=ticks(now),oldTicks=ticks(before);assert.equal(nowTicks.length,oldTicks.length);
const readingChanges=[];
for(let index=0;index<nowTicks.length;index++){
 const a=nowTicks[index],b=oldTicks[index];
 assert.equal(a.actualSeconds,b.actualSeconds,'An engine interval changed.');
 assert.equal(a.category,b.category);
 if(a.seconds!==b.seconds){assert.equal(a.category,'reading');assert.equal(a.actualSeconds,0,'Additional reading advanced the engine.');readingChanges.push({world:a.world,beforeReason:b.reason,afterReason:a.reason,beforeSeconds:b.seconds,afterSeconds:a.seconds,deltaSeconds:a.seconds-b.seconds,engineSeconds:a.engineSeconds});}
}
const worlds=current.worlds.map((world,index)=>{
 const earlier=prior.worlds[index];const {wallSeconds:aw,...ap}=world.primary;const {wallSeconds:bw,...bp}=earlier.primary;
 assert.deepEqual(ap,bp,'An earned outcome changed.');assert.deepEqual(world.counts,earlier.counts);
 return {world:index+1,constitution:world.constitution,ending:world.ending,priorModeledSeconds:earlier.time.modeledWallSeconds,currentModeledSeconds:world.time.modeledWallSeconds,deltaSeconds:world.time.modeledWallSeconds-earlier.time.modeledWallSeconds,readingDeltaSeconds:world.time.readingSeconds-earlier.time.readingSeconds,engineSeconds:world.time.engineSeconds,identicalOutcomeMeasurements:true,identicalCommandCounts:true};
});
const result={currentSource:current.rootFreezeSha256,priorSource:prior.rootFreezeSha256,identicalPublicCommandPayloads:true,identicalActiveTickProgress:true,commandCount:commands(now).length,tickCount:nowTicks.length,worlds,readingChanges,limitations:['This compares the final content run against the preserved scheduling run, not against an observed human.','Narrative text and saved historical prose differ, so this is not a byte-identical save claim.','The strict twelve-hour timing assertion remains separate and is not waived by matching mechanical outcomes.']};
fs.writeFileSync(path.join(currentDirectory,'content-comparison.json'),JSON.stringify(result,null,2)+'\n');
const lines=['# Final prose change: comparison with the scheduling run','',`Executed source: \`${result.currentSource}\`; prior scheduling source: \`${result.priorSource}\`.`, '', `All ${result.commandCount} public command payloads and their active-time positions match. All ${result.tickCount} tick intervals produce identical active engine progress. Each world has identical earned outcome measurements and command counts; the additional prose changes only paused reading intervals in this persona.`, '', '| Constitution | Modeled-time change | Reading-time change | Engine time change |','| --- | ---: | ---: | ---: |',...worlds.map(world=>`| ${world.constitution} | +${world.deltaSeconds}s | +${world.readingDeltaSeconds}s | 0s |`),'',...result.limitations.map(line=>`- ${line}`),''];
fs.writeFileSync(path.join(currentDirectory,'CONTENT-COMPARISON.md'),lines.join('\n'));
console.log(JSON.stringify({currentSource:result.currentSource,commands:result.commandCount,ticks:result.tickCount,readingIntervals:readingChanges.length,worlds},null,2));
