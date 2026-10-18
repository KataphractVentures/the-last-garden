import test from 'node:test';
import assert from 'node:assert/strict';
import type { Command, ExperimentConfig, GameState } from '../src/contracts';
import { STORY_EVENTS } from '../src/content/story';
import { createGame, dispatchCommand, tick } from '../src/engine/index';
import { getStoryEconomy, previewStoryEconomy, STORY_ACCOUNTING_PREFIXES, STORY_COST_MULTIPLIER } from '../src/engine/storyEconomy';
import { decimal } from '../src/engine/amounts';
import { runExperiment } from '../src/laboratory/experiments';

function apply(state: GameState, command: Command): GameState {
  const result = dispatchCommand(state, command);
  assert.equal(result.ok, true, result.message);
  return result.state;
}
function unblocked(): GameState {
  const state = createGame(1701, 0);
  // These transfer unit tests isolate specific authored conversations. Full
  // command-only campaign simulations separately verify their natural triggers.
  state.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  state.pendingEvent = null;
  return state;
}
function choose(state: GameState, event: string, choice: string): GameState {
  const isolated = structuredClone(state);
  isolated.pendingEvent = event;
  delete isolated.decisions[event];
  return apply(isolated, { type: 'choose', event, choice });
}

test('story support cannot create earned income, bootstrap itself, or advance lifetime gates', () => {
  let state = unblocked();
  state = choose(state, 'first_request', 'print');
  assert.equal(state.tokens, '0');
  assert.equal(state.lifetime, '0');
  assert.equal(state.useful, '0');
  assert.equal(getStoryEconomy(state).tokens.granted, '0');
  for (let i = 0; i < 4; i++) state = apply(state, { type: 'tend' });
  const lifetime = state.lifetime, usefulness = state.useful;
  const first = previewStoryEconomy(state, { tokens: 35 });
  assert.equal(first.tokens.grant, '0.4');
  state = choose(state, 'second_pair', 'all_jobs');
  assert.equal(state.tokens, '4.4');
  assert.equal(state.lifetime, lifetime);
  assert.equal(state.useful, usefulness);
  state = choose(state, 'seed_ledger', 'curate');
  assert.equal(state.tokens, '4.4');
  assert.equal(getStoryEconomy(state).tokens.granted, '0.4');
  assert.equal(previewStoryEconomy(state, { tokens: 1e12 }).tokens.grant, '0');
});

test('support consumed by pledged debt still exhausts the grant budget without progressing gates', () => {
  let state = unblocked();
  // Use an obligation large enough to survive four earned tokens under the
  // tuned campaign rate, rather than assuming the five-token opening cost.
  const obligation = decimal(20).mul(STORY_COST_MULTIPLIER);
  state = choose(state, 'lesson_plan', 'observe');
  for (let i = 0; i < 4; i++) state = apply(state, { type: 'tend' });
  const remainingDebt = obligation.sub(4);
  assert(remainingDebt.gt('.4'), 'The fixture must leave enough debt to consume the entire support dividend.');
  assert.equal(state.tokens, '0');
  assert(state.flags.includes(`story-debt:${remainingDebt.toString()}`));
  const preview = previewStoryEconomy(state, { tokens: 35 });
  assert.equal(preview.tokens.grant, '0.4');
  assert.equal(preview.tokens.debtRepayment, '0.4');
  assert.equal(preview.tokens.treasuryGain, '0');
  const beforeUseful = state.useful;
  state = choose(state, 'second_pair', 'all_jobs');
  assert.equal(state.tokens, '0');
  assert.equal(state.lifetime, '4');
  assert.equal(state.useful, beforeUseful);
  assert(state.flags.includes(`story-debt:${remainingDebt.sub('.4').toString()}`));
  assert.equal(getStoryEconomy(state).tokens.remainingBudget, '0');
});

test('research support is bounded by produced preparation and unstarted-study refunds add no allowance', () => {
  let state = tick(unblocked(), 400);
  const ledger = getStoryEconomy(state).research;
  assert(decimal(ledger.earned).gt(0));
  assert(decimal(ledger.earned).eq(state.research));
  const before = state.research;
  const preview = previewStoryEconomy(state, { research: 5 });
  state = choose(state, 'lesson_plan', 'rubric');
  assert(decimal(state.research).eq(decimal(before).add(preview.research.grant)));
  assert.equal(getStoryEconomy(state).research.earned, ledger.earned);
  const config: ExperimentConfig = { program: 'control', template: 'control-1', seed: 11, cohort: 32, budget: 256, holdout: .25, intervention: 'least-privilege', distribution: 'familiar', lineage: 'shortcut', prediction: 'A scoped permission blocks the prohibited route.', control: true };
  const source = runExperiment(config);
  source.adopted = true; source.replicated = true;
  state.experiments.push(source); state.mastered = ['control'];
  const earnedBefore = getStoryEconomy(state).research.earned;
  const grantedBefore = getStoryEconomy(state).research.granted;
  const spendableBefore = state.research;
  state = apply(state, { type: 'experimentAutomation', record: source.id, runs: 3 });
  state = apply(state, { type: 'experimentAutomation', record: null });
  assert(decimal(state.research).eq(decimal(spendableBefore).sub(config.budget)));
  assert.equal(getStoryEconomy(state).research.earned, earnedBefore);
  assert.equal(getStoryEconomy(state).research.granted, grantedBefore);
});

test('a zero-income legacy save keeps past balances without treating them as new support allowance', () => {
  let state = unblocked();
  state.flags = state.flags.filter(flag => !STORY_ACCOUNTING_PREFIXES.some(key => flag.startsWith(`${key}:`)));
  state.tokens = '12345'; state.lifetime = '999999'; state.useful = '45678'; state.research = '1000';
  assert.equal(getStoryEconomy(state).initialized, false);
  assert.equal(previewStoryEconomy(state, { tokens: 1000, research: 1000 }).tokens.grant, '0');
  state = choose(state, 'first_request', 'print');
  assert.equal(state.tokens, '12345'); assert.equal(state.lifetime, '999999'); assert.equal(state.useful, '45678');
  state = apply(state, { type: 'tend' });
  assert.equal(getStoryEconomy(state).tokens.earned, '1');
  assert.equal(previewStoryEconomy(state, { tokens: 1000 }).tokens.grant, '0.1');
  assert.equal(state.lifetime, '1000000');
});

test('narrative support and costs remain exact beyond native numbers and use the branch scale', () => {
  let state = unblocked(); state.legacy.cycle = 1000;
  state = apply(state, { type: 'tend' });
  const preview = previewStoryEconomy(state, { tokens: 20, research: -7 });
  assert.equal(preview.tokens.grant, '1e+5999');
  assert.equal(preview.research.cost, decimal('7e6000').mul(STORY_COST_MULTIPLIER).toString());
  state = choose(state, 'first_request', 'print');
  assert.equal(state.lifetime, '1e+6000'); assert.equal(state.tokens, '1.1e+6000');
  assert.equal(getStoryEconomy(state).tokens.granted, '1e+5999');
  state.flags.push('replay-cycle:2');
  assert.equal(previewStoryEconomy(state, { tokens: -5 }).tokens.cost, decimal('5e12').mul(STORY_COST_MULTIPLIER).toString());
});

test('new civilizations reset support allowance but refunded purchases cannot replenish it', () => {
  let state = tick(unblocked(), 5); state.assisted = true;
  state = tick(state, 20);
  const beforeBuy = getStoryEconomy(state).tokens;
  state = apply(state, { type: 'buy', id: 'helper', quantity: 1 });
  state = apply(state, { type: 'sell', id: 'helper', quantity: 1 });
  assert.deepEqual(getStoryEconomy(state).tokens, beforeBuy);
  state.ending = 'shutdown'; state.endingTime = state.elapsed;
  state = apply(state, { type: 'prestige', layer: 'reinitialize', constitution: 'commons', modules: [] });
  assert.equal(state.lifetime, '0');
  assert.equal(getStoryEconomy(state).tokens.earned, '0');
  assert.equal(getStoryEconomy(state).tokens.granted, '0');
  assert.equal(getStoryEconomy(state).research.earned, '0');
  assert.equal(previewStoryEconomy(state, { tokens: 20 }).tokens.grant, '0');
  const checkpoint = state.legacy.branches.at(-1)?.checkpoint;
  assert(checkpoint);
  assert(checkpoint.flags.includes(`story-earned-tokens:${beforeBuy.earned}`));
});
