import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const currentDirectory=path.resolve(process.argv[2]??'qa/experience-v6/pacing/final');
const priorDirectory=path.resolve('qa/simulations-v5/casual/final');
const oldFreeze=JSON.parse(fs.readFileSync('qa/simulations-v5/source-freeze.json','utf8'));
const newFreeze=JSON.parse(fs.readFileSync('qa/experience-v6/source-freeze.json','utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const changed=[];
for(const file of newFreeze.files){
  assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Current freeze changed: ${file.path}`);
  const prior=oldFreeze.files.find(candidate=>candidate.path===file.path);
  if(prior?.sha256!==file.sha256)changed.push({file:file.path,before:prior?.sha256??null,after:file.sha256});
}
const removed=oldFreeze.files.filter(file=>!newFreeze.files.some(candidate=>candidate.path===file.path));
assert(removed.length===0,'The experience pass removed source files; review before claiming mechanical equivalence.');
assert(changed.every(file=>/\.(tsx|css)$/.test(file.file)),'Non-presentation source changed; do not reuse a mechanical equivalence claim.');
assert.equal(hash(fs.readFileSync(path.join(currentDirectory,'policy.json'))),hash(fs.readFileSync(path.join(priorDirectory,'policy.json'))),'Persona or timing policy changed.');
const prior=JSON.parse(fs.readFileSync(path.join(priorDirectory,'chain-report.json'),'utf8'));
const current=JSON.parse(fs.readFileSync(path.join(currentDirectory,'chain-report.json'),'utf8'));
assert.equal(current.rootFreezeSha256,newFreeze.sha256);
assert(current.sourceChangesDuringRun.length===0);
assert(Object.values(current.checks).every(Boolean),'A full-chain pacing check failed.');
assert.deepEqual(current.total,prior.total,'Aggregate duration/prestige changed.');
const readTrace=directory=>fs.readFileSync(path.join(directory,'actions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.type!=='init');
const priorRows=readTrace(priorDirectory),currentRows=readTrace(currentDirectory);
assert.deepEqual(currentRows,priorRows,'A public action, reading interval, or other trace observation changed.');
const saves=fs.readdirSync(currentDirectory).filter(name=>/^(?:world-\d+-(?:before-ending|ending|before-refit|after-refit|after-reinitialize|after-reframe)|final-state)\.json$/.test(name));
const checkpoints=[];
for(const name of saves){
  const actual=fs.readFileSync(path.join(currentDirectory,name)),expected=fs.readFileSync(path.join(priorDirectory,name));
  assert.equal(hash(actual),hash(expected),`Earned checkpoint differs: ${name}`);
  checkpoints.push({file:name,sha256:hash(actual)});
}
const clock=seconds=>`${Math.floor(seconds/3600)}h ${String(Math.floor(seconds%3600/60)).padStart(2,'0')}m ${String(Math.floor(seconds%60)).padStart(2,'0')}s`;
const result={sourceSha256:newFreeze.sha256,priorSourceSha256:oldFreeze.sha256,sourceChanged:changed,removed,unchangedPolicy:true,exactTraceMatch:true,traceRowsCompared:currentRows.length,exactCheckpointMatch:true,checkpoints,validatedStates:current.validatedStates,checks:current.checks,total:current.total,worlds:current.worlds.map(world=>({constitution:world.constitution,ending:world.ending,engineSeconds:world.time.engineSeconds,modeledWallSeconds:world.time.modeledWallSeconds,readingSeconds:world.time.readingSeconds,decisionSeconds:world.time.decisionSeconds,waitingSeconds:world.time.waitingSeconds,pausedSeconds:world.time.pausedSeconds,commands:world.counts.commands,rejectedCommands:world.counts.failed})),limitations:['Fresh run of the same scripted policy, not an independent new player strategy or an observed human participant.','All engine, scientific, economic, story, and society definition .ts files remained byte-identical. The presentation diff still needs browser verification of event wiring and controls.','The complete v5 independent replay is prior-source evidence. This regression checks every intermediate state and exactly compares all new trace rows and earned checkpoints with that verified run; it does not relabel the old independent replay as a new one.','220 wpm reading applies to content-backed interactions counted by the persona, including content now available inside disclosures. The existing model does not measure navigation, opening disclosures, skimming, or visual comprehension. UI-only copy changes are reported separately and are not padded into or subtracted from simulated duration.']};
fs.writeFileSync(path.join(currentDirectory,'pacing-comparison.json'),JSON.stringify(result,null,2)+'\n');
const lines=['# Casual campaign pacing after the browser experience pass','',`All six campaigns reach Garden within 8–12 modeled hours. The new run validated ${current.validatedStates.toLocaleString('en-US')} intermediate states, rejected no command, and exactly matches the previously independently verified action trace and ${checkpoints.length} earned saves.`, '', '| Constitution | Modeled play time | Actual engine time |', '| --- | ---: | ---: |',...result.worlds.map(world=>`| ${world.constitution} | ${clock(world.modeledWallSeconds)} | ${clock(world.engineSeconds)} |`),'',`Prestige: ${current.total.refits} Refit, ${current.total.reinitializations} Reinitializations, ${current.total.reframes} Reframes; all earned and successful.`, '', `Executed simulation source: \`${newFreeze.sha256}\`. The ${changed.length} source changes are presentation files; engine and content definitions are unchanged. The exact v5 timing/persona policy is retained.`, '',...result.limitations.map(item=>`- ${item}`),''];
fs.writeFileSync(path.join(currentDirectory,'PACING.md'),lines.join('\n'));
console.log(JSON.stringify({source:newFreeze.sha256,checks:current.checks,validatedStates:current.validatedStates,traceRowsCompared:currentRows.length,checkpoints:checkpoints.length,times:result.worlds.map(world=>({constitution:world.constitution,time:clock(world.modeledWallSeconds)}))},null,2));
