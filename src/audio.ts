type Cue='tend'|'buy'|'research'|'alert'|'chapter';
type AudioManifest={music?:Record<string,string>;effects?:Record<string,string>};
let manifest:AudioManifest={};
let enabled=false, musicName='', volume=.3, lastCue=0, currentChapter=1;
let music:HTMLAudioElement|null=null;
let status='Sound is off';
const listeners=new Set<()=>void>();
export const getAudioStatus=()=>status;
export function subscribeAudio(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
function report(message:string){status=message;for(const listener of listeners)listener();}
export async function prepareAudio(){
 try{const response=await fetch(`${import.meta.env.BASE_URL}audio/manifest.json`);if(!response.ok)throw Error('manifest');manifest=await response.json();if(enabled)setMusicChapter(currentChapter);}
 catch{report('Audio could not load. The game can still continue.');}
}
export function setAudioEnabled(value:boolean,chapter=1){enabled=value;currentChapter=chapter;if(!enabled){music?.pause();report('Sound is off');return;}setMusicChapter(chapter);}
export function setAudioVolume(value:number){volume=Math.min(1,Math.max(0,value));if(music)music.volume=volume*.45;}
export function setMusicChapter(chapter:number){
 currentChapter=chapter;if(!enabled)return;
 const key=chapter<3?'garden':chapter<5?'laboratory':'civilization';
 const source=manifest.music?.[key];if(!source){report('Loading original soundtrack…');return;}
 if(musicName!==source){
  music?.pause();music?.remove();
  music=new Audio(`${import.meta.env.BASE_URL}${source.replace(/^\//,'')}`);
  music.hidden=true;music.setAttribute('aria-hidden','true');music.dataset.role='garden-soundtrack';
  music.loop=true;music.volume=volume*.45;musicName=source;
  document.body.appendChild(music);
 }
 const active=music;if(!active)return;
 void active.play().then(()=>{if(active===music&&enabled)report(`Playing: ${key==='garden'?'A Quiet Beginning':key==='laboratory'?'The Work of Understanding':'A World to Care For'}`);}).catch(()=>{if(active===music)report('Playback paused by the browser. Toggle sound to try again.');});
}
export function playCue(name:Cue){
 if(!enabled)return;const now=performance.now();if(name==='tend'&&now-lastCue<180)return;lastCue=now;
 const source=manifest.effects?.[name];if(!source)return;
 const sound=new Audio(`${import.meta.env.BASE_URL}${source.replace(/^\//,'')}`);sound.volume=volume*.7;
 void sound.play().catch(()=>{});
}
if(import.meta.hot)import.meta.hot.dispose(()=>{music?.pause();music?.remove();listeners.clear();});
