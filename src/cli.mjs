#!/usr/bin/env node
// Generic knowledge-skill CLI for Uli.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, fingerprint } from './config.mjs';
import { initProject } from './init.mjs';
import { build } from './build.mjs';
import { watch } from './watch.mjs';
import { readIndex } from './storage.mjs';
import { readKnowledge } from './documents.mjs';
import { createEmbedder } from './embedder.mjs';
import { rank, retrieve } from './search.mjs';
import { exportSkill } from './export.mjs';
const help = `Semantic Skill Kit — local knowledge skills derived from Google Modern Web Guidance

skill-kit init <directory>
skill-kit build [--force] [--offline]
skill-kit watch [--offline]
skill-kit search "query" [--top-k 5] [--threshold 0.3] [--offline]
skill-kit retrieve <id>
skill-kit status
skill-kit model [--offline]
skill-kit export <new-directory> [--include-model] [--offline]

Use --project <directory> with any command except init. Default: current directory.
Export creates a skill directory. Run npm ci inside it once before use.
`;
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals:true, options:{
    project:{type:'string'}, force:{type:'boolean'}, offline:{type:'boolean'},
    'include-model':{type:'boolean'}, 'top-k':{type:'string'}, threshold:{type:'string'},
    help:{type:'boolean',short:'h'}
  }});
  const [command,arg,...extra] = positionals;
  if(values.help || !command) { console.log(help); return; }
  if(extra.length) throw Error('Too many arguments; quote multi-word queries.');
  if(!['init','build','watch','search','retrieve','status','model','export'].includes(command)) throw Error(`Unknown command: ${command}`);
  const requiresArg = ['init','search','retrieve','export'].includes(command);
  if(requiresArg && !arg?.trim()) throw Error(`${command} requires an argument.`);
  if(!requiresArg && arg) throw Error(`${command} does not accept a positional argument.`);
  if(command === 'init') { console.log(await initProject(arg)); return; }
  const root = path.resolve(values.project ?? process.cwd());
  const c = await loadConfig(root), options = {force:values.force,offline:values.offline,log:msg=>console.error(msg)};
  if(command === 'build') { console.log(JSON.stringify(await build(c,options),null,2)); return; }
  if(command === 'watch') {
    const controller = new AbortController();
    for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>controller.abort());
    console.error(`Watching ${c.knowledge}; Ctrl+C stops the watcher.`);
    await watch(root,{signal:controller.signal,buildOptions:{offline:values.offline,log:options.log},onBuild:r=>console.error(JSON.stringify(r)),onError:e=>console.error(`Build postponed: ${e.message}`)});
    return;
  }
  if(command === 'export') { console.log(await exportSkill(c,arg,{...options,includeModel:values['include-model']})); return; }
  if(command === 'model') {
    const engine=await createEmbedder(c,options);
    try { console.log(JSON.stringify({model:c.model,dimensions:(await engine.embed('Model check')).length,cache:c.cache},null,2)); }
    finally { await engine.dispose(); }
    return;
  }
  const index=await readIndex(c);
  const stale = index.fingerprint !== fingerprint(c) || index.sourceHash !== (await readKnowledge(c)).sourceHash;
  if(command === 'status') {
    console.log(JSON.stringify({name:c.name,stale,builtAt:index.builtAt,model:index.model,documents:index.documents.length,chunks:index.chunks.length},null,2));
    return;
  }
  if(stale) throw Error('Index is stale. Run build or wait for the watcher to complete.');
  if(command === 'retrieve') { process.stdout.write(retrieve(index,arg)+'\n'); return; }
  if(!index.chunks.length) { console.log('[]'); return; }
  const engine=await createEmbedder(c,options);
  try {
    const vector=await engine.embed(c.model.queryPrefix+arg);
    console.log(JSON.stringify(rank(index,vector,{topK:values['top-k']===undefined?c.search.topK:Number(values['top-k']),threshold:values.threshold===undefined?c.search.threshold:Number(values.threshold)}),null,2));
  } finally { await engine.dispose(); }
}
main().catch(e=>{ console.error(`Error: ${e.message}`); process.exitCode=1; });
