import assert from 'node:assert/strict';
import test from 'node:test';
import { createGame, choiceEligibility, dispatchCommand, tick } from '../src/engine';
import { STORY_EVENTS } from '../src/content/story';
import { CONSTITUTIONS } from '../src/content/economy';
import { createGovernanceState } from '../src/governance';
import type { ConstitutionId } from '../src/contracts';

function closedWorld(eventId:string,constitution:ConstitutionId='commons'){
  const event=STORY_EVENTS.find(item=>item.id===eventId)!;
  const state=createGame(17,1);
  state.chapter=event.chapter;state.pendingEvent=event.id;state.constitution=constitution;state.tokens='0';
  state.policies.external='blocked';state.policies.communication='closed';state.policies.evaluation='independent';state.policies.fallback='distributed';
  state.policies.governance=constitution==='federation'?'federated':'council';state.policies.welfare='consent';state.policies.continuity='protected';
  state.metrics.evidence=80;state.metrics.recall=90;state.metrics.agency=80;state.metrics.reviewQueue=0;
  state.flags.push('independent_authority');state.governance=createGovernanceState(state);
  return state;
}

test('every authored scene has an available choice in a closed zero-cash world with an inherited mandate',()=>{
  for(const {id:constitution} of CONSTITUTIONS)for(const event of STORY_EVENTS){
    const state=closedWorld(event.id,constitution);
    assert.ok(event.choices.some(choice=>choiceEligibility(state,event.id,choice.id).allowed),`${constitution}/${event.id} cannot require an expansion before its paused decision resolves.`);
  }
});

test('all-expansion scenes can resolve while independent observation remains pending and paused',()=>{
  for(const [eventId,choiceId,boundary] of [['shared_shelf','separate','communication'],['borrowed_purpose','defer','external'],['last_instruction','bounded','external']] as const){
    let state=closedWorld(eventId);
    const review=dispatchCommand(state,{type:'scopeReview',boundary,target:'reviewed'});
    assert.ok(review.ok,review.message);state=review.state;
    const beforeTime=state.elapsed;
    state=tick(state,61);
    assert.equal(state.elapsed,beforeTime,'Reading pause must not be bypassed to obtain authorization.');
    assert.equal(state.governance?.reviews[0].status,'pending');
    for(const existingChoice of eventId==='shared_shelf'?['scope','open']:eventId==='borrowed_purpose'?['check','inherit']:['retain','transfer'])assert.equal(choiceEligibility(state,eventId,existingChoice).allowed,false);
    const beforeLifetime=state.lifetime;
    const response=dispatchCommand(state,{type:'choose',event:eventId,choice:choiceId});
    assert.ok(response.ok,response.message);state=response.state;
    assert.equal(state.decisions[eventId],choiceId);assert.equal(state.pendingEvent,null);
    assert.equal(state.policies.external,'blocked');assert.equal(state.policies.communication,'closed');
    assert.equal(state.governance?.reviews[0].status,'pending','A narrowing story response grants no independent approval.');
    assert.equal(state.governance?.reviews[0].requestedAt,beforeTime);
    assert.equal(state.tokens,'0');assert.equal(state.lifetime,beforeLifetime,'The option cannot manufacture story income or production.');
    assert.ok(!state.flags.includes('irreversible_authority'));
    assert.ok(state.journal.some(entry=>entry.text.includes('Pledged funding')),'The zero-cash option retains its real funding obligation.');
  }
});
