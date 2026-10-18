/** Preserve the executed freeze while linking later presentation-only browser fixes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const run='qa/experience-v6/pacing/final';
const source=JSON.parse(fs.readFileSync(`${run}/root-source-freeze.json`,'utf8'));
const target=JSON.parse(fs.readFileSync('qa/experience-v6/release-source.json','utf8'));
const comparison=JSON.parse(fs.readFileSync(`${run}/pacing-comparison.json`,'utf8'));
assert.equal(comparison.sourceSha256,source.sha256);
assert(comparison.exactTraceMatch&&comparison.exactCheckpointMatch);
const changes=[];
for(const file of target.files){
  assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Final source changed: ${file.path}`);
  const before=source.files.find(candidate=>candidate.path===file.path);
  if(before?.sha256!==file.sha256)changes.push({path:file.path,before:before?.sha256??null,after:file.sha256});
}
assert(source.files.every(file=>target.files.some(candidate=>candidate.path===file.path)),'A source file was removed.');
assert(changes.every(file=>/\.(tsx|css)$/.test(file.path)),'A non-presentation dependency changed; run a new simulation.');
const unchangedNonPresentation=target.files.filter(file=>!(/\.(tsx|css)$/.test(file.path))).length;
const result={simulationSource:source.sha256,finalSource:target.sha256,changes,unchangedNonPresentationFiles:unchangedNonPresentation,exactPriorTraceMatch:comparison.exactTraceMatch,exactPriorCheckpointMatch:comparison.exactCheckpointMatch,sourceChangeTiming:'After the six-world simulation and source-stability checks completed.',scope:'Every .ts engine, economic, content, scientific, persistence, package and build configuration dependency is byte-identical. The simulation directly exercises those modules; it does not execute React event handlers.',limitations:['The complete chain ran on the earlier recorded UI freeze. It is not relabeled as having executed on the final aggregate.','Final browser verification must separately cover changed labels, state reset, and event wiring.']};
fs.writeFileSync(`${run}/presentation-bridge.json`,JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(`${run}/PRESENTATION-BRIDGE.md`,['# Final presentation-only follow-up','',`The six-world campaign run used source \`${source.sha256}\`. The final browser build uses \`${target.sha256}\`. The executed run and its source manifest remain unchanged.`, '',`After the run, ${changes.length} presentation files changed: ${changes.map(file=>`\`${file.path}\``).join(', ')||'none'}. All ${unchangedNonPresentation} non-presentation source/package/configuration files remain byte-identical.`, '', 'The complete casual chain still provides pacing and engine evidence for the final build. React labels, import-state reset, and event handlers are verified through the final browser walkthrough, not through this engine simulation.', '',...result.limitations.map(item=>`- ${item}`),''].join('\n'));
console.log(JSON.stringify(result,null,2));
