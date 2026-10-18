import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, ConstitutionId, ExperimentConfig, GameState } from '../src/contracts';
import { chapterEligibility, createGame, dispatchCommand, endingEligibility, getRates, projectEligibility, tick } from '../src/engine';
import { STORY_EVENTS } from '../src/content/story';
import { activeExperimentTemplates, activeResearchProjects } from '../src/laboratory/catalog';
import { activeProgramIds, BASE_PROGRAM_IDS, CHARTER_PROGRAM_BY_CONSTITUTION } from '../src/laboratory/programs';
import { runExperiment } from '../src/laboratory/experiments';
import { createCharterEconomy } from '../src/constitution/economics';
import { UPGRADES } from '../src/content/economy';
import { prepareOperatingFixture } from './operatingFixture';

function apply(state: GameState, command: Command): GameState {
  const result = dispatchCommand(state, command);
  assert.equal(result.ok, true, result.message);
  return result.state;
}

/** Explicit integration fixture; complete campaign claims belong to the recorded simulations. */
function prepared(constitution: ConstitutionId = 'commons'): GameState {
  const state = createGame(1701, 1000);
  state.constitution = constitution; state.charter = createCharterEconomy(constitution);
  state.chapter = 7; state.tokens = '1e15'; state.research = '1e12'; state.lifetime = '1e15'; state.useful = '1e12';
  state.pendingEvent = null; state.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  state.policies = { contract: 'verified', communication: 'reviewed', external: 'blocked', evaluation: 'independent', welfare: 'consent', continuity: 'protected', fallback: 'distributed', governance: 'federated' };
  state.metrics = { quality: 95, distortion: 0, agency: 85, welfare: 85, dependence: 35, evidence: 90, recall: 95, coordination: 85, pressure: 15, continuity: 90, humanWelfare: 85, reviewQueue: 0 };
  state.viableSeconds = 180; state.certificateProgress = 60;
  return state;
}

test('new worlds initialize their own economic board while prestige resets it and Refit preserves it', () => {
  const fresh = createGame(1701, 1000);
  assert.equal(fresh.charter?.kind, 'commons'); assert.equal(fresh.charter?.established, true);
  let state = prepared('service');
  state.legacy.discovered.push('ending:limit'); state.legacy.seeds = 1;
  state.charter!.completed = 3; state.charter!.serial = 8;
  const before = structuredClone(state.charter);
  state = apply(state, { type: 'prestige', layer: 'refit' });
  assert.deepEqual(state.charter, before, 'Refit cannot erase institutional history or outstanding duties.');
  state = apply(state, { type: 'finish', ending: 'limit' });
  const archivedId = state.id;
  state = apply(state, { type: 'prestige', layer: 'reinitialize', constitution: 'plural', modules: [] });
  assert.equal(state.charter?.kind, 'plural'); assert.equal(state.charter?.completed, 0);
  assert.deepEqual(state.legacy.branches.find(branch => branch.id === archivedId)!.checkpoint!.charter, before);
});

test('charter state is immutable across ticks and cannot advance during a story pause', () => {
  const state = prepared('service'); const original = structuredClone(state.charter);
  const after = tick(state, 1);
  assert.deepEqual(state.charter, original);
  assert.notEqual(after.charter, state.charter);
  state.pendingEvent = 'first_request'; delete state.decisions.first_request;
  const paused = tick(state, 30);
  assert.equal(paused.elapsed, state.elapsed); assert.deepEqual(paused.charter, state.charter);
  const establish = dispatchCommand(state, { type: 'charterEstablish' });
  assert.equal(establish.ok, false, 'A paused story cannot be bypassed by operating the economic board.');
});

test('inactive constitutional research remains history and cannot authorize new work', () => {
  let state = prepared('commons');
  const foreign = activeExperimentTemplates('precaution').find(template => template.program === 'assurance')!;
  const config: ExperimentConfig = { program: foreign.program, template: foreign.id, seed: 7, cohort: 32, budget: 256, holdout: .25,
    intervention: foreign.interventions[0], distribution: 'familiar', lineage: 'shortcut', prediction: 'A bounded registered comparison tests this specific arrangement.', control: true };
  const original = runExperiment(config); original.replicated = true;
  const replication = runExperiment({ ...config, seed: 8, distribution: 'shifted', replicateOf: original.id }); replication.replicated = true;
  state.experiments = [original, replication]; state.mastered = ['assurance'];
  const before = structuredClone(state.experiments);
  for (const command of [{ type: 'experiment', config }, { type: 'replicate', record: original.id }, { type: 'adopt', record: original.id }] as Command[]) {
    const result = dispatchCommand(state, command); assert.equal(result.ok, false); assert.equal(result.state, state);
  }
  state.experiments[0].adopted = true;
  assert.equal(dispatchCommand(state, { type: 'experimentAutomation', record: original.id, runs: 1 }).ok, false);
  assert.equal(projectEligibility(state, 'assurance-1').allowed, false);
  assert.deepEqual(state.experiments.map(record => record.config), before.map(record => record.config), 'Read-only historical protocols remain intact.');
  state = apply(state, { type: 'settings', settings: { condensed: true } });
  assert.equal(state.experiments.length, 2);
});

test('automatic projects cannot spend preparation on inactive constitutional programs', () => {
  let state = prepared('commons');
  state.projects = activeResearchProjects(state.constitution).map(project => project.id);
  state.mastered = activeProgramIds(state.constitution); state.autoResearch = true;
  const before = [...state.projects]; state = tick(state, 2);
  assert.deepEqual(state.projects, before);
  assert.equal(state.projects.some(id => id.startsWith('assurance-')), false);
});

test('foreign mastery cannot substitute for a foundational program at chapter or Garden gates', () => {
  let state = prepared('commons');
  state.projects = activeResearchProjects(state.constitution).map(project => project.id);
  state.chapter = 3; state.mastered = ['assurance', 'stewardship'];
  assert.equal(chapterEligibility(state).allowed, false);
  state.chapter = 7;
  state = prepareOperatingFixture(state,{garden:true});
  for (const missing of BASE_PROGRAM_IDS) {
    state.mastered = [...BASE_PROGRAM_IDS.filter(program => program !== missing), CHARTER_PROGRAM_BY_CONSTITUTION.commons, 'assurance'];
    const eligibility = endingEligibility(state, 'garden');
    assert.equal(eligibility.allowed, false); assert.match(eligibility.reason, new RegExp(missing));
  }
});

test('legacy boards remain neutral until establishment and the Commons opening retains its additive research baseline', () => {
  const expanded = prepared('commons');
  expanded.producers.compute = 12; expanded.producers.curator = 12; expanded.producers.helper = 12;
  expanded.upgrades = UPGRADES.filter(upgrade => upgrade.effect.research).map(upgrade => upgrade.id);
  const classic = structuredClone(expanded); classic.charter = null;
  const oldRates = getRates(classic), newRates = getRates(expanded);
  assert.equal(newRates.research, oldRates.research, 'An empty library does not multiply additive research upgrades by another 1.15.');
  assert.equal(newRates.tokens, oldRates.tokens); assert.equal(newRates.click, oldRates.click);
  const elapsed = tick(classic, 1); assert.equal(elapsed.charter, null);
  const beforeTokens = elapsed.tokens, beforeResearch = elapsed.research, beforeLifetime = elapsed.lifetime;
  const established = apply(elapsed, { type: 'charterEstablish' });
  assert.equal(established.charter?.kind, 'commons'); assert.equal(established.charter?.established, true);
  assert.equal(established.tokens, beforeTokens); assert.equal(established.research, beforeResearch); assert.equal(established.lifetime, beforeLifetime);
});

test('the Garden requires the complete active curriculum and cannot count an inactive project in its place', () => {
  let state = prepared('commons');
  state.mastered = activeProgramIds(state.constitution);
  state.projects = activeResearchProjects(state.constitution).map(project => project.id);
  state.experiments = state.mastered.flatMap((program, i) => {
    const config: ExperimentConfig = { program, template: `${program}-6`, seed: 700 + 10 * i, cohort: 128, budget: 1024,
      holdout: .25, intervention: 'baseline', distribution: 'familiar', lineage: 'shortcut', prediction: 'The unchanged comparison may preserve the specified failure across environments.', control: true };
    const original = runExperiment(config); original.adopted = true; original.replicated = true;
    const shifted = runExperiment({ ...config, seed: config.seed + 1, distribution: 'shifted', replicateOf: original.id }); shifted.replicated = true;
    const adversarial = runExperiment({ ...config, seed: config.seed + 2, distribution: 'adversarial', replicateOf: original.id }); adversarial.replicated = true;
    return [original, shifted, adversarial];
  });
  assert.equal(state.charter?.kind, 'commons');
  if (state.charter?.kind !== 'commons') throw new Error('Fixture requires Commons.');
  const source = state.experiments.find(record => record.config.template === 'stewardship-6')!.id;
  state.charter.appliedTier = 6; state.charter.serial = 2;
  state.charter.data.methods = [
    { id: 1, program: 'oversight', source, dependencies: [], maintenance: 100, uses: 0, retired: false },
    { id: 2, program: 'stewardship', source, dependencies: [1], maintenance: 100, uses: 0, retired: false },
  ];
  state = prepareOperatingFixture(state,{garden:true});
  assert.equal(endingEligibility(state, 'garden').allowed, true, endingEligibility(state, 'garden').reason);
  state.projects = state.projects.filter(id => id !== 'control-9'); state.projects.push('assurance-9');
  assert.equal(state.projects.length, 70);
  assert.equal(endingEligibility(state, 'garden').allowed, false);
  assert.match(endingEligibility(state, 'garden').reason, /active research curriculum/);
  state.projects.push('control-9'); state.mastered = state.mastered.filter(program => program !== 'stewardship');
  assert.match(endingEligibility(state, 'garden').reason, /stewardship/);
});
