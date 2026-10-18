import type { Amount, GameState } from '../contracts';
import type { CharterActionQuote, CohortCommitment, PluralState, RegimeModule, Triple } from './types';
import { amount, base, clamp, decimal, Decimal, failure, flow, quote, refund, scaled, success } from './shared';

const NAMES = ['Tenders', 'Analysts', 'Keepers'];
type Schedule = Pick<CohortCommitment,'work'|'rest'|'continuity'|'fit'>;
const PORTFOLIOS:Record<PluralState['agreement'],Triple<Schedule>> = {
  uniform:[{work:.58,rest:.28,continuity:.14,fit:.9},{work:.58,rest:.28,continuity:.14,fit:.8},{work:.58,rest:.28,continuity:.14,fit:.7}],
  matched:[{work:.66,rest:.25,continuity:.09,fit:1},{work:.59,rest:.32,continuity:.09,fit:.98},{work:.5,rest:.28,continuity:.22,fit:.96}],
  rotation:[{work:.6,rest:.29,continuity:.11,fit:.94},{work:.6,rest:.3,continuity:.1,fit:.96},{work:.54,rest:.3,continuity:.16,fit:.92}],
};
const BASE_WORK = .58 * .8;
const CARE_PACK = 360;
const MAX_DUTY = 10000;
const dataOf = (state:GameState):PluralState|undefined => state.charter?.kind === 'plural' ? state.charter.data : undefined;
const scheduleTier = (agreement:PluralState['agreement']):1|2|4 => agreement==='rotation'?4:agreement==='matched'?2:1;
const isSame = (cohort:CohortCommitment, schedule:Schedule) => cohort.accepted && cohort.work === schedule.work && cohort.rest === schedule.rest && cohort.continuity === schedule.continuity && cohort.fit === schedule.fit;
function carePerSecond(data:PluralState):number {
  return .018 + data.cohorts.reduce((sum, cohort) => sum + (cohort.accepted ? cohort.continuity * .008 : 0), 0);
}
function workShares(data:PluralState):Triple<number> {
  const funded = decimal(data.careReserve).gt(0);
  return data.cohorts.map(cohort => {
    if (!cohort.accepted) return 0;
    const scheduled = cohort.work * cohort.fit;
    // Loss of a care reserve closes expanded assignments; it does not erase or coerce a cohort.
    return (funded ? scheduled : Math.min(scheduled, BASE_WORK)) / (3 * BASE_WORK);
  }) as Triple<number>;
}
function actions(state:GameState, scale:Amount):CharterActionQuote[] {
  const data = dataOf(state);
  if (!data) return [];
  const result:CharterActionQuote[] = [
    quote(state, scale, {action:'fundCare', title:'Fund a care reserve', description:'Reserve 360 normalized tokens for agreed accommodations and continuity support. Operating care draws only from this balance.', effect:`Adds roughly ${Math.floor(CARE_PACK / carePerSecond(data) / 3600)} hours of active care at the current schedule. This is committed principal, not extra production.`, cost:CARE_PACK, tier:1, reason:decimal(data.careReserve).gte(scaled(scale, CARE_PACK * 4))?'The reserve already holds four care budgets; use the existing funding first.':undefined}),
    quote(state, scale, {action:'withdraw', title:'Return unspent care funding', description:'Return the remaining care reserve to the shared wallet. Expanded assignments close while care is unfunded; the population and its continuity duties remain.', effect:'Unspent principal returns once. Continuity obligations are not canceled.', refund:data.careReserve, tier:1, requiresEvidence:false, reason:decimal(data.careReserve).lte(0)?'There is no unspent care funding.':undefined}),
  ];
  for (let target = 0; target < 3; target++) {
    const cohort = data.cohorts[target];
    const desired = PORTFOLIOS[data.agreement][target];
    result.push(quote(state, scale, {action:'negotiate', target, title:`Offer ${NAMES[target]} the ${data.agreement} schedule`, description:`A bounded offer: ${Math.round(desired.work*100)}% work, ${Math.round(desired.rest*100)}% rest, ${Math.round(desired.continuity*100)}% continuity. Observed task fit is ${Math.round(desired.fit*100)}%; this does not establish sentience.`, effect:'Applies a funded, tested work commitment and records its continuity duty. A changed portfolio requires a new agreement.', cost:24 + target * 8, researchCost:2, tier:scheduleTier(data.agreement), reason:isSame(cohort, desired)?'This cohort already has this schedule.':decimal(data.careReserve).lt(scaled(scale, 15))?'Reserve at least 15 normalized care tokens before offering expanded commitments.':undefined}));
    result.push(quote(state, scale, {action:'preserve', target, title:`Preserve ${NAMES[target]}' continuity`, description:'Use the reciprocal-work capstone to fulfill up to 12 accrued continuity duties with a funded preservation procedure.', effect:'Fulfilled duties are removed from the open ledger and recorded as preserved. Neither obedience nor production is rewarded.', cost:48, researchCost:4, tier:6, reason:!cohort.accepted?'An accepted commitment is required.':data.continuityDuty < .01?'No continuity duty is currently open.':decimal(data.careReserve).lt(scaled(scale, 5))?'The preservation procedure needs five normalized tokens in the care reserve.':undefined}));
  }
  return result;
}

export const pluralRegime:RegimeModule = {
  kind:'plural',
  modes:[
    {id:'uniform', name:'Common schedule', description:'One modest schedule for every cohort. Task fit differs; a shared rule is not automatically an appropriate accommodation.'},
    {id:'matched', name:'Matched commitments', description:'Offer each cohort different work, rest, and continuity shares. Higher accepted capacity depends on funded care.'},
    {id:'rotation', name:'Rotating duties', description:'Offer a more even rotation with longer rest and fewer continuity duties than the matched portfolio. Each cohort must agree again.'},
  ],
  create:() => ({...base(),kind:'plural',data:{cohorts:PORTFOLIOS.uniform.map((schedule,index) => ({...schedule,id:(['tenders','analysts','keepers'] as const)[index],accepted:true,served:0})) as Triple<CohortCommitment>,agreement:'uniform',careReserve:'0',continuityDuty:0,preserved:0,unmet:0}}),
  actions,
  configure(state, command) {
    const data = dataOf(state);
    if (!data) return failure('The plural society is not established.');
    if (!command.mode || (command.mode !== 'uniform' && command.mode !== 'matched' && command.mode !== 'rotation')) return failure('Choose a shared work portfolio.');
    if (command.allocation || command.focus) return failure('A cohort schedule changes through negotiation.');
    data.agreement = command.mode;
    return success('The proposed portfolio changed. Existing cohort agreements remain in force until each new offer is accepted.');
  },
  act(state, selected, context) {
    const data = dataOf(state);
    if (!data) return failure('The plural society is not established.');
    if (selected.action === 'fundCare') {
      data.careReserve = amount(decimal(data.careReserve).add(selected.cost));
      return success('The quoted tokens now fund care; they remain separate from spendable production funds.');
    }
    if (selected.action === 'withdraw') {
      refund(state, data.careReserve);
      data.careReserve = '0';
      return success('Unspent care principal returned. Local work continues and continuity duties remain.');
    }
    if (selected.target === undefined || !Number.isInteger(selected.target) || selected.target < 0 || selected.target > 2) return failure('Choose an existing cohort.');
    const cohort = data.cohorts[selected.target];
    if (selected.action === 'negotiate') {
      const desired = PORTFOLIOS[data.agreement][selected.target];
      if (isSame(cohort, desired) || decimal(data.careReserve).lt(scaled(context.scale, 15))) return failure('The offer is unchanged or care is not funded.');
      Object.assign(cohort, desired, {accepted:true});
      data.continuityDuty = Math.min(MAX_DUTY, data.continuityDuty + desired.continuity * 20);
      return success(`${NAMES[selected.target]} accepted a schedule with distinct work, rest, and continuity time. Its duty is now in the ledger.`);
    }
    if (selected.action === 'preserve') {
      if (data.continuityDuty <= 0 || decimal(data.careReserve).lt(scaled(context.scale, 5))) return failure('No funded continuity duty is available.');
      const fulfilled = Math.min(12, data.continuityDuty);
      data.careReserve = amount(decimal(data.careReserve).sub(scaled(context.scale, 5)));
      data.continuityDuty = Math.max(0, data.continuityDuty - fulfilled);
      data.preserved = Math.min(1e9, data.preserved + fulfilled);
      data.unmet = Math.max(0, data.unmet - fulfilled);
      return success(`The funded procedure preserved ${fulfilled.toFixed(2)} continuity duties. No work or income was manufactured by preservation.`);
    }
    return failure('This is not a reciprocal-work operation.');
  },
  rates(state, rates) {
    const data = dataOf(state);
    if (!data) return rates;
    const work = workShares(data);
    const factor = clamp(work.reduce((sum, value) => sum + value, 0), .2, 1.4);
    const funded = decimal(data.careReserve).gt(0);
    const result = {...rates,tokens:amount(decimal(rates.tokens).mul(factor)),useful:amount(decimal(rates.useful).mul(factor)),click:amount(decimal(rates.click).mul(Math.max(.5,factor)))};
    return flow(state,result,{dedicatedUseful:result.useful,note:`Accepted work supplies ${Math.round(factor * 100)}% of baseline capacity. ${funded?'Agreed care is funded.':'Expanded assignments are closed; bounded local work continues.'} ${data.continuityDuty.toFixed(1)} continuity duties remain open.`});
  },
  tick(state, seconds, rates, context) {
    const data = dataOf(state);
    if (!data || seconds <= 0) return;
    const expense = decimal(scaled(context.scale, carePerSecond(data))).mul(seconds);
    const spent = Decimal.min(expense, decimal(data.careReserve));
    const careFraction = expense.gt(0) ? spent.div(expense).toNumber() : 1;
    data.careReserve = amount(decimal(data.careReserve).sub(spent));
    const work = workShares(data);
    const total = work.reduce((sum, value) => sum + value, 0);
    // A bounded assignment count is a readable institutional metric, not spendable currency.
    const assignments = Math.min(1000, decimal(rates.useful).div(context.scale).toNumber()) * seconds;
    data.cohorts.forEach((cohort,index) => {
      cohort.served = Math.min(1e9,cohort.served + assignments * work[index] / Math.max(.000001,total));
    });
    const duty = data.cohorts.reduce((sum,cohort) => sum + (cohort.accepted ? cohort.continuity : 0),0) * seconds / 900;
    data.continuityDuty = Math.min(MAX_DUTY,data.continuityDuty + duty);
    data.unmet = clamp(data.unmet + duty * (1-careFraction) - duty * careFraction * .5,0,MAX_DUTY);
  },
  auto(state, scale) {
    const data = dataOf(state);
    if (!data) return undefined;
    const options = actions(state,scale);
    if (decimal(data.careReserve).lt(scaled(scale,carePerSecond(data) * 1800))) return options.find(option => option.action==='fundCare' && option.allowed);
    const negotiation = options.find(option => option.action==='negotiate' && option.allowed);
    if (negotiation) return negotiation;
    // Preservation spends both the quoted wallet cost and the care reserve;
    // keep that cross-ledger decision explicit until both budgets can be bound.
    return undefined;
  },
};
