export interface AudioPreferences {enabled:boolean;volume:number}
export const AUDIO_PREFERENCE_KEY='last-garden.audio.v1';
const defaults:AudioPreferences={enabled:true,volume:.3};

function browserStorage():Pick<Storage,'getItem'|'setItem'>|undefined {
 try{return typeof localStorage==='undefined'?undefined:localStorage;}catch{return undefined;}
}

// Audio belongs to this browser, not a civilization or an imported save. Older
// saves used sound:false for both the default and an explicit choice, so they
// cannot safely migrate a preference. Record deliberate choices separately.
export function loadAudioPreferences(storage=browserStorage()):AudioPreferences {
 try{
  const saved=JSON.parse(storage?.getItem(AUDIO_PREFERENCE_KEY)??'null') as Partial<AudioPreferences>|null;
  return {
   enabled:typeof saved?.enabled==='boolean'?saved.enabled:defaults.enabled,
   volume:typeof saved?.volume==='number'&&Number.isFinite(saved.volume)?Math.min(1,Math.max(0,saved.volume)):defaults.volume,
  };
 }catch{return {...defaults};}
}

export function saveAudioPreferences(preferences:AudioPreferences,storage=browserStorage()):void {
 try{storage?.setItem(AUDIO_PREFERENCE_KEY,JSON.stringify(preferences));}catch{/* Playback still works when local storage is unavailable. */}
}
