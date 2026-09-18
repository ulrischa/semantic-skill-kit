// Created for Uli. Configuration is data, never executable JavaScript.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const defaults = {
  name: 'my-guidance', description: 'Search guidance for the topic described by this knowledge base.',
  knowledge: 'knowledge', output: '.skill-kit', cache: '.cache/models',
  model: { id: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', dtype: 'q8', maxTokens: 256, queryPrefix: '', documentPrefix: '' },
  chunk: { maxTokens: 240, overlap: 32 },
  search: { topK: 5, threshold: 0.3 },
  watch: { intervalMs: 1000, settleMs: 800 },
  routing: { baseUrl: 'https://api.openai.com/v1', model: '', apiKeyEnv: 'OPENAI_API_KEY', language: 'English', maxInputChars: 12000, pageSize: 8, timeoutMs: 120000 }
};
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function within(root, child) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export async function loadConfig(root) {
  root = path.resolve(root);
  const raw = JSON.parse(await readFile(path.join(root, 'skill-kit.json'), 'utf8'));
  const c = { ...defaults, ...raw, root };
  for (const key of ['model', 'chunk', 'search', 'watch']) c[key] = { ...defaults[key], ...raw[key] };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.name) || c.name.length > 63) throw Error('Invalid skill name (lowercase, digits, hyphens; maximum 63 characters).');
  if (typeof c.description !== 'string' || !c.description.trim() || /[<>]/.test(c.description)) throw Error('A nonempty plain-text description is required.');
  for (const key of ['knowledge', 'output', 'cache']) {
    if (typeof c[key] !== 'string') throw Error(`${key} must be a path string.`);
    c[key] = path.resolve(root, c[key]);
    if (!within(root, c[key]) || c[key] === root) throw Error(`${key} must be a subdirectory of the project.`);
  }
  for (const [a,b] of [['knowledge','output'], ['knowledge','cache'], ['output','cache']]) {
    if (within(c[a], c[b]) || within(c[b], c[a])) throw Error(`${a} and ${b} must not overlap.`);
  }
  for (const [label, value, min] of [['topK',c.search.topK,1],['maxTokens',c.chunk.maxTokens,8],['overlap',c.chunk.overlap,0],['model.maxTokens',c.model.maxTokens,16],['intervalMs',c.watch.intervalMs,50],['settleMs',c.watch.settleMs,0]]) {
    if (!Number.isSafeInteger(value) || value < min) throw Error(`Invalid ${label}.`);
  }
  if (c.chunk.overlap >= c.chunk.maxTokens || c.chunk.maxTokens + 2 > c.model.maxTokens) throw Error('Chunk window must fit model.maxTokens (including two special tokens); overlap must be smaller.');
  if (!Number.isFinite(c.search.threshold) || c.search.threshold < -1 || c.search.threshold > 1) throw Error('threshold must be between -1 and 1.');
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.model.id) || !/^[\w.-]+$/.test(c.model.revision)) throw Error('Use a Hugging Face owner/model ID and a revision name or commit SHA.');
  if (!['q8','fp32','fp16','q4','int8','uint8'].includes(c.model.dtype)) throw Error('Unsupported model dtype.');
  for (const key of ['queryPrefix','documentPrefix']) if (typeof c.model[key] !== 'string') throw Error(`${key} must be a string.`);
  return c;
}
export const fingerprint = c => hash({ schema: 1, pipeline: 1, transformers: '3.8.1', model: c.model, chunk: c.chunk });
