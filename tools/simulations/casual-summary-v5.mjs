import fs from 'node:fs';
import path from 'node:path';

const directory=path.resolve(process.argv[2]??'');
const allowed=path.resolve('qa/simulations-v5/casual');
if(!directory.startsWith(allowed+path.sep))throw new Error('Provide one saved casual v5 run directory.');
const report=JSON.parse(fs.readFileSync(path.join(directory,'chain-report.json'),'utf8'));
const auditAt=process.argv.indexOf('--audit');
const replayPath=auditAt>=0?path.resolve(process.argv[auditAt+1]):path.join(directory,'replay-report.json');
const replayRaw=fs.existsSync(replayPath)?JSON.parse(fs.readFileSync(replayPath,'utf8')):null;
if(auditAt>=0&&(!replayRaw?.exactStateMatch||replayRaw.frozenSourceSha256!==report.rootFreezeSha256))throw new Error('The independent audit must pass against this run’s root source freeze.');
const replay=replayRaw?(auditAt>=0?{passed:replayRaw.exactStateMatch,commands:replayRaw.commands,ticks:replayRaw.ticks,checkedStates:replayRaw.validatedStates,checks:replayRaw.checkpoints,independent:true,path:path.relative(directory,replayPath).replaceAll('\\','/')}:replayRaw):null;
const clock=seconds=>`${Math.floor(seconds/3600)}h ${String(Math.floor(seconds%3600/60)).padStart(2,'0')}m`;
const rows=report.worlds.map(world=>{
 const reportPath=path.join(directory,`world-${world.world}-report.json`);
 const full=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 const operationCounts=full.strategy.charterActionCounts;
 const mainActions=Object.entries(operationCounts).sort(([,a],[,b])=>b-a).map(([key,value])=>`${key} ×${value}`).join(', ');
 return {world:world.world,constitution:world.constitution,ending:world.ending,engineSeconds:world.time.engineSeconds,modeledWallSeconds:world.time.modeledWallSeconds,readingSeconds:world.time.readingSeconds,decisionSeconds:world.time.decisionSeconds,waitingSeconds:world.time.waitingSeconds,pausedSeconds:world.time.pausedSeconds,studies:world.counts.studies,projects:world.counts.projects,findings:full.counts.commandTypes.findingResponse??0,mandate:full.publicState.governance?.mandate,compact:full.publicState.governance?.actor,communityDecisions:full.publicState.society?.decisions,societySpent:full.publicState.society?.spent,societyOutcomes:full.publicState.society?.communities,mainActions,operationCounts,modeSeconds:full.strategy.charterModeSeconds,failedCommands:world.counts.failed};
});
const data={sourceAggregateSha256:report.sourceAggregateSha256,rootFreezeSha256:report.rootFreezeSha256,sourceChangesDuringRun:report.sourceChangesDuringRun,policySha256:report.policySha256,checks:report.checks,total:report.total,rows,replay:replay?{passed:replay.passed,commands:replay.commands,ticks:replay.ticks,checkedStates:replay.checkedStates,checkpoints:replay.checks.length,independent:replay.independent??false,path:replay.path??'replay-report.json'}:null};
fs.writeFileSync(path.join(directory,'derived-summary.json'),JSON.stringify(data,null,2));
const lines=[
 '# Casual multi-prestige simulation — v5', '',
 'This is one scripted casual persona, not a human playtest. Each civilization begins through earned public prestige commands. No resources, research, decisions, or timers are injected.', '',
 '| World | Constitution | Ending | Engine time | Modeled play time | Studies | Projects |',
 '| --- | --- | --- | ---: | ---: | ---: | ---: |',
 ...rows.map(row=>`| ${row.world} | ${row.constitution} | ${row.ending} | ${clock(row.engineSeconds)} | ${clock(row.modeledWallSeconds)} | ${row.studies} | ${row.projects} |`), '',
 'Modeled play time includes reading at 220 words/minute, explicit decisions and interactions, and the established delayed visit schedule. Engine time counts only actual simulation advance. Reading and interactions can overlap engine progress; adding engine time to those categories would double-count it. Protected conversations pause progress. No wait was added to make a campaign meet the target.', '',
 `Transitions: ${report.total.refits} Refit, ${report.total.reinitializations} Reinitialize, ${report.total.reframes} Reframe. Total modeled play time: ${clock(report.total.wallSeconds)}.`, '',
 '## Actual constitutional strategies', '',
 ...rows.map(row=>`- **${row.constitution}:** ${row.mainActions || 'No charter operation recorded'}. Modes: ${Object.entries(row.modeSeconds).filter(([,seconds])=>seconds>0).map(([mode,seconds])=>`${mode} ${clock(seconds)}`).join(', ')}.`), '',
 'Operation counts and durations demonstrate distinct exercised systems; they do not by themselves prove the strategy is optimal or every alternative is balanced. Exact token transfers, costs, refunds and receipts are retained in each world report and the public-command ledger. Refunds are not counted as production.', '',
 '## Checks', '',
 ...Object.entries(report.checks).map(([check,passed])=>`- ${passed?'PASS':'FAIL'} — ${check}`),
 replay?`- ${replay.passed?'PASS':'FAIL'} — ${replay.independent?'separate independent verifier':'deterministic command'} replay: ${replay.commands} commands, ${replay.ticks} ticks, ${replay.checkedStates} intermediate validations, ${replay.checks.length} earned checkpoint comparisons. [Replay evidence](${replay.path??'replay-report.json'}).`:'- Independent replay has not yet been run for this directory.', '',
 `Source aggregate: \`${report.sourceAggregateSha256}\`. Root source freeze: \`${report.rootFreezeSha256??'not yet frozen'}\`. Policy: \`${report.policySha256}\`.`, '',
 'The runner, helper, exact policy, original v4 policy, manifests, before-ending saves, ending saves, prestige saves, study observations and every command/tick are archived alongside this report. Failed/slow diagnostics remain separate; no earlier evidence is overwritten.', '',
 'The v4 economic and reading persona is preserved. New visible controls add declared preferences for restricted use of uncertain findings, independent authority, privacy-preserving reciprocal review, worker augmentation, shared ownership, optional human projects and legitimate alternatives to harmful requests. At the ending’s explicit boundary-observation prompt, discretionary equipment expansion pauses while essential duties continue. See policy.json for exact rules.', '',
];
fs.writeFileSync(path.join(directory,'REPORT.md'),lines.join('\n'));
console.log(JSON.stringify(data,null,2));
