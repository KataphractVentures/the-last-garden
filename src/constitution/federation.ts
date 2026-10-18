import type { Amount, GameState } from '../contracts';
import type { CharterActionQuote, FederationState, RegimeModule, Triple } from './types';
import { amount, base, charterClearance, decimal, Decimal, failure, flow, quote, refund, scaled, shares, success } from './shared';

const NAMES = ['Garden', 'Campus', 'Harbor'];
const ROUTES = {
  ring: { seconds: 18, fee: .01 },
  hub: { seconds: 6, fee: .04 },
  redundant: { seconds: 30, fee: .02 },
} as const;
const MAX_LEVEL = 6;
const ROUTED_SHARE = .18;
const investment = (level:number) => 80 * 3 ** level;
const dataOf = (state:GameState):FederationState|undefined => state.charter?.kind === 'federation' ? state.charter.data : undefined;
/** Only unspent capital explicitly supplied by the shared wallet is returnable. Local income is governed locally. */
export const districtReturnable = (district:FederationState['districts'][number]):Amount => amount(Decimal.min(district.treasury,district.returnable??'0'));

/** Every district receives a share of one production budget, never a copy of it. */
function localWork(data:FederationState):Triple<number> {
  const capacity = data.districts.map(district => (1 + .08 * district.level) / 3) as Triple<number>;
  const totalCapacity = capacity.reduce((sum, value) => sum + value, 0);
  const requested = data.allocation.map(share => share * totalCapacity) as Triple<number>;
  const delivered = capacity.map((limit, index) => Math.min(limit, requested[index])) as Triple<number>;
  if (data.route === 'redundant') {
    // Spare routes recover half the work stranded by a mismatched assignment.
    let recoverable = requested.reduce((sum, value, index) => sum + Math.max(0, value - capacity[index]), 0) * .5;
    for (let index = 0; index < 3 && recoverable > 0; index++) {
      const recovered = Math.min(capacity[index] - delivered[index], recoverable);
      delivered[index] += recovered;
      recoverable -= recovered;
    }
  } else if (data.route === 'hub') {
    // The fast route must pass through the Campus dispatch office.
    const dispatchCapacity = .96 + .12 * data.districts[1].level;
    const total = delivered.reduce((sum, value) => sum + value, 0);
    if (total > dispatchCapacity) for (let index = 0; index < 3; index++) delivered[index] *= dispatchCapacity / total;
  }
  return delivered;
}

function transferTerms(data:FederationState, from:number, scale:Amount) {
  const principal = Decimal.min(decimal(data.districts[from].treasury).mul(.25), decimal(scale).mul(250 * (data.districts[from].level + 1)));
  const fee = principal.mul(ROUTES[data.route].fee);
  const returnable=Decimal.min(principal,decimal(districtReturnable(data.districts[from])));
  return { principal:amount(principal), returnable:amount(returnable), fee:amount(fee), debit:principal.add(fee), seconds:ROUTES[data.route].seconds };
}

function actions(state:GameState, scale:Amount):CharterActionQuote[] {
  const data = dataOf(state);
  if (!data) return [];
  return data.districts.flatMap((district, target) => {
    const maxed = district.level >= MAX_LEVEL;
    const nextCost = scaled(scale, investment(district.level));
    const shortfall = Decimal.max(0, decimal(nextCost).sub(district.treasury));
    const tier = Math.min(6, district.level + 1) as 1|2|3|4|5|6;
    const result:CharterActionQuote[] = [
      quote(state, scale, { action:'fundDistrict', target, title:`Fund ${NAMES[target]}'s next investment`, description:'Advance shared-wallet capital for the district’s next investment. Unspent advanced capital may be returned; locally earned income remains under the district’s authority.', effect:`Reserve ${amount(shortfall)} tokens as returnable capital; no new income or useful work is created.`, cost:amount(shortfall.div(scale)), tier:1, reason:maxed?'This district has completed all six investments.':shortfall.eq(0)?'This treasury already covers its next investment.':undefined }),
      quote(state, scale, { action:'investDistrict', target, title:tier===6?`Ratify ${NAMES[target]}'s resilient charter`:`Build ${NAMES[target]} capacity ${district.level + 1}`, description:`Spend ${nextCost} tokens from this district’s treasury on a local institution. Its capacity grows; other districts do not receive a duplicate building.`, effect:tier===6?'Apply the constitutional capstone and add the final local capacity increment.':'Add 8% of one district’s baseline capacity. Reassign work to make use of it.', researchCost:2 * tier, tier, reason:maxed?'This district has completed all six investments.':decimal(district.treasury).lt(nextCost)?`This district needs ${nextCost} tokens in its own treasury.`:undefined }),
      quote(state, scale, { action:'withdraw', target, title:`Return ${NAMES[target]}'s unused shared capital`, description:`Only ${districtReturnable(district)} tokens are unused shared-wallet capital. The remaining ${amount(decimal(district.treasury).sub(districtReturnable(district)))} locally governed tokens can fund district institutions and agreed mutual aid; the central office cannot confiscate them.`, effect:'Return eligible principal once. Local earnings and in-flight funds remain governed; no production, research, or legacy progress is created.', refund:districtReturnable(district), tier:1, requiresEvidence:false, reason:decimal(districtReturnable(district)).lte(0)?'No unused shared-wallet capital is returnable. Local funds remain under the district’s authority.':undefined }),
    ];
    for (let secondary = 0; secondary < 3; secondary++) {
      if (secondary === target) continue;
      const terms = transferTerms(data, target, scale);
      result.push(quote(state, scale, { action:'transferDistrict', target, secondary, title:`Send funds to ${NAMES[secondary]}`, description:`Under the districts’ standing mutual-aid agreement, commit ${terms.principal} treasury tokens plus a ${terms.fee} route fee. Arrival takes ${terms.seconds} active seconds. Locally governed funds remain locally governed at the destination.`, effect:'Debit the sender once and credit the recipient once. Passing funds through a district never converts local earnings into returnable capital.', tier:data.route==='redundant'?3:1, reason:data.transfers.length >= 3?'Three transfers are already in transit.':decimal(terms.principal).lt(scaled(scale, 1))?'The sending treasury needs at least four normalized tokens to offer a transfer.':undefined }));
    }
    return result;
  });
}

export const federationRegime:RegimeModule = {
  kind:'federation',
  modes:[
    {id:'ring', name:'Local ring', description:'18-second transfers with a 1% fee. Each district handles only its assigned work.'},
    {id:'hub', name:'Campus dispatch', description:'6-second transfers with a 4% fee. The Campus institution limits shared throughput.'},
    {id:'redundant', name:'Redundant routes', description:'30-second transfers with a 2% fee. Spare routes recover half the work stranded by uneven allocations.'},
  ],
  create:() => ({...base(), kind:'federation', data:{ districts:[{id:'garden', treasury:'0', returnable:'0', level:0, evidence:0, delivered:'0'}, {id:'campus', treasury:'0', returnable:'0', level:0, evidence:0, delivered:'0'}, {id:'harbor', treasury:'0', returnable:'0', level:0, evidence:0, delivered:'0'}], allocation:[1/3,1/3,1/3], route:'ring', transfers:[], agreements:0 }}),
  actions,
  configure(state, command) {
    const data = dataOf(state);
    if (!data) return failure('The federation is not established.');
    if (command.mode && command.mode !== 'ring' && command.mode !== 'hub' && command.mode !== 'redundant') return failure('Choose a federation route.');
    if (command.allocation && !shares(command.allocation, 3)) return failure('Three district shares must total one.');
    if (command.mode) data.route = command.mode as FederationState['route'];
    if (command.allocation) data.allocation = [...command.allocation] as Triple<number>;
    return success('Future work uses the new route and allocation. Existing transfers keep their original terms.');
  },
  act(state, selected, context) {
    const data = dataOf(state);
    if (!data || selected.target === undefined || !Number.isInteger(selected.target) || selected.target < 0 || selected.target > 2) return failure('Choose an existing district.');
    const district = data.districts[selected.target];
    if (selected.action === 'fundDistrict') {
      district.returnable = amount(decimal(districtReturnable(district)).add(selected.cost));
      district.treasury = amount(decimal(district.treasury).add(selected.cost));
      return success(`The quoted capital is reserved in ${NAMES[selected.target]}'s treasury. Unspent shared capital is returnable; local earnings are not.`);
    }
    if (selected.action === 'investDistrict') {
      const cost = scaled(context.scale, investment(district.level));
      if (district.level >= MAX_LEVEL || decimal(district.treasury).lt(cost)) return failure('The local investment is not funded.');
      district.returnable = amount(Decimal.max(0,decimal(districtReturnable(district)).sub(cost)));
      district.treasury = amount(decimal(district.treasury).sub(cost));
      district.level++;
      district.evidence = Math.max(district.evidence, selected.tier);
      data.agreements++;
      return success(`${NAMES[selected.target]} now has local capacity level ${district.level}. Its investment used its own treasury once.`);
    }
    if (selected.action === 'withdraw') {
      const capital=districtReturnable(district);
      if(decimal(capital).lte(0))return failure('The district refuses confiscation: there is no unused shared capital to return.');
      refund(state, capital);
      district.treasury = amount(decimal(district.treasury).sub(capital));
      district.returnable = '0';
      return success('Only unused shared-wallet capital returned. The district retains every locally governed token.');
    }
    if (selected.action === 'transferDistrict') {
      const destination = selected.secondary;
      if (destination === undefined || !Number.isInteger(destination) || destination === selected.target || destination < 0 || destination > 2 || data.transfers.length >= 3) return failure('Choose an available route between different districts.');
      const terms = transferTerms(data, selected.target, context.scale);
      if (decimal(district.treasury).lt(terms.debit) || decimal(terms.principal).lte(0)) return failure('This transfer is not funded.');
      district.returnable=amount(Decimal.max(0,decimal(districtReturnable(district)).sub(terms.debit)));
      district.treasury = amount(decimal(district.treasury).sub(terms.debit));
      data.transfers.push({id:++state.charter!.serial, from:selected.target, to:destination, amount:terms.principal, returnable:terms.returnable, fee:terms.fee, remaining:terms.seconds});
      return success(`${terms.principal} tokens are in transit to ${NAMES[destination]}; the route fee has been spent.`);
    }
    return failure('This is not a federation operation.');
  },
  rates(state, rates) {
    const data = dataOf(state);
    if (!data) return rates;
    const work = localWork(data);
    const factor = work.reduce((sum, value) => sum + value, 0);
    const tokens = amount(decimal(rates.tokens).mul(factor));
    const useful = amount(decimal(rates.useful).mul(factor));
    const income = work.map(value => amount(decimal(tokens).mul(ROUTED_SHARE * value / Math.max(.000001, factor)))) as Triple<Amount>;
    const result = {...rates, tokens, useful, click:amount(decimal(rates.click).mul(Math.max(.5, factor)))};
    return flow(state, result, {dedicatedUseful:useful, districtIncome:income, note:`${Math.round(ROUTED_SHARE * 100)}% of available operating income is routed to local treasuries. District capacity supplies ${Math.round(factor * 100)}% of baseline work; ${data.transfers.length} transfer${data.transfers.length===1?'':'s'} in transit.`});
  },
  tick(state, seconds, rates, context) {
    const data = dataOf(state);
    if (!data || seconds <= 0) return;
    const routed = rates.charter?.districtIncome;
    if (routed) {
      const requests = routed.map(value => decimal(value).mul(seconds));
      const requested = requests.reduce((sum, value) => sum.add(value), decimal(0));
      const available = Decimal.min(requested, decimal(state.tokens));
      const ratio = requested.gt(0) ? available.div(requested) : decimal(0);
      state.tokens = amount(decimal(state.tokens).sub(available));
      data.districts.forEach((district, index) => { district.treasury = amount(decimal(district.treasury).add(requests[index].mul(ratio))); });
    }
    const work = localWork(data);
    const total = work.reduce((sum, value) => sum + value, 0);
    data.districts.forEach((district, index) => { district.delivered = amount(decimal(district.delivered).add(decimal(rates.useful).mul(seconds * work[index] / Math.max(.000001, total)))); });
    const arrived = data.transfers.filter(transfer => (transfer.remaining = Math.max(0, transfer.remaining - seconds)) <= 0);
    for (const transfer of arrived) {
      const destination = data.districts[transfer.to];
      destination.returnable=amount(decimal(districtReturnable(destination)).add(transfer.returnable??'0'));
      destination.treasury = amount(decimal(destination.treasury).add(transfer.amount));
      context.log('District transfer arrived', `${transfer.amount} tokens reached ${NAMES[transfer.to]}. This is existing principal, not new income.`);
    }
    data.transfers = data.transfers.filter(transfer => transfer.remaining > 0);
  },
  auto(state, scale) {
    const data = dataOf(state);
    if (!data) return undefined;
    const options = actions(state, scale);
    const order = [0,1,2].sort((a,b) => data.districts[a].level - data.districts[b].level);
    // A batch authorizes only central-wallet funding. A local investment spends
    // a different treasury and still needs the district's explicit decision.
    return order.filter(target => charterClearance(state,Math.min(6,data.districts[target].level + 1) as 1|2|3|4|5|6).allowed).map(target => options.find(option => option.action === 'fundDistrict' && option.target === target && option.allowed)).find(Boolean);
  },
};
