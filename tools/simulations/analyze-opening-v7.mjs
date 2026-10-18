import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const source=path.resolve(process.argv[2]??'qa/experience-v6/pacing/final');
const out=path.resolve(process.argv[3]??'qa/opening-v7/pacing/baseline');
if(fs.existsSync(out))throw new Error('Preserve existing reports; choose a new directory.');
fs.mkdirSync(out,{recursive:true});
const trace=fs.readFileSync(path.join(source,'actions.jsonl'));
const rows=trace.toString().trim().split('\n').map(JSON.parse).filter(row=>row.world===1);
const report=JSON.parse(fs.readFileSync(path.join(source,'world-1-report.json'),'utf8'));
const add=(map,key,value=1)=>map[key]=(map[key]??0)+value;
const hh=seconds=>`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${Math.floor(seconds%60)}s`;
function analyze(clock,limit){
 const commands=rows.filter(row=>row.type==='command'&&row[clock]<limit);
 const ranges=rows.filter(row=>row.type==='tick').map(row=>({...row,start:row[clock]-(clock==='wallSeconds'?row.seconds:row.actualSeconds)})).filter(row=>row.start<limit);
 const duration={},pausedByCategory={};
 for(const row of ranges){
  const included=Math.max(0,Math.min(limit,row[clock])-row.start);
  add(duration,row.category,included);
  if(clock==='wallSeconds')add(pausedByCategory,row.category,included* Math.max(0,row.seconds-row.actualSeconds)/row.seconds);
 }
 const counts={},specific={};
 for(const row of commands){add(counts,row.command.type);add(specific,`${row.command.type}:${row.command.id??row.command.producer??row.command.template??row.command.program??row.command.event??''}`);}
 const bins=[];
 for(let start=0;start<limit;start+=300){
  const end=Math.min(limit,start+300),binCommands=commands.filter(row=>row[clock]>=start&&row[clock]<end),time={};
  for(const row of ranges){const overlap=Math.max(0,Math.min(end,row[clock])-Math.max(start,row.start));if(overlap)add(time,row.category,overlap);}
  bins.push({startSeconds:start,endSeconds:end,commands:binCommands.length,storyChoices:binCommands.filter(row=>row.command.type==='choose').length,experimentStarts:binCommands.filter(row=>row.command.type==='experiment'||row.command.type==='replicate').length,adoptions:binCommands.filter(row=>row.command.type==='adopt').length,purchases:binCommands.filter(row=>row.command.type==='buy'||row.command.type==='upgrade').length,time});
 }
 const consecutive=[];let current=null;
 for(const row of commands){const kind=row.command.type;if(current?.kind===kind){current.count++;current.endSeconds=row[clock];}else{if(current)consecutive.push(current);current={kind,count:1,startSeconds:row[clock],endSeconds:row[clock]};}}if(current)consecutive.push(current);
 const gaps=commands.slice(1).map((row,i)=>({seconds:row[clock]-commands[i][clock],from:commands[i][clock],to:row[clock],after:commands[i].command.type,before:row.command.type}));
 const waits=ranges.filter(row=>row.category==='waiting').map(row=>({start:row.start,end:Math.min(limit,row[clock]),seconds:Math.max(0,Math.min(limit,row[clock])-row.start),reason:row.reason,engineSeconds:row.engineSeconds,wallSeconds:row.wallSeconds}));
 const engineAtCutoff=clock==='wallSeconds'?rows.filter(row=>row.type==='tick').reduce((sum,row)=>sum+Math.max(0,Math.min(row.actualSeconds,limit-(row.wallSeconds-row.seconds))),0):limit;
 return {clock,limitSeconds:limit,engineAtCutoff,commandCount:commands.length,commandTypes:counts,specificCounts:specific,timeByCategory:duration,pausedByCategory,longestGapsBetweenCommands:gaps.sort((a,b)=>b.seconds-a.seconds).slice(0,10),longestWaitingIntervals:waits.sort((a,b)=>b.seconds-a.seconds).slice(0,10),largestConsecutiveCommandRuns:consecutive.sort((a,b)=>b.count-a.count).slice(0,10),fiveMinuteBins:bins,milestones:report.milestones.filter(m=>m[clock]<=limit).map(m=>({chapter:m.chapter,engineSeconds:m.engineSeconds,wallSeconds:m.wallSeconds})),lastClockObservation:rows.filter(row=>row[clock]<=limit).at(-1)};
}
const result={source:path.relative(process.cwd(),source).replaceAll('\\','/'),traceSha256:crypto.createHash('sha256').update(trace).digest('hex'),policyId:JSON.parse(fs.readFileSync(path.join(source,'policy.json'),'utf8')).id,modeledFirstHour:analyze('wallSeconds',3600),firstEngineHour:analyze('engineSeconds',3600),limitations:['This is a previously frozen scripted casual policy, not a human/browser playthrough.','A command is a public engine action, not a measured number of clicks; configuration/navigation costs are only those declared by the persona.','Story reading pauses engine progression. Do not compare the browser simulation clock directly to the modeled wall clock.','Long gaps between commands include reading, deliberate waiting and decision time; they are not automatically boredom.','The policy checks mechanics known from visible descriptions and does not measure discoverability or whether a new player notices a control.','UI-only copy changes do not automatically alter the content-backed reading time. No time adjustment should be invented to retain an eight-to-twelve-hour target.']};
fs.writeFileSync(path.join(out,'opening-metrics.json'),JSON.stringify(result,null,2)+'\n');
const m=result.modeledFirstHour;
const lines=['# Opening-hour exposure from a canonical casual trace','',`Source: \`${result.source}\`, trace SHA-256 \`${result.traceSha256}\`. Policy: \`${result.policyId}\`.`, '', 'This report intentionally describes exposure, repetition and time categories without prescribing gameplay solutions to the independent browser player.', '', `In the first modeled wall hour, the persona issues **${m.commandCount} public commands**, resolves **${m.commandTypes.choose??0} story choices**, starts **${(m.commandTypes.experiment??0)+(m.commandTypes.replicate??0)} experiment/replication runs**, adopts **${m.commandTypes.adopt??0} findings**, and makes **${(m.commandTypes.buy??0)+(m.commandTypes.upgrade??0)} purchases**. Reconstructed engine progress at the one-hour modeled wall cutoff is ${hh(m.engineAtCutoff)}; these are different clocks.`, '', '| Time category | Modeled seconds | Share of first hour |', '| --- | ---: | ---: |', ...Object.entries(m.timeByCategory).map(([key,value])=>`| ${key} | ${value.toFixed(2)} | ${(value/36).toFixed(1)}% |`),'', '| Five-minute block | Commands | Story choices | Studies/replications | Adoptions | Purchases | Waiting seconds |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |',...m.fiveMinuteBins.map(bin=>`| ${bin.startSeconds/60}–${bin.endSeconds/60} min | ${bin.commands} | ${bin.storyChoices} | ${bin.experimentStarts} | ${bin.adoptions} | ${bin.purchases} | ${(bin.time.waiting??0).toFixed(1)} |`),'', '## Interpretation boundaries', '', ...result.limitations.map(item=>`- ${item}`), '', '## Verification plan', '', '1. Preserve the prior v6 trace and policy. Audit the live browser independently first.', '2. After the root fixes are complete, freeze all production source and copy the unchanged canonical casual policy into a new v7 run directory.', '3. If only presentation changes, compare all non-presentation dependencies and either replay the exact canonical trace or rerun all six constitutions; preserve explicit source identities and distinguish the mechanical equivalence check from actual browser wiring.', '4. If mechanics/content change, rerun the full six-world policy, including the already declared Refit, Reinitialization and Reframe transitions, on the final frozen source. Do not edit reading/waiting cadence to manufacture target durations.', '5. Validate each legal command/tick state and each exported checkpoint. Report first-hour exposure, full-world modeled times, rejected commands and successful prestige layers, including any deviations from 8–12 hours.', '6. If root adds a visible convenience control, verify public-command equivalence or its explicit new semantics and real browser behavior. Do not silently rewrite the casual persona to exploit the control.', ''];
fs.writeFileSync(path.join(out,'REPORT.md'),lines.join('\n'));
console.log(JSON.stringify({out,commands:m.commandCount,commandTypes:m.commandTypes,time:m.timeByCategory,engineAtCutoff:m.engineAtCutoff,longestWait:m.longestWaitingIntervals[0],largestConsecutive:m.largestConsecutiveCommandRuns.slice(0,3)},null,2));
