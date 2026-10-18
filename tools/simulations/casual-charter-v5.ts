/** Decisions use the current board's displayed meters, quotes and progress only. */
import Decimal from 'decimal.js';
import type { GameState } from '../../src/contracts.ts';
import type { CharterActionQuote, CharterMode } from '../../src/constitution/types.ts';

export function currentCharterMode(s:GameState):CharterMode|undefined {
 const c=s.charter;if(!c)return;
 switch(c.kind){
  case 'commons':return c.data.mode;
  case 'precaution':return c.data.scope;
  case 'service':return c.data.mode;
  case 'federation':return c.data.route;
  case 'plural':return c.data.agreement;
  case 'frontier':return c.data.offer;
 }
}

export function preferredCharterMode(s:GameState):CharterMode {
 switch(s.constitution){
  case 'commons':return 'maintained';
  case 'precaution':return 'staged';
  case 'service':return s.charter?.kind==='service'&&s.charter.data.active?'urgent':'buffers';
  case 'federation':return 'redundant';
  case 'plural':return 'matched';
  case 'frontier':return 'public';
 }
}

/** Coarse queue matching: nearest 5 percentage points, then correct the largest lane. */
export function casualServiceAllocation(s:GameState):number[]|undefined {
 if(s.charter?.kind!=='service'||!s.charter.data.active)return;
 const c=s.charter;
 const queues=c.data.lanes.map(lane=>Math.max(0,lane.backlog));
 const total=queues.reduce((sum,n)=>sum+n,0);if(total<=0)return;
 const shares=queues.map(n=>n===0?0:Math.max(.05,Math.round(n/total*20)/20));
 const largest=queues.indexOf(Math.max(...queues));
 shares[largest]+=1-shares.reduce((sum,n)=>sum+n,0);
 if(shares.some((n,i)=>Math.abs(n-c.data.allocation[i])>=.1))return shares;
}

export function urgentCharterDuty(s:GameState,quotes:CharterActionQuote[],bottleneck:string):boolean {
 const c=s.charter;if(!c)return false;
 if(quotes.some(q=>q.allowed&&['settleService','settleTender'].includes(q.action)))return true;
 switch(c.kind){
  case 'commons':return c.data.methods.some(method=>!method.retired&&method.maintenance<50);
  case 'precaution':return /bonded deployment capacity/i.test(bottleneck)||c.data.tranches.some(tranche=>tranche.coverage<.8);
  case 'service':return false; // Finite queues are reviewed at the normal institution visit.
  case 'federation':return false;
  case 'plural':return c.data.unmet>0;
  case 'frontier':return c.data.tenders.some(tender=>tender.remaining<=240);
 }
}

export function chooseCasualCharterAction(s:GameState,quotes:CharterActionQuote[],options:{routine:boolean;capstoneReady:boolean;bottleneck:string}):CharterActionQuote|undefined {
 const c=s.charter;if(!c)return;
 const allowed=quotes.filter(q=>q.allowed);
 const closing=s.chapter===7&&c.appliedTier>=6;
 const find=(action:CharterActionQuote['action'],predicate:(q:CharterActionQuote)=>boolean=()=>true)=>allowed.find(q=>q.action===action&&predicate(q));
 const affordableCommitment=(q:CharterActionQuote)=>new Decimal(q.cost).lte(new Decimal(s.tokens).mul(.4))&&new Decimal(q.researchCost).lte(new Decimal(s.research).mul(.4));
 const newCommitment=(action:CharterActionQuote['action'],predicate:(q:CharterActionQuote)=>boolean=()=>true)=>options.routine&&!closing?find(action,q=>affordableCommitment(q)&&predicate(q)):undefined;
 const capstoneNeeded=options.capstoneReady&&c.appliedTier<6;
 const settlement=find('settleService')??find('settleTender');if(settlement)return settlement;
 switch(c.kind){
  case 'commons':{
   const needy=c.data.methods.filter(m=>!m.retired&&m.maintenance<(options.routine?75:50)).sort((a,b)=>a.maintenance-b.maintenance);
   for(const method of needy){const maintain=find('maintain',q=>q.target===method.id);if(maintain)return maintain;}
   if(capstoneNeeded){const application=newCommitment('publish',q=>/capstone|public correction standard/i.test(q.title+' '+q.description+' '+q.effect));if(application)return application;}
   if(c.data.methods.filter(m=>!m.retired).length<6)return newCommitment('publish');
   return;
  }
  case 'precaution':{
   if(/bonded deployment capacity/i.test(options.bottleneck)){
    const expansion=allowed.filter(q=>q.action==='renewTranche'&&q.secondary===1).sort((a,b)=>new Decimal(a.cost).cmp(b.cost))[0];
    if(expansion)return expansion;
   }
   const worn=c.data.tranches.filter(t=>t.coverage<(options.routine ? .9 : .8)).sort((a,b)=>a.coverage-b.coverage);
   for(const tranche of worn){const renewal=find('renewTranche',q=>q.target===tranche.id&&q.secondary!==1);if(renewal)return renewal;}
   if(capstoneNeeded&&options.routine){
    const application=newCommitment('openTranche',q=>/capstone/i.test(q.title));if(application)return application;
    if(c.data.tranches.length>=3){const least=[...c.data.tranches].sort((a,b)=>a.capacity-b.capacity)[0];return find('retireTranche',q=>q.target===least.id);}
   }
   if(c.data.tranches.length<2)return newCommitment('openTranche');
   return;
  }
  case 'service':return !c.data.active?newCommitment('acceptService'):undefined;
  case 'federation':{
   if(!options.routine)return;
   const districts=c.data.districts.map((district,index)=>({district,index})).sort((a,b)=>a.district.level-b.district.level||a.index-b.index);
   for(const {index} of districts){const invest=find('investDistrict',q=>q.target===index);if(invest)return invest;const fund=newCommitment('fundDistrict',q=>q.target===index);if(fund)return fund;}
   return;
  }
  case 'plural':{
   if(c.data.unmet>0||c.data.continuityDuty>0){const preservation=find('preserve');if(preservation)return preservation;}
   if(options.routine){
    const agreement=newCommitment('negotiate');if(agreement)return agreement;
    // Funding an existing duty remains available while closing the final chapter.
    const funding=find('fundCare',affordableCommitment);if(funding)return funding;
   }
   return;
  }
  case 'frontier':{
   if(options.routine&&c.data.rivals.some(rival=>rival.pressure>50)){const disclosure=find('disclose',affordableCommitment);if(disclosure)return disclosure;}
   return !c.data.tenders.length?newCommitment('bid'):undefined;
  }
 }
}
