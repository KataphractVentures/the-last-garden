import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExperimentConfig, GameState, Rates } from '../src/contracts';
import { createGame } from '../src/engine';
import { commonsRegime } from '../src/constitution/commons';
import { activeExperimentTemplates } from '../src/laboratory/catalog';
import { runExperiment } from '../src/laboratory/experiments';
import { decimal } from '../src/engine/amounts';

const rates:Rates={tokens:'100',useful:'100',research:'100',raw:'100',compute:100,demand:100,utilization:1,review:50,distortion:0,click:'6',bottleneck:''};
/** An isolated causal fixture, not a claimed earned campaign. */
function library():GameState {
 const s=createGame(1701,0);if(s.charter?.kind!=='commons')throw Error('Commons');
 s.charter.data.mode='open';s.charter.data.methods=[{id:1,program:'oversight',source:'fixture',dependencies:[],maintenance:100,uses:120,retired:false},{id:2,program:'control',source:'fixture',dependencies:[1],maintenance:100,uses:120,retired:false}];
 return s;
}
test('Commons repair restores real reuse yield and weak dependencies constrain their children',()=>{
 const s=library();if(s.charter?.kind!=='commons')throw Error('Commons');const methods=s.charter.data.methods;
 const healthy=commonsRegime.rates(s,rates,'1');methods[0].maintenance=40;
 const worn=commonsRegime.rates(s,rates,'1');assert(decimal(worn.research).lt(healthy.research));
 // Both the parent and its healthy child inherit the weaker dependency condition.
 assert(decimal(worn.research).eq('101.44'));
 methods[0].maintenance=29;assert(decimal(commonsRegime.rates(s,rates,'1').research).eq(rates.research));
 methods[0].maintenance=100;assert.equal(commonsRegime.rates(s,rates,'1').research,healthy.research);
 const before=JSON.stringify(s);commonsRegime.rates(s,rates,'1');assert.equal(JSON.stringify(s),before);
});
test('Maintained Commons buys slower actual-use wear with real preparation capacity',()=>{
 const open=library(),maintained=library();if(maintained.charter?.kind!=='commons'||open.charter?.kind!=='commons')throw Error('Commons');
 maintained.charter.data.mode='maintained';assert(decimal(commonsRegime.rates(maintained,rates,'1').research).lt(commonsRegime.rates(open,rates,'1').research));
 const context={scale:'1',income:()=>{throw Error('Maintenance cannot create cash');},log:()=>{}};
 const inactive=library();const snapshot=JSON.stringify(inactive.charter);commonsRegime.tick(inactive,60,{...rates,research:'0'},context);assert.equal(JSON.stringify(inactive.charter),snapshot);
 for(let i=0;i<240;i++){commonsRegime.tick(open,.25,rates,context);commonsRegime.tick(maintained,.25,rates,context);}
 assert(maintained.charter.data.methods[0].maintenance>open.charter.data.methods[0].maintenance);
 assert.equal(open.charter.data.methods[0].uses,maintained.charter.data.methods[0].uses);
});
test('Routine Commons automation offers maintenance below the visible 75-condition boundary',()=>{
 const s=library();if(s.charter?.kind!=='commons')throw Error('Commons');
 const template=activeExperimentTemplates('commons').find(t=>t.id==='stewardship-1')!;
 const config:ExperimentConfig={program:'stewardship',template:template.id,seed:1701,cohort:128,budget:1024,holdout:.25,intervention:template.interventions[0],distribution:'familiar',lineage:'clean',prediction:'A controlled fictional method can remain reusable within a bounded maintenance budget.',control:true};
 const root=runExperiment(config);root.adopted=true;root.replicated=true;
 s.experiments=[root,...(['shifted','adversarial'] as const).map((distribution,index)=>runExperiment({...config,seed:1702+index,distribution,replicateOf:root.id}))];s.projects=['stewardship-1'];
 s.charter.data.methods.forEach(method=>method.source=root.id);s.charter.data.focus='oversight';
 s.charter.data.methods[0].maintenance=75;assert.notEqual(commonsRegime.auto(s,'1')?.action,'maintain');
 s.charter.data.methods[0].maintenance=74.9;const offered=commonsRegime.auto(s,'1');assert.equal(offered?.action,'maintain');assert.equal(offered?.target,1);
});
