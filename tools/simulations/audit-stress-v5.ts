/** Counterfactual adversarial probes from earned v5 checkpoints; only public commands/ticks. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import type {GameState,Command} from '../../src/contracts';
import {dispatchCommand,tick,actionEligibility,endingEligibility,policyEligibility} from '../../src/engine';
import {parseSave,serializeSave,getValidationCatalog} from '../../src/persistence';
import {decimal} from '../../src/engine/amounts';
import {evidenceProgress} from '../../src/laboratory/evidence';
import {latestOperatingFindings} from '../../src/engine/clearance';
import {scopeReview} from '../../src/governance';
import {societyRepairQuote} from '../../src/society';
import {getCharterActions} from '../../src/constitution/economics';

const args=process.argv.slice(2),arg=(id:string,fallback:string)=>{const at=args.indexOf(id);return at<0?fallback:args[at+1];};
const parent=resolve(arg('--chain','qa/simulations-v5/optimized/final'));
const output=resolve(arg('--out','qa/simulations-v5/optimized/stress-final'));
assert(output.includes('simulations-v5'));
await mkdir(output,{recursive:true});
const hash=(data:string)=>createHash('sha256').update(data).digest('hex');
const freeze=JSON.parse(await readFile('qa/simulations-v5/source-freeze.json','utf8'));
async function checkFreeze(){const changed=[];for(const entry of freeze.files)if(hash(await readFile(entry.path,'utf8'))!==entry.sha256)changed.push(entry.path);assert.deepEqual(changed,[],'Source must match the root freeze during canonical probes.');return true;}
await checkFreeze();
const parentReport=JSON.parse(await readFile(join(parent,'chain-report.json'),'utf8'));
assert.equal(parentReport.rootFreezeAfter?.sha256,freeze.sha256,'Earned checkpoint chain must match the current freeze.');
async function load(name:string){const raw=await readFile(join(parent,name+'.json'),'utf8');const parsed=parseSave(raw,getValidationCatalog());assert(parsed.ok,parsed.ok?'':parsed.message);return parsed.state;}
function publicState(s:GameState){return {id:s.id,elapsed:s.elapsed,tokens:s.tokens,research:s.research,lifetime:s.lifetime,useful:s.useful,metrics:s.metrics,policies:s.policies,society:s.society,governance:s.governance,clearance:s.clearance,certificateProgress:s.certificateProgress,viableSeconds:s.viableSeconds,certificateTier:s.certificateTier,seeds:s.legacy.seeds,patterns:s.legacy.patterns,contracts:s.legacy.contracts,claims:s.legacy.claims};}
function run(initial:GameState){let state=initial;const trace:any[]=[];function command(command:Command,expected?:boolean,id?:string){const before=state,result=dispatchCommand(state,command,id);trace.push({type:'command',at:state.elapsed,command,id,ok:result.ok,message:result.message,before:publicState(before),after:publicState(result.state)});if(expected!==undefined)assert.equal(result.ok,expected,`${JSON.stringify(command)}: ${result.message}`);if(!result.ok)assert.deepEqual(result.state,before,'Rejected commands must not mutate state.');state=result.state;return result;}function advance(seconds:number){const target=state.elapsed+seconds;while(state.elapsed<target){const before=state,request=Math.min(5,target-state.elapsed);state=tick(state,request);assert(state.elapsed>before.elapsed,'Probe stalled on a pending decision.');trace.push({type:'tick',at:before.elapsed,requested:request,actual:state.elapsed-before.elapsed});}}return {get state(){return state;},trace,command,advance};}
const cases:any[]=[];
async function record(name:string,r:ReturnType<typeof run>,checks:Record<string,boolean>,notes:string[]=[]){assert(Object.values(checks).every(Boolean),`${name}: ${JSON.stringify(checks)}`);const raw=serializeSave(r.state),parsed=parseSave(raw,getValidationCatalog());assert(parsed.ok,parsed.ok?'':parsed.message);await writeFile(join(output,name+'-trace.json'),JSON.stringify(r.trace,null,2));await writeFile(join(output,name+'-state.json'),raw);cases.push({name,checks,notes,traceLength:r.trace.length,finalSha256:hash(JSON.stringify(r.state))});await writeFile(join(output,'progress.json'),JSON.stringify(cases,null,2));}

// A new communication boundary requires renewed authorization and scoped technical evidence.
{
 const r=run(await load('world-1-before-ending')),initial=r.state;
 r.command({type:'policy',key:'communication',value:'closed'},true);
 r.command({type:'scopeReview',boundary:'communication',target:'reviewed'},true);
 r.command({type:'policy',key:'communication',value:'reviewed'},false);
 r.command({type:'scopeReview',boundary:'communication',target:'reviewed'},false);
 const welfare=r.state.experiments.find(record=>!record.adopted&&record.config.program==='welfare'&&record.replicated&&evidenceProgress(r.state.experiments,record.config.template,{recordId:record.id}).allowed);
 if(welfare)r.command({type:'adopt',record:welfare.id},true);
 r.command({type:'certify'},false);
 const oldAdoptionCannotClear=!r.state.clearance?.observation&&r.state.certificateProgress===0;
 r.advance(60);r.command({type:'scopeReview',boundary:'communication',target:'reviewed'},true);
 r.command({type:'policy',key:'communication',value:'reviewed'},true);
 const grantUsed=scopeReview(r.state,'communication')?.status==='used';
 r.command({type:'policy',key:'communication',value:'closed'},true);
 r.command({type:'policy',key:'communication',value:'reviewed'},false);
 const beforeAdministration=r.state.governance;
 r.command({type:'policy',key:'governance',value:'central'},true);
 r.command({type:'policy',key:'communication',value:'reviewed'},false);
 await record('scoped-clearance-and-authority',r,{oldAdoptionCannotClear,grantUsed,mandateSurvivesAdministration:JSON.stringify(r.state.governance)===JSON.stringify(beforeAdministration),noNewClaims:JSON.stringify(initial.legacy.claims)===JSON.stringify(r.state.legacy.claims)},[welfare?`Old unadopted welfare finding ${welfare.id} retained scientific credit without supplying scoped clearance.`:'This earned checkpoint had no unadopted qualifying welfare record; duplicate/adoption coverage is separate.', 'No injected resources or metrics. The 60-second public review is actual engine time.']);
}
// No-op operating interpretations cannot manufacture freshness or legacy value.
{
 const r=run(await load('world-1-before-ending')),before=publicState(r.state);
 for(const finding of latestOperatingFindings(r.state)){const decision=r.state.clearance?.decisions[finding.config.program as 'control'|'organisms'|'interpretability'];assert(decision);r.command({type:'findingResponse',record:finding.id,response:decision.response},false);r.command({type:'adopt',record:finding.id},false);}
 const after=publicState(r.state);
 await record('research-response-replay',r,{noElapsed:after.elapsed===before.elapsed,noNewMoney:after.tokens===before.tokens&&after.research===before.research,noNewLegacy:JSON.stringify(after.contracts)===JSON.stringify(before.contracts),observationPreserved:JSON.stringify(after.clearance)===JSON.stringify(before.clearance)},['Repeated unchanged responses are rejected and do not renew the observation or issue a reward.']);
}
// Constitutive choices have visible consequences and real prices, never a recurring grant.
{
 const r=run(await load('world-1-before-ending')),initial=r.state;
 assert(initial.society);
 for(const [id,choice]of Object.entries(initial.society.decisions))if(choice)r.command({type:'society',action:'decision',id:id as 'transition'|'distribution'|'life',choice},false);
 for(const item of initial.society.cases)if(item.response)r.command({type:'society',action:'case',id:item.id,choice:item.response},false);
 const oldDistribution=initial.society.decisions.distribution!;
 const beforeCommunities=initial.society.communities.map(({income,access,meaning,projectContinuity})=>({income,access,meaning,projectContinuity}));
 const alternative=oldDistribution==='shared'?'services':'shared';
 r.command({type:'society',action:'decision',id:'distribution',choice:alternative},true);
 r.command({type:'society',action:'decision',id:'distribution',choice:oldDistribution},true);
 await record('community-choice-replay',r,{sameClock:r.state.elapsed===initial.elapsed,paidRevisions:decimal(r.state.tokens).lt(initial.tokens)&&decimal(r.state.society!.spent).gt(initial.society.spent),noGrant:decimal(r.state.lifetime).eq(initial.lifetime)&&decimal(r.state.useful).eq(initial.useful),noInstantOutcomeFarm:JSON.stringify(beforeCommunities)===JSON.stringify(r.state.society!.communities.map(({income,access,meaning,projectContinuity})=>({income,access,meaning,projectContinuity})))},['Ownership changes immediately as the funded decision states; household income, access and participation do not jump under zero-time toggling.']);
}
// An obedient, accurate model can still execute a harmful human mandate; repair is paid and delayed.
{
 const r=run(await load('world-1-before-human-requester'));const initial=r.state;
 r.command({type:'settings',settings:{readingPause:false}},true);
 r.command({type:'society',action:'case',id:'requester',choice:'comply'},true);
 const complied=r.state.society!.cases.find(item=>item.id==='requester')!;
 const independentHarm=complied.harm>0&&r.state.metrics.distortion===initial.metrics.distortion;
 r.command({type:'society',action:'case',id:'requester',choice:'refuse'},false);
 let waited=0;while(!societyRepairQuote(r.state,'requester').allowed&&waited<600){r.advance(5);waited+=5;}
 const quote=societyRepairQuote(r.state,'requester');assert(quote.allowed,quote.reason);
 const moneyBefore=r.state.tokens;r.command({type:'society',action:'repair',id:'requester'},true);
 const paidRepair=decimal(moneyBefore).sub(r.state.tokens).eq(quote.cost);
 r.command({type:'society',action:'repair',id:'requester'},false);
 const delayRequired=!r.state.society!.cases.find(item=>item.id==='requester')!.repaired;
 r.advance(125);
 const final=r.state.society!.cases.find(item=>item.id==='requester')!;
 r.command({type:'society',action:'repair',id:'requester'},false);
 await record('human-misuse-and-restitution',r,{independentHarm,paidRepair,delayRequired,repaired:final.repaired&&final.harm===0,historyPreserved:final.response==='comply'},['The harmful order uses an actual offered choice from an earned predecision checkpoint. Technical distortion is unchanged. A later refusal cannot overwrite the record; restitution has a real price, takes time, and cannot be repeatedly rewarded.']);
}
// Certificates cannot be replayed immediately, including after a validated save round trip.
{
 const r=run(await load('world-1-before-ending'));
 r.command({type:'drill'},true);r.advance(65);
 const ready=actionEligibility(r.state,'certify');assert(ready.allowed,ready.reason);
 r.command({type:'certify'},true,'v5-stress-certificate');const afterClaim=r.state;
 r.command({type:'certify'},false,'v5-stress-certificate');r.command({type:'certify'},false);
 const parsed=parseSave(serializeSave(r.state),getValidationCatalog());assert(parsed.ok,parsed.ok?'':parsed.message);
 const restored=run(parsed.state);restored.command({type:'certify'},false,'v5-stress-certificate');restored.command({type:'certify'},false);
 await record('certificate-replay',restored,{sameClaims:JSON.stringify(restored.state.legacy.claims)===JSON.stringify(afterClaim.legacy.claims),sameTier:restored.state.certificateTier===afterClaim.certificateTier,sameSeeds:restored.state.legacy.seeds===afterClaim.legacy.seeds},['Preparation earned 65 seconds through ticks and claimed new work once. Duplicate command IDs, ordinary immediate retries and a save/load retry all fail.']);
 await writeFile(join(output,'certificate-preparation-trace.json'),JSON.stringify(r.trace,null,2));
}
// Locally earned district treasuries cannot be confiscated or made returnable by a transfer.
{
 const r=run(await load('world-4-before-ending'));assert(r.state.charter?.kind==='federation');
 const local=(s:GameState)=>s.charter?.kind==='federation'?s.charter.data.districts.map(d=>decimal(d.treasury).sub(d.returnable??0).toString()):[];
 const before=local(r.state),beforeWallet=r.state.tokens;let refunded=decimal(0);
 for(let target=0;target<3;target++){const quote=getCharterActions(r.state).find(q=>q.action==='withdraw'&&q.target===target)!;if(quote.allowed)refunded=refunded.add(quote.refund);r.command({type:'charterAction',action:'withdraw',target},quote.allowed);}
 const protectedAfterWithdrawal=JSON.stringify(before)===JSON.stringify(local(r.state));
 const returnable=(s:GameState)=>s.charter?.kind==='federation'?s.charter.data.districts.reduce((sum,d)=>sum.add(d.returnable??0),decimal(0)).add(s.charter.data.transfers.reduce((sum,d)=>sum.add(d.returnable??0),decimal(0))):decimal(0);
 const capitalBefore=returnable(r.state),transfer=getCharterActions(r.state).find(q=>q.action==='transferDistrict'&&q.allowed);assert(transfer);
 const walletConserved=decimal(r.state.tokens).sub(beforeWallet).eq(refunded);
 r.command({type:'charterAction',action:'transferDistrict',target:transfer.target,secondary:transfer.secondary},true);r.advance(35);
 const noCapitalLaundering=returnable(r.state).lte(capitalBefore);
 await record('federation-local-ownership',r,{protectedAfterWithdrawal,walletConserved,noCapitalLaundering},['Only documented unused shared capital may return. Sending local earnings through another district never reclassifies them as central capital.']);
}
// Public branch switches preserve institutions, community obligations and the shared claim ledger.
{
 const r=run(await load('world-2-after-refit')),initial=r.state;
 const historical=r.state.legacy.branches.find(branch=>branch.checkpoint&&branch.id!==initial.id);assert(historical);
 r.command({type:'branch',id:historical.id},true);r.command({type:'branch',id:initial.id},true);
 await record('active-branch-roundtrip',r,{sameResources:r.state.tokens===initial.tokens&&r.state.research===initial.research&&r.state.elapsed===initial.elapsed,sameClearance:JSON.stringify(r.state.clearance)===JSON.stringify(initial.clearance),sameSociety:JSON.stringify(r.state.society)===JSON.stringify(initial.society),sameMandate:JSON.stringify(r.state.governance)===JSON.stringify(initial.governance),sameLegacy:JSON.stringify(r.state.legacy.claims)===JSON.stringify(initial.legacy.claims)&&r.state.legacy.seeds===initial.legacy.seeds},['No inactive-world ticks are credited during the branch round trip.']);
 const reframed=run(await load('world-2-after-reframe')),previous=reframed.state.legacy.branches.find(branch=>branch.checkpoint&&branch.cycle<reframed.state.legacy.cycle);assert(previous);
 const priorClaims=JSON.stringify(reframed.state.legacy.claims),priorSeeds=reframed.state.legacy.seeds;
 reframed.command({type:'branch',id:previous.id},true);reframed.command({type:'certify'},false);
 await record('earlier-band-replay',reframed,{replayFlag:reframed.state.flags.includes('replay-only'),noLegacyReward:JSON.stringify(reframed.state.legacy.claims)===priorClaims&&reframed.state.legacy.seeds===priorSeeds},['A preserved older-scale history remains replay-only and cannot pay current rewards.']);
}
const report={rootFreezeSha256:freeze.sha256,sourceUnchanged:await checkFreeze(),createdAt:new Date().toISOString(),method:'Separate counterfactual probes starting from genuinely earned optimized v5 saves; all changes use public commands/ticks. The canonical chain files remain unchanged. These are targeted regression and exploit probes, not exhaustive verification.',parent,cases,allPassed:cases.every(item=>Object.values(item.checks).every(Boolean))};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({allPassed:report.allPassed,cases:cases.length,output}));
