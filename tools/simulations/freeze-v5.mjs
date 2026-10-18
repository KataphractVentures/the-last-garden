import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const walk = directory => fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
const names = [...walk('src'), 'package.json', 'package-lock.json', 'vite.config.ts'].sort();
const files = names.map(name => ({path:name.replaceAll('\\','/'), sha256:sha(fs.readFileSync(name))}));
const manifest = {createdAt:new Date().toISOString(), sha256:sha(JSON.stringify(files)), files};
const target = process.argv[2] || 'qa/simulations-v5/source-freeze.json';
fs.mkdirSync(path.dirname(target), {recursive:true});
fs.writeFileSync(target, JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({path:target,sha256:manifest.sha256,files:files.length}));
