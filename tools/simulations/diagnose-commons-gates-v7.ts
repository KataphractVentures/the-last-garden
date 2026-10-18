import fs from 'node:fs';
import {STORY_EVENTS} from '../../src/content/story.ts';
const dir='qa/opening-v7/pacing/commons-diagnosis';
const diagnosis=JSON.parse(fs.readFileSync(`${dir}/diagnosis.json`,'utf8'));
const trace=fs.readFileSync('qa/opening-v7/pacing/final/actions.jsonl','utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.world===1&&row.type==='command'&&row.command.type==='choose'&&row.ok);
const old=JSON.parse(fs.readFileSync('qa/experience-v6/pacing/final/world-1-report.json','utf8'));
const next=JSON.parse(fs.readFileSync('qa/opening-v7/pacing/final/world-1-report.json','utf8'));
const byChapter:Record<string,any>={};
const waits=diagnosis.waits.map((row:any)=>{
 const read=new Set(trace.filter(command=>command.wallSeconds<=row.wallSeconds).map(command=>command.command.event));
 const core=STORY_EVENTS.find(event=>!event.optional&&event.chapter===row.chapter&&!read.has(event.id));
 const threshold=core?.trigger.lifetimeTokens??0;
 const waitingForLifetime=!row.pending&&!!core&&row.lifetime<threshold;
 const fullyStudiedLifetimeWait=waitingForLifetime&&!row.active&&!row.study;
 if(fullyStudiedLifetimeWait){const group=byChapter[row.chapter]??={intervals:0,requestedSeconds:0,actualSeconds:0,pausedSeconds:0};for(const key of ['requestedSeconds','actualSeconds','pausedSeconds'])group[key]+=row[key];group.intervals++;}
 return {...row,nextCore:core?{id:core.id,threshold,deficit:Math.max(0,threshold-row.lifetime)}:null,waitingForLifetime,fullyStudiedLifetimeWait};
});
const oldIds=new Set(old.choices.map((choice:any)=>choice.event));
const extraChoices=next.choices.filter((choice:any)=>!oldIds.has(choice.event)).map((choice:any)=>{const event=STORY_EVENTS.find(event=>event.id===choice.event)!;const option=event.choices.find(option=>option.label===choice.label)!;return {event:event.id,title:event.title,kind:event.optional?event.characterId?'character':'incident':'core',authoredChapter:event.chapter,chosenAt:choice.engineSeconds,effects:option.effects};});
const chapterDeltas=[];for(let chapter=1;chapter<=7;chapter++){const left=old.milestones.find((m:any)=>m.chapter===chapter),right=next.milestones.find((m:any)=>m.chapter===chapter),leftEnd=old.milestones.find((m:any)=>m.chapter===chapter+1)?.wallSeconds??old.time.modeledWallSeconds,rightEnd=next.milestones.find((m:any)=>m.chapter===chapter+1)?.wallSeconds??next.time.modeledWallSeconds;chapterDeltas.push({chapter,beforeSeconds:leftEnd-left.wallSeconds,afterSeconds:rightEnd-right.wallSeconds,deltaSeconds:(rightEnd-right.wallSeconds)-(leftEnd-left.wallSeconds)});}
const result={...diagnosis,waits,fullyStudiedLifetimeWaitByChapter:byChapter,extraChoices,chapterDeltas};
fs.writeFileSync(`${dir}/gates.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({fullyStudiedLifetimeWaitByChapter:byChapter,extraChoices,chapterDeltas},null,2));
