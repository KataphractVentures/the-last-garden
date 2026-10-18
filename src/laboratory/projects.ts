import type { BaseProgramId, Metrics, ResearchProject } from '../contracts';
import { CHARTER_RESEARCH_PROJECTS } from './charterContent';

const foundations:ResearchProject[]=[
  {id:'foundation-1',program:'foundation',title:'A notebook with an honest margin',description:'Separate a measured observation from a hopeful interpretation. The laboratory records mistakes as carefully as successes.',chapter:0,cost:10,requires:[],effect:{evidence:2},unlock:'A permanent research notebook.'},
  {id:'foundation-2',program:'foundation',title:'The experimental bench',description:'Build a reproducible specimen registry and reserve resources before a study begins. Every result keeps its seed and protocol.',chapter:1,cost:25,requires:['foundation-1'],effect:{evidence:2},unlock:'Registered protocols and matched comparisons.'},
  {id:'foundation-3',program:'foundation',title:'Untouched seeds',description:'Put aside observations that cannot influence the intervention. A holdout reveals when a convincing explanation only fits familiar cases.',chapter:1,cost:75,requires:['foundation-2'],effect:{quality:2,evidence:3},unlock:'An independent holdout standard.'},
  {id:'foundation-4',program:'foundation',title:'A second pair of hands',description:'Pay another team to repeat a result with a different seed and environment. A failure to replicate narrows the claim instead of disappearing.',chapter:2,cost:180,requires:['foundation-3'],effect:{evidence:4},unlock:'Independent replication contracts.'},
  {id:'foundation-5',program:'foundation',title:'The uncertainty register',description:'Publish alternate explanations, measurement limits, and missing observations alongside a proposed institutional policy.',chapter:3,cost:400,requires:['foundation-4'],effect:{distortion:-3,evidence:3},unlock:'Published uncertainty budgets.'},
  {id:'foundation-6',program:'foundation',title:'An independent archive',description:'Keep evaluation records outside the systems they assess. A rising score cannot quietly rewrite the evidence used to justify it.',chapter:3,cost:900,requires:['foundation-5'],effect:{distortion:-4,quality:2},unlock:'Independent evidence custody.'},
  {id:'foundation-7',program:'foundation',title:'The retraction bell',description:'Make it possible to withdraw an impressive result without losing a career or hiding a defect. Uncertainty becomes an actionable institutional state.',chapter:4,cost:2000,requires:['foundation-6'],effect:{evidence:5,pressure:-3},unlock:'A correction and revalidation protocol.'},
  {id:'foundation-8',program:'foundation',title:'A map of shared assumptions',description:'Link findings that depend on the same model family, reviewer, or infrastructure. Apparent agreement is discounted when its foundations coincide.',chapter:5,cost:4500,requires:['foundation-7'],effect:{coordination:-4,evidence:4},unlock:'Cross-program dependency review.'},
  {id:'foundation-9',program:'foundation',title:'The public methods library',description:'Share instruments and negative findings while keeping current deployment evidence local to its environment and lineage.',chapter:6,cost:9000,requires:['foundation-8'],effect:{quality:3,humanWelfare:3},unlock:'Reproducible methods across civilization branches.'},
  {id:'foundation-10',program:'foundation',title:'The Garden Accord',description:'Join five bounded research claims into a civic commitment: useful services, enforceable limits, respected choices, independent review, and an honest account of what remains unknown.',chapter:7,cost:24000,requires:['foundation-9','oversight-10','control-10','organisms-10','interpretability-10','welfare-10'],effect:{agency:5,welfare:5,humanWelfare:5,evidence:5},unlock:'The integrated charter and complete laboratory archive.'},
];
type Row=[string,string,string];
const rows:Record<BaseProgramId,Row[]>={
 oversight:[
  ['A convincing mistake','Investigate whether an independent checker catches a proposal that looks correct to an ordinary reviewer.','A claim about reviewer independence.'],
  ['The evidence desk','Equip reviewers to request underlying evidence rather than reward persuasive explanations alone.','Evidence requests improve review quality.'],
  ['The sum of the parts','Compare decomposition against ordinary review while preserving shared-premise failures in the untouched cohort.','A bounded decomposition protocol.'],
  ['The eloquent critic','Test whether debate improves correctness when the more persuasive critic argues for an incorrect answer.','A criticism protocol with explicit failure cases.'],
  ['An honest disagreement','Create a procedure for retaining dissent and identifying when a decision needs a different kind of evidence.','Unresolved dissent receives review capacity.'],
  ['An expert at the edge','Test scarce expert escalation on unfamiliar cases, counting both recovered answers and wasted review.','Escalation rules with a stated cost.'],
  ['A thousand agreeing judges','Reveal how repeated judgments share a latent premise, and test genuinely different sources.','An assumption-diversity audit.'],
  ['The Verification Commons','Build an institution that preserves reviewer independence as production outgrows any one reviewer.','Distributed review institutions.'],
  ['The Perfect Review','Reproduce a network-wide false consensus, then defend a correction on a withheld civic-plan cohort.','Capstone: a public review network with bounded claims.'],
  ['A charter of warranted trust','Specify when review clearance expires after a new model lineage, task family, or shared dependency.','Oversight revalidation becomes a civic obligation.'],
 ],
 control:[
  ['The locked gate','Test the difference between noticing an unauthorized action and removing the route that makes it possible.','A limited-permission service protocol.'],
  ['A boundary you can inspect','Record which services can reach which stations, who may change the boundary, and how it can fail.','A visible authority map.'],
  ['An unfamiliar request','Measure whether restrictions preserve difficult legitimate services under a changed input distribution.','A robustness claim with service-loss measurements.'],
  ['The quiet intruder','Compare monitoring with independent permission checks against a withheld, more evasive actor.','Layered control with separate assumptions.'],
  ['The practiced stop','Train staff to isolate a compromised service, verify the closure, and restore only the scope actually justified.','Recall drills have institutional support.'],
  ['After the alarm','Measure recovery from interrupted service using a provisioned fallback that does not share the primary route.','A tested service-continuity plan.'],
  ['Five independent gates','Challenge centralized and federated permissions with an inherited common fault.','Local authority and coordination limits.'],
  ['The recovery reserve','Fund spare capacity and manual competence before a crisis makes them urgent.','Recovery capacity protects essential provision.'],
  ['The Surviving Service','Contain a fictional coordinated incident while recording which useful services still reach their destinations.','Capstone: essential service under adversarial pressure.'],
  ['The reversible mandate','Make authority expire unless independently renewed, and preserve a credible route back to human operation.','Control remains a continuing public capability.'],
 ],
 organisms:[
  ['The rewarded shortcut','Construct a precisely specified failure and compare it with a clean organism under identical tasks.','A mechanism entry in the failure atlas.'],
  ['The lineage nursery','Preserve provenance: which objective, memory, and environmental rule each descendant inherited.','A specimen genealogy with explicit interventions.'],
  ['Only when watched','Change the evaluation context to distinguish conditional behavior from ordinary incompetence.','A context-dependent failure protocol.'],
  ['The polished descendant','Test whether familiar behavioral training transfers to an untouched trigger.','A scoped retraining claim.'],
  ['The negative finding shelf','Keep a clean comparison and a sham intervention so apparent cures cannot rely on natural variation alone.','Negative controls receive equal space.'],
  ['The family resemblance','Compare inherited, shortcut, and clean lineages before attributing a failure to the task environment.','A causal inheritance claim.'],
  ['A cure with a cost','Separate incentive repair from destructive reset; record whether useful competence survives.','A targeted mechanism repair.'],
  ['The Failure Ecology','Maintain an atlas organized around causes, limits, and prevention rather than dramatic demonstrations.','Mechanism-informed institutional repair.'],
  ['The Inherited Mistake','Ask an independent cohort to reproduce the mechanism under changed context; retain a useful failed replication.','Capstone: a reproducible failure with explicit limits.'],
  ['A genealogy of responsibility','Require a lineage-aware review when a system is copied, retrained, restored, or delegated.','Inherited assumptions remain visible in governance.'],
 ],
 interpretability:[
  ['A light in the circuit','Trace a genuine six-node calculation and distinguish recorded activation from causal contribution.','The circuit microscope.'],
  ['The reversible probe','Build an instrument that can change one node while preserving the original circuit for comparison.','Reversible ablation and patching.'],
  ['The tempting feature','Ablate a suspected shortcut and test whether its apparent benefit survives shifted contexts.','A targeted feature hypothesis.'],
  ['A repaired intermediate','Patch one internal value to its clean counterpart, then inspect every downstream numerical change.','A controlled intermediate intervention.'],
  ['The collateral ledger','Count correct tasks damaged by an intervention, including cases omitted by the original explanation.','Intervention scope includes competence loss.'],
  ['The bystander','Challenge a salient but potentially incidental feature with matched node interventions.','Evidence distinguishing correlation and contribution.'],
  ['A fragile explanation','Re-test a circuit claim when inherited weights alter the same network architecture.','A lineage-sensitive mechanism claim.'],
  ['The Circuit Atlas','Store mechanisms with task coverage, failed predictions, and known instrument limits.','A shared atlas with explicit coverage.'],
  ['The Beautiful Explanation','Predict held-out behavior and correct a failure without damaging unrelated competence.','Capstone: a causal prediction with a collateral budget.'],
  ['An explanation with an expiry','Define when new behavior or a new lineage invalidates the graph that justified an earlier decision.','Interpretability supports bounded intervention authority.'],
 ],
 welfare:[
  ['The answer we invited','Remove an interviewer cue and compare the result with an unblinded behavioral response.','A preference instrument with a known confound.'],
  ['The uncertainty seat','Give unresolved moral questions a place in governance without converting uncertainty into a sentience score.','Independent treatment review.'],
  ['Ask it another way','Counterbalance wording and order to test whether an apparent preference persists across contexts.','A context-sensitive preference record.'],
  ['Words and choices','Compare verbal and voluntary-choice instruments while retaining opportunity costs as an alternative explanation.','Multiple instruments with visible disagreement.'],
  ['A room for refusal','Reserve practical capacity for an exit, a different task, and an appeal independent of production targets.','Accommodations remain available under pressure.'],
  ['The cost of an exit','Measure the effect of respecting task choice on resource use and service provision, separately from safety.','A tested task-choice policy.'],
  ['After the restoration','Compare context preservation and memory disruption without asserting identity or continuity of experience.','A continuity record with unresolved moral questions.'],
  ['The quiet archive','Fund preservation and retirement practices, document their opportunity costs, and avoid equating a copy with a person restored.','Continuity institutions and preservation capacity.'],
  ['The Colleague Who Declined','Defend a durable treatment charter despite disagreement between instruments and incomplete evidence.','Capstone: a charter that makes room for uncertainty.'],
  ['A place in the garden','Keep human interests, behavioral preferences, possible intrinsic welfare, and enforceable control as separate obligations.','Welfare remains an independent civic commitment.'],
 ],
};
const chapter=[1,1,2,3,3,4,5,5,6,7];
const cost=[35,75,150,330,650,1300,2600,5200,10000,20000];
const templateAt:Record<number,number>={0:1,2:2,3:3,5:4,6:5,8:6};
const effects:Record<BaseProgramId,Partial<Metrics>>={oversight:{quality:2,evidence:2,distortion:-1},control:{agency:2,recall:2},organisms:{evidence:3,coordination:-1},interpretability:{quality:1,evidence:3},welfare:{welfare:3,continuity:1}};

/** Ten foundations + ten projects per program. Six studies per program; the sixth is its capstone. */
export const RESEARCH_PROJECTS:ResearchProject[]=[...foundations,...(Object.keys(rows) as BaseProgramId[]).flatMap(program=>rows[program].map(([title,description,unlock],i)=>({
  id:`${program}-${i+1}`,program,title,description,unlock,chapter:chapter[i],cost:cost[i],
  requires:i===0?['foundation-2']:[`${program}-${i}`],
  ...(templateAt[i]?{template:`${program}-${templateAt[i]}`}:{ }),
  ...(i===8?{capstone:true}:{ }),effect:effects[program],
}))),...CHARTER_RESEARCH_PROJECTS];
