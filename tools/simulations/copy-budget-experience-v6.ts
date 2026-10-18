/** Read-only comparison of the same earned UI fixtures before and after the v6 experience pass. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const root=process.cwd(),args=process.argv.slice(2),outAt=args.indexOf('--out'),freezeAt=args.indexOf('--freeze');
const output=path.resolve(outAt<0?'qa/experience-v6/copy-budget':args[outAt+1]);
const freezePath=freezeAt<0?'qa/experience-v6/source-freeze.json':args[freezeAt+1];
const freeze=JSON.parse(fs.readFileSync(freezePath,'utf8'));
const hash=(value:string|Buffer)=>crypto.createHash('sha256').update(value).digest('hex');
const verifySource=()=>{for(const file of freeze.files)assert.equal(hash(fs.readFileSync(file.path)),file.sha256,`Frozen source changed: ${file.path}`);};
verifySource();assert(!fs.existsSync(output),'Preserve earlier budgets; output must be new.');fs.mkdirSync(output,{recursive:true});
const baseline=path.resolve('qa/simulations-v5/ui/final');
const decode=(value:string)=>value.replace(/&#x([\da-f]+);/gi,(_,code)=>String.fromCodePoint(parseInt(code,16))).replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace(/&(amp|quot|lt|gt|nbsp|apos);/g,(_,name)=>({amp:'&',quot:'"',lt:'<',gt:'>',nbsp:' ',apos:"'"}[name]!));
const wordCount=(value:string)=>decode(value).trim().split(/\s+/).filter(Boolean).length;
type Frame={tag:string;hidden:boolean;closed:boolean;optionCount:number};
/** Controlled React SSR markup only. Closed details and unopened select alternatives are excluded. */
function exposure(html:string){
  const stack:Frame[]=[],text:string[]=[],all:string[]=[];
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  let details=0,buttons=0,disabledButtons=0;
  // A single-select with no explicit selected attribute displays its first option.
  const rendered=html.replace(/<select\b[^>]*>[\s\S]*?<\/select>/g,markup=>/\sselected(?:\s|=|>)/.test(markup)||/\smultiple(?:\s|=|>)/.test(markup)?markup:markup.replace(/<option\b/,'<option selected=""'));
  for(const token of rendered.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)??[]){
    if(token.startsWith('<!--'))continue;
    if(token.startsWith('</')){const name=token.match(/^<\/([^\s>]+)/)?.[1].toLowerCase();const index=stack.map(frame=>frame.tag).lastIndexOf(name??'');if(index>=0)stack.splice(index);continue;}
    if(token.startsWith('<')){
      const tag=token.match(/^<([^\s/>]+)/)?.[1].toLowerCase();if(!tag)continue;
      const parent=stack.at(-1);
      let hidden=!!parent?.hidden||/\s(?:hidden|inert)(?:\s|=|>)/.test(token)||['script','style','template'].includes(tag)||(parent?.tag==='details'&&parent.closed&&tag!=='summary');
      if(tag==='option'){
        const select=[...stack].reverse().find(frame=>frame.tag==='select');
        if(select){hidden ||= !/\sselected(?:\s|=|>)/.test(token);select.optionCount++;}
      }
      if(tag==='details')details++;
      if(tag==='button'&&!hidden){buttons++;if(/\sdisabled(?:\s|=|>)/.test(token))disabledButtons++;}
      if(!voidTags.has(tag)&&!token.endsWith('/>'))stack.push({tag,hidden,closed:tag==='details'&&!/\sopen(?:\s|=|>)/.test(token),optionCount:0});
      continue;
    }
    if(!stack.some(frame=>['script','style','template'].includes(frame.tag)))all.push(token);
    if(!stack.at(-1)?.hidden&&!(stack.at(-1)?.tag==='details'&&stack.at(-1)?.closed))text.push(token);
  }
  return {initialWords:wordCount(text.join(' ')),allMarkupWords:wordCount(all.join(' ')),disclosureSections:details,initialButtons:buttons,initialDisabledButtons:disabledButtons,initialText:decode(text.join(' ')).replace(/\s+/g,' ').trim()};
}

const server=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
const rows:any[]=[];
try{
  const modules=await Promise.all(['/src/governance/GovernancePanel.tsx','/src/society/SocietyPanel.tsx','/src/laboratory/LaboratoryPanel.tsx','/src/engine/index.ts','/src/constitution/economics.ts'].map(file=>server.ssrLoadModule(file)));
  const panels={governance:modules[0].GovernancePanel,society:modules[1].SocietyPanel,laboratory:modules[2].LaboratoryPanel};
  const noDispatch=()=>{throw Error('Copy inspection must never dispatch.');};
  for(const [index,constitution]of ['commons','precaution','service','federation','plural','frontier'].entries()){
    const source=`qa/simulations-v5/casual/final/world-${index+1}-before-ending.json`;
    const loaded=JSON.parse(fs.readFileSync(source,'utf8'));
    const earned=loaded.state??loaded;
    const fresh=modules[3].createGame(1701,1000);fresh.constitution=constitution;fresh.charter=modules[4].createCharterEconomy(constitution);
    for(const [kind,state]of [['fresh',fresh],['earned',earned]]){
      assert.equal(state.constitution,constitution);
      for(const [surface,Component]of Object.entries(panels)){
        const name=`${constitution}-${kind}-${surface}`,prior=fs.readFileSync(path.join(baseline,`${name}.html`),'utf8');
        const before=JSON.stringify(state),html=renderToStaticMarkup(React.createElement(Component,{state,dispatch:noDispatch,initialProgram:'control'}));
        assert.equal(JSON.stringify(state),before,'Copy rendering changed fixture state.');
        const previous=exposure(prior),current=exposure(html);
        rows.push({name,constitution,kind,surface,fixtureSource:kind==='earned'?source:'createGame(1701,1000), constitution-specific presentation only',baselineSha256:hash(prior),currentSha256:hash(html),previous,current,initialWordChange:current.initialWords-previous.initialWords});
        fs.writeFileSync(path.join(output,`${name}.html`),html);
      }
    }
  }
}finally{await server.close();}
verifySource();
const result={sourceSha256:freeze.sha256,baselineManifest:'qa/simulations-v5/source-freeze.json',cases:rows.length,rows,limitations:['Structural copy exposure, not a browser word-count measurement: CSS clipping/responsive layout and aria-only labels are not measured. Native closed details and unselected select options are excluded from the initial count. Numbers count as words.','The same actual earned v5 saves and identical fresh presentation fixtures are used in both versions. No player browser state is read or written.','The existing casual persona reads content definitions and offered eligibility messages, not every TSX label or paragraph. These counts are not added to or subtracted from playtime; no inferred visual-comprehension speed is asserted.','More or fewer words alone cannot establish fun, comprehension, or accessible interaction; actual browser walkthrough findings are separate.']};
fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
const lines=['# Copy exposure comparison','',`Final source: \`${freeze.sha256}\`. Same fresh and earned fixtures, 36 paired surfaces.`, '', '| Constitution | Stage | Surface | v5 initial words | v6 initial words | Change |', '| --- | --- | --- | ---: | ---: | ---: |',...rows.map(row=>`| ${row.constitution} | ${row.kind} | ${row.surface} | ${row.previous.initialWords} | ${row.current.initialWords} | ${row.initialWordChange>0?'+':''}${row.initialWordChange} |`),'','These are initial structurally exposed words: native closed disclosures and unselected options are excluded. All details remain available in the archived rendered markup.','',...result.limitations.map(item=>`- ${item}`),''];
fs.writeFileSync(path.join(output,'REPORT.md'),lines.join('\n'));
console.log(JSON.stringify({source:freeze.sha256,cases:rows.length,output}));
