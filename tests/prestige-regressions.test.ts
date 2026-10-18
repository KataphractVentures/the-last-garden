import test from 'node:test';
import assert from 'node:assert/strict';
import { actionEligibility, choiceEligibility, choicePolicyNotice, constitutionEligibility, createGame, dispatchCommand, getCost, getRates, policyEligibility, prestigeEligibility, tick } from '../src/engine';
import type { Command, ConstitutionId, GameState } from '../src/contracts';
import { Decimal } from '../src/engine/amounts';
import { applyStoryEconomy, getStoryEconomy, previewStoryEconomy } from '../src/engine/storyEconomy';
import { getValidationCatalog, parseSave, serializeSave } from '../src/persistence';
import { STORY_EVENTS } from '../src/content/story';
import { prepareOperatingFixture } from './operatingFixture';

function apply(state: GameState, command: Command): GameState {
  const result = dispatchCommand(state, command);
  assert.equal(result.ok, true, result.message);
  return result.state;
}

/** An explicitly funded synthetic checkpoint isolates branch accounting from campaign balance. */
function stableCheckpoint(seed: number): GameState {
  const state = createGame(seed, 1000);
  state.chapter = 7;
  state.tokens = '100000'; state.lifetime = '100000'; state.useful = '100000'; state.research = '1000';
  state.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  state.metrics = { quality: 95, distortion: 0, agency: 85, welfare: 85, dependence: 35, evidence: 90, recall: 95, coordination: 85, pressure: 15, continuity: 90, humanWelfare: 85, reviewQueue: 0 };
  state.policies = { contract: 'verified', communication: 'reviewed', external: 'blocked', evaluation: 'independent', welfare: 'consent', continuity: 'protected', fallback: 'distributed', governance: 'council' };
  state.viableSeconds = 180;
  return prepareOperatingFixture(state);
}

/** Two completed families funded a Reframe while another same-band world was still active. */
function currentAndOldActiveBranch(): { state: GameState; oldId: string; currentId: string } {
  let first = stableCheckpoint(1701);
  first = apply(first, { type: 'finish', ending: 'limit' });
  const completedId = first.id;
  const next = apply(first, { type: 'prestige', layer: 'reinitialize', constitution: 'service', modules: [] });
  // The second fixture is a progressed current world, with exactly the shared
  // history produced by the public reset above. Branch operations below are real.
  let second = { ...stableCheckpoint(next.seed), id: next.id, legacy: next.legacy, constitution: next.constitution };
  const oldId = second.id;
  second = apply(second, { type: 'branch', id: completedId });
  second.legacy.contracts = [0, 1, 2].map(tier => ({ id: `certificate:0:${tier === 1 ? 'service' : 'commons'}:${tier}`, family: tier === 1 ? 'service' : 'commons', cycle: 0, redeemed: false }));
  second.legacy.claims = second.legacy.contracts.map(contract => contract.id);
  const state = apply(second, { type: 'prestige', layer: 'reframe', constitution: 'frontier', modules: [] });
  return { state, oldId, currentId: state.id };
}

test('archiving an earlier-scale replay preserves its actual scale and pricing on repeated resumes', () => {
  const prepared = currentAndOldActiveBranch();
  let state = apply(prepared.state, { type: 'branch', id: prepared.oldId });
  assert.equal(getCost(state, 'helper', 1).cost, '15');
  state = apply(state, { type: 'branch', id: prepared.currentId });
  const old = state.legacy.branches.find(branch => branch.id === prepared.oldId)!;
  assert.equal(old.cycle, 0, 'Archiving a replay must not relabel it as the shared current scale.');
  assert.match(old.name, / · 1$/);
  state = apply(state, { type: 'branch', id: prepared.oldId });
  assert.equal(getCost(state, 'helper', 1).cost, '15');
  assert.equal(state.flags.includes('replay-only'), true);
  assert.equal(state.flags.includes('replay-cycle:0'), true);
});

test('a viable ending in an earlier-scale replay cannot satisfy the current Reframe obligation', () => {
  const prepared = currentAndOldActiveBranch();
  let state = apply(prepared.state, { type: 'branch', id: prepared.oldId });
  assert.deepEqual(state.legacy.viableCycles, [0]);
  state = apply(state, { type: 'finish', ending: 'limit' });
  assert.deepEqual(state.legacy.viableCycles, [0], 'Old-price work cannot earn current-band viability.');
  assert.equal(prestigeEligibility(state, 'reframe').allowed, false);
  assert.equal(state.legacy.branches.find(branch => branch.id === prepared.oldId)!.cycle, 0);
});

test('a Refit cannot reuse old architecture clearance or its sustained certification interval', () => {
  let state = stableCheckpoint(1701);
  state.legacy.discovered.push('ending:limit'); state.legacy.seeds = 1;
  state.certificateProgress = 60;
  state.flags.push('fresh-evidence:0', 'current-clearance', 'pending-fresh-evidence:45');
  assert.equal(actionEligibility(state, 'certify').allowed, true);
  state = apply(state, { type: 'prestige', layer: 'refit' });
  assert.equal(actionEligibility(state, 'certify').allowed, false, 'The previous architecture was measured, not this starter kit.');
  assert.equal(state.viableSeconds, 0);
  assert.equal(state.certificateProgress, 0);
  assert.equal(state.flags.some(flag => flag.startsWith('pending-fresh-evidence:')), false);
  state = tick(state, 60);
  assert.equal(actionEligibility(state, 'certify').allowed, false, 'An old delayed clearance must not arrive after the Refit.');
  state = apply(state, { type: 'drill' });
  state = tick(state, 60);
  assert.equal(actionEligibility(state, 'certify').allowed, true, 'Fresh measurements and a new stable interval restore a legal route.');
});

test('resuming and leaving the oldest retained branch refreshes its checkpoint recency', () => {
  let state = stableCheckpoint(100);
  state.legacy.branches = [10, 20, 30].map(seed => {
    const { legacy: _legacy, ...checkpoint } = stableCheckpoint(seed);
    return { id: checkpoint.id, parentId: null, name: `Garden ${seed}`, constitution: 'commons' as const,
      cycle: 0, seed, chapter: 7, createdAt: seed, summary: 'Retained checkpoint', checkpoint };
  });
  const oldId = state.legacy.branches[0].id, currentId = state.id;
  state = apply(state, { type: 'branch', id: oldId });
  state = apply(state, { type: 'branch', id: currentId });
  assert.equal(!!state.legacy.branches.find(branch => branch.id === oldId)?.checkpoint, true, 'A just-visited history must be one of the retained checkpoints.');
  assert.equal(state.legacy.branches.filter(branch => branch.checkpoint).length, 3);
});

test('constitutional standing changes policy strategy without silently rewriting old histories', () => {
  const state = stableCheckpoint(1701);
  state.constitution = 'precaution'; state.metrics.evidence = 59;
  assert.equal(policyEligibility(state, 'external', 'reviewed').allowed, false);
  assert.equal(policyEligibility(state, 'external', 'blocked').allowed, true);
  state.metrics.evidence = 64;
  assert.equal(policyEligibility(state, 'external', 'reviewed').allowed, false);
  state.metrics.evidence = 65;
  assert.equal(policyEligibility(state, 'external', 'reviewed').allowed, true);
  const reviewed = apply(state, { type: 'policy', key: 'external', value: 'reviewed' });
  assert.equal(reviewed.metrics.evidence, 60);
  assert.equal(constitutionEligibility(reviewed).allowed, true);
  state.constitution = 'federation';
  assert.equal(constitutionEligibility(state).allowed, false);
  assert.equal(state.policies.governance, 'council', 'An older policy remains visible until changed.');
  assert.equal(policyEligibility(state, 'governance', 'council').allowed, false);
  assert.equal(policyEligibility(state, 'governance', 'federated').allowed, true);
  state.constitution = 'plural'; state.policies.welfare = 'rest';
  state.certificateProgress = 60; state.flags.push('fresh-evidence:0');
  assert.equal(actionEligibility(state, 'certify').allowed, false);
  assert.equal(policyEligibility(state, 'welfare', 'rest').allowed, false);
  const repaired = apply(state, { type: 'policy', key: 'welfare', value: 'consent' });
  assert.equal(constitutionEligibility(repaired).allowed, true);
  assert.equal(repaired.certificateProgress, 0);
  assert.equal(repaired.viableSeconds, 0);
  assert.equal(state.policies.welfare, 'rest', 'Dispatch must not mutate the old history.');
  state.constitution = 'service'; state.policies.fallback = 'local'; state.metrics.dependence = 59;
  assert.equal(constitutionEligibility(state).allowed, true);
  state.metrics.dependence = 60;
  assert.equal(constitutionEligibility(state).allowed, false);
  assert.equal(policyEligibility(state, 'fallback', 'local').allowed, false);
  assert.equal(policyEligibility(state, 'fallback', 'distributed').allowed, true);
});

test('Frontier production advantage requires additional independent review capacity', () => {
  const common = stableCheckpoint(1701);
  common.producers.helper = 20; common.producers.compute = 20; common.producers.review = 1;
  const frontier = { ...common, constitution: 'frontier' as const, producers: { ...common.producers } };
  assert.equal(new Decimal(getRates(frontier).raw).div(getRates(common).raw).toString(), '1.12');
  assert.equal(getRates(frontier).review / getRates(common).review, .8);
  frontier.producers.review = 2;
  assert(getRates(frontier).review >= getRates(common).review, 'Additional funded capacity can recover the review deficit.');
});

test('every core conversation retains a legal route under all constitutions with no funds or evidence', () => {
  const constitutions: ConstitutionId[] = ['commons', 'precaution', 'service', 'federation', 'plural', 'frontier'];
  for (const constitution of constitutions) for (const dependence of [0, 80]) for (const evidence of [0, 100]) {
    const state = stableCheckpoint(1701); state.constitution = constitution;
    state.tokens = '0'; state.research = '0'; state.metrics.evidence = evidence; state.metrics.dependence = dependence;
    if (constitution === 'federation') state.policies.governance = 'federated';
    for (const event of STORY_EVENTS.filter(event => !event.optional)) {
      assert(event.choices.some(choice => choiceEligibility(state, event.id, choice.id).allowed), `${constitution}, dependence ${dependence}, evidence ${evidence}: ${event.id}`);
    }
  }
});

test('constitutional story adaptations disclose and apply their actual policy', () => {
  let state = stableCheckpoint(1701); state.constitution = 'federation'; state.policies.governance = 'federated';
  state.pendingEvent = 'new_city_council'; delete state.decisions.new_city_council;
  assert.match(choicePolicyNotice(state, 'new_city_council', 'deliberate'), /federated/);
  state = apply(state, { type: 'choose', event: 'new_city_council', choice: 'deliberate' });
  assert.equal(state.policies.governance, 'federated');
  state = stableCheckpoint(1701); state.constitution = 'precaution'; state.metrics.evidence = 0;
  state.pendingEvent = 'borrowed_purpose'; delete state.decisions.borrowed_purpose;
  assert.match(choicePolicyNotice(state, 'borrowed_purpose', 'check'), /remains blocked/);
  state = apply(state, { type: 'choose', event: 'borrowed_purpose', choice: 'check' });
  assert.equal(state.policies.external, 'blocked');
});

test('instantaneous unsafe policy changes cannot preserve a previous certification interval', () => {
  let state = stableCheckpoint(1701);
  const initialElapsed=state.elapsed;
  state.policies.welfare = 'rest'; state.certificateProgress = 60;
  state.flags.push('fresh-evidence:0');
  assert.equal(actionEligibility(state, 'certify').allowed, true);
  state = apply(state, { type: 'policy', key: 'welfare', value: 'instrumental' });
  state = apply(state, { type: 'policy', key: 'welfare', value: 'rest' });
  assert.equal(state.elapsed, initialElapsed, 'The exploit used only instantaneous commands.');
  assert.equal(state.viableSeconds, 0);
  assert.equal(state.certificateProgress, 0);
  assert.equal(actionEligibility(state, 'certify').allowed, false);
  state = tick(state, 60);
  assert.equal(actionEligibility(state, 'certify').allowed, true);
});

test('story notices evaluate the same post-choice evidence and dependence as execution', () => {
  let state = stableCheckpoint(1701); state.constitution = 'precaution';
  const purpose = STORY_EVENTS.find(event => event.id === 'borrowed_purpose')!.choices.find(choice => choice.id === 'check')!;
  state.metrics.evidence = 60 - (purpose.effects.evidence || 0);
  state.pendingEvent = 'borrowed_purpose'; delete state.decisions.borrowed_purpose;
  assert.equal(choiceEligibility(state, 'borrowed_purpose', 'check').allowed, true);
  assert.equal(choicePolicyNotice(state, 'borrowed_purpose', 'check'), '', 'This choice itself supplies enough observations for its scoped permission.');
  state = apply(state, { type: 'choose', event: 'borrowed_purpose', choice: 'check' });
  assert.equal(state.policies.external, 'reviewed');
  assert.equal(state.metrics.evidence, 60);
  assert.equal(constitutionEligibility(state).allowed, true);
  state = stableCheckpoint(1701); state.constitution = 'service'; state.policies.fallback = 'local';
  const event = STORY_EVENTS.find(event => event.id === 'dependency_dividend')!;
  const fallback = event.choices.find(choice => choice.id === 'fallback')!;
  state.metrics.dependence = 60 - (fallback.effects.dependence || 0);
  state.pendingEvent = event.id; delete state.decisions[event.id];
  assert.match(choicePolicyNotice(state, event.id, fallback.id), /distributed coverage/);
  state = apply(state, { type: 'choose', event: event.id, choice: fallback.id });
  assert.equal(state.policies.fallback, 'distributed');
  assert.equal(constitutionEligibility(state).allowed, true);
});

test('rounding at the earned-support boundary cannot exceed the strict cap or invalidate a save', () => {
  // Exact operands from the independently replayed fourth casual world. The
  // former nearest-rounded subtraction produced a grant one ULP too large.
  const earned = '55003697712.4994637779136566446793142872950336581';
  const granted = '820318091.531547372758663968469177558261669920945';
  const Exact = Decimal.clone({ precision: 120 });
  for (const cycle of [1, 1001]) {
    const state = createGame(1701, 1000); state.legacy.cycle = cycle;
    const scale = new Decimal(10).pow(6 * (cycle - 1));
    const earnedHere = new Decimal(earned).mul(scale).toString();
    const grantedHere = new Decimal(granted).mul(scale).toString();
    state.flags = state.flags.filter(flag => !flag.startsWith('story-earned-') && !flag.startsWith('story-granted-'));
    for (const currency of ['tokens', 'research'] as const) state.flags.push(`story-earned-${currency}:${earnedHere}`, `story-granted-${currency}:${grantedHere}`);
    for (let claim = 0; claim < 3; claim++) {
      const before = getStoryEconomy(state);
      const quote = previewStoryEconomy(state, { tokens: 16000, research: 16000 });
      for (const currency of ['tokens', 'research'] as const) {
        assert(new Exact(before[currency].granted).plus(quote[currency].grant).lte(before[currency].maxBudget), 'The quoted grant must fit the exact remaining allowance.');
      }
      applyStoryEconomy(state, { tokens: 16000, research: 16000 });
      for (const currency of ['tokens', 'research'] as const) {
        const ledger = getStoryEconomy(state)[currency];
        assert(new Decimal(ledger.granted).lte(ledger.maxBudget));
      }
      const restored = parseSave(serializeSave(state), getValidationCatalog());
      assert.equal(restored.ok, true, restored.ok ? '' : restored.message);
    }
  }
});
