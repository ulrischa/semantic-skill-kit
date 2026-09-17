// Incremental immutable-snapshot builder. Created for Uli.
import { fingerprint } from './config.mjs';
import { hash } from './config.mjs';
import { readKnowledge, chunkMarkdown } from './documents.mjs';
import { createEmbedder } from './embedder.mjs';
import { readIndex, writeIndex, withBuildLock } from './storage.mjs';
export async function build(c, { force = false, offline = false, embedder, log = () => {} } = {}) {
  return withBuildLock(c, async () => {
    const knowledge = await readKnowledge(c), fp = fingerprint(c);
    const previous = force ? null : await readIndex(c, true);
    if (previous?.fingerprint === fp && previous.sourceHash === knowledge.sourceHash) return { changed: false, documents: previous.documents.length, embedded: 0, reused: previous.chunks.length };
    const cached = new Map(previous?.fingerprint === fp ? previous.chunks.map(x => [x.key,x.vector]) : []);
    const owned = !embedder;
    let engine = embedder, embedded = 0, reused = 0;
    const documents = [], chunks = [];
    try {
      if (knowledge.documents.length) engine ??= await createEmbedder(c, { offline });
      for (const doc of knowledge.documents) {
        log(`Indexing ${doc.path}`);
        const { metadataText, ...document } = doc;
        document.tokenCount = await engine.countTokens(doc.body);
        documents.push(document);
        const sections = [...chunkMarkdown(doc.body), metadataText];
        for (const section of sections) {
          const prefix = `${c.model.documentPrefix}${doc.id} (${doc.category})\nFeatures: ${doc.tags.join(', ')}\n\n`;
          for (const window of await engine.split(section, { prefix })) {
            const key = hash({ fp, text: window });
            let vector = cached.get(key);
            if (vector) reused++;
            else { vector = await engine.embed(window); embedded++; }
            if (!Array.isArray(vector) || !vector.length || vector.some(v => !Number.isFinite(v)) || !vector.some(v => v !== 0)) throw Error('Embedding model returned an invalid vector.');
            if (chunks.length && vector.length !== chunks[0].vector.length) throw Error('Embedding dimensions changed during build.');
            cached.set(key, vector);
            chunks.push({ id: doc.id, key, vector });
          }
        }
      }
      // Do not publish a mixed snapshot when files change during inference.
      if ((await readKnowledge(c)).sourceHash !== knowledge.sourceHash) throw Error('Knowledge changed during build; retrying on the next watcher cycle.');
      const index = { schema: 1, fingerprint: fp, sourceHash: knowledge.sourceHash, builtAt: new Date().toISOString(), model: c.model, documents, chunks };
      await writeIndex(c, index);
      return { changed: true, documents: documents.length, chunks: chunks.length, embedded, reused };
    } finally { if (owned && engine) await engine.dispose(); }
  });
}
