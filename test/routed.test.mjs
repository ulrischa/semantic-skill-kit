// Exercise the real HTTP client against a controlled local server, without paid API calls. For Uli.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/init.mjs';
import { loadConfig } from '../src/config.mjs';
import { exportSkill } from '../src/export.mjs';
import { sections } from '../src/routed.mjs';
import { routingConfig, createJsonClient } from '../src/llm.mjs';
async function fixture(t,handler) {
  const root=await mkdtemp(path.join(os.tmpdir(),'routing-test-'));
  await initProject(root);
  const requests=[];
  const server=createServer(async(req,res)=>{
    let raw=''; for await (const chunk of req) raw+=chunk;
    const body=JSON.parse(raw); requests.push({body,url:req.url,auth:req.headers.authorization});
    if(handler) return handler(req,res,body);
    const input=JSON.parse(body.messages[1].content);
    const result=input.content!==undefined ? {title:'Restore files',summary:'Use for recovering missing files.',tasks:['Recover deleted files'],topic:'Recovery'} : (!Array.isArray(input) && input.entries) ? {summary:'Guidance for restoring files and checking backups.'} : {title:'Backup tasks',summary:'Choose a specific recovery task.'};
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const keyName='SKILL_KIT_TEST_KEY_'+server.address().port;
  process.env[keyName]='test-key-never-export';
  const c=await loadConfig(root);
  c.routing={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'test-chat-model',apiKeyEnv:keyName,pageSize:2,maxInputChars:1000};
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));delete process.env[keyName];await rm(root,{recursive:true,force:true});});
  return {root,c,requests};
}
async function list(root,prefix='') {
  const files=[];
  for(const entry of await readdir(path.join(root,prefix),{withFileTypes:true})) {
    const p=path.posix.join(prefix,entry.name);
    if(entry.isDirectory()) files.push(...await list(root,p)); else files.push(p);
  }
  return files;
}
async function reachable(root) {
  const visited=new Set(); const queue=['SKILL.md'];
  while(queue.length) {
    const file=queue.shift(); if(visited.has(file)) continue; visited.add(file);
    const content=await readFile(path.join(root,file),'utf8');
    for(const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(match[1])));
      assert.ok(!target.startsWith('..'));
      queue.push(target);
    }
  }
  return visited;
}
test('heading hierarchy and long sections retain all content',()=>{
  const source='# Parent\nIntro\n## Child\n'+ 'x'.repeat(2100)+'TAIL';
  const parts=sections(source,1000);
  assert.deepEqual(parts.at(-1).headings,['Parent','Child']);
  assert.match(parts.at(-1).content,/TAIL$/);
  assert.equal(parts.map(p=>p.content).join(''),source);
});
test('routed export uses real HTTP, preserves frontmatter, builds reachable Markdown-only tree and reuses cache',async t=>{
  const {root,c,requests}=await fixture(t);
  await rm(path.join(c.knowledge,'example.md'));
  const source='---\nid: restore\ndescription: Recover files\ncategory: Manual backups\ncategories: [Operations]\ncustom: keep me\n---\n# Parent\n## Restore\n'+ 'backup '.repeat(400)+'TAIL';
  await writeFile(path.join(c.knowledge,'backup with spaces.md'),source);
  const target=path.join(root,'export');
  await exportSkill(c,target,{mode:'routed'});
  assert.ok(requests.length>1);
  assert.ok(requests.every(r=>r.url==='/v1/chat/completions'&&r.auth==='Bearer test-key-never-export'));
  assert.ok(requests.some(r=>r.body.messages[1].content.includes('TAIL')));
  assert.equal(await readFile(path.join(target,'references/guides/backup with spaces.md'),'utf8'),source);
  const files=await list(target);
  assert.ok(files.every(f=>f.endsWith('.md')||['LICENSE','NOTICE'].includes(f)));
  const all=(await Promise.all(files.map(f=>readFile(path.join(target,f),'utf8')))).join('\n');
  assert.match(all,/Manual backups/); assert.match(all,/Operations/); assert.doesNotMatch(all,/test-key-never-export/);
  assert.ok((await reachable(target)).has('references/guides/backup with spaces.md'));
  assert.equal((await list(c.output)).some(f=>f==='index.json.gz'),false);
  const count=requests.length;
  await exportSkill(c,path.join(root,'offline'),{mode:'routed',offline:true});
  assert.equal(requests.length,count);
  await writeFile(path.join(c.knowledge,'backup with spaces.md'),source+'\nNew fact');
  await assert.rejects(exportSkill(c,path.join(root,'stale'),{mode:'routed',offline:true}),/cache miss/);
});
test('plain Markdown with colon in title is accepted and API cache invalidates by model',async t=>{
  const {root,c,requests}=await fixture(t);
  await writeFile(path.join(c.knowledge,'example.md'),'# Backups: restore files\nRead this procedure.');
  await exportSkill(c,path.join(root,'first'),{mode:'routed'});
  const count=requests.length; c.routing.model='another-model';
  await exportSkill(c,path.join(root,'second'),{mode:'routed'});
  assert.ok(requests.length>count);
});
test('HTTP errors are bounded and do not leak provider bodies or publish output',async t=>{
  const {root,c,requests}=await fixture(t,(req,res)=>{res.statusCode=429;res.end('test-key-never-export');});
  await assert.rejects(exportSkill(c,path.join(root,'failed'),{mode:'routed'}),e=>/HTTP 429/.test(e.message)&&!e.message.includes('test-key'));
  assert.equal(requests.length,1);
  await assert.rejects(readFile(path.join(root,'failed','SKILL.md')),/ENOENT/);
});
test('invalid model JSON and missing keys fail without publishing',async t=>{
  const {root,c}=await fixture(t,(req,res)=>res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"title":"oops"}'}}]})));
  await assert.rejects(exportSkill(c,path.join(root,'invalid'),{mode:'routed'}),/invalid routing JSON/);
  delete process.env[c.routing.apiKeyEnv];
  await assert.rejects(exportSkill(c,path.join(root,'nokey'),{mode:'routed'}),/Missing API key/);
});
test('API timeout, endpoint validation and incompatible mode options',async t=>{
  const {root,c}=await fixture(t,()=>{}); c.routing.timeoutMs=100;
  await assert.rejects(exportSkill(c,path.join(root,'timeout'),{mode:'routed'}),/timed out/);
  assert.throws(()=>routingConfig({...c,routing:{...c.routing,baseUrl:'http://example.com/v1'}}),/HTTPS/);
  await assert.rejects(exportSkill(c,path.join(root,'invalid'),{mode:'routed',includeModel:true}),/include-model/);
  await assert.rejects(exportSkill(c,path.join(root,'invalid'),{mode:'unknown'}),/mode/);
});
test('changed source during generation is rejected and retry can reuse completed cache',async t=>{
  const {root,c}=await fixture(t);
  let changed=false;
  await assert.rejects(exportSkill(c,path.join(root,'changed'),{mode:'routed',log:()=>{
    if(!changed) {changed=true; void writeFile(path.join(c.knowledge,'added.md'),'# Added\nNew source');}
  }}),/Knowledge changed/);
  await exportSkill(c,path.join(root,'retry'),{mode:'routed'});
  assert.ok((await reachable(path.join(root,'retry'))).has('references/guides/added.md'));
});

test('CLI --mode routed reads provider configuration and produces a usable entrypoint',async t=>{
  const {root,c}=await fixture(t);
  const file=path.join(root,'skill-kit.json');
  const config=JSON.parse(await readFile(file,'utf8')); config.routing=c.routing;
  await writeFile(file,JSON.stringify(config));
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const {fileURLToPath}=await import('node:url');
  const target=path.join(root,'cli-export');
  const result=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../src/cli.mjs',import.meta.url)),'export',target,'--project',root,'--mode','routed']);
  assert.equal(result.stdout.trim(),target);
  assert.ok((await reachable(target)).has('references/guides/example.md'));
});
