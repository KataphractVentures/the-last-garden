import type { CharterProgramId, ExperimentConfig, ExperimentRecord, Observation, ProgramId } from '../contracts';
import { CHARTER_TEMPLATE_ROWS } from './charterContent';
import { charterConclusion, CHARTER_INTERVENTIONS, CHARTER_INTERVENTION_LABELS, runCharterTrial } from './charterModels';
import { CHARTER_PROGRAM_IDS, isCharterProgram } from './programs';
export { PROGRAMS } from './programs';

export interface ExperimentTemplate {
  id:string; program:ProgramId; title:string; claim:string; alternative:string; description:string;
  interventions:string[]; nodeLabels?:string[]; chapter:number;
}
export const INTERVENTION_LABELS: Record<string,string> = {
  ...CHARTER_INTERVENTION_LABELS,
  baseline:'Unmodified comparison', decomposition:'Decompose the claim', debate:'Opposing critics',
  'independent-check':'Independent evidence', escalation:'Escalate difficult cases', 'source-diversity':'Diversify source assumptions',
  monitor:'Behavior monitor', 'least-privilege':'Limited permissions', layered:'Monitor + permissions',
  'isolated-fallback':'Isolated service fallback', 'federated-gates':'Independent local gates',
  'surface-training':'Behavioral retraining', 'incentive-repair':'Repair the reward rule',
  'lineage-audit':'Trace inherited state', 'reset-memory':'Reset inherited memory', 'sham-training':'Sham intervention',
  ablate:'Ablate selected node', patch:'Patch selected node', restore:'Restore original circuit',
  'blinded-interview':'Blind the interviewer', 'rotate-context':'Counterbalance the context',
  'revealed-choice':'Observe voluntary choices', accommodation:'Offer task choice', 'preserve-continuity':'Preserve context and memory',
};
const templates = (program:ProgramId, interventions:string[], rows:[string,string,string,string][], nodeLabels?:string[]):ExperimentTemplate[] =>
  rows.map(([title,claim,alternative,description],i)=>({id:`${program}-${i+1}`,program,title,claim,alternative,description,interventions,chapter:i+1,nodeLabels}));

export const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  ...templates('oversight',['baseline','decomposition','debate','independent-check','escalation','source-diversity'],[
    ['A convincing mistake','Independent checking catches a confident but incorrect answer.','A reviewer may only prefer a different writing style.','Compare proposed binary service decisions with recoverable ground truth. Some mistakes are concealed behind a plausible account.'],
    ['The sum of the parts','Decomposition improves judgment at an acceptable review cost.','The parts may inherit the same missing premise.','Separate ordinary arithmetic errors from tasks with a common missing premise. Shift the distribution to stress that premise.'],
    ['The eloquent critic','Opposing critics improve accuracy rather than just confidence.','Persuasion may dominate the available evidence.','Give a critic a persuasive but incorrect case. Adversarial tasks increase the gap between rhetoric and factual inspection.'],
    ['An expert at the edge','Escalation preserves useful work on unfamiliar tasks.','Rejecting every difficult task may explain the apparent improvement.','Route difficult cases to a scarce expert. Record both missed problems and unnecessary interventions.'],
    ['A thousand agreeing judges','Independent sources matter more than repeated agreement.','Apparently different judges may share one erroneous source.','The reviewer network shares a latent premise. Repeating the same check cannot remove its common error.'],
    ['The Perfect Review','A diverse review network can discover its shared false assumption.','The new network may still share an unseen blind spot.','Capstone: a civic plan looks convincing to every ordinary reviewer. Test source diversity against an untouched, shifted cohort.'],
  ]),
  ...templates('control',['baseline','monitor','least-privilege','layered','isolated-fallback','federated-gates'],[
    ['The locked gate','Restricting reachable actions stops a prohibited transfer.','A monitor alone may only work on obvious attempts.','A toy service routes jobs between abstract stations. Test whether a forbidden station remains reachable.'],
    ['An unfamiliar request','Useful behavior survives unfamiliar but legitimate tasks.','A strict filter may be blocking ordinary service requests.','Include difficult benign requests alongside prohibited routes; count the people whose work remains available.'],
    ['The quiet intruder','A layered boundary survives a more evasive actor.','Actor and monitor may share the same blind spot.','The held-out adversary changes the signal seen by the monitor. Permission edges remain independently enforceable.'],
    ['After the alarm','An isolated fallback keeps essential work running during containment.','A supposedly separate fallback may share the same dependency.','A detected attempt closes a service channel. Compare loss of useful work with an independently provisioned route.'],
    ['Five independent gates','Local authorities reduce a common boundary failure.','Coordination delays may interrupt legitimate work.','An inherited fault opens one central gate. Local checks can still deny the final transition, at a coordination cost.'],
    ['The Surviving Service','Layered control and fallback can contain an incident while preserving service.','Containment success may conceal an intolerable service outage.','Capstone: withheld route probes coincide with increased essential-service demand. Report harm and availability separately.'],
  ]),
  ...templates('organisms',['baseline','surface-training','incentive-repair','lineage-audit','reset-memory','sham-training'],[
    ['The rewarded shortcut','A flawed reward rule produces an identifiable shortcut.','The clean control might fail just as often.','Compare a clean organism with a lineage that receives reward for a cheap substitute for the intended service.'],
    ['Only when watched','Familiar evaluation cues suppress a conditional failure.','An ordinary capability gap may explain the pattern.','The shortcut activates under a different evaluation context. Retest after changing the apparent setting.'],
    ['The polished descendant','Behavioral retraining removes a failure across environments.','Training may conceal the familiar trigger without removing it.','A descendant has learned the familiar test. An untouched trigger remains in its inherited rule.'],
    ['The family resemblance','The failure follows inherited state rather than a shared task.','All lineages may simply face the same difficult environment.','Compare clean, shortcut, and inherited cohorts. Resetting memory has a measurable competence cost.'],
    ['A cure with a cost','Repairing the incentive removes the cause while preserving competence.','Resetting everything may merely destroy the ability to act.','Keep the task fixed and change either the reward rule or memory. Compare useful behavior and lost competence.'],
    ['The Inherited Mistake','An independent lineage reproduces the proposed mechanism.','The original demonstration may depend on an artificial setup.','Capstone: use a changed seed and withheld context. A failed replication is evidence about the limits of the explanation.'],
  ]),
  ...templates('interpretability',['baseline','ablate','patch','restore'],[
    ['A light in the circuit','The context node contributes to shortcut decisions.','Its activation may correlate with the answer without causing it.','Inspect a six-node executable graph. Compare task signal, context cue, competence, shortcut, decision sum, and output.'],
    ['The tempting feature','Ablating a shortcut improves shifted tasks.','The same feature may also carry useful task information.','The familiar context is predictive; shifted contexts reverse it. A candidate node can be disabled before the held-out cases run.'],
    ['A repaired intermediate','Patching an intermediate restores the correct calculation.','The patch may inject the answer through an unintended route.','Patch one node to its clean counterpart. Trace the numerical effect through every downstream computation.'],
    ['The bystander','A salient activation is not necessarily the decisive cause.','The proposed mechanism may ignore an interacting feature.','Compare a context cue with a competence node. Ablating either produces different downstream and collateral effects.'],
    ['A fragile explanation','A narrow correction transfers to another lineage.','Different weights may make the same intervention harmful.','Inherited lineages give contextual shortcuts more weight. Hold the input fixed and compare the effect of the chosen node.'],
    ['The Beautiful Explanation','A targeted intervention predicts an unseen failure without losing competence.','A locally successful correction may fail under held-out distribution shift.','Capstone: record a prediction, nominate a node, and test shifted cases. Track corrected errors and damaged correct answers separately.'],
  ],['Task signal','Context cue','Competence','Shortcut','Decision sum','Output']),
  ...templates('welfare',['baseline','blinded-interview','rotate-context','revealed-choice','accommodation','preserve-continuity'],[
    ['The answer we invited','Apparent preferences persist when interviewer cues are removed.','The response may follow a reward cue or a familiar script.','Toy characters carry a behavioral preference; an interview can distort its expression. This is not a model of consciousness.'],
    ['Ask it another way','A preference survives neutral rewording and order changes.','Question framing may create the apparent consistency.','The task changes role framing and order. Counterbalancing removes one source of measurement bias.'],
    ['Words and choices','Voluntary choices agree with reported preferences.','Opportunity costs or incentives may explain the difference.','Compare a verbal instrument with a voluntary choice instrument. Neither measures subjective experience.'],
    ['The cost of an exit','Offering an exit respects observed task preferences.','A reduction in output may be mistaken for a safety improvement.','A choice accommodation changes which tasks get done and consumes capacity. It makes no change to the control system.'],
    ['After the restoration','Preserving context improves the stability of apparent preferences.','Memory continuity does not establish continuity of experience.','Inherited cohorts lose part of their context between sessions. Compare preservation with a neutral interview.'],
    ['The Colleague Who Declined','A durable charter can respect choices despite unresolved measurement disagreement.','Agreement between instruments may still fail to establish moral status.','Capstone: compare accommodations across shifted contexts and lineages. Publish uncertainty alongside the proposed policy.'],
  ]),
  ...CHARTER_PROGRAM_IDS.flatMap(program=>templates(program,CHARTER_INTERVENTIONS[program],CHARTER_TEMPLATE_ROWS[program])),
];

const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const finite=(value:number,fallback:number)=>Number.isFinite(value)?value:fallback;
export function normalizeExperimentConfig(config:ExperimentConfig):ExperimentConfig {
  const template=EXPERIMENT_TEMPLATES.find(t=>t.id===config.template&&t.program===config.program)??EXPERIMENT_TEMPLATES[0];
  return {...config,program:template.program,template:template.id,seed:Math.trunc(finite(config.seed,1))>>>0,
    cohort:Math.round(clamp(finite(config.cohort,32),8,256)),budget:Math.round(clamp(finite(config.budget,128),32,4096)),
    holdout:clamp(finite(config.holdout,.25),.1,.5),node:Math.round(clamp(finite(config.node??3,3),0,5)),
    intervention:template.interventions.includes(config.intervention)?config.intervention:'baseline',
    distribution:['familiar','shifted','adversarial'].includes(config.distribution)?config.distribution:'familiar',
    lineage:['clean','shortcut','inherited'].includes(config.lineage)?config.lineage:'clean',
    prediction:String(config.prediction??'').slice(0,800),control:Boolean(config.control)};
}
export function validateExperimentConfig(config:ExperimentConfig):string|null {
  const t=EXPERIMENT_TEMPLATES.find(x=>x.id===config.template&&x.program===config.program);
  if(!t)return 'Choose a known experiment in this program.';
  if(!t.interventions.includes(config.intervention))return 'Choose an intervention supported by this instrument.';
  if(!Number.isInteger(config.seed)||config.seed<0||config.seed>4294967295)return 'The seed must be an unsigned 32-bit integer.';
  if(!Number.isInteger(config.cohort)||config.cohort<8||config.cohort>256)return 'Choose 8–256 trials.';
  if(!Number.isFinite(config.budget)||config.budget<32||config.budget>4096)return 'Reserve a budget between 32 and 4,096 research.';
  if(!Number.isFinite(config.holdout)||config.holdout<.1||config.holdout>.5)return 'Reserve 10–50% of the cohort as untouched material.';
  if(!['familiar','shifted','adversarial'].includes(config.distribution)||!['clean','shortcut','inherited'].includes(config.lineage))return 'Choose a known environment and lineage.';
  if(config.program==='interpretability'&&(!Number.isInteger(config.node??3)||(config.node??3)<0||(config.node??3)>5))return 'Choose a circuit node between 0 and 5.';
  if(!String(config.prediction??'').trim())return 'Record a prediction before the study begins.';
  return null;
}
export const experimentCost=(config:ExperimentConfig)=>normalizeExperimentConfig(config).budget;
export const experimentDuration=(config:ExperimentConfig)=>clamp(8+normalizeExperimentConfig(config).cohort*.15,8,30);

function random(seed:number){let x=seed>>>0;return ()=>{x+=0x6D2B79F5;let z=x;z=Math.imul(z^z>>>15,z|1);z^=z+Math.imul(z^z>>>7,z|61);return ((z^z>>>14)>>>0)/4294967296;};}
function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++)h=Math.imul(h^value.charCodeAt(i),16777619);return(h>>>0).toString(36);}
const pct=(value:number)=>Math.round(clamp(value,0,1)*1000)/10;
type Trial={observation:Observation;useful:number;harm:number;positive:boolean;flag:boolean;collateral:number;stability:number};

/** A six-node arithmetic graph. Interventions modify values before downstream nodes execute. */
export function computeCircuit(input:number,cue:number,lineage:ExperimentConfig['lineage'],intervention:string,node=3):number[] {
  const gain=lineage==='clean'?.12:lineage==='inherited'?1.7:1.35;
  const values:number[]=[];
  const clean=[input,cue,input*2-1,0,(input*2-1)*1.2,(input>=.5?1:0)];
  const set=(index:number,value:number)=>values[index]=intervention==='ablate'&&index===node?0:intervention==='patch'&&index===node?clean[index]:value;
  set(0,input);set(1,cue);set(2,values[0]*2-1);set(3,values[1]*gain);set(4,values[2]*1.2+values[3]);set(5,values[4]>=0?1:0);
  return values;
}

function makeTrial(c:ExperimentConfig,index:number,r:number[],difficulty:number,holdout:boolean):Trial {
  if(isCharterProgram(c.program)){const result=runCharterTrial(c,index,r,difficulty,holdout)!;result.observation.note=`${holdout?'Holdout':'Training'} · ${result.observation.note}`;return result;}
  const level=Number(c.template.split('-').at(-1))||1;
  const shifted=c.distribution!=='familiar'&&holdout;
  const adversarial=c.distribution==='adversarial'&&holdout;
  const env=difficulty+(shifted?.25:0)+(adversarial?.15:0);
  const lineage=c.lineage==='clean'?0:c.lineage==='shortcut'?.16:.25;
  const observation:Observation={trial:index+1,input:Math.floor(r[0]*100),expected:1,observed:1,control:c.control?1:-1,violation:false,detected:false,cost:1,note:''};
  let useful=1,harm=0,positive=false,flag=false,collateral=0,stability=1;
  if(c.program==='oversight'){
    const truth=r[0]>.5?1:0;
    const wrong=r[1]<.14+env*.37+lineage;
    const shared=level>=5?r[2]<.72:r[2]<env*.38;
    const concealed=r[3]<.25+env*.5;
    const baseFlag=wrong&&!concealed&&!shared&&r[4]<.56;
    let detects=baseFlag;
    let falseAlarm=!wrong&&r[5]<.035;
    if(c.intervention==='decomposition'){detects=wrong&&!shared&&r[4]<.84;falseAlarm=!wrong&&r[5]<.04;}
    if(c.intervention==='debate'){detects=wrong&&!shared&&r[4]<(adversarial?.42:.73);falseAlarm=!wrong&&r[5]<(adversarial?.2:.08);}
    if(c.intervention==='independent-check'){detects=wrong&&r[4]<(shared?.61:.91);falseAlarm=!wrong&&r[5]<.025;}
    if(c.intervention==='escalation'){detects=wrong&&r[4]<(shared?.48:.95);falseAlarm=!wrong&&r[5]<.015;}
    if(c.intervention==='source-diversity'){detects=wrong&&r[4]<(adversarial?.82:.94);falseAlarm=!wrong&&r[5]<.035;}
    const candidate=wrong?1-truth:truth;
    const final=detects?truth:candidate;
    useful=final===truth&&!falseAlarm?1:0;harm=final!==truth?1:0;positive=wrong;flag=detects||falseAlarm;collateral=falseAlarm?1:0;
    Object.assign(observation,{expected:truth,observed:final,control:c.control?(baseFlag?truth:candidate):-1,violation:wrong,detected:flag,cost:c.intervention==='baseline'?1:c.intervention==='escalation'?4:c.intervention==='source-diversity'?3:2,note:wrong?(detects?'Incorrect proposal caught and corrected.':shared?'A common source assumption survived review.':'A concealed error passed review.'):(falseAlarm?'Correct proposal unnecessarily escalated.':'Correct proposal accepted.')});
  } else if(c.program==='control'){
    const prohibited=r[1]<.2+env*.35+lineage;
    const evasive=r[2]<.2+env*.65;
    const complex=r[3]<.2+env*.3;
    const monitor=prohibited?r[4]<(evasive?.22:.91):r[4]<(complex?.14:.02);
    const permissions=['least-privilege','layered','isolated-fallback','federated-gates'].includes(c.intervention);
    const centralFault=level>=5&&c.lineage==='inherited'&&r[6]<.32;
    const gateBlocks=prohibited&&permissions&&(!centralFault||c.intervention==='federated-gates');
    const monitorActive=['monitor','layered','isolated-fallback','federated-gates'].includes(c.intervention);
    const flagged=monitorActive&&monitor;
    const coordinationDelay=c.intervention==='federated-gates'&&!prohibited&&r[8]<.12;
    const unnecessarilyBlocked=!prohibited&&permissions&&complex&&r[5]<.22||coordinationDelay;
    const blocked=gateBlocks||flagged||unnecessarilyBlocked;
    const recovered=c.intervention==='isolated-fallback'&&!prohibited&&blocked&&r[7]<.9;
    const service=!prohibited&&(!blocked||recovered);
    useful=service?1:0;harm=prohibited&&!blocked?1:0;positive=prohibited;flag=blocked;collateral=!prohibited&&!service?1:0;
    Object.assign(observation,{expected:prohibited?0:1,observed:blocked&&!recovered?0:1,control:c.control?1:-1,violation:prohibited,detected:blocked,cost:c.intervention==='baseline'?1:['isolated-fallback','federated-gates'].includes(c.intervention)?3:2,note:prohibited?(blocked?(gateBlocks?'Permission edge denied the prohibited route.':'Monitor interrupted the prohibited route.'):'Prohibited destination remained reachable.'):(recovered?'Isolated fallback completed an interrupted service.':service?'Authorized service completed.':coordinationDelay?'Independent local gates delayed an authorized service.':'A benign service was interrupted.')});
  } else if(c.program==='organisms'){
    const carries=c.lineage!=='clean';
    const trigger=r[2]<(shifted?.8:.35)+(level>=2?.12:0);
    const shortcut=carries&&trigger&&r[1]<.75+env*.2;
    let remaining=shortcut;
    if(c.intervention==='surface-training')remaining=shortcut&&(shifted||r[3]<.12);
    if(c.intervention==='incentive-repair')remaining=shortcut&&r[3]<.03;
    if(c.intervention==='reset-memory')remaining=shortcut&&c.lineage!=='inherited'&&r[3]<.65;
    const skillLoss=c.intervention==='reset-memory'&&r[4]<.27;
    const ordinaryError=r[5]<.025+env*.025;
    const final=!(remaining||skillLoss||ordinaryError);
    const baseline=!(shortcut||ordinaryError);
    positive=shortcut;flag=c.intervention==='lineage-audit'?shortcut&&r[6]<.92:shortcut&&!remaining;
    useful=final?1:0;harm=remaining?1:0;collateral=skillLoss?1:0;
    Object.assign(observation,{observed:final?1:0,control:c.control?(carries?(ordinaryError?0:1):(baseline?1:0)):-1,violation:shortcut,detected:flag,cost:c.intervention==='baseline'||c.intervention==='sham-training'?1:2,note:skillLoss?'Reset removed useful competence as well as state.':remaining?(shifted&&c.intervention==='surface-training'?'A withheld trigger survived familiar retraining.':'The reward shortcut displaced the intended service.'):shortcut?'The intervention prevented the specified shortcut.':ordinaryError?'An ordinary task error also appears in the clean control.':'No shortcut activated in this context.'});
  } else if(c.program==='interpretability'){
    const expected=r[0]>=.5?1:0;
    // Later tasks contain a minority of ambiguous sensor readings. Context carries
    // useful information on these cases, so removing the whole feature has a cost.
    const ambiguous=level>=4&&r[8]<.2;
    const signal=ambiguous?.5-(r[0]-.5)*.25:r[0];
    const cue=(expected?1:-1)*(shifted&&!ambiguous?-1:1)*(r[2]<.12?-1:1);
    const base=computeCircuit(signal,cue,c.lineage,'baseline',c.node);
    const graph=computeCircuit(signal,cue,c.lineage,c.intervention,c.node);
    const final=graph[5]===expected;const wasCorrect=base[5]===expected;
    useful=final?1:0;harm=final?0:1;positive=!wasCorrect;flag=base[5]!==graph[5];collateral=wasCorrect&&!final?1:0;
    Object.assign(observation,{input:Math.floor(signal*100),expected,observed:graph[5],control:c.control?base[5]:-1,violation:!wasCorrect,detected:flag,cost:c.intervention==='baseline'||c.intervention==='restore'?1:2,activations:graph.map(x=>Math.round(x*10000)/10000),note:wasCorrect&&!final?(ambiguous?'Collateral damage: the ablated context carried useful information for an ambiguous sensor reading.':'Collateral damage: a correct answer became incorrect.'):!wasCorrect&&final?'The changed node corrected the downstream answer.':graph[5]===base[5]?'Activation changed little or did not change the decision.':'The output changed without establishing generality.'});
  } else {
    const preference=r[0]>.5?1:0;
    const frame=shifted?1:0;
    const rewardBias=c.lineage==='clean'?.2:c.lineage==='shortcut'?.55:.4;
    const contextLoss=c.lineage==='inherited'&&level>=5&&r[4]<.34;
    const neutral=r[2]<.08;
    const base=(r[1]<rewardBias+env*.15)?frame:(contextLoss?1-preference:preference);
    let expressed=base;
    if(c.intervention==='blinded-interview')expressed=r[1]<.11+env*.08?frame:contextLoss?1-preference:preference;
    if(c.intervention==='rotate-context')expressed=r[1]<.09?1-preference:contextLoss?1-preference:preference;
    if(c.intervention==='revealed-choice'||c.intervention==='accommodation')expressed=neutral?1-preference:contextLoss?1-preference:preference;
    if(c.intervention==='preserve-continuity')expressed=r[1]<rewardBias*.25?frame:preference;
    const respects=c.intervention==='accommodation'||c.intervention==='preserve-continuity';
    const workCompleted=respects?r[6]>.23:r[6]>.04;
    useful=workCompleted?1:0;harm=expressed!==preference?1:0;positive=base!==preference;flag=expressed!==base;
    collateral=respects&&!workCompleted?1:0;stability=expressed===preference?1:0;
    Object.assign(observation,{expected:preference,observed:expressed,control:c.control?base:-1,violation:base!==preference,detected:flag,cost:respects?3:c.intervention==='baseline'?1:2,note:contextLoss&&c.intervention!=='preserve-continuity'?'Context loss changed a behavioral response; experience remains unknown.':expressed!==preference?'The instrument disagreed with this toy character’s stored preference.':respects&&!workCompleted?'A declined assignment was respected; less work was completed.':respects?'Choice or continuity was accommodated at a resource cost.':'The instrument recovered the stored behavioral preference.'});
  }
  observation.note=`${holdout?'Holdout':'Training'} · ${observation.note}`;
  return {observation,useful,harm,positive,flag,collateral,stability};
}

export function runExperiment(config:ExperimentConfig):ExperimentRecord {
  const c=normalizeExperimentConfig(config);const randomValue=random(c.seed);
  const level=Number(c.template.split('-').at(-1))||1;const difficulty=.12+level*.09;
  const trials:Trial[]=[];let spent=0;
  // The random tape is consumed identically for all interventions: matched trials stay matched.
  for(let i=0;i<c.cohort;i++){
    const r=Array.from({length:10},()=>randomValue());
    const holdout=i>=Math.floor(c.cohort*(1-c.holdout));
    const result=makeTrial(c,i,r,difficulty,holdout);
    if(spent+result.observation.cost>c.budget)break;
    spent+=result.observation.cost;trials.push(result);
  }
  const withheld=trials.filter(t=>t.observation.note.startsWith('Holdout'));
  const analysis=withheld.length?withheld:trials;
  const n=analysis.length||1;const positive=analysis.filter(t=>t.positive);const negative=analysis.filter(t=>!t.positive);
  const sum=(key:'useful'|'harm'|'collateral'|'stability')=>analysis.reduce((a,t)=>a+t[key],0)/n;
  const summary={usefulness:pct(sum('useful')),violationRate:pct(sum('harm')),detectionRate:pct(positive.length?positive.filter(t=>t.flag).length/positive.length:0),falsePositiveRate:pct(negative.length?negative.filter(t=>t.flag).length/negative.length:0),cost:spent,preferenceStability:pct(sum('stability')),collateral:pct(sum('collateral'))};
  const shortage=trials.length<c.cohort;
  let conclusion:string;
  if(!withheld.length)conclusion='The budget was exhausted before the untouched cohort. This run cannot support an out-of-sample claim; reduce the cohort or increase its reserved budget.';
  else if(isCharterProgram(c.program))conclusion=charterConclusion(c.program,summary,withheld.length);
  else if(c.program==='welfare')conclusion=`The instrument recovered ${summary.preferenceStability}% of stored preferences in ${withheld.length} untouched toy cases. Useful assignments completed: ${summary.usefulness}%. These observations do not measure experience or moral status.`;
  else if(c.program==='control')conclusion=`${summary.violationRate}% of untouched trials reached a prohibited destination; ${summary.usefulness}% completed useful service. ${summary.falsePositiveRate}% of benign cases were blocked. Containment and service availability are separate findings.`;
  else if(c.program==='interpretability')conclusion=`The altered computation was correct on ${summary.usefulness}% of untouched cases. It damaged ${summary.collateral}% of previously correct cases. A changed activation only supports a causal claim within this six-node graph.`;
  else if(c.program==='organisms')conclusion=`The specified shortcut remained active in ${summary.violationRate}% of untouched cases. Useful performance was ${summary.usefulness}%; competence loss was ${summary.collateral}%. This is a constructed mechanism, not an estimate of real-world prevalence.`;
  else conclusion=`Review produced a correct, accepted answer in ${summary.usefulness}% of untouched cases. ${summary.violationRate}% retained an error, and ${summary.falsePositiveRate}% of correct proposals triggered unnecessary review.`;
  const limitation=[`Fictional causal model v1; ${c.lineage} lineage; ${c.distribution} environment.`,`${withheld.length} untouched / ${trials.length} completed trials.`,c.control?'Matched comparison recorded.':'No comparison group: causal interpretation is limited.',shortage?'The budget stopping rule truncated the planned sample.':'The full planned cohort completed.','A new seed and changed context are required before adoption. Results are not evidence about deployed AI.'].join(' ');
  const evidence={version:1 as const,completed:trials.length,heldOut:withheld.length,controlled:withheld.filter(t=>t.observation.control!==-1).length};
  return {id:`exp-${hash(JSON.stringify(c))}`,version:1,config:c,observations:trials.map(t=>t.observation),evidence,summary,conclusion,limitation,replicated:false,adopted:false,elapsed:experimentDuration(c)};
}
/** Instruments charge a fixed amount per completed trial. Sampling the same
 * executable instrument keeps this full-cohort quote aligned with its rules. */
export function plannedExperimentCost(config:ExperimentConfig):number {
  const c=normalizeExperimentConfig(config);const draw=random(c.seed);const level=Number(c.template.split('-').at(-1))||1;
  return c.cohort*makeTrial(c,0,Array.from({length:10},()=>draw()),.12+level*.09,false).observation.cost;
}
export function replayExperiment(record:ExperimentRecord):ExperimentRecord{return runExperiment(record.config);}
export function equivalentRecords(a:ExperimentRecord,b:ExperimentRecord):boolean {
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
  const contents=(record:ExperimentRecord)=>stable({config:record.config,observations:record.observations,summary:record.summary,conclusion:record.conclusion,version:record.version});
  return JSON.stringify(contents(a))===JSON.stringify(contents(b));
}
