import {useState, type CSSProperties} from 'react';
import Decimal from 'decimal.js';
import {Sprout,Leaf,Database,FlaskConical,Wrench,Network,Building2,Globe,Cpu,ScanEye,ShieldCheck,Landmark,Lock,ArrowUpRight,Plus,Recycle,Repeat2,Square,Check} from 'lucide-react';
import {PRODUCERS,UPGRADES} from '../content/economy';
import {RESEARCH_PROJECTS} from '../laboratory/projects';
import {formatAmount,getCost,getRates,getUpgradeCost,getResaleRefund} from '../engine';
import type {GameState,Dispatch,Producer,Upgrade} from '../contracts';
import './civilization.css';
import './workshop.css';

const icons=[Sprout,Leaf,Database,FlaskConical,Wrench,Network,Building2,Globe,Cpu,ScanEye,ShieldCheck,Landmark];
const requirementNames=new Map([...RESEARCH_PROJECTS.map(project=>[project.id,project.title] as const),...UPGRADES.map(upgrade=>[upgrade.id,upgrade.name] as const)]);

function precise(value:string|number,notation:string) {
 const amount=new Decimal(value);
 return amount.abs().lt(100)?amount.toSignificantDigits(3).toString():formatAmount(amount.toString(),notation);
}
function signed(value:string|number,notation:string) {
 const amount=new Decimal(value);
 return `${amount.gt(0)?'+':''}${precise(amount.toString(),notation)}`;
}
function unitDescription(producer:Producer):string {
 if(producer.category==='production')return `${producer.rate} normalized base output/s · ${producer.compute} compute demand per unit`;
 if(producer.category==='compute')return `+${producer.rate} base compute capacity per canopy, before efficiency upgrades`;
 if(producer.category==='review')return '+4 independent review capacity per observatory; actual review also needs allocated compute';
 if(producer.category==='institution')return '+3 research workstation capacity and +0.5 independent review capacity; supports public participation';
 return 'Strengthens recoverable authority with diminishing returns; a drill measures the current architecture';
}
function effectLabels(upgrade:Upgrade):string[] {
 const labels:string[]=[];
 const effects=upgrade.effect;
 const family=PRODUCERS.find(producer=>producer.id===upgrade.producer)?.name;
 if(effects.production)labels.push(`+${Math.round(effects.production*100)}% base ${family??'shared'} output`);
 if(effects.research)labels.push(`+${Math.round(effects.research*100)}% research efficiency`);
 if(effects.review)labels.push(`+${Math.round(effects.review*100)}% review efficiency`);
 if(effects.click)labels.push(`+${Math.round(effects.click*100)}% tending multiplier`);
 if(effects.compute)labels.push(`+${Math.round(effects.compute*100)}% base compute capacity`);
 if(effects.quality)labels.push(`Task quality +${effects.quality} points`);
 if(effects.recall)labels.push(`Recall estimate +${effects.recall} points`);
 if(effects.agency)labels.push(`Human agency +${effects.agency} points`);
 if(effects.welfare)labels.push(`AI treatment +${effects.welfare} points`);
 return labels;
}

export function ShopPanel({state,dispatch}:{state:GameState;dispatch:Dispatch}){
 const [quantity,setQuantity]=useState<number|'max'>(1);
 const [view,setView]=useState<'producers'|'upgrades'>('producers');
 const [support,setSupport]=useState(false);
 const [selling,setSelling]=useState(false);
 const [automationOpen,setAutomationOpen]=useState(Boolean(state.autoBuy));
 const available=UPGRADES.filter(upgrade=>!state.upgrades.includes(upgrade.id)&&upgrade.chapter<=state.chapter&&(!upgrade.producer||(state.producers[upgrade.producer]||0)>=(upgrade.requiredCount||0)));
 const rates=getRates(state);
 const unavailable=state.paused||Boolean(state.ending);
 const unavailableReason=state.ending?'This civilization has resolved.':state.paused?'Resume the simulation to change the workshop.':'';
 const notation=state.settings.notation;
 const category=PRODUCERS.filter(producer=>support?producer.category!=='production':producer.category==='production');
 const readyProducers=category.filter(producer=>producer.chapter<=state.chapter);
 const futureProducers=category.filter(producer=>producer.chapter>state.chapter);
 const nextChapter=futureProducers[0]?.chapter;
 const nextFamilies=futureProducers.filter(producer=>producer.chapter===nextChapter);
 const orderedFamily=PRODUCERS.find(producer=>producer.id===state.autoBuy);
 const nextOrder=orderedFamily?getCost(state,orderedFamily.id,1):null;
 const orderProgress=nextOrder&&new Decimal(nextOrder.cost).gt(0)?Decimal.min(1,Decimal.max(0,new Decimal(state.tokens).div(nextOrder.cost))).toNumber():0;
 const orderReducesOutput=orderedFamily&&new Decimal(getRates({...state,producers:{...state.producers,[orderedFamily.id]:(state.producers[orderedFamily.id]||0)+1}}).tokens).lt(rates.tokens);

 return <section className="shop-panel">
  <div className="section-heading">
   <div><span className="eyebrow">Give your garden room to grow</span><h2>{view==='producers'?'Build something useful.':'Small changes. New possibilities.'}</h2></div>
   <div className="segmented" role="group" aria-label="Workshop view">
    <button aria-pressed={view==='producers'} className={view==='producers'?'active':''} onClick={()=>setView('producers')}>Workshop</button>
    <button aria-pressed={view==='upgrades'} className={view==='upgrades'?'active':''} onClick={()=>setView('upgrades')}>Improvements <span>{available.length}</span></button>
   </div>
  </div>
  {unavailable&&<p className="shop-status-note">{unavailableReason}</p>}
  {view==='producers'?<>
   <div className="shop-tools">
    <div className="filter-tabs" role="group" aria-label="Producer category"><button aria-pressed={!support} className={!support?'active':''} onClick={()=>setSupport(false)}>Production</button><button aria-pressed={support} className={support?'active':''} onClick={()=>setSupport(true)}>Capacity & care</button></div>
    <div className="purchase-controls" role="group" aria-label="Transaction quantity">
     <button aria-pressed={selling} className={`sell-toggle ${selling?'selected':''}`} title="Resell at 50% of recorded purchase cost" onClick={()=>setSelling(!selling)}><Recycle size={14}/>{selling?'Selling':'Buy'}</button>
     {[1,10,25,'max'].map(value=><button key={value} aria-pressed={quantity===value} className={quantity===value?'active':''} onClick={()=>setQuantity(value as number|'max')}>{value==='max'?'Max':`×${value}`}</button>)}
    </div>
   </div>
   <details className="shop-auto-disclosure" open={automationOpen} onToggle={event=>setAutomationOpen(event.currentTarget.open)}>
    <summary><Repeat2 size={16}/><strong>Auto-buy</strong><span className="shop-order-state">{state.autoBuy?'On':'Off'}</span><span>{orderedFamily?.name??'Set up a repeating purchase'}</span></summary>
    <section className="shop-automation shop-standing-order" aria-label="Controlled purchasing automation">
    <p>Buy one unit per second when affordable. <strong>Can spend all available tokens.</strong></p>
    <div className="shop-automation-controls"><label>Standing order<select aria-label="Auto-buy producer family" value={state.autoBuy??''} disabled={unavailable} onChange={event=>dispatch({type:'autoBuy',id:event.target.value||null})}><option value="">Off · manual purchases</option>{PRODUCERS.map(producer=><option key={producer.id} value={producer.id} disabled={producer.chapter>state.chapter}>{producer.name}{producer.chapter>state.chapter?` · chapter ${producer.chapter}`:''}</option>)}</select></label><button disabled={!state.autoBuy||unavailable} onClick={()=>dispatch({type:'autoBuy',id:null})}><Square size={12}/> Stop</button></div>
    {orderedFamily&&nextOrder&&<div className="shop-order-savings"><div><span>Next purchase · {orderedFamily.name}</span><strong>{formatAmount(state.tokens,notation)} / {formatAmount(nextOrder.cost,notation)} <small>tokens</small></strong></div><progress value={orderProgress} max={1} aria-label={`Available tokens for the next ${orderedFamily.name} unit`}/>{orderReducesOutput&&<p className="shop-order-tradeoff">The next unit would reduce current output. Add capacity or change this order.</p>}</div>}
    {state.autoBuy&&<small>{state.ending?'Civilization complete. This order is inactive.':state.paused?'Paused with the world.':state.pendingEvent&&state.settings.readingPause?'Waiting for your story decision.':`Repeating ${PRODUCERS.find(producer=>producer.id===state.autoBuy)?.name??'the authorized family'} purchases until stopped.`}</small>}
    <details className="shop-order-details"><summary>How this order works</summary><p>The order attempts one unit per simulation second at its full current price. It stays within this family, pauses with the world and at protected story decisions, and never changes permissions or chooses story responses. Larger deployments make existing clearance stale; review it after expansion.</p></details>
   </section></details>
   {state.autoBuy&&<p className="shop-auto-warning">Auto-buy can spend all available tokens.{orderReducesOutput?' The next unit would reduce output; add capacity or change this order.':''}</p>}
   <div className="producer-list">{readyProducers.map(producer=>{
    const index=PRODUCERS.indexOf(producer),Icon=icons[index]||Sprout;
    const count=state.producers[producer.id]||0;
    const price=getCost(state,producer.id,quantity);
    const locked=state.chapter<producer.chapter;
    const canBuy=new Decimal(state.tokens).gte(price.cost)&&price.quantity>0;
    const sellQuantity=quantity==='max'?count:Math.min(count,quantity);
    const selectedQuantity=selling?sellQuantity:price.quantity;
    const nextCount=count+(selling?-selectedQuantity:selectedQuantity);
    const next=getRates({...state,producers:{...state.producers,[producer.id]:nextCount}});
    const paidChange=new Decimal(next.tokens).sub(rates.tokens);
    const usefulChange=new Decimal(next.useful).sub(rates.useful);
    const computeChange=next.compute-rates.compute;
    const reviewChange=next.review-rates.review;
    const researchChange=new Decimal(next.research).sub(rates.research);
    const refund=getResaleRefund(state,producer.id,sellQuantity);
    return <article key={producer.id} className={`producer ${locked?'locked':''}`}>
     <div className="producer-icon" style={{'--item-color':producer.color} as CSSProperties}><Icon size={24} strokeWidth={1.5}/></div>
     <div className="producer-info">
      <div><h3>{producer.name}</h3><span className="owned-count">{count.toLocaleString()} owned</span>{state.autoBuy===producer.id&&<span className="shop-auto-badge"><Repeat2 size={10}/> Auto-buy</span>}</div>
      <p>{producer.category==='production'?'Makes tokens automatically.':producer.benefit}</p>
      {!locked&&selectedQuantity>0&&<>
      <div className={`shop-quick-rate ${paidChange.lt(0)&&!selling?'has-tradeoff':''}`}>
       <span>{producer.category==='production'?'Paid output':producer.category==='compute'?'Compute capacity':producer.category==='review'?'Review flow':producer.category==='institution'?'Research flow':'Recoverable authority'}</span>
       <strong>{producer.category==='production'?`${signed(paidChange.toString(),notation)}/s`:producer.category==='compute'?signed(computeChange,notation):producer.category==='review'?`${signed(reviewChange,notation)}/s`:producer.category==='institution'?`${signed(researchChange.toString(),notation)}/s`:selling?'Capacity removed':'Capacity added'}</strong>
      </div>
      {paidChange.lt(0)&&!selling&&<p className="shop-purchase-warning">This purchase reduces output. Add capacity or review your allocation.</p>}
      {producer.chapter>=3&&!selling&&<p className="shop-purchase-warning">Expansion makes prior deployment clearance stale.</p>}
      {selling&&<p className="shop-purchase-warning">Service dependence and commitments remain after resale.</p>}
      </>}
      <details className="shop-producer-details"><summary>Rates & details</summary><p>{producer.description}</p><small>{producer.benefit}</small><p className="shop-unit-data">{unitDescription(producer)}</p>
      {!locked&&selectedQuantity>0&&<div className={`shop-rate-preview ${paidChange.lt(0)&&!selling?'has-tradeoff':''}`}>
       <span className="shop-preview-count">{selling?'After selling':'After adding'} {selectedQuantity.toLocaleString()} · {count.toLocaleString()} → {nextCount.toLocaleString()} owned</span>
       <dl>
        {(producer.category==='production'||!paidChange.isZero())&&<><div><dt>Paid output</dt><dd>{signed(paidChange.toString(),notation)}/s</dd></div><div><dt>Useful work</dt><dd>{signed(usefulChange.toString(),notation)}/s</dd></div></>}
        {producer.category==='production'&&<div><dt>Compute demand</dt><dd>{signed(next.demand-rates.demand,notation)}</dd></div>}
        {producer.category==='compute'&&<div><dt>Actual capacity</dt><dd>{signed(computeChange,notation)}</dd></div>}
        {(producer.category==='review'||producer.category==='institution'||producer.category==='compute')&&<><div><dt>Review flow</dt><dd>{signed(reviewChange,notation)}/s</dd></div><div><dt>Research flow</dt><dd>{signed(researchChange.toString(),notation)}/s</dd></div></>}
       </dl>
       {producer.category==='production'&&<small>Production utilization: {Math.round(rates.utilization*100)}% → {Math.round(next.utilization*100)}%. {paidChange.lt(0)&&!selling?'This purchase would reduce current output; capacity or specialization needs attention.':producer.chapter>=3&&!selling?'New deployment makes prior clearance stale.':''}</small>}
       {producer.category==='control'&&<small>The recall target changes over time. This purchase does not itself provide a new observation.</small>}
       {selling&&<small>Refund: {formatAmount(refund,notation)} tokens. Service dependence and commitments remain.</small>}
      </div>}</details>
      {!locked&&!selling&&quantity==='max'&&price.quantity===0&&<p className="shop-next-cost">Next unit: {formatAmount(getCost(state,producer.id,1).cost,notation)} tokens. None affordable yet.</p>}
     </div>
     <button className="purchase-button" title={unavailableReason||undefined} disabled={unavailable||locked||(selling?sellQuantity===0:!canBuy)} onClick={()=>dispatch(selling?{type:'sell',id:producer.id,quantity:sellQuantity}:{type:'buy',id:producer.id,quantity})}>
      {locked?<><Lock size={14}/>Chapter {producer.chapter}</>:selling?<><Recycle size={14}/>Sell {sellQuantity}<span>+{formatAmount(refund,notation)} tokens</span></>:<><Plus size={14}/>{formatAmount(price.cost,notation)}<span>{quantity==='max'?`${price.quantity.toLocaleString()} units · `:''}tokens</span></>}
     </button>
    </article>;
   })}</div>
   {futureProducers.length>0&&<div className="shop-future">
    <p className="shop-next-unlock"><Lock size={14}/><span><b>Next · Chapter {nextChapter}</b>{nextFamilies.map(producer=>producer.name).join(' · ')}</span></p>
    <details className="shop-future-catalogue"><summary>Explore future {support?'capacity & care':'workshop'} · {futureProducers.length} families</summary><ul>{futureProducers.map(producer=><li key={producer.id}><div><b>{producer.name}</b><span>Chapter {producer.chapter}</span></div><p>{producer.description}</p><small>{producer.benefit}</small></li>)}</ul></details>
   </div>}
   <p className="fine-print">Bulk prices round the total once. Resale returns half the recorded purchase cost. Rate previews use your current policies, allocation, upgrades, and scenario; they do not promise future clearance.</p>
   <p className="shop-bottleneck"><Cpu size={14}/><span>{rates.bottleneck}</span></p>
  </>:<>
   <p className="shop-upgrade-explainer">Percentage improvements add to their stated base multiplier. Point improvements affect separate world conditions, capped at 100; they do not establish permanent evidence.</p>
   <div className="upgrade-grid">{available.map(upgrade=>{
    const cost=getUpgradeCost(state,upgrade.id);
    const missing=(upgrade.requires||[]).filter(id=>!state.projects.includes(id)&&!state.upgrades.includes(id));
    const afford=new Decimal(state.tokens).gte(cost);
    const family=PRODUCERS.find(producer=>producer.id===upgrade.producer);
    return <button key={upgrade.id} className="upgrade-card" title={unavailableReason||(!afford?'More tokens are needed for this improvement.':undefined)} disabled={unavailable||missing.length>0||!afford} onClick={()=>dispatch({type:'upgrade',id:upgrade.id})}>
     <span className="eyebrow">{family?.name??upgrade.category}</span><h3>{upgrade.name}<ArrowUpRight size={16}/></h3><p>{upgrade.description}</p>
     <ul className="shop-upgrade-effects">{effectLabels(upgrade).map(effect=><li key={effect}>{effect}</li>)}</ul>
     {upgrade.requires&&upgrade.requires.length>0&&<div className="shop-upgrade-research"><span>Research foundations</span>{upgrade.requires.map(id=><small className={missing.includes(id)?'is-missing':'is-complete'} key={id}>{missing.includes(id)?<Lock size={10}/>:<Check size={10}/>} {requirementNames.get(id)??id}</small>)}</div>}
     <strong>{formatAmount(cost,notation)} tokens</strong>
     {upgrade.producer&&<small>{upgrade.requiredCount} {family?.name??upgrade.producer} required · owned {state.producers[upgrade.producer]||0}</small>}
    </button>;
   })}{!available.length&&<div className="empty-state"><Wrench/><h3>Good foundations take time.</h3><p>Grow your workshop to discover more improvements.</p></div>}</div>
  </>}
 </section>;
}
