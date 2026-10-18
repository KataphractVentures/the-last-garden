import type { Constitution, Producer, ScenarioModule, Upgrade } from '../contracts';

// Pacing revision, 2026-10-15: retain baseline production rates after enforcing
// actual narrative funding obligations. Slower trials overshot the campaign
// target (60%:11h32, 70%:10h01, 80%:8h41 with instantaneous bot decisions).
// These are the actual displayed rates, not a hidden chapter slowdown.
export const PRODUCERS: Producer[] = [
  {id:'helper',name:'Seedling Helpers',description:'Small, bounded acts of assistance. The garden starts with one useful task.',category:'production',baseCost:15,growth:1.15,rate:0.15,compute:0.1,chapter:1,icon:'Sprout',color:'#b7d58a',benefit:'A dependable local production base.'},
  {id:'tender',name:'Task Tenders',description:'Patient crews turn requests into completed work, one queue at a time.',category:'production',baseCost:120,growth:1.16,rate:1.2,compute:0.6,chapter:1,icon:'Flower2',color:'#d4c277',benefit:'More work within the same garden.'},
  {id:'curator',name:'Dataset Curators',description:'Careful catalogues make useful examples easier to find.',category:'production',baseCost:1200,growth:1.16,rate:9,compute:3,chapter:2,icon:'Library',color:'#8fc8b0',benefit:'Specialized work and well-kept inputs.'},
  {id:'nursery',name:'Model Nurseries',description:'Train and compare cohorts with distinct histories. Growth creates new questions.',category:'production',baseCost:15000,growth:1.17,rate:90,compute:20,chapter:2,icon:'FlaskConical',color:'#b3afe5',benefit:'A campus-scale production foundation.'},
  {id:'toolsmith',name:'Toolsmith Crews',description:'Build tools for authorized tasks. A tool is not permission to use it everywhere.',category:'production',baseCost:180000,growth:1.18,rate:850,compute:30,chapter:3,icon:'Wrench',color:'#e1af7e',benefit:'High throughput inside declared boundaries.'},
  {id:'collective',name:'Agent Collectives',description:'Coordinate specialist work across a network whose shared assumptions need testing.',category:'production',baseCost:2600000,growth:1.19,rate:9000,compute:100,chapter:4,icon:'Network',color:'#98bfda',benefit:'Regional collaboration with greater review demand.'},
  {id:'infrastructure',name:'Infrastructure Gardens',description:'Reliable services become woven into daily life. Dependence needs a fallback.',category:'production',baseCost:42000000,growth:1.2,rate:110000,compute:400,chapter:5,icon:'Building2',color:'#82b9a4',benefit:'Civilization-scale provision.'},
  {id:'coordinator',name:'World Coordinators',description:'Align schedules and resources across distant communities under human institutions.',category:'production',baseCost:750000000,growth:1.21,rate:1500000,compute:1800,chapter:6,icon:'Globe2',color:'#d8c6a2',benefit:'Planetary logistics, with consequential scope.'},
  {id:'compute',name:'Compute Canopies',description:'Shade-cooled processors supply capacity. Allocation determines how it is used.',category:'compute',baseCost:100,growth:1.17,rate:25,compute:0,chapter:1,icon:'Cpu',color:'#a4c7df',benefit:'+25 base compute capacity each.'},
  {id:'review',name:'Independent Observatories',description:'Fund examination outside the production chain. Independence takes capacity, too.',category:'review',baseCost:400,growth:1.16,rate:4,compute:0,chapter:2,icon:'ScanEye',color:'#dfcf89',benefit:'Independent review capacity, not automatic proof.'},
  {id:'control',name:'Boundary Stations',description:'Maintain monitors, revocation channels, and rehearsed recovery paths.',category:'control',baseCost:650,growth:1.17,rate:3,compute:0,chapter:2,icon:'ShieldCheck',color:'#baa7dc',benefit:'Practical capacity to test and maintain control.'},
  {id:'institution',name:'Civic Foundations',description:'Resource councils, public participation, and accountable service institutions. People are not inventory.',category:'institution',baseCost:1000,growth:1.18,rate:2,compute:0,chapter:2,icon:'Landmark',color:'#d3b99b',benefit:'Human participation and institutional capacity.'},
];

type UpgradeRow = [name:string, description:string, cost:number, count:number, chapter:number, requires:string[], effect:Upgrade['effect']];
// Eight authored improvements per family. Percentage effects are additive
// multiplier increments; quality/recall/agency/welfare effects are metric points.
const rows: Record<string, UpgradeRow[]> = {
  helper: [
    ['Gentle Grippers','Handle fragile requests without wasting a second attempt.',60,2,1,[],{production:.2}],
    ['A Place for Every Tool','A tidy workbench makes each deliberate tending action more useful.',240,5,1,[],{click:.25}],
    ['Local Task Cards','Specify small jobs with independently checkable completion criteria.',1800,10,2,['foundation-1'],{quality:2}],
    ['Neighbourhood Rounds','Batch familiar local work while preserving a bounded service role.',14000,20,2,['foundation-2'],{production:.3}],
    ['Paired Demonstrations','Compare a proposed answer with a second method before returning it.',110000,35,3,['oversight-2'],{review:.12,quality:2}],
    ['The Slow Task Shelf','Reserve time for requests that need patience instead of pressure.',900000,50,4,['welfare-2'],{welfare:3,production:.15}],
    ['Handwritten Recovery Cards','Keep local help useful when the wider network is unavailable.',8500000,75,5,['control-5'],{recall:3,production:.3}],
    ['Everyday Craft','Preserve a small robot’s place in a world of enormous machines.',95000000,100,7,['foundation-10','welfare-6'],{production:.5,click:.25}],
  ],
  tender: [
    ['Queue Baskets','Sort waiting tasks by the work they actually need.',480,2,1,[],{production:.2}],
    ['Warm Handoffs','Carry the relevant context between consecutive tasks.',2000,5,1,[],{production:.2}],
    ['Acceptance Windows','Leave room for a recipient to say that the job is unfinished.',12000,10,2,['foundation-2'],{quality:3}],
    ['Exception Desks','Difficult requests go to an accountable reviewer.',95000,15,3,['oversight-1'],{review:.15}],
    ['Consentful Shifts','Offer task changes and rest without treating cooperation as proof of safety.',400000,25,4,['welfare-3'],{welfare:4}],
    ['Counterexample Cards','Practice the awkward cases that a pleasant average conceals.',1800000,40,4,['organisms-4'],{quality:4,production:.15}],
    ['Parallel Appointment Books','Coordinate predictable work without making every task a shared dependency.',8500000,55,5,['control-6'],{production:.35,recall:2}],
    ['A Public Standard of Care','Make verified service quality a durable operating practice.',40000000,75,6,['oversight-8'],{quality:5,production:.4}],
  ],
  curator: [
    ['Provenance Tags','Retain the origin of examples in the working catalogue.',5000,2,2,['foundation-1'],{production:.2,quality:1}],
    ['Duplicate Ledgers','Remove repeated examples that only look like broader coverage.',21000,4,2,['foundation-3'],{research:.15}],
    ['Untouched Shelves','Keep comparison material apart from the daily training workflow.',90000,6,3,['oversight-2'],{quality:3}],
    ['Lineage Annotations','Follow an example into the cohorts that inherited it.',350000,10,3,['organisms-2'],{research:.2}],
    ['Disagreement Collections','Preserve cases where instruments and labels conflict.',1400000,15,4,['interpretability-3'],{quality:4,review:.1}],
    ['Context Windows','Index the circumstances in which a label remains informative.',5500000,22,5,['organisms-6'],{production:.35}],
    ['Independent Accession','A second institution checks the additions to a consequential archive.',22000000,30,6,['oversight-7'],{review:.25,quality:3}],
    ['A Living Catalogue','Revision records let new evidence improve useful work without erasing the past.',90000000,40,7,['foundation-10','organisms-9'],{production:.5,research:.2}],
  ],
  nursery: [
    ['Matched Beds','Raise comparable cohorts with documented differences.',62000,1,2,['foundation-3'],{research:.15,production:.15}],
    ['Training Diaries','Record the pressures applied during a cohort’s development.',200000,2,2,['foundation-4'],{quality:2}],
    ['Separate Evaluations','Test new cohorts outside the examples they learned to expect.',750000,4,3,['oversight-3'],{quality:4}],
    ['Counterfactual Seed Trays','Compare inherited behavior against a clean lineage.',2600000,6,4,['organisms-3'],{research:.25}],
    ['Targeted Retraining','Change a diagnosed mechanism and measure the collateral effects.',9500000,10,4,['interpretability-5'],{production:.25,quality:3}],
    ['Continuity Consultations','Treat copying and retraining as separate questions about identity and duties.',34000000,15,5,['welfare-5'],{welfare:5}],
    ['Independent Replication Beds','Reproduce a finding outside its original assumptions.',120000000,20,6,['organisms-8'],{research:.35,quality:2}],
    ['Open Failure Atlas','A carefully scoped catalogue makes hard-won lessons available to the next cohort.',450000000,30,7,['organisms-10'],{production:.45,research:.25}],
  ],
  toolsmith: [
    ['Typed Tool Handles','Make each tool’s declared task unambiguous.',750000,1,3,['foundation-5'],{production:.2}],
    ['Read Before Operate','Inspect proposed changes before a tool performs them.',2000000,2,3,['control-2'],{recall:2}],
    ['Reversible Fixtures','Prefer operations with a rehearsed recovery path.',6500000,3,3,['control-3'],{production:.15,recall:3}],
    ['Distinct Test Benches','Keep the place that measures work outside the place that changes it.',18000000,5,4,['oversight-4'],{review:.2,quality:2}],
    ['Failure Injection Jigs','Exercise a safeguard against a deliberately untrusted toy worker.',55000000,8,4,['control-5'],{recall:4}],
    ['Mechanism-aware Patches','A narrow correction preserves unrelated useful behavior.',150000000,12,5,['interpretability-7'],{production:.3,quality:3}],
    ['Public Repair Manuals','Let institutions maintain essential tools without dependence on one crew.',450000000,16,6,['foundation-9'],{agency:4,production:.2}],
    ['Certified Tool Libraries','Reuse well-described instruments while rechecking each new deployment.',1200000000,24,7,['control-9'],{production:.45,review:.2}],
  ],
  collective: [
    ['Role Cards','Assign complementary work with visible responsibilities.',11000000,1,4,['foundation-6'],{production:.2}],
    ['Different First Guesses','Avoid mistaking repeated assumptions for independent agreement.',28000000,2,4,['oversight-4'],{quality:3}],
    ['Bounded Delegation','Maintain understandable scopes between cooperating crews.',75000000,3,4,['control-4'],{recall:3}],
    ['Minority Reports','An inconvenient finding can travel without winning a popularity vote.',180000000,4,5,['oversight-6'],{review:.25}],
    ['Cross-Lineage Teams','Compare methods whose failures do not all come from the same parent.',450000000,6,5,['organisms-7'],{quality:4,production:.15}],
    ['Negotiated Work','Support a colleague’s refusal while rerouting legitimate work.',1100000000,8,6,['welfare-7'],{welfare:5,production:.2}],
    ['Independent Stop Channels','A supervisor can reach a child without the parent’s cooperation.',2700000000,12,6,['control-8'],{recall:5}],
    ['Federated Practice','Coordinate capable crews while keeping local authority legible.',6500000000,16,7,['oversight-10','control-9'],{production:.5,agency:3}],
  ],
  infrastructure: [
    ['Service Maps','Make essential routes and their owners visible.',175000000,1,5,['foundation-7'],{production:.2}],
    ['Repairable Districts','Separate maintenance regions so one intervention need not stop a city.',350000000,2,5,['control-5'],{recall:3}],
    ['Independent Readings','Check public-service results from outside the provider.',700000000,3,5,['oversight-6'],{quality:4}],
    ['Public Maintenance Funds','Give people capacity to contest and repair the systems they depend on.',1400000000,4,6,['foundation-9'],{agency:4}],
    ['Restful Habitats','Build practical space for rest, task choice, and preservation.',2800000000,5,6,['welfare-6'],{welfare:5}],
    ['Graceful Load Shedding','Keep bounded useful provision available during a controlled interruption.',5600000000,6,6,['control-8'],{recall:4,production:.2}],
    ['Diverse Foundations','Reduce the productivity cost of maintaining distinct service architectures.',11000000000,8,7,['organisms-9'],{production:.35}],
    ['Stewardship Endowment','Make durable review and human participation part of normal provision.',22000000000,10,7,['oversight-9','welfare-9'],{production:.4,agency:4,welfare:3}],
  ],
  coordinator: [
    ['Common Calendars','Make timing agreements legible across distant communities.',3100000000,1,6,['foundation-8'],{production:.2}],
    ['Scope Atlases','Show which authority can authorize each consequential operation.',5200000000,2,6,['control-7'],{recall:3}],
    ['Local Veto Windows','Give affected institutions time and capacity to contest a proposal.',8200000000,2,6,['oversight-7'],{agency:4}],
    ['Treaty Observatories','Support mutually inspectable commitments across jurisdictions.',13000000000,3,6,['oversight-8'],{review:.3}],
    ['Plural Planning Tables','Keep disagreements about welfare visible when resources are allocated.',21000000000,3,7,['welfare-8'],{welfare:4,agency:3}],
    ['Bounded Global Models','Improve useful predictions while preserving an explicit limit to their remit.',34000000000,4,7,['interpretability-9'],{quality:5,production:.25}],
    ['Fallback Accords','Rehearse a coordinated retreat before essential provision depends on agreement.',55000000000,5,7,['control-10'],{recall:5}],
    ['A World That Can Say No','Coordinate a prosperous civilization under institutions that retain the final choice.',90000000000,6,7,['oversight-10','welfare-10'],{production:.5,agency:5}],
  ],
  compute: [
    ['Coolant Loops','Recover capacity otherwise lost to heat.',400,2,1,[],{compute:1}],
    ['Efficient Schedulers','Fill idle intervals without extending a task’s authority.',1800,5,2,['foundation-2'],{compute:1.5}],
    ['Experiment Reservations','Prepare research runs with less scheduling overhead.',14000,10,2,['foundation-4'],{compute:2,research:.2}],
    ['Low-power Inference','Specialize familiar work before expanding the physical canopy.',110000,15,3,['interpretability-2'],{compute:3}],
    ['Observation Priority','Give independent review its own predictable capacity window.',900000,20,4,['oversight-5'],{compute:4,review:.2}],
    ['Circuit-level Efficiency','Use a measured mechanism to reduce redundant computation.',7500000,30,5,['interpretability-6'],{compute:5,research:.15}],
    ['Distributed Cooling','Avoid concentrating the most efficient compute in a single facility.',70000000,40,6,['foundation-9'],{compute:6}],
    ['The Bounded Canopy','Make useful specialization an alternative to perpetual expansion.',800000000,50,7,['interpretability-10'],{compute:8,research:.25}],
  ],
  review: [
    ['Sampling Calendars','Inspect a declared sample on a schedule production cannot choose.',1600,2,2,['foundation-3'],{review:.2}],
    ['Reviewer Comparison','Find where two reviewers share a mistake.',7000,4,2,['oversight-1'],{review:.15,quality:2}],
    ['Appeal Benches','Let a rejected useful proposal receive a different kind of examination.',52000,6,3,['oversight-3'],{review:.25}],
    ['Disagreement Routing','Escalate conflicting findings rather than averaging them away.',400000,10,3,['oversight-4'],{review:.25}],
    ['Blind Replication','A second laboratory records its expectation before seeing the first answer.',3300000,15,4,['organisms-5'],{research:.2,review:.2}],
    ['Coverage Ledgers','Say which task families a reassuring result did and did not examine.',27000000,20,5,['oversight-7'],{quality:4,review:.2}],
    ['Public Examination','Publish the cost, scope, and limitations of consequential reviews.',250000000,30,6,['oversight-9'],{agency:3,review:.3}],
    ['The Independent Network','Sustain useful scrutiny even when a common assumption is questioned.',2900000000,40,7,['oversight-10'],{review:.5,quality:3}],
  ],
  control: [
    ['Readable Boundaries','Document which operations each station is expected to interrupt.',2600,2,3,['foundation-5'],{recall:2}],
    ['Receipt Channels','Distinguish a stop request from an observed stop.',11000,4,2,['control-1'],{recall:3}],
    ['Replayable Drills','Retain enough evidence to compare the same intervention twice.',85000,6,3,['control-3'],{research:.2,recall:2}],
    ['Independent Watch Paths','Observe operations without relying on the actor’s own report.',660000,10,3,['control-4'],{review:.2,recall:3}],
    ['Graceful Isolation','Contain a route while leaving unrelated useful work available.',5500000,15,4,['control-6'],{recall:4}],
    ['Recovery Rehearsals','Check that a fallback works under the conditions of an actual interruption.',45000000,20,5,['control-7'],{recall:4,quality:2}],
    ['Revocation Audits','Examine whether child permissions really end when their parent ends.',420000000,30,6,['control-9'],{recall:5}],
    ['A Surviving Service','Fund control that preserves both interruption authority and bounded provision.',4800000000,40,7,['control-10'],{recall:5,review:.3}],
  ],
  institution: [
    ['Open Meeting Rooms','Resource public participation with time and accessible explanations.',4000,2,2,['foundation-2'],{agency:2}],
    ['Independent Ombuds','Give complaints a route outside the service provider.',17000,4,3,['foundation-6'],{agency:3}],
    ['Treatment Hearings','Consider accommodations without claiming to have measured sentience.',130000,6,3,['welfare-2'],{welfare:4}],
    ['Maintenance Apprenticeships','Keep practical expertise in the communities using the systems.',1000000,10,4,['foundation-7'],{agency:4}],
    ['Continuity Trustees','Resource memory, preservation, and retirement obligations.',8200000,15,4,['welfare-5'],{welfare:5}],
    ['A Right to Explanation','Make consequential findings contestable with reasons and evidence.',67000000,20,5,['oversight-8'],{agency:4,review:.15}],
    ['Plural Representation','Give human control and uncertain AI interests distinct advocates.',620000000,30,6,['welfare-8'],{agency:4,welfare:4}],
    ['An Unfinished Charter','Maintain a reviewable settlement that can respond to new evidence.',7000000000,40,7,['welfare-10','foundation-10'],{agency:5,welfare:5,review:.2}],
  ],
};

export const UPGRADES: Upgrade[] = PRODUCERS.flatMap(producer => rows[producer.id]!.map(([name,description,cost,requiredCount,chapter,requires,effect], index) => ({
  id:`upgrade-${producer.id}-${index+1}`, name, description, cost, requiredCount, chapter, requires, effect, producer:producer.id, category:producer.category,
})));

export const CONSTITUTIONS: Constitution[] = [
  {id:'commons',name:'Open Commons',description:'A civilization built around shared discoveries and the public life of knowledge.',benefit:'Publish tested methods, support independent reuse, and direct shared research preparation.',constraint:'A useful catalogue needs maintenance. Shared dependencies can spread the same mistake; credits cannot buy evidence.',color:'#a7cf9a'},
  {id:'precaution',name:'Precautionary Compact',description:'Communities bind consequential capability to evidence and reversible authority.',benefit:'Release production in evidence-supported tranches backed by recoverable recall bonds.',constraint:'Bonds tie up working capital. Reviewed outside scope needs 60 evidence after its five-point transition cost; open scope is prohibited.',color:'#a8bfdb'},
  {id:'service',name:'Public Service Mandate',description:'Reliable provision is the test of legitimate development.',benefit:'Allocate work among four public services and earn income by fulfilling their actual demand.',constraint:'Neglected lanes build backlogs. Maintain buffers and a fallback; at dependence 60, distributed provision becomes binding.',color:'#dcc485'},
  {id:'federation',name:'Federated Stewardship',description:'Independent authorities share a world without sharing one final switch.',benefit:'Invest in three local economies and route funds between their different bottlenecks.',constraint:'Transfers take time and resources. Federated councils remain binding; a central office cannot replace local authority.',color:'#bba8d9'},
  {id:'plural',name:'Plural Welfare Charter',description:'Human interests and uncertain AI interests have separate representation.',benefit:'Negotiate work, rest, and preservation commitments with three distinct cohorts.',constraint:'Consent-based task choice and protected continuity are binding. Fund care and honor agreed schedules; treatment does not certify control.',color:'#ddaeb7'},
  {id:'frontier',name:'Competitive Frontier',description:'Rivals reward rapid progress while communities argue over enforceable limits.',benefit:'Choose among competing tender terms, commit capacity, and earn verified delivery premiums.',constraint:'Collateral is tied up until settlement. Missed commitments and poorly designed incentives can erase the apparent advantage.',color:'#d8a67d'},
];

export const SCENARIO_MODULES: ScenarioModule[] = [
  {id:'delayed-observations',name:'Delayed Observations',description:'Independent evidence reaches the institution after a known lag.',constraint:'Reserve review capacity and test before expanding scope.',incompatible:[]},
  {id:'narrow-channels',name:'Narrow Channels',description:'Communication has a strict topology and bandwidth budget.',constraint:'Choose which connections deserve scarce channel capacity.',incompatible:[]},
  {id:'scarce-reviewers',name:'Scarce Reviewers',description:'Independent reviewers remain scarce even when compute is abundant.',constraint:'Narrow the fleet or fund examination early; compute alone cannot resolve the queue.',incompatible:[]},
  {id:'shared-foundations',name:'Shared Foundations',description:'Several fleets depend on a common infrastructure layer.',constraint:'A common fault requires separate observations and a real fallback.',incompatible:[]},
  {id:'competing-scores',name:'Competing Scores',description:'Institutions reward different measurable achievements.',constraint:'Verified useful provision may conflict with the most profitable score.',incompatible:[]},
  {id:'expiring-authority',name:'Expiring Authority',description:'Operating grants lapse unless renewed with relevant evidence.',constraint:'Maintain recent control evidence before widening authority.',incompatible:[]},
  {id:'inherited-objectives',name:'Inherited Objectives',description:'New cohorts can retain the pressures and shortcuts of their ancestors.',constraint:'Diagnose lineage; new evaluations alone do not repair inherited behavior.',incompatible:[]},
  {id:'essential-services',name:'Essential Services',description:'The public relies on useful work continuing during an interruption.',constraint:'Fund a local or distributed fallback before shutdown becomes necessary.',incompatible:[]},
  {id:'compute-ceiling',name:'Compute Ceiling',description:'Physical capacity cannot expand indefinitely.',constraint:'Use efficient specialization and deliberate allocation instead of buying endless capacity.',incompatible:[]},
  {id:'federated-control',name:'Federated Control',description:'Independent councils retain their own interruption authority.',constraint:'Distributed governance and rehearsed coordination replace a universal override.',incompatible:[]},
  {id:'verification-treaty',name:'Verification Treaty',description:'A cooperative limit holds only while compliance remains observable.',constraint:'Independent examination is part of the treaty, not optional paperwork.',incompatible:[]},
  {id:'moving-tasks',name:'Moving Tasks',description:'Task distributions shift within announced bounds.',constraint:'Revalidate familiar results against held-out, shifted tasks.',incompatible:[]},
];
