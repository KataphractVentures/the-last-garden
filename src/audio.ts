type Cue='tend'|'buy'|'research'|'alert'|'chapter';
type AudioManifest={music?:Record<string,string>;effects?:Record<string,string>};
let manifest:AudioManifest={};
let enabled=false, musicName='', volume=.3, lastCue=0, currentChapter=1;
let music:HTMLAudioElement|null=null;
let loading:Promise<void>|null=null;
let pendingPlay:HTMLAudioElement|null=null;
let retryListening=false;
let status='Sound is off';
const listeners=new Set<()=>void>();
const baseUrl=import.meta.env?.BASE_URL??'/';
export const getAudioStatus=()=>status;
export function subscribeAudio(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
function report(message:string){if(status===message)return;status=message;for(const listener of listeners)listener();}
function listenForRetry(value:boolean){
 if(value===retryListening)return;retryListening=value;
 for(const type of ['pointerup','keydown','click']){
  if(value)document.addEventListener(type,retryPlayback,true);
  else document.removeEventListener(type,retryPlayback,true);
 }
}
function retryPlayback(event:Event){
 if(!enabled||!event.isTrusted)return;
 if(event instanceof KeyboardEvent&&(event.ctrlKey||event.metaKey||event.altKey))return;
 setMusicChapter(currentChapter);
}
export function prepareAudio():Promise<void>{
 if(manifest.music)return Promise.resolve();
 if(loading)return loading;
 loading=(async()=>{
  try{const response=await fetch(`${baseUrl}audio/manifest.json`);if(!response.ok)throw Error('manifest');manifest=await response.json();if(enabled)setMusicChapter(currentChapter);}
  catch{if(enabled)report('Audio could not load. Toggle sound to retry.');}
  finally{loading=null;}
 })();
 return loading;
}
export function setAudioEnabled(value:boolean,chapter=1){enabled=value;currentChapter=chapter;if(!enabled){music?.pause();listenForRetry(false);report('Sound is off');return;}setMusicChapter(chapter);}
export function setAudioVolume(value:number){volume=Math.min(1,Math.max(0,value));if(music)music.volume=volume*.45;}
export function setMusicChapter(chapter:number){
 currentChapter=chapter;if(!enabled)return;
 const key=chapter<3?'garden':chapter<5?'laboratory':'civilization';
 const source=manifest.music?.[key];if(!source){report('Loading original soundtrack…');void prepareAudio();return;}
 if(musicName!==source){
  music?.pause();music?.remove();
  music=new Audio(`${baseUrl}${source.replace(/^\//,'')}`);
  music.hidden=true;music.setAttribute('aria-hidden','true');music.dataset.role='garden-soundtrack';
  music.loop=true;music.volume=volume*.45;musicName=source;
  document.body.appendChild(music);
 }
 const active=music;if(!active)return;
 if(pendingPlay===active||!active.paused)return;
 pendingPlay=active;
 void active.play().then(()=>{
  if(active!==music||!enabled){active.pause();return;}
  listenForRetry(false);
  report(`Playing: ${key==='garden'?'A Quiet Beginning':key==='laboratory'?'The Work of Understanding':'A World to Care For'}`);
 }).catch((error:unknown)=>{
  if(active!==music||!enabled)return;
  listenForRetry(true);
  report(error instanceof Error&&error.name==='NotAllowedError'?'Music starts on your next click or key press.':'Playback stopped. Click or press a key to retry.');
 }).finally(()=>{if(pendingPlay===active)pendingPlay=null;});
}
export function playCue(name:Cue){
 if(!enabled)return;const now=performance.now();if(name==='tend'&&now-lastCue<180)return;lastCue=now;
 const source=manifest.effects?.[name];if(!source)return;
 const sound=new Audio(`${baseUrl}${source.replace(/^\//,'')}`);sound.volume=volume*.7;
 void sound.play().catch(()=>{});
}
export function stopAudio(){enabled=false;listenForRetry(false);music?.pause();music?.remove();music=null;musicName='';pendingPlay=null;report('Sound is off');}
if(import.meta.hot)import.meta.hot.dispose(()=>{stopAudio();listeners.clear();});
