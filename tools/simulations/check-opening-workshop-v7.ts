/** Presentation regression: future catalogue never hides a currently available purchase. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {createGame,getCost,formatAmount} from '../../src/engine';
import {PRODUCERS} from '../../src/content/economy';
import type {GameState} from '../../src/contracts';

const server=await createServer({root:process.cwd(),server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const results:{case:string;visibleFamilies:number;futureFamilies:number}[]=[];
let checks=0;
function check(condition:unknown,message:string){checks++;assert(condition,message);}
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
try{
 const {ShopPanel}=await server.ssrLoadModule('/src/ui/ShopPanel.tsx');
 function inspect(id:string,state:GameState){
  const before=JSON.stringify(state);
  const html=renderToStaticMarkup(React.createElement(ShopPanel,{state,dispatch:()=>assert.fail('Rendering must never authorize purchases')}));
  const ready=PRODUCERS.filter(producer=>producer.category==='production'&&producer.chapter<=state.chapter);
  const future=PRODUCERS.filter(producer=>producer.category==='production'&&producer.chapter>state.chapter);
  const rows=[...html.matchAll(/<article class="producer [^"]*">[\s\S]*?<\/article>/g)].map(match=>match[0]);
  check(rows.length===ready.length,`${id}: every available family, and no future family, is a purchase row`);
  for(const [index,producer] of ready.entries()){
   const row=rows[index];
   check(row.includes(`<h3>${producer.name}</h3>`),`${id}: ${producer.id} remains in its established order`);
   const button=row.match(/<button class="purchase-button"[^>]*>([\s\S]*?)<\/button>/);
   check(Boolean(button),`${id}: ${producer.id} retains its purchase action`);
   const price=getCost(state,producer.id,1);
   const disabled=state.paused||Boolean(state.ending)||Number(state.tokens)<Number(price.cost)||price.quantity===0;
   check(button![0].includes('disabled=""')===disabled,`${id}: ${producer.id} preserves affordability/pause/ending eligibility`);
   check(new RegExp(`</svg>${escape(formatAmount(price.cost,state.settings.notation))}<span>tokens</span>`).test(button![0]),`${id}: ${producer.id} displays the actual quoted price`);
  }
  check(html.indexOf('Controlled purchasing automation')<html.indexOf('class="producer-list"'),`${id}: auto-buy is discoverable before purchase rows`);
  check(html.includes('Can spend all available tokens.'),`${id}: spending warning remains immediately visible`);
  if(!state.autoBuy)check(html.includes('<option value="" selected="">Off · manual purchases</option>'),`${id}: auto-buy stays off without authorization`);
  if(future.length){
   check(html.includes('<details class="shop-future-catalogue">'),`${id}: future catalogue defaults closed`);
   for(const producer of future)check(html.includes(`<b>${producer.name}</b>`),`${id}: ${producer.id} remains discoverable in the optional catalogue`);
  }else check(!html.includes('shop-future-catalogue'),`${id}: no empty future catalogue after all unlocks`);
  const select=html.match(/<select aria-label="Auto-buy producer family"[^>]*>[\s\S]*?<\/select>/)![0];
  for(const producer of PRODUCERS){
   const option=select.match(new RegExp(`<option value="${producer.id}"[^>]*>`))![0];
   check(option.includes('disabled=""')===(producer.chapter>state.chapter),`${id}: ${producer.id} auto-buy unlock unchanged`);
  }
  check(JSON.stringify(state)===before,`${id}: rendering is state-pure`);
  results.push({case:id,visibleFamilies:ready.length,futureFamilies:future.length});
  return html;
 }
 for(let chapter=1;chapter<=7;chapter++){
  const state=createGame(1701,0);state.chapter=chapter;state.tokens='100000000000000000000';
  inspect(`chapter-${chapter}-affordable`,state);
 }
 const fresh=createGame(1701,0);inspect('fresh-unaffordable',fresh);
 const exact=createGame(1701,0);exact.tokens='15';inspect('exact-first-price',exact);
 const paused=createGame(1701,0);paused.tokens='1000';paused.autoBuy='helper';paused.paused=true;
 check(inspect('paused-order',paused).includes('Paused with the world.'),'Paused order has an honest status');
 const pending=createGame(1701,0);pending.pendingEvent='first_request';pending.autoBuy='helper';
 check(inspect('pending-order',pending).includes('Waiting for your story decision.'),'Protected story decision explains inactive order');
 const ended=createGame(1701,0);ended.chapter=7;ended.ending='garden';ended.autoBuy='helper';
 check(inspect('completed-order',ended).includes('Civilization complete. This order is inactive.'),'Completed world never claims purchases will continue');
 await mkdir('qa/opening-v7/workshop',{recursive:true});
 await writeFile('qa/opening-v7/workshop/render-checks.json',JSON.stringify({cases:results.length,checks,results,scope:'Static rendering and eligibility only; interactive category, quantity, selling and automation behavior require the browser walkthrough.'},null,2)+'\n');
 console.log(JSON.stringify({cases:results.length,checks,status:'passed'}));
}finally{await server.close();}
