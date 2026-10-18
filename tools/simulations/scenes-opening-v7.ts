import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { STORY_EVENTS } from '../../src/content/story.ts';
import { parseSave } from '../../src/persistence/validation.ts';

const out=path.resolve(process.argv[2]??'qa/opening-v7/pacing/final');
const prior=path.resolve('qa/experience-v6/pacing/final');
const definitions=new Map(STORY_EVENTS.map(event=>[event.id,event]));
const read=(directory:string)=>fs.readFileSync(path.join(directory,'actions.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
function exposure(directory:string){
 const rows=read(directory),worlds:any[]=[];
 for(let index=1;index<=6;index++){
  const list=rows.filter(row=>row.world===index),choices:any[]=[],commands=list.filter(row=>row.type==='command'&&row.ok);
  let chapter=1;
  for(const row of commands){
   if(row.command.type==='advance')chapter++;
   if(row.command.type!=='choose')continue;
   const event=definitions.get(row.command.event);
   assert(event,`Missing story definition ${row.command.event}`);
   choices.push({id:event.id,kind:event.optional?event.characterId?'character':'incident':'core',authoredChapter:event.chapter,presentedChapter:chapter,carryOver:event.chapter<chapter,engineSeconds:row.engineSeconds,wallSeconds:row.wallSeconds,choice:row.command.choice});
  }
  const chars=choices.filter(row=>row.kind==='character');
  const gaps=chars.slice(1).map((row,i)=>({from:chars[i].id,to:row.id,seconds:row.engineSeconds-chars[i].engineSeconds}));
  const checkpoint=fs.readFileSync(path.join(directory,`world-${index}-ending.json`),'utf8');
  const parsed=parseSave(checkpoint);assert(parsed.ok,`Ending save rejected: ${index}`);
  const ledger=Object.fromEntries(choices.map(row=>[row.id,row.choice]));
  assert.deepEqual(ledger,parsed.state.decisions,`World ${index}: trace does not match saved story ledger`);
  const characterDefinitions=STORY_EVENTS.filter(event=>event.optional&&event.characterId);
  const ledgerFields=choices.map(row=>row.id);assert.equal(new Set(ledgerFields).size,ledgerFields.length,'A story rewarded twice in trace.');
  worlds.push({world:index,constitution:parsed.state.constitution,choiceCount:choices.length,counts:Object.fromEntries(['core','incident','character'].map(kind=>[kind,choices.filter(row=>row.kind===kind).length])),carriedCharacterScenes:chars.filter(row=>row.carryOver),characterSceneCount:chars.length,characterScenesAvailable:characterDefinitions.length,unreadCharacterScenes:characterDefinitions.filter(event=>!parsed.state.decisions[event.id]).map(event=>event.id),minimumCharacterChoiceGap:gaps.length?Math.min(...gaps.map(gap=>gap.seconds)):null,characterGaps:gaps,ledgerMatchesTrace:true,duplicateRewardedScenes:false,choices});
 }
 return worlds;
}
const current=exposure(out),previous=exposure(prior);
const runFreeze=JSON.parse(fs.readFileSync(path.join(out,'root-source-freeze.json'),'utf8'));
function opening(world:any){const choices=world.choices.filter((choice:any)=>choice.wallSeconds<3600),characters=choices.filter((choice:any)=>choice.kind==='character');return {counts:Object.fromEntries(['core','incident','character'].map(kind=>[kind,choices.filter((choice:any)=>choice.kind===kind).length])),minimumCharacterChoiceGap:characters.length>1?Math.min(...characters.slice(1).map((choice:any,i:number)=>choice.engineSeconds-characters[i].engineSeconds)):null,choices};}
const result={description:'Successful choose commands classified by the authored story IDs and metadata. Presentation chapter is reconstructed from public advance commands. The saved ending decision ledger is checked against the trace. Gaps are active engine time between resolved character decisions, not human reading time.',source:path.relative(process.cwd(),path.join(out,'root-source-freeze.json')).replaceAll('\\','/'),sourceSha256:runFreeze.sha256,openingFirstModeledHour:{prior:opening(previous[0]),current:opening(current[0])},worlds:current.map((world,i)=>({...world,prior:{counts:previous[i].counts,minimumCharacterChoiceGap:previous[i].minimumCharacterChoiceGap,carriedCharacterScenes:previous[i].carriedCharacterScenes.length,unreadCharacterScenes:previous[i].unreadCharacterScenes},deltaChoices:world.choiceCount-previous[i].choiceCount,deltaCharacterChoices:world.characterSceneCount-previous[i].characterSceneCount})),checks:{allDecisionLedgersMatch:current.every(world=>world.ledgerMatchesTrace),noDuplicateRewards:current.every(world=>!world.duplicateRewardedScenes),ninetySecondCharacterGaps:current.every(world=>world.minimumCharacterChoiceGap===null||world.minimumCharacterChoiceGap>=90)},limitations:['No count is a human engagement rating.','The character cooldown does not promise a ninety-second wall gap: choice-reading and engine pauses affect wall timing.','Core decisions and optional incidents are excluded from the character minimum-gap assertion.','A character scene can remain unread at an ending; availability across chapters does not force the player to consume every optional scene.']};
fs.writeFileSync(path.join(out,'scene-exposure.json'),JSON.stringify(result,null,2)+'\n');
const lines=['# Character-scene scheduling and ledger checks','',result.description,'','| Constitution | Core choices | Incidents | Character scenes | Character delta | Carried from prior chapters | Minimum character gap | Unread at ending |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',...result.worlds.map(world=>`| ${world.constitution} | ${world.counts.core} | ${world.counts.incident} | ${world.characterSceneCount} | ${world.deltaCharacterChoices>=0?'+':''}${world.deltaCharacterChoices} | ${world.carriedCharacterScenes.length} | ${world.minimumCharacterChoiceGap}s | ${world.unreadCharacterScenes.length} |`),'',`Checks: ${Object.entries(result.checks).map(([key,value])=>`${key}: ${value?'PASS':'FAIL'}`).join('; ')}.`, '', '## First modeled hour', '', `Character scenes: ${result.openingFirstModeledHour.prior.counts.character} before and ${result.openingFirstModeledHour.current.counts.character} after. Their minimum active-time separation changes from ${result.openingFirstModeledHour.prior.minimumCharacterChoiceGap}s to ${result.openingFirstModeledHour.current.minimumCharacterChoiceGap}s. Core choices: ${result.openingFirstModeledHour.prior.counts.core} → ${result.openingFirstModeledHour.current.counts.core}. Incidents: ${result.openingFirstModeledHour.prior.counts.incident} → ${result.openingFirstModeledHour.current.counts.incident}. This supports less bunching and preserved story continuity, not fewer total conversations.`, '', '## Interpretation', '', ...result.limitations.map(item=>`- ${item}`),''];
fs.writeFileSync(path.join(out,'SCENES.md'),lines.join('\n'));
console.log(JSON.stringify({checks:result.checks,worlds:result.worlds.map(({constitution,counts,deltaCharacterChoices,carriedCharacterScenes,minimumCharacterChoiceGap,unreadCharacterScenes})=>({constitution,counts,deltaCharacterChoices,carryOvers:carriedCharacterScenes.length,minimumCharacterChoiceGap,unread:unreadCharacterScenes.length}))},null,2));
if(!Object.values(result.checks).every(Boolean))process.exitCode=1;
