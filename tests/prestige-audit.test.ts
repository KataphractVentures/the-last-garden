import test from 'node:test';
import assert from 'node:assert/strict';
import type { BranchRecord, Command, GameState } from '../src/contracts';
import { actionEligibility, createGame, dispatchCommand, getCost, prestigeEligibility, worldCycle } from '../src/engine';
import { getValidationCatalog, parseSave, serializeSave } from '../src/persistence';
import { STORY_EVENTS } from '../src/content/story';
import { certificateFrontier, compactLegacyHistory } from '../src/engine/legacyHistory';
import { prepareOperatingFixture } from './operatingFixture';

/** Synthetic late-history integration fixture; never claimed as an earned campaign. */
function stable(seed=1701):GameState {
  const s=createGame(seed,1000);s.chapter=7;s.tokens='100000000';s.lifetime='100000000';s.useful='100000000';s.research='1000000';
  s.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,event.choices[0].id]));s.pendingEvent=null;
  s.policies={contract:'verified',communication:'reviewed',external:'blocked',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'council'};
  s.metrics={quality:95,distortion:0,agency:85,welfare:85,dependence:35,evidence:90,recall:95,coordination:85,pressure:15,continuity:90,humanWelfare:85,reviewQueue:0};
  s.viableSeconds=180;s.certificateProgress=60;s.flags=['fresh-evidence:0','current-clearance'];return prepareOperatingFixture(s);
}
function apply(s:GameState,c:Command):GameState {const result=dispatchCommand(s,c);assert(result.ok,result.message);return result.state;}
function valid(s:GameState):void {const result=parseSave(serializeSave(s),getValidationCatalog());assert(result.ok,result.ok?'':result.message);}
function checkpoint(s:GameState,id:string,cycle:number):BranchRecord {const {legacy:_,...saved}=structuredClone(s);saved.id=id;return{id,parentId:null,name:`Saved history ${id}`,constitution:s.constitution,cycle,seed:s.seed,chapter:s.chapter,createdAt:s.startedAt,summary:'Explicit audit checkpoint',checkpoint:saved};}
function fillCertificates(s:GameState,n=10000):void {s.legacy.contracts=Array.from({length:n},(_,tier)=>{const family=tier===0?'service':'commons';return{id:`certificate:${s.legacy.cycle}:${family}:${tier}`,cycle:s.legacy.cycle,family,redeemed:false};});s.legacy.claims=s.legacy.contracts.map(c=>c.id);s.certificateTier=n;}
const branchTotal=(s:GameState)=>s.legacy.branches.length+(s.legacy.historySummary?.branches??0);

test('audit: trimmed certificate IDs cannot repay old tiers, including stale saved branch state',()=>{
  let s=stable();const old=checkpoint(stable(42),'old-active-audit',0);s.legacy.branches=[old];fillCertificates(s);valid(s);
  s=apply(s,{type:'certify'});valid(s);assert(s.legacy.contracts.length<10000);assert.equal(s.legacy.contracts.length+s.legacy.historySummary!.certificates,10001);
  const trimmed='certificate:0:commons:100';assert(!s.legacy.claims.includes(trimmed));const high=s.certificateTier;
  const stale=structuredClone(s);stale.certificateTier=100;stale.certificateProgress=60;stale.flags=stale.flags.filter(f=>!f.startsWith('fresh-evidence:')&&!f.startsWith('certified-useful:'));stale.flags.push('fresh-evidence:0');
  const attempt=dispatchCommand(stale,{type:'certify'});assert(!attempt.state.legacy.claims.includes(trimmed),'Retired certificate must not be paid again.');
  if(attempt.ok)assert(attempt.state.certificateTier>high,'Any recovery must advance past the shared high-water mark.');
  s=apply(s,{type:'branch',id:old.id});assert(s.certificateTier>=high,'A stale checkpoint must inherit shared certification progress.');
  const seeds=s.legacy.seeds;s=apply(s,{type:'certify'});assert.equal(s.legacy.seeds,seeds+10);assert(s.certificateTier>high);assert(!s.legacy.claims.includes(trimmed));valid(s);
});

test('audit: compaction retains a minority current family and the three contracts needed to Reframe',()=>{
  let s=stable();fillCertificates(s);s=apply(s,{type:'certify'});
  assert(s.legacy.contracts.some(c=>c.family==='service'&&c.cycle===0&&!c.redeemed),'Old minority-family witness must survive recent-majority pressure.');
  s=apply(s,{type:'finish',ending:'limit'});assert(prestigeEligibility(s,'reframe').allowed);
  const prior=structuredClone(s.legacy.contracts),oldSummary=structuredClone(s.legacy.historySummary);s=apply(s,{type:'prestige',layer:'reframe',constitution:'commons',modules:[]});
  const redeemed=s.legacy.contracts.filter(c=>c.redeemed&&!prior.find(old=>old.id===c.id)?.redeemed);
  assert.equal(redeemed.length,3);assert(new Set(redeemed.map(c=>c.family)).size>=2);assert.equal(s.legacy.cycle,1);assert.deepEqual(s.legacy.historySummary,oldSummary);valid(s);
});

test('audit: an imported claim-only high-water survives repeated history compaction',()=>{
  const s=stable();fillCertificates(s);const highest='certificate:0:commons:90000';s.legacy.claims[0]=highest;s.certificateTier=90001;valid(s);
  compactLegacyHistory(s);assert(s.legacy.claims.includes(highest));assert(!s.legacy.contracts.some(c=>c.id===highest));valid(s);
  // Explicit synthetic old receipts force another retirement pass, with the
  // authoritative claim outside the recent tail and without any detail row.
  for(let tier=0;tier<2000;tier++){const id=`certificate:1:commons:${tier}`;s.legacy.contracts.push({id,family:'commons',cycle:1,redeemed:true});s.legacy.claims.push(id);}
  compactLegacyHistory(s);assert(s.legacy.claims.includes(highest));assert(s.legacy.claims.length<2000);valid(s);
  s.certificateTier=0;assert.equal(certificateFrontier(s),90001);assert(!actionEligibility(s,'certify').allowed,'A stale local counter cannot override the retained paid claim.');
});

test('audit: boundary branch switching retains the selected target and unique monotonic new-world IDs',()=>{
  let s=stable();const target=checkpoint(stable(43),'oldest-resumable-audit',0);
  s.legacy.branches=Array.from({length:5000},(_,i)=>i===0?target:i<3?checkpoint(stable(50+i),`other-resumable-${i}`,0):{id:`archived-audit-${i}`,parentId:null,name:`History ${i}`,constitution:'commons',cycle:0,seed:i,chapter:7,createdAt:1000,summary:'Compact audit history'});
  valid(s);const current=s.id;s=apply(s,{type:'branch',id:target.id});valid(s);
  assert(s.legacy.branches.length<5000);assert(s.legacy.branches.some(b=>b.id===target.id),'Switch target metadata cannot disappear while outgoing branch is archived.');assert.equal(s.id,target.id);assert.equal(s.tokens,target.checkpoint!.tokens);
  assert(s.legacy.branches.find(b=>b.id===current)?.checkpoint);assert.equal(branchTotal(s),5001);
  s=apply(s,{type:'branch',id:current});assert.equal(branchTotal(s),5001,'Repeated switching cannot invent retired histories.');assert(s.legacy.branches.find(b=>b.id===target.id)?.checkpoint,'Leaving the selected branch must preserve its newly active checkpoint.');assert.equal(s.legacy.branches.filter(b=>b.checkpoint).length,3);
  s=apply(s,{type:'finish',ending:'shutdown'});s=apply(s,{type:'prestige',layer:'reinitialize',constitution:'commons',modules:[]});const firstId=s.id,firstOrdinal=Number(s.id.split('-').at(-1));assert(firstOrdinal>=5001);
  // The second explicit fixture only advances chapter/decisions to permit a public reset.
  s.chapter=7;s.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,event.choices[0].id]));s.pendingEvent=null;
  s=apply(s,{type:'finish',ending:'shutdown'});s=apply(s,{type:'prestige',layer:'reinitialize',constitution:'commons',modules:[]});
  assert.notEqual(s.id,firstId);assert(Number(s.id.split('-').at(-1))>firstOrdinal);valid(s);
});

test('audit: compacted history does not grant an old replay current-cycle viability or rewards',()=>{
  let s=stable();s.legacy.cycle=1;s.id='current-band-audit';const target=checkpoint(stable(44),'old-band-audit',0);s.legacy.branches=[target];fillCertificates(s);
  // A single public certification at the current scale triggers the real compaction path.
  s.useful='100000000000000';s=apply(s,{type:'certify'});assert(s.legacy.historySummary);valid(s);
  s=apply(s,{type:'branch',id:target.id});assert.equal(worldCycle(s),0);assert.equal(s.legacy.cycle,1);assert.equal(getCost(s,'helper',1).cost,'15');
  assert(!actionEligibility(s,'certify').allowed);const before={seeds:s.legacy.seeds,claims:[...s.legacy.claims],summary:structuredClone(s.legacy.historySummary)};
  s=apply(s,{type:'finish',ending:'limit'});assert(!s.legacy.viableCycles.includes(1));assert(!prestigeEligibility(s,'reframe').allowed);
  assert.equal(s.legacy.seeds,before.seeds);assert.deepEqual(s.legacy.claims,before.claims);assert.deepEqual(s.legacy.historySummary,before.summary);valid(s);
});
