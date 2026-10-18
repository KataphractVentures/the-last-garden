import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine';
import { applyGovernanceCommand, compactVerificationEligibility, consumeGovernanceAuthorization, createGovernanceState, ensureGovernance, governanceEffects, governanceGardenEligibility, governancePolicyEligibility, governanceState, scopeReview, tickGovernance } from '../src/governance';
import { createCharterEconomy, getCharterActions, dispatchCharterCommand } from '../src/constitution/economics';
import { federationRegime, districtReturnable } from '../src/constitution/federation';
import { decimal } from '../src/engine/amounts';
import type { CharterContext } from '../src/constitution/types';

function fixture(){const state=createGame(73,1000);state.chapter=5;state.pendingEvent=null;state.elapsed=1000;state.policies.evaluation='independent';state.policies.external='blocked';state.policies.communication='closed';state.policies.fallback='distributed';state.metrics.evidence=80;state.metrics.recall=90;state.metrics.agency=80;state.metrics.reviewQueue=0;state.governance=createGovernanceState();return state;}
function mandate(state:ReturnType<typeof fixture>){assert.equal(applyGovernanceCommand(state,{type:'publicMandate'}).ok,true);}
function review(state:ReturnType<typeof fixture>){assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed'}).ok,true);state.elapsed+=60;assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed'}).ok,true);}

test('a historic independence promise becomes durable rights without inventing approvals or mutating reads',()=>{
  const state=fixture();delete state.governance;state.flags.push('independent_authority');const before=structuredClone(state);
  assert.equal(governanceState(state).mandate,'inherited');assert.deepEqual(state,before);
  assert.equal(governancePolicyEligibility(state,'external','reviewed').allowed,false);
  const established=ensureGovernance(state);assert.equal(established.mandate,'inherited');assert.deepEqual(established.reviews,[]);assert.equal(established.mandateAt,null);
});
test('public refusal survives administration changes and only a repaired appeal can authorize scope',()=>{
  const state=fixture();mandate(state);state.metrics.recall=20;review(state);
  assert.equal(scopeReview(state,'external')?.status,'refused');
  for(const administration of ['central','federated','council'] as const){state.policies.governance=administration;assert.equal(governancePolicyEligibility(state,'external','reviewed').allowed,false);}
  assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed'}).ok,false);
  assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed',appeal:true}).ok,true);
  assert.equal(scopeReview(state,'external')?.status,'refused');state.metrics.recall=90;
  assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed',appeal:true}).ok,true);
  assert.equal(governancePolicyEligibility(state,'external','reviewed').allowed,true);assert.equal(governancePolicyEligibility(state,'external','open').allowed,false);
});
test('a scope grant is exact and single use; narrowing cannot manufacture a replacement',()=>{
  const state=fixture();mandate(state);review(state);
  assert.equal(governancePolicyEligibility(state,'communication','reviewed').allowed,false);
  consumeGovernanceAuthorization(state,'external','reviewed');state.policies.external='reviewed';
  assert.equal(scopeReview(state,'external')?.status,'used');assert.equal(governancePolicyEligibility(state,'external','blocked').allowed,true);
  state.policies.external='blocked';assert.equal(governancePolicyEligibility(state,'external','reviewed').allowed,false);
  assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed'}).ok,true);
  assert.equal(applyGovernanceCommand(state,{type:'scopeReview',boundary:'external',target:'reviewed'}).ok,false,'A fresh observation cannot be skipped.');
});
test('central administration can retain legitimate oversight; unaccountable expansion never counts as a public mandate',()=>{
  const state=fixture();state.policies.governance='central';assert.equal(governancePolicyEligibility(state,'external','open').allowed,true);
  assert.equal(governanceGardenEligibility(state).allowed,false);mandate(state);assert.equal(governanceGardenEligibility(state).allowed,true);
});
test('another institution develops with time, and accepted but unverified promises do not restrain it',()=>{
  const control=fixture(),agreed=fixture();mandate(agreed);
  assert.equal(applyGovernanceCommand(agreed,{type:'externalCompact',terms:'inspection'}).ok,true);
  tickGovernance(control,120);tickGovernance(agreed,120);control.elapsed+=120;agreed.elapsed+=120;
  assert.equal(governanceState(control).actor.capability,governanceState(agreed).actor.capability);
  assert.equal(compactVerificationEligibility(agreed).allowed,true);assert.equal(applyGovernanceCommand(agreed,{type:'compactVerify'}).ok,true);
  tickGovernance(control,1000);tickGovernance(agreed,1000);assert(governanceState(agreed).actor.capability<governanceState(control).actor.capability);
  assert(governanceEffects(agreed).reviewMultiplier<governanceEffects(control).reviewMultiplier);
  const capability=governanceState(agreed).actor.capability;assert.equal(applyGovernanceCommand(agreed,{type:'externalCompact',terms:'none'}).ok,true);assert.equal(governanceState(agreed).actor.capability,capability);
});
test('privacy and inspection trade distinct costs; broken verifiability suspends reciprocal restraint',()=>{
  const inspection=fixture(),privacy=fixture();mandate(inspection);mandate(privacy);
  applyGovernanceCommand(inspection,{type:'externalCompact',terms:'inspection'});applyGovernanceCommand(privacy,{type:'externalCompact',terms:'privacy'});
  tickGovernance(inspection,240);tickGovernance(privacy,240);inspection.elapsed+=240;privacy.elapsed+=240;
  applyGovernanceCommand(inspection,{type:'compactVerify'});applyGovernanceCommand(privacy,{type:'compactVerify'});
  assert(governanceEffects(inspection).agencyDelta<governanceEffects(privacy).agencyDelta);
  assert(governanceEffects(inspection).pressureDelta<governanceEffects(privacy).pressureDelta);
  privacy.policies.evaluation='shared';tickGovernance(privacy,1);assert.equal(governanceState(privacy).actor.verified,false);assert.equal(governanceState(privacy).actor.verifiedAt,null);
  const paused=structuredClone(inspection);paused.paused=true;const before=structuredClone(paused.governance);tickGovernance(paused,100);assert.deepEqual(paused.governance,before);
});

const context:CharterContext={scale:'1',income:()=>{},log:()=>{}};
function federation(){const s=fixture();s.constitution='federation';s.charter=createCharterEconomy('federation');s.tokens='1000';s.research='1000';if(s.charter.kind!=='federation')throw Error('fixture');return s;}
test('Federation withdrawal returns explicit unused capital but cannot confiscate local operating income',()=>{
  const s=federation();if(s.charter?.kind!=='federation')throw Error('fixture');const district=s.charter.data.districts[0];
  district.treasury='120';district.returnable='20';const before=decimal(s.tokens).add(district.treasury);
  assert.equal(dispatchCharterCommand(s,{type:'charterAction',action:'withdraw',target:0},context).ok,true);
  assert.equal(s.tokens,'1020');assert.equal(district.treasury,'100');assert.equal(district.returnable,'0');assert(decimal(s.tokens).add(district.treasury).eq(before));
  assert.equal(getCharterActions(s).find(action=>action.action==='withdraw'&&action.target===0)?.allowed,false);
  assert.equal(dispatchCharterCommand(s,{type:'charterAction',action:'withdraw',target:0},context).ok,false);
});
test('Federation transfers preserve owned-fund classification and cannot launder it through another district',()=>{
  const s=federation();if(s.charter?.kind!=='federation')throw Error('fixture');const source=s.charter.data.districts[0];source.treasury='100';source.returnable='10';
  const operation=federationRegime.actions(s,'1').find(action=>action.action==='transferDistrict'&&action.target===0&&action.secondary===1)!;
  assert.equal(federationRegime.act(s,operation,context).ok,true);const transfer=s.charter.data.transfers[0];assert.equal(transfer.returnable,'10');assert.equal(districtReturnable(source),'0');
  federationRegime.tick(s,18,{tokens:'0',useful:'0',research:'0',raw:'0',compute:0,demand:0,utilization:0,review:0,distortion:0,click:'0',bottleneck:''},context);
  const destination=s.charter.data.districts[1];assert.equal(destination.treasury,'25');assert.equal(districtReturnable(destination),'10');
  assert.equal(dispatchCharterCommand(s,{type:'charterAction',action:'withdraw',target:1},context).ok,true);assert.equal(destination.treasury,'15');
  assert.equal(dispatchCharterCommand(s,{type:'charterAction',action:'withdraw',target:1},context).ok,false);
});
test('legacy Federation funds without recorded returnable capital remain local and can still fund institutions',()=>{
  const s=federation();if(s.charter?.kind!=='federation')throw Error('fixture');const district=s.charter.data.districts[0];district.treasury='120';delete district.returnable;
  assert.equal(districtReturnable(district),'0');const investment=federationRegime.actions(s,'1').find(action=>action.action==='investDistrict'&&action.target===0)!;
  assert.equal(federationRegime.act(s,investment,context).ok,true);assert.equal(district.level,1);assert.equal(district.treasury,'40');assert.equal(district.returnable,'0');
});
