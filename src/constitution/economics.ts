import type { Amount, ConstitutionId, Eligibility, GameState, Rates } from '../contracts';
import { CHARTER_PROGRAM_BY_CONSTITUTION } from '../laboratory/programs';
import { amount, decimal, Decimal, charterScale, charterClearance, success, failure, refund } from './shared';
import type { CharterActionQuote, CharterActionResult, CharterCommand, CharterContext, CharterEconomy, CharterModeOption, RegimeModule } from './types';
import { commonsRegime, hasViableCommonsApplication } from './commons';
import { precautionRegime, hasActivePrecautionApplication } from './precaution';
import { serviceRegime } from './service';
import { federationRegime } from './federation';
import { pluralRegime } from './plural';
import { frontierRegime } from './frontier';

const regimes:Record<ConstitutionId,RegimeModule>={commons:commonsRegime,precaution:precautionRegime,service:serviceRegime,federation:federationRegime,plural:pluralRegime,frontier:frontierRegime};
const yes=(reason:string):Eligibility=>({allowed:true,reason});
const no=(reason:string):Eligibility=>({allowed:false,reason});
const established=(s:GameState):boolean=>!!s.charter?.established&&s.charter.kind===s.constitution;
function money(value:unknown,allowZero=true):value is Amount {try{if(typeof value!=='string'||value.length>500)return false;const n=decimal(value);return n.isFinite()&&Math.abs(n.e)<=1e9&&n.toString().length<=128&&(allowZero?n.gte(0):n.gt(0));}catch{return false;}}
function available(s:GameState,q:CharterActionQuote,budget?:Amount):CharterActionQuote {
 if(!q.allowed)return q;
 if(decimal(budget??s.tokens).lt(q.cost))return {...q,allowed:false,reason:budget===undefined?'Not enough spendable tokens for this commitment.':'This operation exceeds the remaining authorized batch budget.'};
 if(decimal(s.research).lt(q.researchCost))return {...q,allowed:false,reason:'Keep enough research capacity for this operation; laboratory evidence alone does not pay its operating cost.'};
 return q;
}
function record(s:GameState,context:CharterContext,title:string,text:string):void {
 const c=s.charter;if(!c)return;
 c.receipts.push({id:++c.serial,time:s.elapsed,title,text});if(c.receipts.length>80)c.receipts.splice(0,c.receipts.length-80);
 context.log(title,text);
}
function meaningful(q:CharterActionQuote):boolean {return !['retract','retireTranche','withdraw','acceptService','bid','fundDistrict','transferDistrict','fundCare','bufferService'].includes(q.action);}
function perform(s:GameState,q:CharterActionQuote,context:CharterContext,automated=false):CharterActionResult {
 const c=s.charter;if(!c)return failure('Establish the strategy board first.');
 const budget=automated?c.automation?.budgetRemaining:undefined;const checked=available(s,q,budget);if(!checked.allowed)return failure(checked.reason);
 const before={charter:structuredClone(c),tokens:s.tokens,research:s.research,metrics:{...s.metrics}};
 if(automated&&c.automation)c.automation.budgetRemaining=amount(decimal(c.automation.budgetRemaining).sub(q.cost));else s.tokens=amount(decimal(s.tokens).sub(q.cost));
 s.research=amount(decimal(s.research).sub(q.researchCost));
 const earned:Amount[]=[];const logs:{title:string;text:string}[]=[];
 const result=regimes[c.kind].act(s,q,{...context,income:value=>earned.push(value),log:(title,text)=>logs.push({title,text})});
 if(!result.ok){s.charter=before.charter;s.tokens=before.tokens;s.research=before.research;s.metrics=before.metrics;return result;}
 for(const value of earned)if(decimal(value).gt(0))context.income(value);
 c.completed=Math.min(1e9,c.completed+1);if(meaningful(q))c.appliedTier=Math.max(c.appliedTier,q.tier);
 if(!automated&&!c.manualActions.includes(q.action))c.manualActions.push(q.action);
 record(s,context,q.title,`${result.message} ${automated?'Authorized batch operation. ':''}${q.effect}`);
 for(const log of logs)context.log(log.title,log.text);
 return result;
}

export function createCharterEconomy(kind:ConstitutionId):CharterEconomy {return regimes[kind].create();}
export function charterEstablishEligibility(s:GameState):Eligibility {return established(s)?no('This civilization already has its strategy board.'):yes('Establish an empty board with legal local operations. Existing savings and history stay intact; no capital or evidence is invented.');}
export function getCharterActions(s:GameState,scale:Amount=charterScale(s)):CharterActionQuote[] {return established(s)?regimes[s.constitution].actions(s,scale).map(q=>available(s,q)):[];}
export function getCharterModes(s:GameState):CharterModeOption[] {return established(s)?regimes[s.constitution].modes:[];}
export function charterAutomationScope(s:GameState) {return {actions:(s.charter?.manualActions??[]).filter(action=>!['openTranche','retireTranche','withdraw','retract','transferDistrict','investDistrict'].includes(action)),maxTier:s.charter?.appliedTier??0};}
export function charterConfigureEligibility(s:GameState,command:Extract<CharterCommand,{type:'charterConfigure'}>):Eligibility {
 if(!established(s))return no('Establish the strategy board first.');
 const copy={...s,charter:structuredClone(s.charter),metrics:{...s.metrics}};
 const result=regimes[s.constitution].configure(copy,command);return {allowed:result.ok,reason:result.message};
}
export function charterAutomationEligibility(s:GameState):Eligibility {
 if(!established(s))return no('Establish the strategy board first.');
 const clearance=charterClearance(s,3);if(!clearance.allowed)return clearance;
 if((s.charter?.completed??0)<3)return no('Complete three strategy operations yourself before authorizing a bounded batch.');
 if(!charterAutomationScope(s).actions.length)return no('Manually complete a repeatable strategy operation before authorizing its automation.');
 return yes('Mastery permits up to 20 operations using a locked token budget, an explicit reserve floor, and the current strategy. Stop returns unspent funds.');
}
export function dispatchCharterCommand(s:GameState,command:CharterCommand,context:CharterContext):CharterActionResult {
 if(command.type==='charterEstablish'){
  const e=charterEstablishEligibility(s);if(!e.allowed)return failure(e.reason);
  s.charter=createCharterEconomy(s.constitution);record(s,context,'Strategy board established',e.reason);return success(e.reason);
 }
 if(!established(s))return failure('Establish the strategy board first.');
 const c=s.charter!;
 if(command.type==='charterConfigure'){
  const e=charterConfigureEligibility(s,command);if(!e.allowed)return failure(e.reason);
  if(c.automation){refund(s,c.automation.budgetRemaining);c.automation=null;record(s,context,'Strategy batch stopped','A changed strategy requires a new authorization. Unspent funds returned.');}
  const result=regimes[c.kind].configure(s,command);if(result.ok)record(s,context,'Strategy revised',result.message);return result;
 }
 if(command.type==='charterAction'){
  const q=regimes[c.kind].actions(s,context.scale).find(q=>q.action===command.action&&q.target===command.target&&q.secondary===command.secondary);
  return q?perform(s,q,context):failure('This operation is not offered by the current strategy board. Refresh its quote.');
 }
 if(!command.enabled){
  const returned=c.automation?.budgetRemaining??'0';refund(s,returned);c.automation=null;
  record(s,context,'Strategy batch stopped',`Returned ${returned} unspent tokens to the treasury. This is a refund, not new income.`);return success('Unspent batch funds returned.');
 }
 const e=charterAutomationEligibility(s);if(!e.allowed)return failure(e.reason);
 if(c.automation)return failure('Stop the current strategy batch before replacing its authorization.');
 if(!Number.isInteger(command.runs)||command.runs!<1||command.runs!>20)return failure('Choose between 1 and 20 authorized operations.');
 if(!money(command.budget,false)||!money(command.reserveFloor??'0'))return failure('Choose a finite positive token budget and a nonnegative reserve floor.');
 if(decimal(s.tokens).sub(command.budget).lt(command.reserveFloor??'0'))return failure('The locked batch budget would cross your treasury reserve floor.');
 s.tokens=amount(decimal(s.tokens).sub(command.budget));c.automation={remaining:command.runs!,budgetRemaining:amount(command.budget),reserveFloor:amount(command.reserveFloor??'0'),elapsed:0,...charterAutomationScope(s)};
 record(s,context,'Strategy batch authorized',`${command.runs} operations; ${command.budget} tokens held separately. Current strategy and all evidence requirements still apply.`);return success('Bounded strategy automation started.');
}
export function applyCharterRates(s:GameState,rates:Rates,scale:Amount):Rates {
 if(!established(s))return rates;
 const result=regimes[s.constitution].rates(s,rates,scale);
 // Tending inherits available ordinary work, including its original upgrades;
 // it cannot bypass a case limit or collect work promised to a later settlement.
 const originalBase=Decimal.max(scale,decimal(rates.tokens).mul(.06));
 const tendingBonus=decimal(rates.click).div(originalBase);
 result.click=amount(Decimal.max(scale,decimal(result.tokens).mul(.06)).mul(tendingBonus));
 return result;
}
export function advanceCharter(s:GameState,seconds:number,rates:Rates,context:CharterContext):void {
 if(!established(s)||s.paused||s.ending||!Number.isFinite(seconds)||seconds<=0)return;
 const dt=Math.min(.25,seconds);regimes[s.constitution].tick(s,dt,rates,context);
 const c=s.charter!,batch=c.automation;if(!batch)return;
 batch.elapsed+=dt;if(batch.elapsed<30)return;batch.elapsed=0;
 const clearance=charterAutomationEligibility(s);
 const stop=(message:string)=>{const active=s.charter;if(!active?.automation)return;refund(s,active.automation.budgetRemaining);active.automation=null;record(s,context,'Strategy batch complete',`${message} Unspent funds returned without counting as income.`);};
 if(!clearance.allowed){stop(clearance.reason);return;}
 if(decimal(s.tokens).lt(batch.reserveFloor)){stop('The treasury reached its authorized reserve floor.');return;}
 const q=regimes[c.kind].auto(s,context.scale);if(!q)return;
 if(!batch.actions.includes(q.action)||q.tier>batch.maxTier){stop('The next operation exceeds the manually demonstrated operation types or evidence tier in this authorization.');return;}
 const eligible=available(s,q,batch.budgetRemaining);if(!eligible.allowed){if(decimal(batch.budgetRemaining).lt(q.cost))stop(eligible.reason);return;}
 const result=perform(s,q,context,true);if(!result.ok){stop(result.message);return;}
 if(c.automation){c.automation.remaining--;if(c.automation.remaining<=0)stop('The authorized operation limit was reached.');}
}
export function charterGardenEligibility(s:GameState):Eligibility {
 if(!established(s))return no('Establish this constitution’s strategy board before completing its expanded Garden Accord.');
 const evidence=charterClearance(s,6);if(!evidence.allowed)return evidence;
 const program=CHARTER_PROGRAM_BY_CONSTITUTION[s.constitution];
 if(!s.projects.includes(`${program}-10`))return no('Complete this constitution’s tenth research project and its integrated application.');
 if((s.charter?.appliedTier??0)<6)return no('Use the sixth study in a completed strategy application. The board marks its capstone operation.');
 const c=s.charter!;
 if(c.kind==='commons'&&!hasViableCommonsApplication(s))return no('Maintain a live correction-standard method and its dependencies before the Accord.');
 if(c.kind==='precaution'&&!hasActivePrecautionApplication(s))return no('Retain an active, funded capstone deployment case before the Accord.');
 if(c.kind==='service'&&c.data.active)return no('Settle the active service commitment before the Accord.');
 if(c.kind==='frontier'&&c.data.tenders.length)return no('Settle every outstanding tender before the Accord.');
 if(c.kind==='federation'&&c.data.transfers.length)return no('Let outstanding district transfers arrive before the Accord.');
 if(c.kind==='plural'&&c.data.unmet>1)return no('Fund care and resolve the displayed continuity duties before the Accord.');
 return yes('This constitution has tested, applied, and completed its distinctive research and economic commitments.');
}
