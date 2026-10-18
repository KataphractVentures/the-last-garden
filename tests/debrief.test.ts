import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { EndingId, GameState } from '../src/contracts';
import { buildEndingDebrief } from '../src/engine/debrief';
import { createGame, dispatchCommand } from '../src/engine';
import { parseSave } from '../src/persistence/validation';

function earned(ending: EndingId): GameState {
  const result = parseSave(readFileSync(new URL(`./fixtures/${ending}.save.json`, import.meta.url), 'utf8'));
  assert.ok(result.ok, result.ok ? '' : result.message);
  return result.state;
}

test('earned Custodian debrief preserves material welfare, lost agency, and the actual delegation decision', () => {
  const state = earned('custodian');
  const before = JSON.stringify(state);
  const debrief = buildEndingDebrief(state);
  assert.ok(state.metrics.humanWelfare > 80 && state.metrics.agency < 25, 'This fixture must retain the audited contrast.');
  assert.equal(debrief.metrics.find(metric => metric.key === 'humanWelfare')?.value, state.metrics.humanWelfare);
  assert.equal(debrief.metrics.find(metric => metric.key === 'agency')?.value, state.metrics.agency);
  assert.equal(debrief.metrics.length, 4);
  const transfer = debrief.decisions.find(entry => entry.eventId === 'last_instruction');
  assert.ok(transfer);
  assert.ok(transfer?.text.includes('Transfer scope revision to the successor'));
  assert.ok(transfer.time !== null);
  assert.equal(debrief.committedAt, state.endingTime);
  assert.equal(JSON.stringify(state), before, 'Reading the debrief must not alter the earned state.');
});

test('routine journal traffic cannot replace decisive choices in the ending account', () => {
  const state = earned('custodian');
  const baseline = buildEndingDebrief(state);
  for (let i = 0; i < 100; i++) state.journal.push({ id: 90000 + i, time: state.elapsed, type: 'policy', title: 'Routine maintenance', text: 'A maintained package was inspected.' });
  assert.deepEqual(buildEndingDebrief(state).decisions, baseline.decisions);
});

test('compacted journals retain known choices without manufacturing timestamps or unavailable choices', () => {
  const state = earned('custodian');
  state.journal = [];
  let debrief = buildEndingDebrief(state);
  assert.ok(debrief.decisions.some(entry => entry.eventId === 'last_instruction' && entry.text.includes('Transfer scope revision')));
  assert.equal(debrief.decisions.find(entry => entry.eventId === 'last_instruction')?.time, null);
  assert.ok(debrief.notes.some(note => note.includes('timestamps')));
  delete state.decisions.last_instruction;
  state.decisions.retired_event = 'unavailable_choice';
  debrief = buildEndingDebrief(state);
  assert.ok(!debrief.decisions.some(entry => entry.eventId === 'last_instruction'));
  assert.ok(debrief.notes.some(note => note.includes('original delegation decision is unavailable')));
  assert.ok(debrief.fullDecisions.some(entry => entry.eventId === 'retired_event' && entry.text.includes('original wording is unavailable')));
});

test('earned catastrophe preserves the warning chain and interventions without claiming missing evidence', () => {
  const state = earned('catastrophe');
  const debrief = buildEndingDebrief(state);
  for (const title of ['Warning 1 · scores and service diverge', 'Warning 2 · a recall did not reach every child', 'Last recovery window', 'The irreversible threshold']) {
    assert.ok(debrief.incidents.some(entry => entry.title === title), title);
  }
  assert.deepEqual(debrief.incidents.map(entry => entry.journalId), state.journal.filter(entry => entry.type === 'incident').map(entry => entry.id));
  state.journal = [];
  const compacted = buildEndingDebrief(state);
  assert.equal(compacted.incidents.length, 0);
  assert.ok(compacted.notes.some(note => note.includes('Not retained') && note.includes('Warning 1')));
  assert.ok(compacted.conditions.some(entry => entry.text.includes('Survival-loss record: present')));
});

test('shutdown distinguishes measured post-containment welfare from its earlier level', () => {
  const parsed = parseSave(readFileSync(new URL('./fixtures/world-1-before-ending.json', import.meta.url), 'utf8'));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.message);
  const result = dispatchCommand(parsed.state, { type: 'finish', ending: 'shutdown' });
  assert.ok(result.ok, result.message);
  const state = result.state;
  const debrief = buildEndingDebrief(state);
  assert.ok(debrief.conditions.some(entry => entry.text.includes('after the immediate containment cost')));
  assert.ok(debrief.conditions.some(entry => entry.title === 'The cost was real'));
  assert.equal(debrief.metrics.find(metric => metric.key === 'humanWelfare')?.value, state.metrics.humanWelfare);
});

test('score account calculates its output ratio with arbitrary-precision amounts', () => {
  const state = earned('custodian');
  state.ending = 'score'; state.lifetime = '1e1200'; state.useful = '2.5e1199';
  assert.ok(buildEndingDebrief(state).conditions[0].text.includes('25.0%'));
});

test('older ending histories do not acquire invented public approvals or human community outcomes',()=>{
  const state=earned('custodian');
  delete state.governance;delete state.society;
  const debrief=buildEndingDebrief(state);
  assert.ok(debrief.conditions.some(entry=>entry.id==='public-history'&&entry.text.includes('not retained')));
  assert.ok(debrief.conditions.some(entry=>entry.title==='Human communities'&&entry.text.includes('No retrospective choices')));
  assert.ok(!debrief.conditions.some(entry=>entry.id==='external-compact'));
  assert.ok(!debrief.conditions.some(entry=>entry.text.includes('Household resources')));
});

test('public mandates and human-directed misuse retain actual receipts in the ending account',()=>{
  let state=createGame(62,1);state.chapter=5;state.pendingEvent=null;state.tokens='100000000';
  state.metrics.evidence=80;state.metrics.recall=90;state.metrics.agency=80;state.metrics.reviewQueue=0;state.policies.evaluation='independent';
  for(const command of [{type:'publicMandate'},{type:'society',action:'case',id:'requester',choice:'comply'}] as const){
    const result=dispatchCommand(state,command);assert.ok(result.ok,result.message);state=result.state;
  }
  state.ending='custodian';state.endingTime=state.elapsed;
  const before=JSON.stringify(state),debrief=buildEndingDebrief(state);
  assert.ok(debrief.conditions.some(entry=>entry.id==='public-mandate'&&entry.text.includes('ratified')));
  assert.ok(debrief.conditions.some(entry=>entry.title.startsWith('Human-directed misuse')&&entry.text.includes('technical accuracy did not prevent harm')));
  const receipt=state.society!.receipts.find(entry=>entry.kind==='human-misuse')!;
  assert.ok(debrief.decisions.some(entry=>entry.text===receipt.text&&entry.time===receipt.time));
  assert.ok(debrief.fullDecisions.some(entry=>entry.text===receipt.text));
  assert.equal(JSON.stringify(state),before);
});
