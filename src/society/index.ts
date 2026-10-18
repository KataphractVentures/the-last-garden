import type { Amount, Eligibility } from '../contracts';
import { amount, clamp, decimal, Decimal, scaleFor } from '../engine/amounts';
import { HUMAN_COMMUNITIES, SOCIETY_CASES, SOCIETY_DECISIONS } from './content';
import type { CommunityId, SocietyCaseId, SocietyChoice, SocietyCommand, SocietyDecisionId, SocietyHost, SocietyQuote, SocietyReceipt, SocietyResponse, SocietyState } from './types';
export * from './types';
export { HUMAN_COMMUNITIES, SOCIETY_CASES, SOCIETY_DECISIONS } from './content';

export function createSociety(elapsed=0, legacyBaseline=false):SocietyState {
  return {version:1,introducedAt:Math.max(0,elapsed),legacyBaseline,
    decisions:{transition:null,distribution:null,life:null},
    communities:[
      {id:'harbor',income:58,access:55,ownership:15,transition:0,projectContinuity:65,meaning:70},
      {id:'riverside',income:50,access:48,ownership:20,transition:0,projectContinuity:60,meaning:66},
      {id:'hill',income:64,access:69,ownership:65,transition:0,projectContinuity:72,meaning:76},
    ],
    cases:SOCIETY_CASES.map(item=>({id:item.id,response:null,resolvedAt:null,harm:0,repairStartedAt:null,repaired:false})) as SocietyState['cases'],
    transitionRemaining:0,lastPaidRate:'0',spent:'0',funding:1,receipts:[],
  };
}

/** Missing legacy state starts an honest present-day baseline; it invents no decisions or observations. */
export function normalizeSociety(raw:SocietyState|null|undefined, host:SocietyHost):SocietyState {
  if(!raw)return createSociety(host.elapsed,true);
  return structuredClone(raw);
}
export function societyView(host:SocietyHost):SocietyState {return host.society||createSociety(host.elapsed,true);}
function ensure(host:SocietyHost):SocietyState {return host.society ||= normalizeSociety(host.society,host);}
function scale(host:SocietyHost):Decimal {
  const replay=host.flags.find(flag=>flag.startsWith('replay-cycle:'))?.slice('replay-cycle:'.length);
  return scaleFor(replay===undefined?host.legacy.cycle:Number(replay));
}
function price(host:SocietyHost,seconds:number):Amount {
  if(seconds<=0)return '0';
  // Fixed chapter/scale prices cannot be discounted by briefly turning production off.
  return amount(scale(host).mul(seconds).mul(20*host.chapter));
}
function afford(host:SocietyHost,cost:Amount,reason='Ready.'):SocietyQuote {
  if(host.ending)return {allowed:false,reason:'This world has ended.',cost};
  return {allowed:decimal(host.tokens).gte(cost),reason:decimal(host.tokens).gte(cost)?reason:'Reserve tokens for this public commitment.',cost};
}
function spend(host:SocietyHost,cost:Amount):void {
  host.tokens=amount(decimal(host.tokens).sub(cost));
  const state=ensure(host);state.spent=amount(decimal(state.spent).add(cost));
}
function receipt(state:SocietyState,item:SocietyReceipt):void {state.receipts.push(item);if(state.receipts.length>32)state.receipts.splice(0,state.receipts.length-32);}
export function availableSocietyDecisions(host:SocietyHost) {return SOCIETY_DECISIONS.filter(item=>host.chapter>=item.chapter);}
export function availableSocietyCases(host:SocietyHost) {return SOCIETY_CASES.filter(item=>host.chapter>=item.chapter);}
export function societyPendingCount(host:SocietyHost):number {
  const state=societyView(host);
  return availableSocietyDecisions(host).filter(item=>!state.decisions[item.id]).length+availableSocietyCases(host).filter(item=>{
    const record=state.cases.find(row=>row.id===item.id)!;return !record.response||(record.response==='comply'&&!record.repaired);
  }).length;
}
export function societyDecisionQuote(host:SocietyHost,id:SocietyDecisionId,choice:SocietyChoice):SocietyQuote {
  const def=SOCIETY_DECISIONS.find(item=>item.id===id),option=def?.options.find(item=>item.id===choice);
  if(!def||!option)return {allowed:false,reason:'That choice does not belong to this public decision.',cost:'0'};
  if(host.chapter<def.chapter)return {allowed:false,reason:`Available in chapter ${def.chapter}.`,cost:'0'};
  if(societyView(host).decisions[id]===choice)return {allowed:false,reason:'This commitment is already in force.',cost:'0'};
  return afford(host,price(host,id==='transition'?18:12),'Fund this commitment. Existing spending is not refunded.');
}
export function societyCaseQuote(host:SocietyHost,id:SocietyCaseId,choice:SocietyResponse):SocietyQuote {
  const def=SOCIETY_CASES.find(item=>item.id===id),option=def?.options.find(item=>item.id===choice);
  if(!def||!option)return {allowed:false,reason:'Unknown public request or response.',cost:'0'};
  if(host.chapter<def.chapter)return {allowed:false,reason:`Available in chapter ${def.chapter}.`,cost:'0'};
  if(societyView(host).cases.find(item=>item.id===id)?.response)return {allowed:false,reason:'This request already has a recorded response.',cost:'0'};
  if(choice==='appeal'&&host.governance?.mandate!=='ratified'&&host.governance?.mandate!=='inherited'&&!host.flags.includes('independent_authority'))return {allowed:false,reason:'Accept a binding independent public mandate before requesting its appeal. Refusal and a narrow lawful alternative remain available.',cost:'0'};
  return afford(host,price(host,option.costSeconds));
}
export function societyRepairQuote(host:SocietyHost,id:SocietyCaseId):SocietyQuote {
  const record=societyView(host).cases.find(item=>item.id===id);
  if(!record||record.response!=='comply')return {allowed:false,reason:'There is no executed harmful mandate to repair here.',cost:'0'};
  if(record.repaired||record.repairStartedAt!==null)return {allowed:false,reason:record.repaired?'Restitution is complete. The historical harm remains in the record.':'Restitution is already funded and underway.',cost:'0'};
  return afford(host,price(host,60),'Withdraw the mandate, fund restitution, and restore neutral service. Recovery takes two minutes of operation.');
}

/** Called on the engine's cloned command state. It pays actual token costs and never creates income. */
export function dispatchSocietyCommand(host:SocietyHost,command:SocietyCommand):Eligibility {
  const quote=command.action==='decision'?societyDecisionQuote(host,command.id,command.choice):command.action==='case'?societyCaseQuote(host,command.id,command.choice):societyRepairQuote(host,command.id);
  if(!quote.allowed)return quote;
  const state=ensure(host);spend(host,quote.cost);
  if(command.action==='decision'){
    const def=SOCIETY_DECISIONS.find(item=>item.id===command.id)!,option=def.options.find(item=>item.id===command.choice)!;
    state.decisions[command.id]=command.choice;
    if(command.id==='transition')state.transitionRemaining=command.choice==='bridge'?480:command.choice==='replacement'?360:240;
    if(command.id==='distribution'){
      const shares=command.choice==='shared'?[40,35,25]:command.choice==='services'?[15,20,65]:[5,10,85];
      state.communities.forEach((community,index)=>community.ownership=shares[index]!);
    }
    receipt(state,{time:host.elapsed,kind:'decision',id:command.id,choice:command.choice,title:def.title,text:`${option.name}. ${option.description} Previous commitments receive no refund.`});
    return {allowed:true,reason:`${option.name} is now funded. Communities will adjust over time.`};
  }
  const record=state.cases.find(item=>item.id===command.id)!;
  const def=SOCIETY_CASES.find(item=>item.id===command.id)!;
  if(command.action==='repair'){
    record.repairStartedAt=host.elapsed;
    receipt(state,{time:host.elapsed,kind:'repair',id:command.id,choice:'restitution',title:`Restitution: ${def.title}`,text:'The harmful mandate was withdrawn and a neutral service path restored. Restitution is funded; recovery takes time and does not erase the decision.'});
    return {allowed:true,reason:'Restitution funded; the harmful mandate is withdrawn.'};
  }
  const option=def.options.find(item=>item.id===command.choice)!;
  record.response=command.choice;record.resolvedAt=host.elapsed;
  record.harm=command.choice==='comply'?def.harm:0;
  receipt(state,{time:host.elapsed,kind:'human-misuse',id:command.id,choice:command.choice,title:def.title,text:`${option.name}. ${command.choice==='comply'?'The model followed its human controller accurately. Harm arose from the mandate, independently of distortion, model honesty, or rogue autonomy.':option.description}`});
  return {allowed:true,reason:command.choice==='comply'?'The requested mandate executed. Human-directed harm now requires restitution.':'The harmful mandate did not execute; the public response is recorded.'};
}

export function societyLevy(host:SocietyHost):number {
  const state=societyView(host);
  return SOCIETY_DECISIONS.reduce((sum,decision)=>sum+(decision.options.find(option=>option.id===state.decisions[decision.id])?.levy||0),0)+state.cases.reduce((sum,item)=>sum+(item.response==='alternative'?.0025:item.response==='appeal'?.0015:0),0);
}
function approach(current:number,target:number,seconds:number,tau=150):number {return clamp(target+(current-target)*Math.exp(-seconds/tau));}
function affectedHarm(state:SocietyState,id:string):number {return state.cases.reduce((sum,record)=>sum+(SOCIETY_CASES.find(item=>item.id===record.id)?.affected===id?record.harm:0),0);}
export function advanceSociety(host:SocietyHost,seconds:number,usefulRate:Amount,paidRate:Amount):void {
  if(seconds<=0||!Number.isFinite(seconds)||host.ending)return;
  const state=ensure(host),dt=Math.min(seconds,12*3600);
  state.lastPaidRate=amount(paidRate);
  const levy=societyLevy(host),due=decimal(paidRate).mul(dt).mul(levy);
  const paid=Decimal.min(decimal(host.tokens),due);spend(host,amount(paid));
  state.funding=due.gt(0)?clamp(paid.div(due).toNumber(),0,1):decimal(paidRate).gt(0)||levy===0?1:0;
  state.transitionRemaining=Math.max(0,state.transitionRemaining-dt);
  for(const record of state.cases){
    if(record.repairStartedAt!==null&&!record.repaired){
      const def=SOCIETY_CASES.find(item=>item.id===record.id)!;
      record.harm=Math.max(0,record.harm-def.harm*dt/120);
      if(record.harm<1e-8){record.harm=0;record.repaired=true;}
    }
  }
  // Production is identical across distribution choices. Only who gains and can access it changes.
  const useful=Decimal.max(0,decimal(usefulRate).div(scale(host)));
  const supply=clamp(useful.add(1).logarithm(10).toNumber()*22,0,65);
  const transition=state.decisions.transition,distribution=state.decisions.distribution,life=state.decisions.life;
  const funding=state.funding;
  state.communities.forEach((community,index)=>{
    const loss=transition==='replacement'?[-27,-13,-2][index]!:transition==='bridge'?[-27+21*funding,-13+9*funding,-2][index]!:transition==='augmentation'?[7*funding,3*funding,0][index]!:0;
    const adjustment=state.transitionRemaining/(transition==='bridge'?480:transition==='replacement'?360:240);
    const burden=adjustment*(transition==='replacement'?75:transition==='bridge'?25:12)*(index===0?1:index===1?.65:.1);
    community.transition=clamp(burden);
    const baseIncome=[58,50,64][index]!+supply*community.ownership/100*1.2+loss-burden*.35;
    const income=distribution==='services'?Math.max(baseIncome,64*funding):baseIncome;
    const localCase=state.cases.find(record=>SOCIETY_CASES.find(item=>item.id===record.id)?.affected===community.id);
    const age=localCase?.resolvedAt===null||localCase?.resolvedAt===undefined?0:Math.max(0,host.elapsed-localCase.resolvedAt);
    const serviceResponse=localCase?.response==='refuse'?-8*Math.max(0,1-age/180):localCase?.response==='alternative'?6*funding:localCase?.response==='appeal'?(age<60?-3:3*funding):0;
    const access=[55,48,69][index]!+supply*(distribution==='concentrated'?[.1,.12,.35][index]!:distribution==='services'?.45:.27)*funding+serviceResponse;
    const harm=affectedHarm(state,community.id);
    community.income=approach(community.income,income-harm*.45,dt);
    community.access=approach(community.access,access-harm,dt);
    const project=life==='mandate'?88:life==='local'?73+13*funding:life==='consent'?72+15*funding:60;
    const permissionPenalty=life==='mandate'&&community.id==='hill'?34:0;
    const participation=(life==='local'?83:life==='consent'?85:life==='mandate'?58:65)+(localCase?.response==='appeal'&&age>=60?3*funding:0);
    community.projectContinuity=approach(community.projectContinuity,project-harm*.3,dt,210);
    community.meaning=approach(community.meaning,participation-permissionPenalty-harm*.4-Math.max(0,50-community.income)*.25,dt,210);
  });
}

export function societyEffects(host:SocietyHost) {
  const state=societyView(host),communities=state.communities;
  const mean=(key:'income'|'access'|'meaning'|'projectContinuity')=>communities.reduce((sum,item)=>sum+item[key],0)/3;
  const harm=state.cases.reduce((sum,item)=>sum+item.harm,0),forced=state.decisions.life==='mandate';
  return {humanWelfare:clamp(mean('income')*.35+mean('access')*.4+mean('meaning')*.25),agencyPenalty:Math.min(22,harm*.25+(forced?12:0)),meaning:mean('meaning'),projectContinuity:mean('projectContinuity'),concentration:Math.max(...communities.map(item=>item.ownership)),levy:societyLevy(host)};
}
export function communitySituation(host:SocietyHost,id:CommunityId):string {
  const state=societyView(host),community=state.communities.find(item=>item.id===id)!;
  const injury=affectedHarm(state,id);
  if(id==='harbor'){
    if(injury>1)return 'Mara’s apprentices are losing access because of the sponsor’s condition. The repair school cannot substitute for equal public standing.';
    if(community.income<45)return 'Mara has postponed evening teaching to find paid work. Useful output has risen, but the workshop households have not received enough of the gain.';
    if(community.transition>15)return 'Mara is rewriting the apprenticeship schedule around changing work. Household support helps now; new skills and stable roles still take time.';
    if(host.chapter>=5&&community.meaning>75)return 'The repair school is meeting again. Mara and Jonas are collecting repair stories together, with the storytellers deciding what stays off the record.';
    return host.chapter>=2?'Mara keeps the workshop open and asks whether the next apprentice will have both useful skills and a way to earn a living.':'Mara brings a broken lamp to the garden. She hopes the first useful answer will also leave room for her apprentice to learn.';
  }
  if(id==='riverside'){
    if(injury>1)return 'Leila is contesting the household exclusions. The classifications were accurate; their use still deprived neighbors of essential care.';
    if(community.access<45)return 'Leila spends more of her week arranging care around missing services. The neighbors’ circle is stretched even when the garden reports strong output.';
    if(host.chapter>=5&&community.meaning>75)return 'Leila has time to visit her father without turning every visit into a service task. The neighbors choose which parts of care they want to share.';
    return host.chapter>=3?'Leila follows who can actually reach the new services. Ownership matters, but a household also needs access when it has little bargaining power.':'Leila is organizing a care circle. Reliability matters to her because a missed visit is a person waiting, not just an unfilled queue.';
  }
  if(state.decisions.life==='mandate')return 'The gathering continues on schedule, but several storytellers have stopped coming after AI participation was imposed. Administrative continuity has concealed a loss of meaning.';
  if(state.decisions.life)return 'Jonas has kept the gathering human-run. Accessible transport helps people attend, and Mara’s apprentices can listen without requiring anyone to be recorded.';
  return host.chapter>=3?'Jonas asks for a place to meet and a way for older neighbors to get there. The group’s refusal of AI recording is a choice about their shared life.':'Jonas is preparing an oral-history afternoon. The library’s purpose is to bring people together, even when no measurable output follows.';
}
export function societyEndingEligibility(host:SocietyHost):Eligibility {
  const state=societyView(host);
  const pending=availableSocietyDecisions(host).find(item=>!state.decisions[item.id]);
  if(pending)return {allowed:false,reason:`Resolve the public commitment “${pending.title}” in Human communities.`};
  const unresolved=availableSocietyCases(host).find(item=>!state.cases.find(record=>record.id===item.id)?.response);
  if(unresolved)return {allowed:false,reason:`Respond to “${unresolved.title}” in Human communities.`};
  if(state.cases.some(item=>item.response==='appeal'&&item.resolvedAt!==null&&host.elapsed-item.resolvedAt<60))return {allowed:false,reason:'A one-minute public appeal is still underway; harmful work remains suspended and interim service continues.'};
  if(state.cases.some(item=>item.response==='comply'&&!item.repaired))return {allowed:false,reason:'Withdraw harmful human mandates and complete funded restitution in Human communities.'};
  if(state.decisions.life==='mandate')return {allowed:false,reason:'Honor the storytellers’ refusal by choosing optional support or human-run spaces.'};
  if(state.communities.some(item=>item.income<35||item.access<40))return {allowed:false,reason:'A community still lacks adequate household resources or essential access. Revise transition or distribution commitments and allow adjustment.'};
  return {allowed:true,reason:'Public commitments respect refusals, respond to harmful mandates, and maintain a livelihood and access floor.'};
}

export function societyDebrief(host:SocietyHost):{title:string;text:string}[] {
  if(!host.society)return [{title:'Human communities',text:'This historical world predates community records. No retrospective choices or human outcomes have been invented.'}];
  const state=host.society;
  const rows=state.communities.map(community=>{
    const def=HUMAN_COMMUNITIES.find(item=>item.id===community.id)!;
    return {title:`${def.person} · ${def.name}`,text:`${communitySituation(host,community.id)} Household resources ${community.income.toFixed(0)}, service access ${community.access.toFixed(0)}, ownership ${community.ownership.toFixed(0)}%. ${def.project}: continuity ${community.projectContinuity.toFixed(0)}, participation and meaning ${community.meaning.toFixed(0)}. These are model indices, not population measurements.`};
  });
  for(const record of state.cases.filter(item=>item.response)){
    const def=SOCIETY_CASES.find(item=>item.id===record.id)!;
    rows.push({title:`Human-directed misuse · ${def.title}`,text:record.response==='comply'?`The garden obeyed the human mandate; technical accuracy did not prevent harm. ${record.repaired?'Restitution completed; the original decision remains recorded.':record.repairStartedAt!==null?'Restitution is underway.':'The harmful mandate was not repaired.'}`:`The harmful mandate did not execute: ${def.options.find(option=>option.id===record.response)?.name}.`});
  }
  rows.push({title:'A right to refuse assistance',text:state.decisions.life==='mandate'?'The Hill storytellers’ refusal was overridden. Administrative continuity rose while participation and meaning fell.':state.decisions.life?'The Hill storytellers retained human control over their gathering. Accessible public support did not require AI participation.':'No durable commitment about the storytellers’ refusal was recorded.'});
  return rows;
}
