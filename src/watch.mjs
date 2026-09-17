// Poll content hashes to survive directory replacement and network filesystems. Created for Uli.
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, hash } from './config.mjs';
import { collectFiles } from './documents.mjs';
import { build } from './build.mjs';
export async function watch(root, { signal, onBuild = () => {}, onError = console.error, buildOptions = {} } = {}) {
  let seen, completed, changedAt = 0, interval = 1000;
  while (!signal?.aborted) {
    try {
      const c = await loadConfig(root);
      interval = c.watch.intervalMs;
      const state = hash({ config: await readFile(path.join(c.root,'skill-kit.json'),'utf8'), files: await collectFiles(c.knowledge) });
      if (state !== seen) { seen = state; changedAt = Date.now(); }
      if (state !== completed && Date.now() - changedAt >= c.watch.settleMs) {
        const result = await build(c, buildOptions);
        completed = state;
        onBuild(result);
      }
    } catch (e) { onError(e); }
    try { await delay(interval, undefined, { signal }); } catch (e) { if (e.name !== 'AbortError') throw e; }
  }
}
