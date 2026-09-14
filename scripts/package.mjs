import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { zipSync, unzipSync } from 'fflate';

const root=process.cwd(), files={};
const directories=['src','server','shared','scripts','tests','dist','demo','benchmark-results'];
const selected=[...directories,'package.json','package-lock.json','tsconfig.json','vite.config.ts','index.html','.env.example','.gitignore','README.md','START-HERE.md','CONNECTED-SOURCES.md','VALIDATION.md','Start-ReproSafe.cmd','Stop-ReproSafe.cmd','Restart-ReproSafe.cmd'];
function include(path) {
  const full=resolve(root,path), entries=readdirSync(full,{withFileTypes:true});
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const child=resolve(full,entry.name), local=relative(root,child).replaceAll('\\','/');
    if (entry.isDirectory()) include(local);
    else if(entry.isFile()) files[`reprosafe/${local}`]=readFileSync(child);
  }
}
for (const path of selected) {
  if (directories.includes(path)) include(path);
  else files[`reprosafe/${path}`]=readFileSync(resolve(root,path));
}
const archive=zipSync(files,{level:6});
const entries=Object.keys(unzipSync(archive));
if (entries.some(path=>/(?:^|\/)(?:node_modules|\.wasmer|\.local|test-results)(?:\/|$)/.test(path) || path.endsWith('/.env'))) throw new Error('Distribution contains a disallowed local file.');
writeFileSync(resolve(root,'../ReproSafe-source.zip'),archive);
const demo=Object.fromEntries(Object.entries(files).filter(([name])=>name.startsWith('reprosafe/demo/retail/')).map(([name,data])=>[name.replace('reprosafe/demo/retail/',''),data]));
writeFileSync(resolve(root,'../ReproSafe-demo.zip'),zipSync(demo,{level:6}));
console.log(`Packaged ${entries.length} files (${Math.round(archive.length/1024)} KB), excluding keys, runtime cache, local sessions, and test exports.`);
