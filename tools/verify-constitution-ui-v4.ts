import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import type {ConstitutionId,GameState,ProgramId} from '../src/contracts';
import type {CharterActionQuote} from '../src/constitution/types';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),options:Record<string,string>={},positionals:string[]=[];
for(let index=0;index<args.length;index++){
 const argument=args[index];
 if(!argument.startsWith('--')){positionals.push(argument);continue;}
 assert(['--manifest','--output','--input'].includes(argument),`Unknown option: ${argument}`);
 const value=args[++index];assert(value&&!value.startsWith('--'),`${argument} needs a path`);
 assert(options[argument]===undefined,`${argument} may only be supplied once`);options[argument]=value;
}
assert(positionals.length<=2,'Use at most two positional arguments: output and input');
const output=resolve(root,options['--output']??positionals[0]??'qa/simulations-v4/ui');
const input=resolve(root,options['--input']??positionals[1]??'qa/simulations-v4/casual/final');
const manifestPath=resolve(root,options['--manifest']??join(input,'source-manifest.json'));
const command=['npx tsx tools/verify-constitution-ui-v4.ts',...args.map(argument=>argument.includes(' ')?`'${argument.replaceAll("'","''")}'`:argument)].join(' ');
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const slash=(value:string)=>value.replaceAll('\\','/');
const ids:ConstitutionId[]=['commons','precaution','service','federation','plural','frontier'];
const boards:Record<ConstitutionId,string>={commons:'The living catalogue',precaution:'The assurance terraces',service:'The provision board',federation:'The three districts',plural:'The shared calendar',frontier:'The tender exchange'};
const boardClasses:Record<ConstitutionId,string>={commons:'charter-catalogue',precaution:'charter-terraces',service:'charter-services',federation:'charter-districts',plural:'charter-cohorts',frontier:'charter-rivals'};
const decode=(value:string)=>value.replaceAll('&amp;','&').replaceAll('&#x27;',"'").replaceAll('&#39;',"'").replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>');
const plain=(value:string)=>decode(value.replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
const escape=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const noDispatch=()=>{throw new Error('Rendering must not dispatch a game command.');};
const manifestRaw=await readFile(manifestPath,'utf8');
const manifestInput=JSON.parse(manifestRaw) as {sourceAggregateSha256?:string;sha256?:string;files:{path:string;sha256:string}[]};
const manifest={...manifestInput,sourceAggregateSha256:manifestInput.sourceAggregateSha256??manifestInput.sha256};
assert(manifest.sourceAggregateSha256&&/^[a-f0-9]{64}$/.test(manifest.sourceAggregateSha256),'Manifest must contain a SHA-256 sourceAggregateSha256 or sha256');
assert.equal(sha(JSON.stringify(manifest.files)),manifest.sourceAggregateSha256,'Manifest aggregate must match its file list');
async function verifySource(){const mismatches:string[]=[];for(const entry of manifest.files)if(sha(await readFile(join(root,entry.path)))!==entry.sha256)mismatches.push(entry.path);return mismatches;}
assert.deepEqual(await verifySource(),[],'Current source must match the selected source manifest before rendering.');
await mkdir(output,{recursive:true});
const checks:{id:string;kind:string;constitution:ConstitutionId;input?:string;inputSha256?:string;checks:string[];strategyBytes:number;labBytes?:number;quotesShown?:number;automation?:unknown;markup:string}[]=[];
const server=await createServer({root,server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'error'});
try {
 const {ConstitutionPanel}=await server.ssrLoadModule('/src/constitution/ConstitutionPanel.tsx');
 const {LaboratoryPanel}=await server.ssrLoadModule('/src/laboratory/LaboratoryPanel.tsx');
 const {createGame}=await server.ssrLoadModule('/src/engine/index.ts');
 const {createCharterEconomy,getCharterActions,charterAutomationScope,charterGardenEligibility}=await server.ssrLoadModule('/src/constitution/economics.ts');
 const {charterClearance}=await server.ssrLoadModule('/src/laboratory/evidence.ts');
 const {CHARTER_PROGRAM_BY_CONSTITUTION,PROGRAMS}=await server.ssrLoadModule('/src/laboratory/programs.ts');
 const render=(state:GameState)=>renderToStaticMarkup(React.createElement(ConstitutionPanel,{state,dispatch:noDispatch,onOpenResearch:(_program:ProgramId)=>{throw new Error('Render must not navigate.');}}));
 function validateMarkup(state:GameState,html:string){
  assert(!/NaN|undefined|Infinity/.test(html),'No invalid numeric/text values');
  assert(html.includes(`aria-label="${boards[state.constitution]}"`),'Matching accessible strategy board');
  assert(html.includes(`class="${boardClasses[state.constitution]}"`),'Constitution-specific instrument');
  for(const other of ids.filter(id=>id!==state.constitution))assert(!html.includes(`class="${boardClasses[other]}"`),`No ${other} instrument in ${state.constitution}`);
  assert(html.includes('aria-label="Constitutional application progress"'),'Visible applied research status');
  const program=CHARTER_PROGRAM_BY_CONSTITUTION[state.constitution];
  const definition=PROGRAMS.find((item:{id:ProgramId})=>item.id===program);
  assert(plain(html).includes(`Open ${definition.name}`),'Matching sixth-program navigation control');
  assert(html.includes('aria-label="Mastered strategy automation"'),'Automation controls present');
 }
 for(const kind of ids){
  for(const populated of [false,true]){
   const state:GameState=createGame(1701,0);state.constitution=kind;state.charter=createCharterEconomy(kind);
   const c=state.charter!;
   // These are isolated presentation fixtures, not campaign evidence or economic simulations.
   if(populated){
    if(c.kind==='commons')c.data.methods=[{id:1,program:'oversight',source:'render-fixture',dependencies:[],maintenance:100,uses:2.5,retired:false},{id:2,program:'control',source:'render-fixture',dependencies:[1],maintenance:65,uses:1.25,retired:false}];
    if(c.kind==='precaution')c.data.tranches=[{id:1,bond:'1800',capacity:150,coverage:1,wear:0,source:'render-fixture',active:true}];
    if(c.kind==='service'){c.data.active=true;c.data.contract=1;c.data.funding='18';c.data.lanes.forEach(lane=>{lane.required=15;lane.delivered=5;lane.backlog=10;});}
    if(c.kind==='federation')c.data.transfers=[{id:1,from:0,to:1,amount:'10',remaining:18,fee:'0.1'}];
    if(c.kind==='plural')c.data.careReserve='100';
    if(c.kind==='frontier')c.data.tenders=[{id:1,kind:'verified',collateral:'24',reward:'5',required:10,delivered:5,remaining:120,source:'render-fixture'}];
   }
   const before=JSON.stringify(state),html=render(state);
   validateMarkup(state,html);assert.equal(JSON.stringify(state),before,'Rendering cannot mutate its fixture');
   const id=`${kind}-${populated?'populated':'initial'}-fixture`,markup=`${id}.html`;
   await writeFile(join(output,markup),html);
   checks.push({id,kind:'isolated render fixture',constitution:kind,checks:['matching board','distinct instrument','matching sixth-program navigation label','application progress','automation controls','finite displayed values','no state mutation'],strategyBytes:Buffer.byteLength(html),markup});
  }
 }
 for(let index=0;index<ids.length;index++){
  const file=join(input,`world-${index+1}-before-ending.json`),raw=await readFile(file,'utf8');
  const parsed=JSON.parse(raw);const state:GameState=parsed.state??parsed;
  const kind=ids[index];assert.equal(state.constitution,kind);assert.equal(state.ending,null);assert.equal(state.charter?.kind,kind);assert.equal(state.charter?.appliedTier,6);
  const before=JSON.stringify(state),html=render(state),text=plain(html);
  validateMarkup(state,html);
  assert(text.includes('Capstone applied in this civilization.'),'Earned capstone is visibly applied');
  const readiness=charterGardenEligibility(state);assert(readiness.allowed,'Earned pre-ending charter is ready');assert(text.includes(readiness.reason),'Readiness explanation matches engine');
  for(const tier of [1,3,6] as const){const evidence=charterClearance(state,tier);assert(evidence.allowed,`Earned tier ${tier} evidence complete`);assert(text.includes(evidence.reason),`Tier ${tier} UI displays authoritative proof/project status`);}
  const buttons=[...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match=>({attributes:match[1],text:plain(match[2])}));
  const quotes:CharterActionQuote[]=getCharterActions(state);let quotesShown=0;
  for(const quote of quotes){const button=buttons.find(item=>item.text===quote.title);if(!button)continue;quotesShown++;
   assert(text.includes(quote.description),`Displayed ${quote.action} explains the actual quote`);assert(text.includes(quote.effect),`Displayed ${quote.action} explains the actual consequence`);
   if(!quote.allowed)assert(text.includes(quote.reason),`Blocked ${quote.action} gives its reason`);
   assert.equal(/\bdisabled(?:=""|\s|$)/.test(button.attributes),!quote.allowed||Boolean(state.pendingEvent||state.paused||state.ending),`${quote.title}: enabled state matches authoritative quote`);
  }
  assert(quotesShown>0,'At least one quoted institutional operation is visible');
  const scope=state.charter?.automation??charterAutomationScope(state);
  assert(Number.isInteger(scope.maxTier)&&scope.maxTier>=0&&scope.maxTier<=6,'Finite supported automation tier');
  assert(Array.isArray(scope.actions)&&new Set(scope.actions).size===scope.actions.length,'Automation action set is finite and unique');
  assert(scope.actions.every((action:string)=>!['openTranche','retireTranche','withdraw','retract','transferDistrict','investDistrict'].includes(action)),'No forbidden automatic authority or capital expansion');
  const authorization=html.match(/<div class="charter-authorization">([\s\S]*?)<\/div>/)?.[1]??'';
  assert.equal((authorization.match(/<li\b/g)??[]).length,scope.actions.length,'Displayed operation list matches the finite authorized action count');
  assert(text.includes(`Up to applied study tier ${scope.maxTier}.`),'Exact automation tier visible');
  assert(html.includes('value="20"'),'Finite 20-operation authorization option');
  assert(text.includes('Changing a strategy setting stops the batch and returns unused funds.'),'Changed-plan refund semantics visible');
  if(state.charter?.automation)assert(state.charter.automation.remaining>=1&&state.charter.automation.remaining<=20,'Active operation limit is finite');
  const program=CHARTER_PROGRAM_BY_CONSTITUTION[kind],definition=PROGRAMS.find((item:{id:ProgramId})=>item.id===program);
  const lab=renderToStaticMarkup(React.createElement(LaboratoryPanel,{state,dispatch:noDispatch,initialProgram:program}));
  assert(!/NaN|undefined|Infinity/.test(lab),'Laboratory displays finite values');
  const nav=lab.match(/<nav class="lab-programs"[^>]*>([\s\S]*?)<\/nav>/)?.[1]??'';
  const selected=[...nav.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].filter(match=>match[1].includes('aria-pressed="true"'));
  assert.equal(selected.length,1,'Exactly one research program selected');assert(plain(selected[0][2]).includes(definition.name),'Matching sixth program selected in laboratory');
  assert.equal((nav.match(/<button\b/g)??[]).length,6,'Five common programs plus one active constitutional program');
  assert.equal(JSON.stringify(state),before,'Strategy and lab rendering do not mutate earned state');
  const id=`world-${index+1}-${kind}-earned`,markup=`${id}.html`;
  await writeFile(join(output,markup),html);await writeFile(join(output,`${id}-laboratory.html`),lab);
  checks.push({id,kind:'actual final earned pre-ending state',constitution:kind,input:slash(relative(root,file)),inputSha256:sha(raw),checks:['matching board and distinct instrument','matching sixth-program navigation control','matching active sixth laboratory program','authoritative quote descriptions/effects/disabled state','authoritative tier 1/3/6 proof and project status','visible earned capstone and readiness','finite explicit automation scope and operation limit','no rendering commands or state mutation','finite displayed values'],strategyBytes:Buffer.byteLength(html),labBytes:Buffer.byteLength(lab),quotesShown,automation:{actions:scope.actions,maxTier:scope.maxTier,active:!!state.charter?.automation},markup});
 }
}finally{await server.close();}
assert.deepEqual(await verifySource(),[],'Frozen game source remains unchanged after rendering.');
const result={status:'passed',createdAt:new Date().toISOString(),command,sourceManifest:slash(relative(root,manifestPath)),sourceManifestSha256:sha(manifestRaw),sourceAggregateSha256:manifest.sourceAggregateSha256,sourceFileCount:manifest.files.length,sourceMatchedBeforeAndAfter:true,toolSha256:sha(await readFile(fileURLToPath(import.meta.url))),fixtureCases:12,earnedCases:6,checks,limitations:['Server rendering verifies structural markup and pure rendering, not browser layout, CSS contrast, keyboard interaction, hydration, or navigation events.','The twelve isolated fixtures exercise presentation branches only. They are not played campaigns or evidence of economic feasibility.','The six earned cases load final casual pre-ending exports without modifying or advancing them.','Root browser QA covers production and narrow-screen Commons separately.'],reactReview:{componentStructure:'Six dedicated board components, typed shared quote controls, and a world-keyed workspace.',hooks:'Unconditional hooks; local drafts only; no effects that change economy state.',accessibility:'Labelled sections and inputs, explicit pressed states, named navigation and finite authorization controls; browser interaction checks remain separate.',rendering:'No dispatch, navigation, or state mutation during server rendering; decoration uses CSS/SVG rather than animation-driven state.',types:'Discriminated charter state and engine quote helpers; currency inputs and formatted balances use decimal strings.'}};
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2));
await writeFile(join(output,'verification-tool.ts.txt'),await readFile(fileURLToPath(import.meta.url)));
const rows=checks.filter(item=>item.kind==='actual final earned pre-ending state').map(item=>`| ${item.constitution} | ${item.quotesShown} | Passed | Passed | Passed |`).join('\n');
await writeFile(join(output,'REPORT.md'),`# Constitution UI verification\n\nPassed **12 isolated render fixtures and 6 actual earned pre-ending states** using the final frozen game source. The corresponding six laboratory views also selected the correct sixth program.\n\nRun from the game directory:\n\n\`\`\`powershell\n${command}\n\`\`\`\n\nSource manifest: \`${slash(relative(root,manifestPath))}\`. Source fingerprint: \`${manifest.sourceAggregateSha256}\` (${manifest.files.length} files). Every file matched before and after the checks. No game source, save, or earned state was changed.\n\n| Earned constitution | Visible quoted operations | Evidence and capstone | Sixth laboratory program | Bounded automation |\n| --- | ---: | --- | --- | --- |\n${rows}\n\nThe earned inputs are \`casual/final/world-1-before-ending.json\` through \`world-6-before-ending.json\`. Their SHA-256 hashes, assertions, and raw rendered fragments are recorded in [results.json](results.json). All quoted operations that appear in the selected object's drawer matched the engine's descriptions, consequences, disabled states, and blocked reasons. Tier 1, 3, and 6 research status matched the authoritative evidence-and-project helper. The applied capstone and current constitutional readiness were visible.\n\nAutomation displayed the current finite operation scope and highest applied tier, excluded automatic authority/capital expansion, retained the 20-operation limit, and explained that changing strategy stops the plan and refunds unused funds. Strategy and laboratory rendering dispatched no commands and left each earned input byte-equivalent after parsing.\n\nThe React review found typed regime-specific components, unconditional hooks, local-only drafts, world-keyed selection, labelled controls, decimal-safe amounts, and no rendering side effects.\n\nThese are **structural server-render checks**. They do not exercise browser layout, keyboard input, hydration, contrast, or actual navigation events. The 12 initial/populated fixtures are presentation cases, not played campaigns. Root's production/mobile Commons browser QA is separate.\n`);
console.log(JSON.stringify({status:result.status,fixtureCases:12,earnedCases:6,source:manifest.sourceAggregateSha256,output:slash(relative(root,output))}));

