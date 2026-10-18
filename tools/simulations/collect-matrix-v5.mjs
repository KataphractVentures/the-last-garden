import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='qa/simulations-v5/optimized';
const parts=['matrix-a','matrix-b','matrix-c'].map(dir=>JSON.parse(fs.readFileSync(path.join(base,dir,'matrix.json'),'utf8')));
const freeze=parts[0].configuration.rootFreeze;
const release=JSON.parse(fs.readFileSync('qa/simulations-v5/source-freeze.json','utf8'));
const prior=JSON.parse(fs.readFileSync('qa/simulations-v5/source-pre-browser-copy-fix.json','utf8'));
const beforeMap=Object.fromEntries(prior.files.map(entry=>[entry.path,entry.sha256])),afterMap=Object.fromEntries(release.files.map(entry=>[entry.path,entry.sha256]));
const releaseDelta=Object.keys(afterMap).filter(file=>beforeMap[file]!==afterMap[file]);
assert.deepEqual(releaseDelta,['src/laboratory/LaboratoryPanel.tsx']);
for(const part of parts){
 assert.equal(part.configuration.parentStateSha256,parts[0].configuration.parentStateSha256);
 const oldFiles=part.configuration.sourceBefore.files,newFiles=part.sourceAfter.files;
 const changed=Object.keys(newFiles).filter(file=>oldFiles[file]!==newFiles[file]);
 assert(changed.every(file=>file==='src/laboratory/LaboratoryPanel.tsx'),'Unexpected simulation or engine source drift.');
 for(const [file,digest]of Object.entries(oldFiles))if(beforeMap[file])assert.equal(digest,beforeMap[file],file+' differs from recorded prior freeze.');
 for(const [file,digest]of Object.entries(newFiles))if(afterMap[file]&&file!=='src/laboratory/LaboratoryPanel.tsx')assert.equal(digest,afterMap[file],file+' differs from final release.');
 assert.equal(part.configuration.rootFreeze.sha256,prior.sha256);
}

const rows=parts.flatMap(part=>part.rows);assert.equal(rows.length,6);assert.equal(new Set(rows.map(row=>row.constitution)).size,6);assert(rows.every(row=>row.runs.length===3&&row.runs.every(run=>run.success)));
const comparisons=parts.flatMap(part=>part.comparisons);
const winners=Object.fromEntries(rows.map(row=>{const run=[...row.runs].filter(run=>run.success).sort((a,b)=>a.seconds-b.seconds)[0];return [row.constitution,{strategy:run.strategy}];}));
const parent=JSON.parse(fs.readFileSync(path.join(base,'parent-policy.json'),'utf8'));
const finalPolicies={...winners,commons:parent.commons};
const report={rootFreezeSha256:freeze.sha256,releaseFreezeSha256:release.sha256,releaseDelta,globalSourceUnchanged:parts.every(part=>part.unchangedSourceDuringRun),engineSourceUnchanged:true,engineEquivalentToRelease:true,method:parts[0].configuration.method,parentStateSha256:parts[0].configuration.parentStateSha256,complete:true,rows,comparisons};
fs.writeFileSync(path.join(base,'matrix-combined.json'),JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(base,'matrix-winner-policies.json'),JSON.stringify(winners,null,2)+'\n');
fs.writeFileSync(path.join(base,'final-policies.json'),JSON.stringify(finalPolicies,null,2)+'\n');
const hms=seconds=>`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m ${Math.round(seconds%60)}s`;
const lines=['# Frozen v5 constitutional strategy comparison','',report.method,'',`Started on source freeze ${freeze.sha256}. Release ${release.sha256} differs only in the LaboratoryPanel denominator clarification; all engine and simulation files stayed identical. Global source drift is recorded where this UI edit occurred. All 18 cells completed Garden with 70 active projects and 36 adequate protocols.`, '', '| Constitution | Native | Baseline | Transferred | Best tested |','| --- | ---: | ---: | ---: | --- |'];
for(const row of rows){const best=[...row.runs].sort((a,b)=>a.seconds-b.seconds)[0];lines.push(`| ${row.name} | ${['native','baseline','transferred'].map(p=>hms(row.runs.find(run=>run.profile===p).seconds)).join(' | ')} | ${best.profile} |`);}
lines.push('','Engine time excludes human reading and interaction. Profiles use the same earned parent and the same legality/recovery adapter, but distinct modes, reserves, research priorities and allocation doctrines. A transferred strategy can win; the label native is not evidence of superiority. None of these finite comparisons establishes a global optimum.','', 'Detailed actual actions, resource movements, study ordering, source hashes and earned checkpoints are retained in matrix-a, matrix-b and matrix-c. Final sequential prestige begins fresh, using the separately tested fresh Commons winner followed by these constitutional winners.');
fs.writeFileSync(path.join(base,'MATRIX.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({complete:true,cells:18,winners:Object.fromEntries(rows.map(row=>{const win=[...row.runs].sort((a,b)=>a.seconds-b.seconds)[0];return [row.constitution,{profile:win.profile,seconds:win.seconds}];})),rootFreeze:freeze.sha256}));
