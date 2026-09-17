// Heading chunking adapted from Google Modern Web Guidance; see NOTICE. Extended for Uli.
import path from 'node:path';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { marked } from 'marked';
import { parse } from 'yaml';
import { hash } from './config.mjs';
export async function collectFiles(dir, relative = '') {
  const stat = await lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error(`Knowledge path must be a real directory: ${dir}`);
  const result = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw Error(`Symlinks are not supported in knowledge: ${entry.name}`);
    if (entry.name.startsWith('.')) continue;
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(full, rel));
    else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push({ path: rel, source: await readFile(full, 'utf8') });
  }
  return result;
}
export function chunkMarkdown(markdown) {
  const chunks = []; let current = [];
  for (const token of marked.lexer(markdown)) {
    if (token.type === 'heading' && current.length) { chunks.push(current.join('\n\n')); current = []; }
    current.push(token.raw);
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks.filter(chunk => chunk.trim());
}
export function parseDocument(file) {
  const source = file.source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (source.startsWith('---\n') && !match) throw Error(`Unclosed frontmatter: ${file.path}`);
  const meta = match ? parse(match[1], { maxAliasCount: 20 }) : {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw Error(`Invalid metadata: ${file.path}`);
  const body = match ? source.slice(match[0].length).trim() : source.trim();
  if (!body) throw Error(`Empty document: ${file.path}`);
  const id = meta.id ?? file.path.replace(/\.md$/i, '');
  if (typeof id !== 'string' || !/^[\p{L}\p{N}_./-]+$/u.test(id) || id.split('/').some(p => !p || p === '.' || p === '..')) throw Error(`Invalid document ID: ${file.path}`);
  const title = marked.lexer(body).find(t => t.type === 'heading')?.text ?? id;
  const description = meta.description ?? title;
  const category = meta.category ?? (file.path.includes('/') ? file.path.split('/')[0] : 'general');
  const tags = meta.tags ?? meta.featuresUsed ?? meta['web-feature-ids'] ?? [];
  if (typeof description !== 'string' || !description.trim() || typeof category !== 'string' || !Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw Error(`Invalid description/category/tags: ${file.path}`);
  return { id, description, category, tags, path: file.path, body, sourceHash: hash(source), metadataText: match?.[1] ?? `description: ${description}\ntags: ${tags.join(', ')}` };
}
export async function readKnowledge(c) {
  const files = await collectFiles(c.knowledge);
  const documents = files.map(parseDocument);
  const ids = new Set();
  for (const doc of documents) { if (ids.has(doc.id)) throw Error(`Duplicate document ID: ${doc.id}`); ids.add(doc.id); }
  return { documents, sourceHash: hash(files) };
}
