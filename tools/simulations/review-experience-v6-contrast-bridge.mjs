/** Verify the final disabled-ending contrast change without rerunning unchanged DOM checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const initial=JSON.parse(fs.readFileSync('qa/experience-v6/source-freeze.json','utf8'));
const final=JSON.parse(fs.readFileSync('qa/experience-v6/release-source.json','utf8'));
const ssr=JSON.parse(fs.readFileSync('qa/experience-v6/review-release/results.json','utf8'));
assert.equal(final.sha256,'88cb25eb6e3732140740f6470453ecd9d1a6635156fbb9e5c62b48201dac058a');
assert.equal(hash(JSON.stringify(final.files)),final.sha256);
for(const item of final.files)assert.equal(hash(fs.readFileSync(item.path)),item.sha256,`Final source differs: ${item.path}`);

const oldStyles=initial.files.find(item=>item.path==='src/styles.css');
assert(oldStyles);
const previousFiles=final.files.map(item=>item.path==='src/styles.css'?{...item,sha256:oldStyles.sha256}:item);
const previousAggregate=hash(JSON.stringify(previousFiles));
assert.equal(previousAggregate,'1a0f303b386eb98738132a75c674505394e66421967bb91d9320674979b4ac6b');
assert.equal(previousAggregate,ssr.frozenSource.sha256);
assert.equal(ssr.status,'passed');
const css=fs.readFileSync('src/styles.css','utf8');
const marker='.ending-option:disabled{opacity:1';
const index=css.indexOf(marker);assert(index>=0);
assert.equal(hash(css.slice(0,index)),oldStyles.sha256,'Change exceeds the appended disabled-ending rules');
const addition=css.slice(index).trim();
assert.equal(addition,'.ending-option:disabled{opacity:1;background:#18221a;border-style:dashed}.ending-option:disabled h3{color:#c2cbb5}.ending-option:disabled p,.ending-option:disabled small{color:#acb9a2}.ending-option:disabled .eyebrow{color:#b8b7a2}');

const luminance=color=>{
  const channels=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
};
const contrast=(a,b)=>{const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]+.05)/(values[1]+.05);};
const colors={heading:'#c2cbb5',descriptionAndReason:'#acb9a2',unavailableLabel:'#b8b7a2'},background='#18221a';
const ratios=Object.fromEntries(Object.entries(colors).map(([name,color])=>[name,Number(contrast(color,background).toFixed(2))]));
for(const value of Object.values(ratios))assert(value>=4.5);
const result={status:'passed',createdAt:new Date().toISOString(),previousSource:previousAggregate,finalSource:final.sha256,verifiedSourceFiles:final.files.length,changedFiles:['src/styles.css'],cssAddition:addition,preservedSsr:{report:'qa/experience-v6/review-release/results.json',cases:ssr.cases,assertions:ssr.assertions,status:ssr.status},declaredColorContrast:{background,foreground:colors,ratios},conclusions:['The only source delta from the fully checked 1a0f303b release is this exact CSS addition.','No DOM, gameplay action, eligibility predicate, copy, or persistence code changed. Native disabled buttons remain disabled.','Opacity no longer dims the explanatory text; the dashed border and existing unavailable label distinguish unavailable outcomes.'],limitations:['Contrast calculations use the declared opaque CSS colors; actual browser rendering and interaction are checked separately by the root agent.','This is a one-file source bridge, not a claim that the prior SSR checks executed on the new aggregate or a full accessibility certification.']};
fs.writeFileSync('qa/experience-v6/review-release/contrast-bridge.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:result.status,previousSource:previousAggregate,finalSource:final.sha256,changedFiles:result.changedFiles,ratios},null,2));
