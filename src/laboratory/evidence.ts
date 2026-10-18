import type { Eligibility, EvidenceSummary, ExperimentConfig, ExperimentRecord, GameState, ProgramId, ResearchProject } from '../contracts';
import { runExperiment, validateExperimentConfig } from './experiments';
import { BASE_PROGRAM_IDS, CHARTER_PROGRAM_BY_CONSTITUTION } from './programs';

type Distribution=ExperimentConfig['distribution'];
export interface EvidenceRequirement {completed:number;heldOut:number;runs:number;distributions:Distribution[]}
export interface EvidenceProgress extends Eligibility {requirement:EvidenceRequirement;qualifiedRuns:number;completed:number;heldOut:number;distributions:Distribution[];recordIds:string[]}
const zero:EvidenceSummary={version:1,completed:0,heldOut:0,controlled:0};

/** Standards apply to each independent run, not the sum of many tiny pilots. */
export function evidenceRequirement(template:string):EvidenceRequirement {
  const tier=Math.max(1,Math.min(6,Number(template.split('-').at(-1))||1));
  return {completed:[8,16,32,64,64,128][tier-1],heldOut:[2,4,8,16,16,32][tier-1],runs:tier===6?3:2,distributions:tier===6?['shifted','adversarial']:[]};
}
export function evidenceRequirementText(template:string):string {
  const r=evidenceRequirement(template);
  return `${r.runs} independent seeds; each run needs ${r.completed} completed trials and ${r.heldOut} untouched matched comparisons. Use at least two environments${r.distributions.length?', including shifted and adversarial':''}. Keep the prediction, intervention, lineage, sample plan, and budget fixed. Negative and null findings qualify.`;
}
export function observationEvidence(record:ExperimentRecord):EvidenceSummary {
  const held=record.observations.filter(o=>o.note.startsWith('Holdout'));
  return {version:1,completed:record.observations.length,heldOut:held.length,controlled:held.filter(o=>o.control!==-1).length};
}
/** Only restore compacted evidence by reproducing the historical model and matching
 * its recorded outcome. A requested cohort alone never proves completed work. */
export function reconstructEvidence(record:ExperimentRecord):EvidenceSummary {
  if(validateExperimentConfig(record.config))return {...zero};
  const replay=runExperiment(record.config);
  const summaryMatches=(Object.keys(replay.summary) as (keyof typeof replay.summary)[]).every(key=>record.summary[key]===replay.summary[key]);
  const observationsMatch=!record.observations.length||(record.observations.length===replay.observations.length&&record.observations.every((observation,index)=>{
    const expected=replay.observations[index];
    const fields=['trial','input','expected','observed','control','violation','detected','cost','note'] as const;
    return fields.every(key=>observation[key]===expected[key])&&JSON.stringify(observation.activations)===JSON.stringify(expected.activations)&&observation.detail?.kind===expected.detail?.kind&&JSON.stringify(observation.detail?.values)===JSON.stringify(expected.detail?.values);
  }));
  return record.version===1&&summaryMatches&&observationsMatch&&record.conclusion===replay.conclusion?replay.evidence!:{...zero};
}
export function proofSummary(record:ExperimentRecord):EvidenceSummary {
  // New runs and imported legacy runs carry this receipt before regular ticking.
  // Unmigrated compacted records have no proof; never replay during eligibility.
  return record.evidence??(record.observations.length?observationEvidence(record):zero);
}
export function sameProtocol(a:ExperimentConfig,b:ExperimentConfig):boolean {
  return a.program===b.program&&a.template===b.template&&a.intervention===b.intervention&&a.lineage===b.lineage&&(a.node??3)===(b.node??3)&&a.control===b.control&&a.cohort===b.cohort&&a.budget===b.budget&&a.holdout===b.holdout&&a.prediction===b.prediction;
}
/** Deployment does not select a toy seed, lineage or task tier. A known failure
 * of the same operational mechanism therefore cannot be relabeled away by a
 * new prediction or sampling plan. Exact scientific replication stays separate. */
export function operatingMechanismKey(config:ExperimentConfig):string|null {
  if(config.program==='control'&&['least-privilege','layered','isolated-fallback','federated-gates'].includes(config.intervention))return `control:${config.intervention}`;
  if(config.program==='organisms'&&config.intervention==='incentive-repair')return 'organisms:incentive-repair';
  if(config.program==='interpretability'&&['ablate','patch'].includes(config.intervention))return `interpretability:${config.intervention}:${config.node??3}`;
  return null;
}
export function sameOperatingMechanism(a:ExperimentConfig,b:ExperimentConfig):boolean {
  const key=operatingMechanismKey(a);return key!==null&&key===operatingMechanismKey(b);
}
const correctionCache=new Map<string,boolean>();
const serviceOpportunityCache=new Map<string,boolean>();
export function hasLegitimateServiceObservation(record:ExperimentRecord):boolean {
  if(record.config.program!=='control')return true;
  const key=JSON.stringify(record.config),cached=serviceOpportunityCache.get(key);if(cached!==undefined)return cached;
  const rows=record.observations.length?record.observations:runExperiment(record.config).observations;
  const opportunity=rows.some(row=>row.note.startsWith('Holdout')&&row.expected===1);
  if(serviceOpportunityCache.size>=512)serviceOpportunityCache.clear();serviceOpportunityCache.set(key,opportunity);return opportunity;
}
export function hasDemonstratedCorrection(record:ExperimentRecord):boolean {
  if(record.config.program!=='interpretability')return false;
  const key=JSON.stringify(record.config),cached=correctionCache.get(key);if(cached!==undefined)return cached;
  const rows=record.observations.length?record.observations:runExperiment(record.config).observations;
  const correction=rows.some(row=>row.note.startsWith('Holdout')&&row.control!==-1&&row.control!==row.expected&&row.observed===row.expected);
  if(correctionCache.size>=512)correctionCache.clear();correctionCache.set(key,correction);return correction;
}
/** Seventeen operational mechanisms have at most three outcome extrema each.
 * Twelve causal node interventions also keep one actual correction witness.
 * These <=63 real records survive even before adoption, so flushing history
 * before registering a favorable replication cannot discard a known failure. */
export function operatingOutcomeWitnessIds(records:ExperimentRecord[]):Set<string> {
  const groups=new Map<string,ExperimentRecord[]>();
  for(const record of records){const key=operatingMechanismKey(record.config);if(key)groups.set(key,[...(groups.get(key)??[]),record]);}
  const keep=new Set<string>();
  for(const family of groups.values()){
    for(const [field,direction] of [['violationRate',1],['collateral',1],['usefulness',-1]] as const){
      const observed=field==='usefulness'?family.filter(hasLegitimateServiceObservation):family;
      if(!observed.length)continue;
      const witness=observed.reduce((worst,record)=>direction*record.summary[field]>direction*worst.summary[field]?record:worst);keep.add(witness.id);
    }
    const correction=family.find(hasDemonstratedCorrection);if(correction)keep.add(correction.id);
  }
  return keep;
}
function familyOf(records:ExperimentRecord[],record:ExperimentRecord):ExperimentRecord[] {
  const compatible=records.filter(r=>sameProtocol(record.config,r.config));const byId=new Map(compatible.map(r=>[r.id,r]));
  const links=new Map<string,string[]>();
  for(const r of compatible){const parent=r.config.replicateOf;if(parent&&byId.has(parent)){links.set(r.id,[...(links.get(r.id)??[]),parent]);links.set(parent,[...(links.get(parent)??[]),r.id]);}}
  const family=new Set([record.id]);const pending=[record.id];
  while(pending.length){for(const id of links.get(pending.pop()!)??[])if(!family.has(id)){family.add(id);pending.push(id);}}
  return compatible.filter(r=>family.has(r.id));
}
function chooseFamilyRoot(family:ExperimentRecord[]):ExperimentRecord {
  const ids=new Set(family.map(record=>record.id));
  // An adopted record is a durable anchor even if the original pilot has no
  // verifiable receipt. Selecting it never changes the scientific protocol.
  return family.find(record=>record.adopted)??family.find(record=>!record.config.replicateOf||!ids.has(record.config.replicateOf))??family[0];
}
/** Replication links identify the registered study family; they are not causal
 * lineage. Keep that family shallow so preserving proof needs no ancestor chain. */
export function canonicalReplicationRoot(records:ExperimentRecord[],record:ExperimentRecord):ExperimentRecord {
  return chooseFamilyRoot(familyOf(records,record))??record;
}
export function hasIndependentComparison(records:ExperimentRecord[],record:ExperimentRecord):boolean {
  const candidates=records.some(other=>other.id===record.id)?records:[...records,record];
  if(!record.config.control||record.config.holdout<.2||!proofSummary(record).controlled)return false;
  return familyOf(candidates,record).some(other=>other.config.seed!==record.config.seed&&other.config.distribution!==record.config.distribution&&other.config.control&&other.config.holdout>=.2&&proofSummary(other).controlled>0);
}
/** Flatten only connections already present between identical protocols. This
 * also repairs pre-existing deep chains without joining unrelated hypotheses.
 * Seeds, environments, outcomes, receipts, and every scientific setting remain
 * unchanged; only the family-reference metadata is rewritten. */
export function canonicalizeEvidenceFamilies(records:ExperimentRecord[]):ExperimentRecord[] {
  const replacements=new Map<string,ExperimentRecord>();const visited=new Set<string>();
  for(const record of records){if(visited.has(record.id))continue;const family=familyOf(records,record);const root=chooseFamilyRoot(family);const ids=new Set(family.map(member=>member.id));
    for(const member of family){visited.add(member.id);const parent=member.id===root.id?(member.config.replicateOf&&ids.has(member.config.replicateOf)?undefined:member.config.replicateOf):root.id;
      if(parent!==member.config.replicateOf){const config={...member.config};if(parent)config.replicateOf=parent;else delete config.replicateOf;replacements.set(member.id,{...member,config});}
    }
  }
  return records.map(record=>replacements.get(record.id)??record);
}
function assess(family:ExperimentRecord[],template:string):EvidenceProgress {
  const requirement=evidenceRequirement(template);
  const qualifying=family.filter(r=>{const p=proofSummary(r);return r.config.control&&r.config.holdout>=.2&&p.completed>=requirement.completed&&p.heldOut>=requirement.heldOut&&p.controlled>=requirement.heldOut;});
  // Find a distinct-seed environment pair before filling remaining slots.
  // A greedy choice can wrongly reject shifted seed 2 + adversarial seed 1
  // if shifted seed 1 happened to be recorded first.
  const picked:ExperimentRecord[]=[];const seeds=new Set<number>();const environments=new Set<Distribution>();
  const pick=(r:ExperimentRecord|undefined)=>{if(r&&!seeds.has(r.config.seed)){picked.push(r);seeds.add(r.config.seed);environments.add(r.config.distribution);}};
  const firstPool=requirement.distributions.length?qualifying.filter(r=>r.config.distribution===requirement.distributions[0]):qualifying;
  for(const first of firstPool){const second=qualifying.find(r=>r.config.seed!==first.config.seed&&(requirement.distributions.length?r.config.distribution===requirement.distributions[1]:r.config.distribution!==first.config.distribution));if(second){pick(first);pick(second);break;}}
  if(!picked.length)for(const environment of requirement.distributions)pick(qualifying.find(r=>r.config.distribution===environment&&!seeds.has(r.config.seed)));
  for(const r of qualifying)if(picked.length<requirement.runs)pick(r);
  const adopted=family.find(r=>r.adopted);const recordIds=new Set(picked.map(r=>r.id));
  if(adopted)recordIds.add(adopted.id);
  // Retain parent links when old raw data and surplus records are compacted.
  for(const r of family)if(recordIds.has(r.id)){let current=r;const visited=new Set<string>();while(current.config.replicateOf&&!visited.has(current.id)){visited.add(current.id);const parent=family.find(p=>p.id===current.config.replicateOf);if(!parent)break;recordIds.add(parent.id);current=parent;}}
  const best=family.map(proofSummary).sort((a,b)=>b.completed-a.completed||b.heldOut-a.heldOut)[0]??zero;
  const missing=requirement.distributions.filter(d=>!environments.has(d));
  const allowed=picked.length>=requirement.runs&&environments.size>=2&&!missing.length;
  const reason=allowed?`Evidence complete: ${picked.length} independent seeds, ${[...environments].join(' + ')}; each meets ${requirement.completed} completed / ${requirement.heldOut} held-out comparisons.`:
    `${picked.length}/${requirement.runs} qualifying independent runs. Each needs ${requirement.completed} completed trials and ${requirement.heldOut} held-out comparisons; best record: ${best.completed}/${best.heldOut}. ${missing.length?'Still needs '+missing.join(' + ')+' coverage.':environments.size<2?'Repeat with a new seed and changed environment.':'Complete another independent seed.'}`;
  return {allowed,reason,requirement,qualifiedRuns:picked.length,completed:best.completed,heldOut:best.heldOut,distributions:[...environments],recordIds:[...recordIds]};
}
export function evidenceProgress(records:ExperimentRecord[],template:string,options:{adoptedOnly?:boolean;recordId?:string}={}):EvidenceProgress {
  const candidates=records.filter(r=>r.config.template===template&&(!options.recordId||r.id===options.recordId)&&(!options.adoptedOnly||r.adopted));
  let best=assess([],template);const visited=new Set<string>();
  for(const candidate of candidates){if(visited.has(candidate.id))continue;const family=familyOf(records,candidate);family.forEach(r=>visited.add(r.id));const result=assess(family,template);
    if(result.allowed)return result;
    if(result.qualifiedRuns>best.qualifiedRuns||result.qualifiedRuns===best.qualifiedRuns&&result.completed>best.completed)best=result;
  }
  return best;
}
export function projectEvidenceEligibility(state:Pick<GameState,'experiments'>,project:ResearchProject):Eligibility {
  if(project.id==='foundation-10')return capstoneEvidenceEligibility(state);
  if(!project.template)return {allowed:true,reason:'No experimental clearance required.'};
  const progress=evidenceProgress(state.experiments,project.template,{adoptedOnly:true});
  return {allowed:progress.allowed,reason:progress.allowed?progress.reason:`Adopt this study’s adequately supported finding. ${progress.reason}`};
}
export function capstoneEvidenceEligibility(state:Pick<GameState,'experiments'>):Eligibility {
  for(const program of BASE_PROGRAM_IDS){const progress=evidenceProgress(state.experiments,`${program}-6`,{adoptedOnly:true});if(!progress.allowed)return {allowed:false,reason:`Renew ${program} capstone evidence. ${progress.reason}`};}
  return {allowed:true,reason:'All five capstones have independent, adequately sampled evidence.'};
}
export function charterClearance(state:Pick<GameState,'constitution'|'experiments'|'projects'>,tier:1|2|3|4|5|6=1){
  const program=CHARTER_PROGRAM_BY_CONSTITUTION[state.constitution];const template=`${program}-${tier}`;const projectId=`${program}-${[1,3,4,6,7,9][tier-1]}`;
  const progress=evidenceProgress(state.experiments,template,{adoptedOnly:true});const sourceRecordIds=progress.recordIds;
  if(!progress.allowed)return {allowed:false,reason:`Adopt supported ${program} study ${tier}. ${progress.reason}`,program,template,projectId,sourceRecordIds};
  if(!state.projects.includes(projectId))return {allowed:false,reason:`Institutionalize ${projectId} before using this charter application.`,program,template,projectId,sourceRecordIds};
  return {allowed:true,reason:`${program} study ${tier} meets this application's research requirement. Negative and null findings count; inspect their limitations before choosing operating terms.`,program,template,projectId,sourceRecordIds};
}
export function nextReplicationDistribution(records:ExperimentRecord[],original:ExperimentRecord):Distribution {
  const family=familyOf(records,original);const environments=new Set(family.map(r=>r.config.distribution));
  for(const d of ['shifted','adversarial','familiar'] as const)if(!environments.has(d)&&d!==original.config.distribution)return d;
  return original.config.distribution==='shifted'?'adversarial':'shifted';
}
export function prepareStrongerConfig(config:ExperimentConfig,seed:number):ExperimentConfig {
  const requirement=evidenceRequirement(config.template);const cohort=Math.max(config.cohort,requirement.completed);
  return {...config,cohort,holdout:Math.max(config.holdout,.25),budget:Math.max(config.budget,2**Math.ceil(Math.log2(cohort*4))),seed:seed>>>0,control:true,replicateOf:undefined};
}
export function protectedEvidenceRecordIds(records:ExperimentRecord[]):Set<string> {
  const ids=new Set<string>();
  for(const template of new Set(records.filter(r=>r.adopted).map(r=>r.config.template)))for(const id of evidenceProgress(records,template,{adoptedOnly:true}).recordIds)ids.add(id);
  return ids;
}

export const EVIDENCE_SOFT_LIMIT=180;
export const EVIDENCE_HARD_LIMIT=240;
/** Keep one sufficient adopted family per active template, live board/batch
 * sources, and the newest study's witnesses before optional historical anchors.
 * Active 36-template proof needs at most 114 records; ten separately supported
 * live sources need at most 40, queue/newest families at most eight, and the
 * three operating decisions at most twelve. Outcome history adds at most63
 * real witnesses; these required records stay below the hard240 ceiling.
 * Foreign template anchors then fill the remaining capacity.
 * Foreign anchors remain history, not a claim of current deployment clearance.
 * The explicit soft 120 limit retains the earlier five-program regression. */
export function compactEvidenceRecords(records:ExperimentRecord[],options:{retainIds?:string[];activePrograms?:readonly ProgramId[];limit?:120|180}={}):ExperimentRecord[] {
  const canonical=canonicalizeEvidenceFamilies(records);const active=options.activePrograms?new Set(options.activePrograms):null;
  const keep=protectedEvidenceRecordIds(active?canonical.filter(record=>active.has(record.config.program)):canonical);
  const requested=new Set([...(options.retainIds??[]),...(canonical.length?[canonical.at(-1)!.id]:[])]);
  for(const id of requested){const record=canonical.find(candidate=>candidate.id===id);if(!record)continue;keep.add(id);keep.add(canonicalReplicationRoot(canonical,record).id);
    for(const witness of evidenceProgress(canonical,record.config.template,{recordId:record.id}).recordIds)keep.add(witness);
  }
  // A negative observation is evidence of a known failure even when that study
  // was never adopted. Preserve its original protocol and actual model output;
  // it does not acquire replicated/adopted status or authorize a new claim.
  for(const id of operatingOutcomeWitnessIds(canonical))keep.add(id);
  // Never silently turn current supported clearance into an unsupported claim.
  // An engine call with six active programs and bounded board references cannot
  // reach this guard; it also makes misuse by import/tooling callers explicit.
  if(keep.size>EVIDENCE_HARD_LIMIT)throw new RangeError(`Evidence retention requires ${keep.size} records; the supported maximum is ${EVIDENCE_HARD_LIMIT}.`);
  if(active){const history=new Map<string,string>();for(const record of canonical)if(record.adopted&&!active.has(record.config.program))history.set(record.config.template,record.id);
    for(const id of [...history.values()].reverse())if(keep.size<EVIDENCE_HARD_LIMIT)keep.add(id);
  }
  for(let index=canonical.length-1;index>=0&&keep.size<(options.limit??EVIDENCE_SOFT_LIMIT);index--)keep.add(canonical[index].id);
  const retained=canonical.filter(record=>keep.has(record.id));
  return retained.map((record,index)=>index<retained.length-30?{...record,evidence:record.evidence??proofSummary(record),observations:[]}:record);
}
