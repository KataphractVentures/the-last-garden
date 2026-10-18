import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {getAudioStatus,prepareAudio,setAudioEnabled,setMusicChapter,setAudioVolume,stopAudio} from '../src/audio';
import {AUDIO_PREFERENCE_KEY,loadAudioPreferences,saveAudioPreferences} from '../src/audioPreferences';

const eventListeners=new Map<string,Set<(event:Event)=>void>>();
const tracks:FakeAudio[]=[];
let playback:'allowed'|'blocked'|'pending'='allowed';
let finishPlayback:(()=>void)|undefined;
let deliverManifest:()=>void;
const manifestReady=new Promise<void>(resolve=>{deliverManifest=resolve;});
let manifestRequests=0;
class FakeKeyboardEvent {ctrlKey=false;metaKey=false;altKey=false;isTrusted=true;}
class FakeAudio {
 paused=true;hidden=false;loop=false;volume=1;dataset:Record<string,string>={};playCount=0;removed=false;
 constructor(readonly src:string){tracks.push(this);}
 setAttribute(){}
 play(){
  this.playCount++;
  if(playback==='blocked')return Promise.reject(Object.assign(new Error('User activation required'),{name:'NotAllowedError'}));
  this.paused=false;
  if(playback==='pending')return new Promise<void>(resolve=>{finishPlayback=resolve;});
  return Promise.resolve();
 }
 pause(){this.paused=true;}
 remove(){this.removed=true;}
}
const originals={Audio:globalThis.Audio,document:globalThis.document,KeyboardEvent:globalThis.KeyboardEvent,fetch:globalThis.fetch};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function interact(trusted=true){for(const listener of eventListeners.get('click')??[])listener({isTrusted:trusted} as Event);}
function listenerCount(){return [...eventListeners.values()].reduce((sum,listeners)=>sum+listeners.size,0);}

before(()=>{
 Object.assign(globalThis,{
  Audio:FakeAudio,KeyboardEvent:FakeKeyboardEvent,
  document:{body:{appendChild(){}},
   addEventListener(type:string,listener:(event:Event)=>void){const group=eventListeners.get(type)??new Set();group.add(listener);eventListeners.set(type,group);},
   removeEventListener(type:string,listener:(event:Event)=>void){eventListeners.get(type)?.delete(listener);}},
  fetch:async()=>{manifestRequests++;await manifestReady;return {ok:true,json:async()=>({music:{garden:'audio/garden.mp3',laboratory:'audio/laboratory.mp3',civilization:'audio/civilization.mp3'}})};},
 });
});
beforeEach(()=>{stopAudio();tracks.length=0;playback='allowed';finishPlayback=undefined;});
after(()=>{stopAudio();Object.assign(globalThis,originals);});

test('a late soundtrack download cannot undo a mute made during startup',async()=>{
 setAudioEnabled(true,1);
 const ready=Promise.all([prepareAudio(),prepareAudio()]);
 setAudioEnabled(false,1);
 deliverManifest();await ready;
 assert.equal(manifestRequests,1);
 assert.equal(tracks.length,0);
 assert.equal(getAudioStatus(),'Sound is off');
 assert.equal(listenerCount(),0);
});

test('audio starts enabled unless the browser has an explicit preference',()=>{
 const values=new Map<string,string>();
 const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
 assert.deepEqual(loadAudioPreferences(storage),{enabled:true,volume:.3});
 saveAudioPreferences({enabled:false,volume:.15},storage);
 assert.deepEqual(loadAudioPreferences(storage),{enabled:false,volume:.15},'a deliberate mute survives reload');
 saveAudioPreferences({enabled:true,volume:0},storage);
 assert.deepEqual(loadAudioPreferences(storage),{enabled:true,volume:0},'zero volume is a deliberate preference too');
 values.set(AUDIO_PREFERENCE_KEY,'not json');
 assert.deepEqual(loadAudioPreferences(storage),{enabled:true,volume:.3});
});

test('unavailable browser storage does not prevent playback or a local mute',()=>{
 const storage={getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}};
 assert.deepEqual(loadAudioPreferences(storage),{enabled:true,volume:.3});
 assert.doesNotThrow(()=>saveAudioPreferences({enabled:false,volume:.3},storage));
});

test('startup attempts music once and shares the loaded manifest',async()=>{
 assert.equal(manifestRequests,1);
 setAudioVolume(.4);
 setAudioEnabled(true,1);
 setMusicChapter(1);
 await flush();
 assert.equal(tracks.length,1);
 assert.equal(tracks[0].playCount,1);
 assert.equal(tracks[0].volume,.4*.45);
 assert.equal(tracks[0].paused,false);
 assert.match(getAudioStatus(),/^Playing: A Quiet Beginning/);
 assert.equal(listenerCount(),0);
});

test('blocked autoplay retries on a real interaction without duplicating music or listeners',async()=>{
 playback='blocked';setAudioEnabled(true,1);await flush();
 assert.match(getAudioStatus(),/next click or key press/);
 assert.equal(listenerCount(),3);
 interact();await flush();
 assert.equal(listenerCount(),3,'repeated blocked retries share one listener per event');
 const attempts=tracks[0].playCount;
 playback='allowed';interact(false);await flush();
 assert.equal(tracks[0].playCount,attempts,'synthetic events cannot unlock audio');
 interact();await flush();
 assert.equal(tracks.length,1);
 assert.equal(tracks[0].paused,false);
 assert.match(getAudioStatus(),/^Playing:/);
 assert.equal(listenerCount(),0);
});

test('a mute click wins over its capture-phase retry and any late play promise',async()=>{
 playback='blocked';setAudioEnabled(true,1);await flush();
 playback='pending';interact();setAudioEnabled(false,1);
 assert.equal(tracks[0].paused,true);
 finishPlayback?.();await flush();
 assert.equal(getAudioStatus(),'Sound is off');
 assert.equal(tracks[0].paused,true);
 assert.equal(listenerCount(),0);
 const attempts=tracks[0].playCount;interact();await flush();
 assert.equal(tracks[0].playCount,attempts,'later interaction cannot undo a mute');
});

test('chapter changes replace the one soundtrack, while muted chapter changes stay silent',async()=>{
 setAudioEnabled(true,1);await flush();
 const original=tracks[0];
 setMusicChapter(3);await flush();
 assert.equal(original.paused,true);
 assert.equal(original.removed,true);
 assert.match(tracks[1].src,/laboratory/);
 setAudioEnabled(false,3);setMusicChapter(5);await flush();
 assert.equal(tracks.length,2);
 assert.equal(getAudioStatus(),'Sound is off');
 setAudioEnabled(true,5);await flush();
 assert.match(tracks[2].src,/civilization/);
 assert.equal(tracks.filter(track=>!track.removed).length,1);
 assert.match(getAudioStatus(),/A World to Care For/);
 stopAudio();
 assert.equal(tracks.filter(track=>!track.removed).length,0);
});
