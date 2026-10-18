import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatchCommand } from '../src/engine/index';
import { getStoryEconomy } from '../src/engine/storyEconomy';
import { STORY_EVENTS } from '../src/content/story';
import { parseSave, serializeSave, getValidationCatalog } from '../src/persistence/index';
import { runExperiment } from '../src/laboratory/experiments';
import { evidenceProgress } from '../src/laboratory/evidence';
import type { Command, ExperimentConfig, GameState } from '../src/contracts';

function command(state: GameState, input: Command): GameState {
  const result = dispatchCommand(state, input);
  assert.equal(result.ok, true, result.message);
  return result.state;
}
function restored(state: GameState): GameState {
  const result = parseSave(serializeSave(state, 1792080000000), getValidationCatalog());
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.state;
}
function isolatedWorld(): GameState {
  const state = createGame(1701, 1792080000000);
  // A unit-test fixture removes narrative scheduling only. All income in the
  // accounting assertions below is earned through ordinary tending commands.
  state.decisions = Object.fromEntries(STORY_EVENTS.map(event => [event.id, event.choices[0].id]));
  state.pendingEvent = null;
  return state;
}
function earnFour(state: GameState): GameState {
  for (let i = 0; i < 4; i++) state = command(state, { type: 'tend' });
  return state;
}

test('save restoration and branch switching cannot reset or transfer the story grant budget', () => {
  let state = earnFour(isolatedWorld());
  state.pendingEvent = 'first_request'; delete state.decisions.first_request;
  state = command(state, { type: 'choose', event: 'first_request', choice: 'print' });
  assert.equal(getStoryEconomy(state).tokens.earned, '4');
  assert.equal(getStoryEconomy(state).tokens.granted, '0.4');
  assert.equal(getStoryEconomy(state).tokens.remainingBudget, '0');
  state = restored(state);
  const originalAccounting = getStoryEconomy(state);
  state.chapter = 7; state.pendingEvent = null;
  state = command(state, { type: 'finish', ending: 'shutdown' });
  const originalId = state.id;
  state = command(state, { type: 'prestige', layer: 'reinitialize', constitution: 'commons', modules: [] });
  assert.equal(getStoryEconomy(state).tokens.earned, '0');
  assert.equal(getStoryEconomy(state).tokens.granted, '0');
  const newId = state.id;
  state = command(state, { type: 'tend' });
  const newAccounting = getStoryEconomy(state);
  state = command(state, { type: 'branch', id: originalId });
  assert.deepEqual(getStoryEconomy(state), originalAccounting);
  state = restored(state);
  state = command(state, { type: 'branch', id: newId });
  assert.deepEqual(getStoryEconomy(state), newAccounting);
  assert.equal(state.lifetime, '1');
});

test('a Refit starter kit and its resale do not create earned grant capacity', () => {
  let state = earnFour(isolatedWorld());
  state.legacy.discovered.push('ending:garden'); state.legacy.seeds = 1;
  const before = getStoryEconomy(state);
  state = command(state, { type: 'prestige', layer: 'refit' });
  assert.deepEqual(getStoryEconomy(state), before);
  state = command(state, { type: 'sell', id: 'helper', quantity: 1 });
  assert.deepEqual(getStoryEconomy(state), before);
  state = restored(state);
  assert.deepEqual(getStoryEconomy(state), before);
});

test('a migrated save preserves historical progress but only new production funds future story support', () => {
  let state = isolatedWorld();
  state.lifetime = '1000000000'; state.useful = '12345'; state.tokens = '500000'; state.research = '3000';
  state.flags = state.flags.filter(flag => !flag.startsWith('story-earned-') && !flag.startsWith('story-granted-'));
  state = restored(state);
  assert.equal(state.lifetime, '1000000000'); assert.equal(state.useful, '12345');
  assert.equal(state.tokens, '500000'); assert.equal(state.research, '3000');
  assert.equal(getStoryEconomy(state).tokens.remainingBudget, '0');
  state = command(state, { type: 'tend' });
  assert.equal(getStoryEconomy(state).tokens.earned, '1');
  assert.equal(getStoryEconomy(state).tokens.remainingBudget, '0.1');
  state = restored(state);
  assert.equal(getStoryEconomy(state).tokens.remainingBudget, '0.1');
});

const capstone: ExperimentConfig = { program: 'oversight', template: 'oversight-6', seed: 1,
  cohort: 128, budget: 512, holdout: .25, intervention: 'baseline', distribution: 'shifted',
  lineage: 'shortcut', prediction: 'The baseline may preserve the shared false premise.', control: true, node: 3 };
function study(id: string, seed: number, distribution: ExperimentConfig['distribution'], patch: Partial<ExperimentConfig> = {}) {
  return { ...runExperiment({ ...capstone, seed, distribution, ...patch }), id };
}

test('capstone evidence finds valid distinct-seed coverage despite a crossed-seed first choice', () => {
  const root = study('root', 1, 'shifted');
  const records = [root, study('shift-two', 2, 'shifted', { replicateOf: 'root' }),
    study('adversarial-one', 1, 'adversarial', { replicateOf: 'root' }),
    study('familiar-three', 3, 'familiar', { replicateOf: 'root' })];
  const result = evidenceProgress(records, capstone.template);
  assert.equal(result.allowed, true, result.reason);
  assert(result.recordIds.includes('shift-two'));
  assert(result.recordIds.includes('adversarial-one'));
  assert.equal(result.qualifiedRuns, 3);
  // Removing the genuinely independent third seed cannot be repaired by a new ID.
  const duplicate = study('familiar-two', 2, 'familiar', { replicateOf: 'root' });
  assert.equal(evidenceProgress([...records.slice(0, 3), duplicate], capstone.template).allowed, false);
});

test('many small capstone pilots cannot pool their samples into an advanced clearance', () => {
  const records = Array.from({ length: 50 }, (_, index) => study(`pilot-${index}`, index + 1,
    index % 2 ? 'adversarial' : 'shifted', { cohort: 8, budget: 32, holdout: .5,
      ...(index ? { replicateOf: 'pilot-0' } : {}) }));
  const result = evidenceProgress(records, capstone.template);
  assert.equal(result.allowed, false);
  assert.equal(result.qualifiedRuns, 0);
  assert.equal(result.completed, 8);
});

test('imported evidence cannot inflate an eight-trial pilot by duplicating observation rows', () => {
  const state = isolatedWorld();
  const pilot = study('duplicate-pilot', 17, 'shifted', { cohort: 8, budget: 32, holdout: .5 });
  const row = pilot.observations.find(observation => observation.note.startsWith('Holdout'))!;
  pilot.observations = Array.from({ length: 128 }, () => ({ ...row }));
  pilot.evidence = { version: 1, completed: 128, heldOut: 128, controlled: 128 };
  state.experiments = [pilot];
  const result = parseSave(serializeSave(state, 1792080000000), getValidationCatalog());
  assert.equal(result.ok, false, 'An expanded receipt must not turn duplicated pilot rows into advanced evidence.');
});

test('reordering JSON object keys preserves a genuine evidence receipt on import', () => {
  const state = isolatedWorld();
  const record = study('genuine-study', 23, 'adversarial');
  record.summary = Object.fromEntries(Object.entries(record.summary).reverse()) as typeof record.summary;
  record.observations = record.observations.map(row => Object.fromEntries(Object.entries(row).reverse()) as typeof row);
  state.experiments = [record];
  const result = parseSave(serializeSave(state, 1792080000000), getValidationCatalog());
  assert.ok(result.ok, result.ok ? '' : result.message);
  assert.deepEqual(result.state.experiments[0].evidence, record.evidence);
});
