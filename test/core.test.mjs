import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, writeFile, readFile, rm, rename, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { initProject } from '../src/init.mjs';
import { loadConfig } from '../src/config.mjs';
import { chunkMarkdown, parseDocument } from '../src/documents.mjs';
import { build } from '../src/build.mjs';
import { readIndex } from '../src/storage.mjs';
import { rank, retrieve, cosineSimilarity } from '../src/search.mjs';
import { watch } from '../src/watch.mjs';
import { exportSkill } from '../src/export.mjs';
const fake = () => ({ calls:0, async embed(text) { this.calls++; return [text.includes('backup')?1:0.2,text.includes('plant')?1:0.2,0.1]; }, countTokens:t=>t.split(/\s+/).length,split:(t,{prefix=''}={})=>[prefix+t],dispose:async()=>{} });
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'skill-kit-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await initProject(dir);
  return {dir,c:await loadConfig(dir),engine:fake()};
}
const doc = (id,body) => `---\nid: ${id}\ndescription: ${id} guidance\ntags: [example]\n---\n\n# ${id}\n\n${body}\n`;
async function until(fn, timeout=6000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline) { if(await fn()) return; await delay(30); }
  throw Error('Timed out waiting for observable watcher result');
}
test('heading chunking respects fenced code and setext headings',()=>{
  const result=chunkMarkdown('# A\n\nhello\n\n```js\n# not heading\n```\n\nB\n===\n\nworld');
  assert.equal(result.length,2); assert.match(result[0],/# not heading/); assert.match(result[1],/world/);
});
test('plain Markdown, YAML metadata, and invalid metadata',()=>{
  assert.equal(parseDocument({path:'nested/a.md',source:'# Title\nText'}).id,'nested/a');
  assert.deepEqual(parseDocument({path:'a.md',source:doc('a','hello')}).tags,['example']);
  assert.throws(()=>parseDocument({path:'a.md',source:'---\nid: ../evil\n---\nBody'}),/Invalid document ID/);
  assert.throws(()=>parseDocument({path:'a.md',source:'---\nx: y'}),/Unclosed/);
});
test('cosine, threshold, top-K, best chunk per document and invalid dimensions',()=>{
  const index={documents:[{id:'a'},{id:'b'}],chunks:[{id:'a',vector:[1,0]},{id:'a',vector:[0.8,0.2]},{id:'b',vector:[0,1]}]};
  assert.equal(cosineSimilarity([1,0],[1,0]),1);
  assert.deepEqual(rank(index,[1,0]).map(r=>r.id),['a']);
  assert.equal(rank(index,[1,0],{threshold:0,topK:1}).length,1);
  assert.equal(rank(index,[0,0]).length,0);
  assert.throws(()=>rank(index,[1]),/incompatible/);
  assert.throws(()=>rank(index,[1,0],{topK:0}),/Invalid/);
  assert.throws(()=>retrieve(index,'../etc/passwd'),/Unknown/);
});
test('unchanged builds do no inference; edits reuse unchanged chunks',async t=>{
  const {c,engine}=await fixture(t);
  await writeFile(path.join(c.knowledge,'a.md'),doc('a','backup\n\n## Stable\nplant'));
  const first=await build(c,{embedder:engine}); assert.ok(first.embedded>0);
  const count=engine.calls;
  assert.equal((await build(c,{embedder:engine})).changed,false); assert.equal(engine.calls,count);
  await writeFile(path.join(c.knowledge,'a.md'),doc('a','backup changed\n\n## Stable\nplant'));
  const next=await build(c,{embedder:engine}); assert.ok(next.embedded>0); assert.ok(next.reused>0);
});
test('deletion and empty directory remove old documents and vectors',async t=>{
  const {c,engine}=await fixture(t); await build(c,{embedder:engine});
  await rm(path.join(c.knowledge,'example.md'));
  await build(c,{embedder:engine});
  const index=await readIndex(c); assert.equal(index.documents.length,0); assert.equal(index.chunks.length,0);
});
test('model change and force invalidate every cached vector',async t=>{
  const {c,engine}=await fixture(t); await build(c,{embedder:engine});
  const changed=await build({...c,model:{...c.model,dtype:'fp32'}},{embedder:engine});
  assert.equal(changed.reused,0); assert.ok(changed.embedded>0);
  assert.ok((await build(c,{embedder:engine,force:true})).embedded>0);
});
test('failed inference preserves previous index and releases lock',async t=>{
  const {c,engine}=await fixture(t); await build(c,{embedder:engine});
  const before=await readFile(path.join(c.output,'index.json.gz'));
  await writeFile(path.join(c.knowledge,'new.md'),doc('new','New content'));
  await assert.rejects(build(c,{embedder:{...engine,embed:async()=>{throw Error('broken');}}}),/broken/);
  assert.deepEqual(await readFile(path.join(c.output,'index.json.gz')),before);
  assert.equal((await build(c,{embedder:engine})).documents,2);
});
test('duplicate IDs never publish a partial index',async t=>{
  const {c,engine}=await fixture(t); await build(c,{embedder:engine});
  await writeFile(path.join(c.knowledge,'duplicate.md'),doc('example','Duplicate'));
  await assert.rejects(build(c,{embedder:engine}),/Duplicate/);
  assert.equal((await readIndex(c)).documents.length,1);
});
test('concurrent builds are rejected and content changes during a build are detected',async t=>{
  const {c,engine}=await fixture(t);
  let release; const gate=new Promise(r=>{release=r;}); let entered=false;
  const slow={...engine,embed:async()=>{entered=true;await gate;return [1,0];}};
  const first=build(c,{embedder:slow}); await until(()=>entered);
  await assert.rejects(build(c,{embedder:engine}),/Another build/);
  await writeFile(path.join(c.knowledge,'extra.md'),doc('extra','changed'));
  release(); await assert.rejects(first,/Knowledge changed/);
  assert.equal(await readIndex(c,true),null);
});
test('watcher survives directory replacement, deletion, invalid config and recovery',async t=>{
  const {dir,c,engine}=await fixture(t);
  const original=JSON.parse(await readFile(path.join(dir,'skill-kit.json'),'utf8'));
  original.watch={intervalMs:50,settleMs:50};
  const config=path.join(dir,'skill-kit.json'); await writeFile(config,JSON.stringify(original));
  const controller=new AbortController(); let builds=0; const errors=[];
  const running=watch(dir,{signal:controller.signal,buildOptions:{embedder:engine},onBuild:()=>builds++,onError:e=>errors.push(e.message)});
  t.after(async()=>{controller.abort();await running;});
  await until(()=>builds>=1);
  await rename(c.knowledge,path.join(dir,'old-knowledge'));
  await delay(120);
  await mkdir(c.knowledge); await writeFile(path.join(c.knowledge,'new.md'),doc('replacement','plant'));
  await until(async()=>{const i=await readIndex(c,true);return i?.documents[0]?.id==='replacement';});
  await writeFile(config,'broken JSON'); await delay(120);
  await writeFile(config,JSON.stringify(original));
  await rm(path.join(c.knowledge,'new.md'));
  await until(async()=> (await readIndex(c)).documents.length===0);
  assert.ok(errors.length>0);
});
test('export is movable, includes all runtime files, and refuses overwrite',async t=>{
  const {dir,c,engine}=await fixture(t);
  const destination=path.join(dir,'dist','exported');
  await exportSkill(c,destination,{embedder:engine});
  const exported=await loadConfig(destination), index=await readIndex(exported);
  assert.match(retrieve(index,'example'),/Replace the knowledge base/);
  assert.match(await readFile(path.join(destination,'SKILL.md'),'utf8'),/node src\/cli.mjs search/);
  await assert.rejects(exportSkill(c,destination,{embedder:engine}),/already exists/);
  await assert.rejects(exportSkill(c,path.join(c.knowledge,'export'),{embedder:engine}),/outside knowledge/);
});
test('configuration rejects overlapping folders and invalid token windows',async t=>{
  const {dir}=await fixture(t), file=path.join(dir,'skill-kit.json');
  const original=JSON.parse(await readFile(file,'utf8'));
  await writeFile(file,JSON.stringify({...original,output:'knowledge/out'}));
  await assert.rejects(loadConfig(dir),/overlap/);
  await writeFile(file,JSON.stringify({...original,chunk:{maxTokens:256,overlap:32}}));
  await assert.rejects(loadConfig(dir),/fit model/);
});
