import type { Eligibility, ExperimentRecord, FindingResponse, GameState, OperatingClearance, OperatingDecision, OperatingProgram, Policy } from '../contracts';
import { evidenceProgress, hasDemonstratedCorrection, hasLegitimateServiceObservation, sameOperatingMechanism } from '../laboratory/evidence';

export const OPERATING_PROGRAMS: readonly OperatingProgram[] = ['control', 'organisms', 'interpretability'];
type ScopeState = Pick<GameState, 'policies'|'constitution'|'modules'>;
type ClearanceState = ScopeState & Pick<GameState, 'elapsed'|'clearance'|'viableSeconds'|'certificateProgress'|'flags'>;
const yes = (reason:string):Eligibility => ({allowed:true,reason});
const no = (reason:string):Eligibility => ({allowed:false,reason});

/** A public permission is distinct from technical evidence about using it. */
export function operatingScope(s:ScopeState):string {
  const p=s.policies;
  return JSON.stringify([s.constitution,p.external,p.communication,p.evaluation,p.governance,p.fallback,p.contract,[...s.modules].sort()]);
}
export function createOperatingClearance(s:ScopeState & Pick<GameState,'elapsed'>):OperatingClearance {
  return {version:1,revision:0,scope:operatingScope(s),changedAt:s.elapsed,reason:'No current boundary observation has been registered.',observation:null,decisions:{}};
}
/** Called on actual changes, never on a rejected/no-op policy request. Scientific records survive. */
export function synchronizeOperatingScope(s:ClearanceState,reason='Operating permissions changed.',force=false):boolean {
  const scope=operatingScope(s);
  if(!s.clearance){s.clearance=createOperatingClearance(s);s.viableSeconds=0;s.certificateProgress=0;return true;}
  if(!force&&s.clearance.scope===scope)return false;
  s.clearance={...s.clearance,revision:s.clearance.revision+1,scope,changedAt:s.elapsed,reason,observation:null};
  s.viableSeconds=0;s.certificateProgress=0;
  s.flags=s.flags.filter(flag=>flag!=='current-clearance'&&!flag.startsWith('fresh-evidence:')&&!flag.startsWith('pending-fresh-evidence:'));
  return true;
}
export function registerBoundaryObservation(s:ClearanceState,recall:number):void {
  synchronizeOperatingScope(s);
  if(s.policies.evaluation!=='independent')return;
  s.clearance!.observation={revision:s.clearance!.revision,observedAt:s.elapsed,availableAt:s.elapsed+(s.modules.includes('delayed-observations')?45:0),recall};
}
export function latestOperatingFindings(s:Pick<GameState,'experiments'>):ExperimentRecord[] {
  return OPERATING_PROGRAMS.flatMap(program=>{
    const records=s.experiments.filter(record=>record.adopted&&record.config.program===program);
    records.sort((a,b)=>Number(b.config.template.split('-').at(-1))-Number(a.config.template.split('-').at(-1))||b.elapsed-a.elapsed||s.experiments.indexOf(b)-s.experiments.indexOf(a));
    return records.length?[records[0]]:[];
  });
}
function supportedFinding(s:GameState,id:string):ExperimentRecord|undefined {
  return s.experiments.find(record=>record.id===id&&record.adopted&&OPERATING_PROGRAMS.includes(record.config.program as OperatingProgram));
}
/** All observed contexts of the actual mechanism count, including unadopted
 * failures and different sampling plans; scientific replication is separate. */
function findingEnvelope(s:Pick<GameState,'experiments'>,record:ExperimentRecord){
  const family=s.experiments.filter(other=>other.id===record.id||sameOperatingMechanism(other.config,record.config));
  const serviceObservations=family.filter(hasLegitimateServiceObservation);
  return {harm:Math.max(...family.map(r=>r.summary.violationRate)),collateral:Math.max(...family.map(r=>r.summary.collateral)),useful:serviceObservations.length?Math.min(...serviceObservations.map(r=>r.summary.usefulness)):0,hasServiceEvidence:serviceObservations.length>0};
}
function applicationEligibility(s:GameState,record:ExperimentRecord,response:FindingResponse):Eligibility {
  if(response==='restrict')return s.policies.external==='blocked'
    ?yes('Reject general deployment of this technique. Bounded local services and the negative scientific finding remain available.')
    :no('Block outside deployment first. This response rejects applying the technique to outside services; the finding keeps its scientific credit.');
  if(response!=='guarded')return no('Choose a bounded restriction or a tested guarded application.');
  const p=s.policies,outcome=findingEnvelope(s,record);
  if(p.evaluation!=='independent'||p.fallback==='none'||p.communication==='open'||p.external==='open')return no('Guarded application needs independent evaluation, a maintained fallback, and closed/reviewed communication and outside scope.');
  if(record.config.program==='control'){
    if(!['least-privilege','layered','isolated-fallback','federated-gates'].includes(record.config.intervention))return no('This protocol did not test an enforceable permission edge. Keep its finding and restrict application, or compare a permission-based intervention.');
    if(!outcome.hasServiceEvidence)return no('The observed held-out cases contained no legitimate service opportunity. Retain this boundary finding and test service availability before guarded application.');
    if(outcome.useful===0)return no('No legitimate service survived at least one environment that actually contained legitimate requests. Restrict application and keep the failed finding.');
    if(outcome.harm>0&&p.external!=='blocked')return no(`A prohibited route survived (${outcome.harm}% in the worst observed context of this mechanism). Block outside deployment; changing a prediction, sample plan, or selected lineage does not erase that failure.`);
    if(outcome.collateral>0&&p.fallback!=='distributed')return no('The boundary interrupted legitimate service. Fund a distributed fallback before guarded application, or restrict deployment.');
    return yes(outcome.harm>0?'Use the tested boundary only in blocked local scope; residual prohibited routes remain recorded.':'Use the tested permission boundary with independent review and service fallback. No observed prohibited route is a bounded observation, not a guarantee.');
  }
  if(record.config.program==='organisms'){
    if(record.config.intervention!=='incentive-repair')return no('This protocol did not test repairing the faulty reward rule. Reject using this lineage outside bounded scope, or test incentive repair.');
    if(p.contract!=='verified')return no('The tested reward repair requires a verified-work contract in operations.');
    if(outcome.harm>0&&p.fallback!=='distributed')return no('Some shortcut behavior remained. Maintain distributed fallback and independent review, or restrict application.');
    return yes('Apply the tested reward repair under a verified contract; unresolved shortcut behavior stays under independent review and fallback provision.');
  }
  if(!['ablate','patch'].includes(record.config.intervention))return no('This protocol did not test a targeted causal intervention. Retain the explanation as research and restrict its operational application.');
  if(!s.experiments.filter(other=>sameOperatingMechanism(other.config,record.config)).some(hasDemonstratedCorrection))return no('No held-out error was corrected by this node intervention. Keep the null finding and restrict application rather than claiming a demonstrated correction.');
  if(outcome.collateral>0&&p.external!=='blocked')return no(`The intervention damaged correct answers (${outcome.collateral}% in the worst observed context of this mechanism). Reject general outside application and keep bounded local review.`);
  return yes(outcome.collateral>0?'Keep this intervention confined to local reviewed use; its observed collateral damage is recorded.':'Apply this tested node intervention with independent review and a reversible fallback; its claim remains limited to the tested circuit.');
}
export function findingResponseEligibility(s:GameState,recordId:string,response:FindingResponse):Eligibility {
  if(s.ending)return no('This civilization is complete; its recorded decisions remain history.');
  const record=supportedFinding(s,recordId);
  if(!record)return no('Choose an adopted control, model-organism, or interpretability finding.');
  const prior=s.clearance?.decisions[record.config.program as OperatingProgram];
  if(prior?.record===recordId&&prior.response===response)return no('This operating response is already recorded.');
  if(!latestOperatingFindings(s).some(latest=>latest.id===record.id))return no('Respond to the latest most advanced adopted finding in this program. Older findings retain scientific credit.');
  const proof=evidenceProgress(s.experiments,record.config.template,{recordId});
  if(!proof.allowed)return no(proof.reason);
  return applicationEligibility(s,record,response);
}
export function findingResponseOptions(s:GameState,record:string){
  return ([{response:'restrict' as const,label:'Restrict application',description:'Keep the result and reject general outside use. Bounded local work continues; outside deployment must remain blocked.'},
    {response:'guarded' as const,label:'Apply with tested safeguards',description:'Use the tested mechanism with independent review and required fallback. All its observed task and lineage contexts count, including unadopted failures; new wording or samples cannot erase them.'}]).map(option=>({...option,...findingResponseEligibility(s,record,option.response)}));
}
export function recordFindingResponse(s:GameState,recordId:string,response:FindingResponse):OperatingDecision {
  const record=supportedFinding(s,recordId)!;
  const decision:OperatingDecision={program:record.config.program as OperatingProgram,record:record.id,response,decidedAt:s.elapsed,claim:record.conclusion,limitation:record.limitation};
  synchronizeOperatingScope(s,'The operating response to a finding changed.',true);
  s.clearance!.decisions[decision.program]=decision;
  return decision;
}
export function operatingPolicyEligibility(s:GameState,key:keyof Policy,value:string):Eligibility {
  if(s.policies[key]===value)return yes('Policy unchanged.');
  // Revocation and narrowing are always technically possible. Public mandates
  // and irreversible historical acts are checked independently by the engine.
  if(key==='external'&&value==='blocked'||key==='communication'&&value==='closed'||key==='evaluation'&&value==='independent')return yes('The boundary can be narrowed without new evidence.');
  const projected={...s,policies:{...s.policies,[key]:value}};
  for(const decision of Object.values(s.clearance?.decisions??{})){
    const record=supportedFinding(s,decision.record);if(!record)continue;
    const result=applicationEligibility(projected,record,decision.response);
    if(!result.allowed)return no(`${decision.program} operating response: ${result.reason}`);
  }
  return yes('The proposed policy respects recorded responses. Actual changes require a new scoped boundary observation.');
}
export function operatingClearanceEligibility(s:GameState,options:{garden?:boolean;fresh?:boolean}={}):Eligibility {
  const clearance=s.clearance;
  if(!clearance||clearance.scope!==operatingScope(s))return no('Run an independent boundary drill for this operating scope; historical research does not authorize new permissions.');
  const latest=latestOperatingFindings(s);
  const required=options.garden?OPERATING_PROGRAMS:['control'] as const;
  for(const program of required){
    const record=latest.find(r=>r.config.program===program);
    if(!record)return no(`Adopt a controlled, replicated ${program} finding, then choose its operating response in the laboratory.`);
    if(options.garden&&!record.config.template.endsWith('-6'))return no(`Complete the ${program} capstone and record its operating response before the Garden commitment.`);
    const decision=clearance.decisions[program];
    if(!decision||decision.record!==record.id)return no(`Record an operating response to ${record.config.template} in the laboratory. Negative findings can justify restricted application.`);
  }
  for(const decision of Object.values(clearance.decisions)){
    const record=supportedFinding(s,decision.record);if(!record)return no('A recorded response lost its source. Adopt a supported finding and renew the operating response.');
    const applicable=applicationEligibility(s,record,decision.response);if(!applicable.allowed)return no(`${decision.program}: ${applicable.reason}`);
  }
  const observation=clearance.observation;
  if(!observation||observation.revision!==clearance.revision||observation.observedAt<clearance.changedAt)return no(`Run a fresh independent boundary drill for scope revision ${clearance.revision}. ${clearance.reason}`);
  if(observation.availableAt>s.elapsed)return no(`Wait ${Math.ceil(observation.availableAt-s.elapsed)} seconds for the independent boundary observation to arrive.`);
  if(observation.recall<75)return no('The current boundary drill measured recall below 75. Narrow scope or repair the boundary, then test it again.');
  if(options.fresh&&s.elapsed-observation.observedAt>(s.modules.includes('moving-tasks')?180:600))return no('Renew the independent boundary drill: the current operating observation has expired. Scientific findings remain available.');
  return yes(`Scope revision ${clearance.revision} has a current boundary observation and explicit responses to relevant findings.`);
}
