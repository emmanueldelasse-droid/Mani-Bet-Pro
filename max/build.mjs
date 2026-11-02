import {readFile,mkdir,writeFile} from 'node:fs/promises';
const dir=new URL('.',import.meta.url);
const [source,html]=await Promise.all([
  readFile(new URL('./worker.mjs',dir),'utf8'),
  readFile(new URL('./dashboard.html',dir),'utf8')
]);
const marker="const MAX_APP_HTML = '';";
if(!source.includes(marker))throw new Error('Point d’injection dashboard introuvable');
const bundle=source.replace(marker,'const MAX_APP_HTML = '+JSON.stringify(html)+';');
const out=new URL('./dist/worker.mjs',dir);
await mkdir(new URL('./dist/',dir),{recursive:true});
await writeFile(out,bundle,'utf8');
console.log('ManiBetProMax bundle prêt · '+bundle.length+' caractères');
