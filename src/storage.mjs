// A single atomic snapshot keeps vectors and retrieved documents consistent. Created for Uli.
import path from 'node:path';
import { mkdir, readFile, writeFile, rename, rm, open } from 'node:fs/promises';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const zip = promisify(gzip), unzip = promisify(gunzip);
export async function readIndex(c, optional = false) {
  try {
    const index = JSON.parse((await unzip(await readFile(path.join(c.output, 'index.json.gz')))).toString('utf8'));
    if (index.schema !== 1 || !Array.isArray(index.documents) || !Array.isArray(index.chunks)) throw Error('Unsupported or invalid index. Rebuild it.');
    return index;
  } catch (e) { if (optional && e.code === 'ENOENT') return null; throw e; }
}
export async function writeIndex(c, index) {
  await mkdir(c.output, { recursive: true });
  const target = path.join(c.output, 'index.json.gz'), temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, await zip(JSON.stringify(index)));
    const handle = await open(temp, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temp, target);
  } finally { await rm(temp, { force: true }); }
}
export async function withBuildLock(c, action) {
  await mkdir(c.output, { recursive: true });
  const lock = path.join(c.output, 'build.lock');
  let handle;
  try { handle = await open(lock, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw Error(`Another build owns ${lock}. If it crashed, stop all builders and remove that file.`); throw e; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, started: new Date().toISOString() })); return await action(); }
  finally { await handle.close(); await rm(lock, { force: true }); }
}
