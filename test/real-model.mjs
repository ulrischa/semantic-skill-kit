// End-to-end test using real MiniLM inference, not a mock. Created for Uli.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initProject } from '../src/init.mjs';
import { loadConfig, defaults } from '../src/config.mjs';
import { build } from '../src/build.mjs';
import { readIndex } from '../src/storage.mjs';
import { createEmbedder } from '../src/embedder.mjs';
import { rank, retrieve } from '../src/search.mjs';
import { exportSkill } from '../src/export.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'skill-kit-real-'));
try {
  await initProject(root);
  await rm(path.join(root,'knowledge','example.md'));
  await writeFile(path.join(root,'knowledge','backup.md'),'---\nid: restore-backup\ndescription: Restore deleted files from a backup archive.\n---\n# Recover lost files\nOpen your backup archive, select the missing documents and restore them to a new folder. Verify recovered files before replacing originals.\n');
  await writeFile(path.join(root,'knowledge','plants.md'),'---\nid: water-plants\ndescription: Water plants and keep roots healthy.\n---\n# Water indoor plants\nCheck whether the soil is dry. Water the plant slowly and allow excess water to drain.\n');
  const c=await loadConfig(root);
  c.cache=path.resolve(process.env.SKILL_KIT_TEST_CACHE ?? 'examples/home-guidance/.cache/models');
  const engine=await createEmbedder(c);
  try {
    const result=await build(c,{embedder:engine});
    assert.ok(result.embedded>0);
    const index=await readIndex(c);
    const hits=rank(index,await engine.embed('How do I recover accidentally deleted documents?'));
    assert.equal(hits[0].id,'restore-backup');
    assert.match(retrieve(index,hits[0].id),/backup archive/);
    assert.equal((await build(c,{embedder:engine})).changed,false);
    const long=('backup recovery restore deleted files '.repeat(180));
    const windows=await engine.split(long);
    assert.ok(windows.length>1);
    for(const text of windows) assert.equal((await engine.embed(text)).length,384);
    const target=path.join(root,'exported');
    await exportSkill(c,target,{embedder:engine,includeModel:true});
    const exported=await loadConfig(target), offline=await createEmbedder(exported,{offline:true});
    try { assert.equal(rank(await readIndex(exported),await offline.embed('How should I water my houseplants?'))[0].id,'water-plants'); }
    finally { await offline.dispose(); }
    console.log(JSON.stringify({passed:true,documents:result.documents,chunks:result.chunks,topResult:hits[0],longTextWindows:windows.length,offlineExport:true},null,2));
  } finally { await engine.dispose(); }
} finally { await rm(root,{recursive:true,force:true}); }
