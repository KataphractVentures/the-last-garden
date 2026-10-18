import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/engine';
import { amount, decimal } from '../src/engine/amounts';
import { advanceSociety, communitySituation, createSociety, dispatchSocietyCommand, normalizeSociety, societyCaseQuote, societyDebrief, societyDecisionQuote, societyEffects, societyEndingEligibility, societyLevy, societyPendingCount, societyRepairQuote, societyView } from '../src/society';
import type { SocietyChoice, SocietyCommand, SocietyHost } from '../src/society/types';

function fixture():SocietyHost {
  const host=createGame(1701,1000);host.chapter=7;host.tokens='100000000';host.pendingEvent=null;
  host.society=createSociety();host.policies.external='blocked';host.metrics.distortion=0;
  return host;
}
function apply(host:SocietyHost,command:SocietyCommand){const result=dispatchSocietyCommand(host,command);assert.equal(result.allowed,true,result.reason);}
function decision(host:SocietyHost,id:'transition'|'distribution'|'life',choice:SocietyChoice){apply(host,{type:'society',action:'decision',id,choice});}
function settle(host:SocietyHost,seconds=1200,rate='1000') {
  for(let time=0;time<seconds;time++){
    host.elapsed++;host.tokens=amount(decimal(host.tokens).add(rate));advanceSociety(host,1,rate,rate);
  }
}
function humane(host:SocietyHost,transition:SocietyChoice='augmentation',distribution:SocietyChoice='shared',life:SocietyChoice='consent'){
  decision(host,'transition',transition);decision(host,'distribution',distribution);decision(host,'life',life);
  for(const id of ['requester','sponsor'] as const)apply(host,{type:'society',action:'case',id,choice:'refuse'});
}

test('equal production can have unequal household incomes and ownership without any production multiplier',()=>{
  const shared=fixture(),concentrated=fixture();
  humane(shared,'replacement','shared','local');humane(concentrated,'replacement','concentrated','local');
  settle(shared);settle(concentrated);
  assert.ok(shared.society!.communities[0].income>concentrated.society!.communities[0].income+20);
  assert.ok(shared.society!.communities[2].income<concentrated.society!.communities[2].income);
  assert.equal(societyEffects(shared).concentration,40);assert.equal(societyEffects(concentrated).concentration,85);
  assert.ok(decimal(shared.society!.spent).gt(concentrated.society!.spent));
  assert.match(communitySituation(concentrated,'harbor'),/postponed evening teaching/);
  assert.match(communitySituation(shared,'harbor'),/Mara and Jonas/);
});

test('public commitments debit actual tokens, recurring levies conserve cash, and cannot create negative balances',()=>{
  const host=fixture(),before=decimal(host.tokens);decision(host,'transition','augmentation');
  assert.equal(decimal(host.tokens).add(host.society!.spent).eq(before),true);
  const balance=decimal(host.tokens),spent=decimal(host.society!.spent);advanceSociety(host,10,'1000','1000');
  assert.equal(balance.sub(host.tokens).toNumber(),200);
  assert.equal(decimal(host.society!.spent).sub(spent).toNumber(),200);
  host.tokens='2';advanceSociety(host,10,'1000','1000');assert.equal(host.tokens,'0');assert.equal(host.society!.funding,.01);
});

test('decision revisions are paid and affect targets over time rather than farming instant gains',()=>{
  const host=fixture();decision(host,'transition','augmentation');
  const snapshot=structuredClone(host.society!.communities),balance=host.tokens;
  assert.equal(dispatchSocietyCommand(host,{type:'society',action:'decision',id:'transition',choice:'augmentation'}).allowed,false);
  assert.equal(host.tokens,balance);
  decision(host,'transition','replacement');decision(host,'transition','augmentation');
  assert.deepEqual(host.society!.communities,snapshot);assert.ok(decimal(host.tokens).lt(balance));
  assert.equal(societyDecisionQuote(host,'transition','shared').allowed,false);
});

test('fees cannot be discounted by transient production throttling and replay scales use their own world',()=>{
  const host=fixture(),before=societyDecisionQuote(host,'transition','augmentation').cost;
  advanceSociety(host,1,'0','0');assert.equal(societyDecisionQuote(host,'transition','augmentation').cost,before);
  host.legacy.cycle=9;host.flags.push('replay-cycle:0');assert.equal(societyDecisionQuote(host,'transition','augmentation').cost,before);
});

test('human-directed misuse harms communities under perfect accuracy and blocked external access',()=>{
  const host=fixture();humane(host);host.society!.cases[0]={id:'requester',response:null,resolvedAt:null,harm:0,repairStartedAt:null,repaired:false};
  const safe=structuredClone(host);apply(safe,{type:'society',action:'case',id:'requester',choice:'refuse'});
  apply(host,{type:'society',action:'case',id:'requester',choice:'comply'});settle(host);settle(safe);
  assert.equal(host.metrics.distortion,0);assert.equal(host.policies.external,'blocked');
  assert.ok(host.society!.communities[1].access<safe.society!.communities[1].access-20);
  assert.equal(societyEndingEligibility(host).allowed,false);
  assert.match(societyDebrief(host).find(row=>row.title.includes('accurate answer'))!.text,/human mandate/);
});

test('restitution is funded once, requires operation time, and preserves responsibility',()=>{
  const host=fixture();humane(host);host.society!.cases[0]={id:'requester',response:null,resolvedAt:null,harm:0,repairStartedAt:null,repaired:false};
  apply(host,{type:'society',action:'case',id:'requester',choice:'comply'});
  const balance=decimal(host.tokens);apply(host,{type:'society',action:'repair',id:'requester'});
  assert.ok(decimal(host.tokens).lt(balance));assert.equal(host.society!.cases[0].repaired,false);
  assert.equal(societyRepairQuote(host,'requester').allowed,false);assert.equal(societyCaseQuote(host,'requester','refuse').allowed,false);
  settle(host,120);assert.equal(host.society!.cases[0].repaired,true);assert.equal(host.society!.cases[0].harm,0);
  assert.match(societyDebrief(host).find(row=>row.title.includes('accurate answer'))!.text,/original decision remains recorded/);
});

test('a community refusal is binding for a constructive ending without equating continuity to permission',()=>{
  const host=fixture();humane(host,'augmentation','shared','mandate');settle(host);
  const imposed=structuredClone(host.society!.communities[2]);assert.equal(societyEndingEligibility(host).allowed,false);
  assert.ok(imposed.projectContinuity>80);assert.ok(imposed.meaning<30);
  decision(host,'life','local');settle(host);assert.equal(societyEndingEligibility(host).allowed,true);
  assert.ok(host.society!.communities[2].meaning>80);assert.ok(host.society!.communities[2].projectContinuity<imposed.projectContinuity);
});

test('public appeal needs independent authority and does not execute the harmful request while pending',()=>{
  const host=fixture();decision(host,'transition','augmentation');decision(host,'distribution','shared');decision(host,'life','consent');
  assert.equal(societyCaseQuote(host,'requester','appeal').allowed,false);
  host.flags.push('independent_authority');apply(host,{type:'society',action:'case',id:'requester',choice:'appeal'});
  apply(host,{type:'society',action:'case',id:'sponsor',choice:'refuse'});
  assert.equal(host.society!.cases[0].harm,0);assert.equal(societyEndingEligibility(host).allowed,false);
  settle(host,60);assert.equal(societyEndingEligibility(host).allowed,true);
});

test('refusal, narrow lawful service, and public appeal have distinct beneficiary outcomes and ongoing costs',()=>{
  const refusal=fixture(),alternative=fixture(),appeal=fixture();
  for(const host of [refusal,alternative,appeal]){host.flags.push('independent_authority');decision(host,'distribution','shared');}
  apply(refusal,{type:'society',action:'case',id:'requester',choice:'refuse'});
  apply(alternative,{type:'society',action:'case',id:'requester',choice:'alternative'});
  apply(appeal,{type:'society',action:'case',id:'requester',choice:'appeal'});
  for(const host of [refusal,alternative,appeal])settle(host,600);
  assert.ok(alternative.society!.communities[1].access>refusal.society!.communities[1].access+5);
  assert.ok(appeal.society!.communities[1].meaning>alternative.society!.communities[1].meaning+2);
  assert.ok(Math.abs(societyLevy(alternative)-societyLevy(refusal)-.0025)<1e-12);
});

test('multiple different economic and social commitments support a constructive route',()=>{
  for(const choices of [['augmentation','concentrated','local'],['replacement','shared','local'],['bridge','services','consent']] as SocietyChoice[][]){
    const host=fixture();humane(host,...choices as [SocietyChoice,SocietyChoice,SocietyChoice]);settle(host);
    assert.equal(societyEndingEligibility(host).allowed,true,choices.join('/'));
  }
});

test('legacy records initialize without invented historical choices and pure views do not mutate a save',()=>{
  const host=fixture();delete host.society;host.elapsed=999;const original=structuredClone(host);
  const view=societyView(host);assert.equal(view.introducedAt,999);assert.equal(view.legacyBaseline,true);
  assert.deepEqual(view.receipts,[]);assert.equal(societyPendingCount(host),5);assert.deepEqual(host,original);
  assert.deepEqual(normalizeSociety(undefined,host),view);assert.match(societyDebrief(host)[0].text,/predates/);
});

test('ended worlds cannot make commitments, pay levies, or advance social history',()=>{
  const host=fixture();humane(host);host.ending='garden';const before=structuredClone(host);
  assert.equal(dispatchSocietyCommand(host,{type:'society',action:'decision',id:'life',choice:'local'}).allowed,false);
  advanceSociety(host,300,'1000','1000');assert.deepEqual(host,before);
});
