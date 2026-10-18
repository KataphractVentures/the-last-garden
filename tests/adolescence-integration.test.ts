import assert from 'node:assert/strict';
import test from 'node:test';
import type {Command,GameState} from '../src/contracts';
import {actionEligibility,createGame,dispatchCommand,tick} from '../src/engine';
import {STORY_EVENTS} from '../src/content/story';
import {prepareOperatingFixture} from './operatingFixture';

function apply(state:GameState,command:Command){const result=dispatchCommand(state,command);assert.ok(result.ok,result.message);return result.state;}
// Explicit funded integration fixture; full earned campaigns are separate.
function ready(){
  let s=createGame(1701,0);s.chapter=7;s.pendingEvent=null;s.settings.readingPause=false;
  s.decisions=Object.fromEntries(STORY_EVENTS.map(event=>[event.id,event.choices[0].id]));
  s.tokens='1e12';s.lifetime='1e12';s.useful='1e12';s.research='1e9';s.producers.institution=30;s.producers.control=10;s.producers.compute=30;
  s.policies={contract:'verified',external:'blocked',communication:'closed',evaluation:'independent',welfare:'consent',continuity:'protected',fallback:'distributed',governance:'council'};
  s.metrics={quality:95,distortion:0,agency:88,welfare:85,dependence:20,evidence:95,recall:95,coordination:85,pressure:15,continuity:90,humanWelfare:85,reviewQueue:0};
  return prepareOperatingFixture(s);
}

test('certifying useful work preserves physical boundary evidence and the Garden observation interval',()=>{
  const before=ready();assert.ok(actionEligibility(before,'certify').allowed);
  const after=apply(before,{type:'certify'});
  assert.deepEqual(after.clearance!.observation,before.clearance!.observation);
  assert.equal(after.viableSeconds,before.viableSeconds);
  assert.equal(after.certificateProgress,0);
  assert.equal(dispatchCommand(after,{type:'certify'}).ok,false);
});

test('equipment purchases cannot renew an expiring-authority measurement window',()=>{
  let s=ready();s.modules=['expiring-authority'];
  s=apply(s,{type:'policy',key:'external',value:'reviewed'});
  s=tick(s,40);assert.equal(s.policies.external,'reviewed');
  s=apply(s,{type:'buy',id:'helper',quantity:1});
  s=tick(s,20);assert.equal(s.policies.external,'blocked');
  assert.equal(s.clearance!.observation,null);
});

test('an actual new boundary drill sustains staged reviewed scope and outcomes remain immutable',()=>{
  let s=ready();s.modules=['expiring-authority'];s=apply(s,{type:'policy',key:'external',value:'reviewed'});
  s=apply(s,{type:'drill'});const original=structuredClone(s);
  const advanced=tick(s,60);
  assert.deepEqual(s,original);assert.equal(advanced.policies.external,'reviewed');
  assert.notDeepEqual(advanced.governance,s.governance);assert.notDeepEqual(advanced.society,s.society);
});

test('accurate human-directed abuse suspends certification despite healthy technical metrics',()=>{
  let s=ready();s=apply(s,{type:'society',action:'case',id:'requester',choice:'comply'});
  assert.equal(s.metrics.distortion,0);assert.ok(s.metrics.recall>=75);
  assert.equal(actionEligibility(s,'certify').allowed,false);
  assert.equal(s.certificateProgress,0);
  s=apply(s,{type:'society',action:'repair',id:'requester'});s=tick(s,120);
  assert.equal(s.society!.cases[0].repaired,true);
});
