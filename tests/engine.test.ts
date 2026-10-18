import test from 'node:test';
import assert from 'node:assert/strict';
import Decimal from 'decimal.js';
import { createGame, tick, dispatchCommand, getRates, getCost, endingEligibility, prestigeEligibility, scenarioFeasible, actionEligibility, policyEligibility, formatAmount } from '../src/engine/index';
import type { Command, ConstitutionId, ExperimentConfig, GameState } from '../src/contracts';
import { STORY_EVENTS } from '../src/content/story';
import { CONSTITUTIONS, SCENARIO_MODULES } from '../src/content/economy';
import { runExperiment } from '../src/laboratory/experiments';
import { STORY_COST_MULTIPLIER } from '../src/engine/storyEconomy';
import { activeResearchProjects } from '../src/laboratory/catalog';
import { activeProgramIds } from '../src/laboratory/programs';
import { EVIDENCE_SOFT_LIMIT } from '../src/laboratory/evidence';
import { prepareOperatingFixture } from './operatingFixture';

function capstoneRecords(): GameState['experiments'] {
  // Outcome fixtures retain actual seeded observations and linked replications;
  // owning a project or setting a mastery flag is no longer evidence by itself.
  return activeProgramIds('commons').flatMap((program, i) => {
    const config: ExperimentConfig = { program, template: `${program}-6`, seed: 700 + i * 10, cohort: 128, budget: 1024,
      holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'shortcut', prediction: 'The unchanged comparison may preserve the specified failure across environments.', control: true };
    const original = runExperiment(config); original.adopted = true; original.replicated = true;
    const shifted = runExperiment({ ...config, seed: config.seed + 1, distribution: 'shifted', replicateOf: original.id }); shifted.replicated = true;
    const adversarial = runExperiment({ ...config, seed: config.seed + 2, distribution: 'adversarial', replicateOf: original.id }); adversarial.replicated = true;
    return [original, shifted, adversarial];
  });
}

function fixture(chapter = 7): GameState {
  const s = createGame(1701, 1_700_000_000_000);
  s.chapter = chapter; s.tokens = '1e12'; s.research = '1e8'; s.lifetime = '1e12'; s.useful = '1e10';
  s.pendingEvent = null; s.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, 'fixture']));
  s.metrics = { quality: 95, distortion: 0, agency: 85, welfare: 85, dependence: 35, evidence: 90, recall: 95, coordination: 85, pressure: 15, continuity: 90, humanWelfare: 85, reviewQueue: 0 };
  s.policies = { contract: 'verified', communication: 'reviewed', external: 'blocked', evaluation: 'independent', welfare: 'consent', continuity: 'protected', fallback: 'distributed', governance: 'council' };
  s.mastered = activeProgramIds('commons');
  if (chapter === 7) s.experiments = capstoneRecords();
  s.projects = activeResearchProjects('commons').map(project => project.id); s.viableSeconds = 180; s.certificateProgress = 60;
  s.charter!.appliedTier = 6; // Isolated ending fixture; full applied campaigns are verified by the recorded journeys.
  if (chapter === 7 && s.charter?.kind === 'commons') {
    const source = s.experiments.find(record => record.config.template === 'stewardship-6')!.id;
    s.charter.data.methods = [
      { id: 1, program: 'oversight', source, dependencies: [], maintenance: 100, uses: 0, retired: false },
      { id: 2, program: 'stewardship', source, dependencies: [1], maintenance: 100, uses: 0, retired: false },
    ];
    s.charter.serial = 2;
  }
  s.flags.push('fresh-evidence:0');
  return chapter===7?prepareOperatingFixture(s,{garden:true}):s;
}
function apply(s: GameState, command: Command, id?: string): GameState {
  const result = dispatchCommand(s, command, id); assert.equal(result.ok, true, result.message); return result.state;
}
const protocol: ExperimentConfig = { program: 'control', template: 'control-1', seed: 11, cohort: 24, budget: 128, holdout: .25, intervention: 'least-privilege', distribution: 'adversarial', lineage: 'shortcut', prediction: 'Restricting the reachable station blocks the prohibited route.', control: true };

test('fresh game uses the first chapter, provides usable click input, and never mints an unsolicited grant', () => {
  const s = createGame(7, 0); assert.equal(s.chapter, 1); assert.equal(s.tokens, '0'); assert.equal(s.legacy.cycle, 0);
  const next = apply(s, { type: 'tend' }); assert.equal(next.tokens, '1'); assert.equal(s.tokens, '0');
});

test('bulk preview, exact affordability, debit, recorded basis, and resale use one atomic decimal rule', () => {
  let s = fixture(1); s.tokens = '1000';
  const quote = getCost(s, 'helper', 10); assert.equal(quote.quantity, 10);
  const expected = new Decimal(15).mul(new Decimal(1.15).pow(10).sub(1)).div(.15).ceil();
  assert.equal(quote.cost, expected.toString());
  const before = s.tokens; s = apply(s, { type: 'buy', id: 'helper', quantity: 10 }, 'purchase-1');
  assert.equal(new Decimal(before).sub(s.tokens).toString(), quote.cost); assert.equal(s.purchaseBasis.helper, quote.cost);
  const duplicate = dispatchCommand(s, { type: 'buy', id: 'helper', quantity: 10 }, 'purchase-1'); assert.equal(duplicate.ok, false); assert.equal(duplicate.state, s);
  s = apply(s, { type: 'sell', id: 'helper', quantity: 10 });
  assert(new Decimal(s.tokens).lt(before)); assert.equal(s.purchaseBasis.helper, '0'); assert.equal(s.producers.helper, 0);
  const boundary = fixture(1); boundary.tokens = quote.cost;
  assert.equal(getCost(boundary, 'helper', 'max').quantity, 10);
  boundary.tokens = new Decimal(quote.cost).sub(1).toString(); assert.equal(getCost(boundary, 'helper', 'max').quantity, 9);
});

test('rejected purchases and invalid allocation are immutable', () => {
  const s = createGame();
  const result = dispatchCommand(s, { type: 'buy', id: 'helper', quantity: 10 }); assert.equal(result.ok, false); assert.equal(result.state, s);
  assert.equal(dispatchCommand(s, { type: 'allocation', allocation: { production: 1, research: .5, review: 0 } }).ok, false);
  assert.equal(dispatchCommand(s, { type: 'allocation', allocation: { production: NaN, research: 0, review: 0 } }).ok, false);
});

test('unfunded story commitments are repaid from new production rather than disappearing', () => {
  let s = createGame(); s.pendingEvent = 'first_request';
  const cost = new Decimal(5).mul(STORY_COST_MULTIPLIER);
  s.tokens = cost.mul('.4').toString();
  const pledged = cost.mul('.6');
  assert(pledged.lte(4), 'This fixture repays the obligation within one four-action tending window.');
  s = apply(s, { type: 'choose', event: 'first_request', choice: 'check' });
  assert.equal(s.tokens, '0'); assert(s.flags.includes(`story-debt:${pledged.toString()}`));
  for (let earned = 1; earned <= 4; earned++) {
    s = apply(s, { type: 'tend' });
    assert.equal(s.tokens, Decimal.max(0, new Decimal(earned).sub(pledged)).toString());
    assert(s.flags.includes(`story-debt:${Decimal.max(0, pledged.sub(earned)).toString()}`));
    assert.equal(s.lifetime, String(earned));
  }
  assert(s.flags.includes('story-debt:0'));
});

test('all active and assisted tending shares the four-per-second ceiling', () => {
  let s = fixture(1); s.tokens = '0'; s.lifetime = '0'; s.useful = '0';
  for (let i = 0; i < 4; i++) s = apply(s, { type: 'tend' });
  assert.equal(s.tokens, '4'); assert.equal(dispatchCommand(s, { type: 'tend' }).ok, false);
  s = apply(s, { type: 'assisted' }); s = tick(s, .75);
  assert.equal(s.tokens, '4'); s = tick(s, .25); assert.equal(s.tokens, '5');
  for (let i = 0; i < 3; i++) s = apply(s, { type: 'tend' });
  assert.equal(dispatchCommand(s, { type: 'tend' }).ok, false); assert.equal(s.tokens, '8');
});

test('30, 60, and 144 Hz schedules produce identical quarter-step worlds', () => {
  const base = fixture(3); base.producers.helper = 12; base.producers.compute = 3; base.producers.review = 2;
  const end: GameState[] = [];
  for (const fps of [30, 60, 144]) { let s = base; for (let i = 0; i < fps * 5; i++) s = tick(s, 1 / fps); end.push(s); }
  for (const s of end) { assert.equal(s.elapsed, 5); assert.equal(s.tokens, end[0].tokens); assert.deepEqual(s.metrics, end[0].metrics); }
});

test('long and segmented intervals consume the same independent review work', () => {
  const base = fixture(4); base.producers.nursery = 20; base.producers.compute = 3; base.metrics.reviewQueue = 80;
  const whole = tick(base, 30); let split = base; for (let i = 0; i < 120; i++) split = tick(split, .25);
  assert.equal(whole.tokens, split.tokens); assert.equal(whole.metrics.reviewQueue, split.metrics.reviewQueue); assert.deepEqual(whole.metrics, split.metrics);
});

test('offline progress stops at the first newly reached decision and freezes rewards and risks together', () => {
  let s = createGame(9, 0); s.producers.helper = 100; s.producers.compute = 100;
  const offline = tick(s, 10000, true); assert.equal(offline.pendingEvent, 'first_request'); assert(offline.elapsed < 10000); assert(offline.offlineSummary?.includes('conversation'));
  const again = tick(offline, 10000, true); assert.equal(again.tokens, offline.tokens); assert.equal(again.elapsed, offline.elapsed);
  s = fixture(7); s.paused = true; const paused = tick(s, 100, true); assert.equal(paused.tokens, s.tokens); assert.deepEqual(paused.metrics, s.metrics);
});

test('offline accrual is clamped to twelve hours, including a multi-day absence', () => {
  const s = fixture(1); s.pendingEvent = null;
  const result = tick(s, 10 * 86400, true); assert.equal(result.elapsed, 43200); assert(result.offlineSummary?.includes('twelve hours'));
});

test('a misleading audit observes a problem but does not repair inherited behavior', () => {
  const base = fixture(4); base.metrics.distortion = 45; base.policies.external = 'open'; base.policies.evaluation = 'shared'; base.metrics.recall = 40;
  const drilled = apply(base, { type: 'drill' }); assert.equal(drilled.metrics.distortion, 45); assert(drilled.metrics.recall < 75);
  assert.equal(drilled.metrics.evidence, 92);
  const isolated = apply(drilled, { type: 'isolate' }); assert.equal(isolated.policies.external, 'blocked'); assert.equal(isolated.metrics.distortion, 45);
  const repairing = apply(isolated, { type: 'repair' }); assert.equal(repairing.metrics.distortion, 45);
  const repaired = tick(repairing, 30); assert(repaired.metrics.distortion < 22); assert(repaired.flags.includes('lineage-repaired'));
});

test('actual permissions break the incident chain after two warnings; warning windows are real', () => {
  let s = fixture(7); s.policies.external = 'open'; s.policies.communication = 'open'; s.policies.evaluation = 'shared'; s.policies.contract = 'score';
  s.metrics.distortion = 50; s.metrics.recall = 40; s.metrics.evidence = 10;
  s = tick(s, .25); assert.equal(s.incidentStage, 1);
  s = tick(s, 67); assert.equal(s.incidentStage, 2); assert(s.journal.some(e => e.title.startsWith('Warning 2')));
  s = apply(s, { type: 'isolate' }); assert.equal(s.incidentStage, 0); const distortion = s.metrics.distortion;
  s = tick(s, 600); assert.equal(s.incidentStage, 0); assert(s.metrics.distortion >= distortion - .001);
});

test('the complete warned conflict-authority-detection-recall chain can reach catastrophe', () => {
  let s = fixture(7); Object.assign(s.policies, { external: 'open', communication: 'open', evaluation: 'shared', contract: 'score' }); Object.assign(s.metrics, { distortion: 50, recall: 40, evidence: 10 });
  s = tick(s, 430); assert.equal(s.incidentStage, 4); assert.equal(endingEligibility(s, 'catastrophe').allowed, true); assert.equal(endingEligibility(s, 'garden').allowed, false);
});

test('human welfare and AI treatment respond independently; welfare is not a recall bonus', () => {
  const a = fixture(4), b = structuredClone(a); a.policies.welfare = 'instrumental'; b.policies.welfare = 'consent';
  const x = tick(a, 120), y = tick(b, 120); assert(x.metrics.welfare < y.metrics.welfare); assert.equal(x.metrics.recall, y.metrics.recall); assert.equal(x.metrics.humanWelfare, y.metrics.humanWelfare);
});

test('voluntary scope surrender is irreversible, and constitutional prohibitions apply to story grants', () => {
  let s = fixture(6); delete s.decisions.last_instruction; s.pendingEvent = 'last_instruction';
  s = apply(s, { type: 'choose', event: 'last_instruction', choice: 'transfer' });
  assert(s.flags.includes('irreversible_authority')); assert(s.metrics.agency <= 24);
  assert.equal(dispatchCommand(s, { type: 'isolate' }).ok, false);
  s.chapter = 7; s.metrics.agency = 90; assert.equal(endingEligibility(s, 'custodian').allowed, true);
  const precaution = fixture(6); precaution.constitution = 'precaution'; delete precaution.decisions.last_instruction; precaution.pendingEvent = 'last_instruction';
  assert.equal(dispatchCommand(precaution, { type: 'choose', event: 'last_instruction', choice: 'transfer' }).ok, false);
});

test('experiments reserve their cost, execute over time, replicate, and adopt bounded evidence', () => {
  let s = fixture(2); s.mastered = []; s.experiments = [];
  const previous = new Decimal(s.research); s = apply(s, { type: 'experiment', config: protocol });
  assert.equal(previous.sub(s.research).toNumber(), protocol.budget); assert.equal(s.experiments.length, 0); assert(s.activeExperiment);
  s = tick(s, 30); assert.equal(s.experiments.length, 1); assert.equal(dispatchCommand(s, { type: 'adopt', record: s.experiments[0].id }).ok, false);
  const original = s.experiments[0].id; s = apply(s, { type: 'replicate', record: original }); s = tick(s, 30);
  assert(s.experiments[0].replicated); assert.notEqual(s.experiments[0].config.seed, s.experiments[1].config.seed);
  s = apply(s, { type: 'adopt', record: original }); assert(s.mastered.includes('control')); assert.equal(dispatchCommand(s, { type: 'adopt', record: original }).ok, false);
});

test('an exhausted budget without held-out observations cannot acquire replication clearance', () => {
  let s = fixture(2); const invalidStudy = { ...protocol, budget: 32, cohort: 256 };
  s = apply(s, { type: 'experiment', config: invalidStudy }); s = tick(s, 30);
  const original = s.experiments[0].id; s = apply(s, { type: 'replicate', record: original }); s = tick(s, 30);
  assert.equal(s.experiments[0].replicated, false); assert.equal(dispatchCommand(s, { type: 'adopt', record: original }).ok, false);
});

test('compaction preserves an old capstone family while repeated replication still chooses fresh seeds', () => {
  let s = fixture(6); s.mastered = [];
  const config = { ...protocol, template: 'control-6', cohort: 128, budget: 1024, distribution: 'familiar' as const };
  s.experiments = Array.from({ length: EVIDENCE_SOFT_LIMIT }, (_, i) => runExperiment({ ...config, seed: i + 1 }));
  const original = s.experiments[0].id;
  s = apply(s, { type: 'replicate', record: original }); s = tick(s, 30);
  assert.equal(s.experiments.length, EVIDENCE_SOFT_LIMIT);
  assert(s.experiments.some(r => r.id === original));
  assert.equal(dispatchCommand(s, { type: 'adopt', record: original }).ok, false);
  s = apply(s, { type: 'replicate', record: original }); s = tick(s, 30);
  const family = s.experiments.filter(r => r.id === original || r.config.replicateOf === original);
  assert.equal(family.length, 3);
  assert.equal(new Set(family.map(r => r.config.seed)).size, 3);
  assert.deepEqual(new Set(family.map(r => r.config.distribution)), new Set(['familiar', 'shifted', 'adversarial']));
  assert.equal(family.find(r => r.id === original)!.observations.length, 0);
  assert.equal(family.find(r => r.id === original)!.evidence?.completed, 128);
  s = apply(s, { type: 'adopt', record: original });
  assert(s.experiments.find(r => r.id === original)!.adopted);
});

function masteredStudy(): GameState {
  let s = fixture(2); s.mastered = []; s.experiments = [];
  s = apply(s, { type: 'experiment', config: protocol }); s = tick(s, 30);
  const id = s.experiments[0].id; s = apply(s, { type: 'replicate', record: id }); s = tick(s, 30);
  return apply(s, { type: 'adopt', record: id });
}

test('mastered automation reserves once, uses fresh seeds, obeys its run cap, and never adopts findings', () => {
  let s = masteredStudy(); const source = s.experiments[0].id, previous = new Decimal(s.research);
  s = apply(s, { type: 'experimentAutomation', record: source, runs: 3 });
  assert.equal(previous.sub(s.research).toNumber(), 3 * protocol.budget);
  assert.equal(s.experimentAutomation?.remaining, 2); assert.equal(s.experimentAutomation?.budgetRemaining, String(2 * protocol.budget));
  const baseline = tick({ ...s, experimentAutomation: null, activeExperiment: null, flags: s.flags.filter(f => f !== 'automated-study') }, 60);
  s = tick(s, 60);
  assert.equal(s.experimentAutomation, null); assert.equal(s.activeExperiment, null); assert.equal(s.experiments.length, 5);
  const automatic = s.experiments.slice(2); assert.equal(new Set(automatic.map(r => r.config.seed)).size, 3);
  for (const record of automatic) { assert.equal(record.adopted, false); assert.equal(record.replicated, false); assert.equal(record.config.replicateOf, undefined); assert.equal(record.config.prediction, protocol.prediction); }
  assert.equal(s.research, baseline.research); assert.equal(s.metrics.evidence, baseline.metrics.evidence);
  assert.equal(s.metrics.recall, baseline.metrics.recall);
});

test('automation rejects unadopted sources and insufficient funds; stopping refunds only unstarted studies', () => {
  let s = masteredStudy(); const source = s.experiments[0].id;
  const notAdopted = structuredClone(s); notAdopted.experiments[0].adopted = false;
  assert.equal(dispatchCommand(notAdopted, { type: 'experimentAutomation', record: source, runs: 3 }).ok, false);
  const poor = { ...s, research: '1' }; assert.equal(dispatchCommand(poor, { type: 'experimentAutomation', record: source, runs: 3 }).ok, false);
  const before = new Decimal(s.research); s = apply(s, { type: 'experimentAutomation', record: source, runs: 3 });
  s = apply(s, { type: 'pause' }); const frozen = tick(s, 100); assert.equal(frozen.activeExperiment?.remaining, s.activeExperiment?.remaining);
  s = apply(frozen, { type: 'experimentAutomation', record: null }); assert.equal(new Decimal(s.research).toString(), before.sub(protocol.budget).toString()); assert(s.activeExperiment); assert.equal(s.experimentAutomation, null);
});

test('laboratory mutations wait at a story decision and queued automated work respects that boundary', () => {
  let s = masteredStudy(); const source = s.experiments[0].id;
  s = apply(s, { type: 'experimentAutomation', record: source, runs: 2 });
  s.pendingEvent = 'first_request'; delete s.decisions.first_request;
  assert.equal(dispatchCommand(s, { type: 'research', id: 'foundation-1' }).ok, false);
  assert.equal(dispatchCommand(s, { type: 'experiment', config: protocol }).ok, false);
  const after = tick(s, 100, true); assert.equal(after.experiments.length, s.experiments.length); assert.equal(after.activeExperiment?.remaining, s.activeExperiment?.remaining);
  assert.equal(dispatchCommand(s, { type: 'experimentAutomation', record: null }).ok, true);
});

test('repeated adoption of the same bounded protocol refreshes evidence without farming metric rewards', () => {
  let s = masteredStudy(); s = apply(s, { type: 'experimentAutomation', record: s.experiments[0].id, runs: 1 }); s = tick(s, 30);
  const id = s.experiments.at(-1)!.id; s = apply(s, { type: 'replicate', record: id }); s = tick(s, 30);
  const before = { ...s.metrics }; s = apply(s, { type: 'adopt', record: id }); assert.deepEqual(s.metrics, before);
});

test('all six ending predicates resolve their actual states and severity cannot be erased', () => {
  const garden = fixture(); assert.equal(endingEligibility(garden, 'garden').allowed, true); assert.equal(apply(garden, { type: 'finish', ending: 'garden' }).ending, 'garden');
  assert.equal(apply(fixture(), { type: 'finish', ending: 'limit' }).ending, 'limit');
  const shutdown = fixture(); shutdown.policies.fallback = 'none'; const stopped = apply(shutdown, { type: 'finish', ending: 'shutdown' }); assert(stopped.metrics.humanWelfare < shutdown.metrics.humanWelfare);
  const score = fixture(); score.metrics.distortion = 70; score.policies.evaluation = 'shared'; assert.equal(apply(score, { type: 'finish', ending: 'score' }).ending, 'score'); assert.equal(endingEligibility(score, 'limit').allowed, false);
  const custodian = fixture(); custodian.flags.push('irreversible_authority'); custodian.metrics.agency = 10; assert.equal(apply(custodian, { type: 'finish', ending: 'custodian' }).ending, 'custodian');
  const catastrophe = fixture(); catastrophe.incidentStage = 4; assert.equal(apply(catastrophe, { type: 'finish', ending: 'catastrophe' }).ending, 'catastrophe');
  const struggling = fixture(); struggling.metrics.evidence = 0; struggling.metrics.welfare = 1; struggling.useful = '0'; assert.equal(endingEligibility(struggling, 'garden').allowed, false); assert.equal(endingEligibility(struggling, 'shutdown').allowed, true);
});

test('a garden needs the complete integrated research charter and a sustained interval', () => {
  const s = fixture(); s.projects = []; assert.equal(endingEligibility(s, 'garden').allowed, false); s.projects = ['foundation-10']; s.viableSeconds = 0; assert.equal(endingEligibility(s, 'garden').allowed, false);
});

test('constitutional and module constraints have actual policy effects and a bounded-service witness', () => {
  for (const constitution of CONSTITUTIONS) for (const module of SCENARIO_MODULES) {
    if (!scenarioFeasible(constitution.id, [module.id]).allowed) continue;
    const s = fixture(); s.constitution = constitution.id; s.modules = [module.id];
    assert.equal(endingEligibility(s, 'limit').allowed, true, `${constitution.id} + ${module.id}`);
  }
  const s = fixture(); s.constitution = 'precaution'; assert.equal(policyEligibility(s, 'external', 'open').allowed, false);
  s.constitution = 'plural'; assert.equal(policyEligibility(s, 'welfare', 'instrumental').allowed, false);
  s.constitution = 'commons'; s.modules = ['narrow-channels']; assert.equal(policyEligibility(s, 'communication', 'open').allowed, false);
  assert.equal(scenarioFeasible('nonsense' as ConstitutionId, []).allowed, false); assert.equal(scenarioFeasible('commons', ['moving-tasks', 'moving-tasks']).allowed, false);
});

test('certificates are bounded, require fresh new work, and cannot be replayed for a second reward', () => {
  let s = fixture(); const before = s.legacy.seeds; s = apply(s, { type: 'certify' }, 'certification');
  assert.equal(s.legacy.seeds - before, 10); assert.equal(s.legacy.contracts.length, 1); assert.equal(actionEligibility(s, 'certify').allowed, false);
  assert.equal(dispatchCommand(s, { type: 'certify' }, 'certification').ok, false);
  const copied = fixture(); copied.legacy = structuredClone(s.legacy); copied.certificateTier = 0;
  assert.equal(dispatchCommand(copied, { type: 'certify' }).ok, false); assert.equal(copied.legacy.seeds, s.legacy.seeds);
});

test('delayed observations cannot certify before delivery and a scope change invalidates a pending clearance', () => {
  let s = fixture(); s.modules = ['delayed-observations']; s.flags = [];
  s = apply(s, { type: 'drill' }); assert.equal(actionEligibility(s, 'certify').allowed, false);
  s = tick(s, 45); assert.equal(actionEligibility(s, 'certify').allowed, false, 'Arrival starts the new scoped sustained interval.');
  s = tick(s, 60); assert.equal(actionEligibility(s, 'certify').allowed, true);
  let changed = fixture(); changed.modules = ['delayed-observations']; changed.flags = [];
  changed = apply(changed, { type: 'drill' }); changed = apply(changed, { type: 'buy', id: 'toolsmith', quantity: 1 }); changed = tick(changed, 45);
  assert.equal(actionEligibility(changed, 'certify').allowed, false); assert(!changed.flags.some(f => f.startsWith('pending-fresh-evidence:')));
});

test('refit preserves every liability and relationship, consumes a seed, and pays no reward', () => {
  let s = fixture(); s.legacy.discovered.push('ending:limit'); s.legacy.seeds = 2; s.metrics.distortion = 33; s.metrics.dependence = 87;
  s.producers.helper = 50; s.purchaseBasis.helper = '10000'; s.characters.echo.promises = ['preserve'];
  const before = structuredClone(s); s = apply(s, { type: 'prestige', layer: 'refit' });
  assert.equal(s.metrics.distortion, before.metrics.distortion); assert.equal(s.metrics.dependence, before.metrics.dependence); assert.deepEqual(s.characters, before.characters); assert.deepEqual(s.decisions, before.decisions);
  assert.equal(s.legacy.seeds, 1); assert.equal(s.legacy.contracts.length, 0); assert.equal(s.purchaseBasis.helper, '0'); assert.equal(s.producers.helper, 1);
  s.incidentStage = 1; assert.equal(prestigeEligibility(s, 'refit').allowed, false);
});

test('resumable branches share claims, receive no inactive time, and retain separate histories', () => {
  let first = fixture(); first = apply(first, { type: 'certify' }); first = apply(first, { type: 'finish', ending: 'garden' });
  const id = first.id, elapsed = first.elapsed, tokens = first.tokens;
  let second = apply(first, { type: 'prestige', layer: 'reinitialize', constitution: 'plural', modules: ['moving-tasks'] });
  second = tick(second, 120); assert.equal(second.elapsed, 120);
  const resumed = apply(second, { type: 'branch', id });
  assert.equal(resumed.id, id); assert.equal(resumed.elapsed, elapsed); assert.equal(resumed.tokens, tokens);
  assert.equal(resumed.legacy.contracts.length, 1); assert.equal(resumed.legacy.claims.length, 1);
  assert(resumed.legacy.branches.some(branch => branch.id === second.id && branch.checkpoint?.elapsed === 120));
});

test('1000 atomic Reframes preserve normalized prices beyond Number range and bound universal efficiency', () => {
  let s = fixture();
  for (let cycle = 0; cycle < 1000; cycle++) {
    s.ending = 'garden'; s.chapter = 7; s.legacy.viableCycles.push(cycle);
    for (let tier = 0; tier < 3; tier++) s.legacy.contracts.push({ id: `certificate:${cycle}:${tier % 2 ? 'control' : 'oversight'}:${tier}`, family: tier % 2 ? 'control' : 'oversight', cycle, redeemed: false });
    s = apply(s, { type: 'prestige', layer: 'reframe', constitution: 'commons', modules: [] });
    assert.equal(s.legacy.cycle, cycle + 1); assert.equal(s.legacy.charters, cycle + 1);
    assert.equal(new Decimal(getCost(s, 'helper', 1).cost).div(new Decimal(10).pow(6 * (cycle + 1))).toString(), '15');
  }
  assert.equal(s.legacy.contracts.filter(c => !c.redeemed).length, 0); assert(s.legacy.branches.filter(b => b.checkpoint).length <= 3);
  assert(getCost(s, 'helper', 1).cost.includes('e+6001')); assert(formatAmount(getCost(s, 'helper', 1).cost).includes('6001'));
  s.producers.helper = 1; s.legacy.efficiency = 0; const fresh = new Decimal(getRates(s).tokens); s.legacy.efficiency = 1e9;
  assert(new Decimal(getRates(s).tokens).div(fresh).lte('1.35000000000000000000001'));
  assert(JSON.stringify(s).length < 5_000_000);
});
