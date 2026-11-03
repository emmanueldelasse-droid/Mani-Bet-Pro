import {readFile,mkdir,writeFile} from 'node:fs/promises';
const dir=new URL('.',import.meta.url);
const [worker,engine,advanced,points,scheduler,quality,html,prompt]=await Promise.all([
 readFile(new URL('./worker.mjs',dir),'utf8'),
 readFile(new URL('./engine.mjs',dir),'utf8'),
 readFile(new URL('./advanced.mjs',dir),'utf8'),
 readFile(new URL('./points.mjs',dir),'utf8'),
 readFile(new URL('./scheduler.mjs',dir),'utf8'),
 readFile(new URL('./quality-worker.mjs',dir),'utf8'),
 readFile(new URL('./dashboard.html',dir),'utf8'),
 readFile(new URL('./analyst-prompt.md',dir),'utf8')
]);
if(!worker.includes("const MAX_APP_HTML='';")||!worker.includes("const MAX_ANALYST_PROMPT='';"))
 throw new Error('Placeholders dashboard/analyst introuvables');
const bundle=worker.replace("const MAX_APP_HTML='';",'const MAX_APP_HTML='+JSON.stringify(html)+';')
 .replace("const MAX_ANALYST_PROMPT='';",'const MAX_ANALYST_PROMPT='+JSON.stringify(prompt)+';');
await mkdir(new URL('./dist/',dir),{recursive:true});
await Promise.all([
 writeFile(new URL('./dist/worker.mjs',dir),bundle,'utf8'),
 writeFile(new URL('./dist/engine.mjs',dir),engine,'utf8'),
 writeFile(new URL('./dist/advanced.mjs',dir),advanced,'utf8'),
 writeFile(new URL('./dist/points.mjs',dir),points,'utf8'),
 writeFile(new URL('./dist/scheduler.mjs',dir),scheduler,'utf8'),
 writeFile(new URL('./dist/quality-worker.mjs',dir),quality,'utf8')
]);
console.log('ManiBetProMax independent build: worker',bundle.length,'/ engine',engine.length,'/ advanced',advanced.length,'/ points',points.length,'/ scheduler',scheduler.length,'/ quality',quality.length);
