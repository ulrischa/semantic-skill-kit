// Adapted from GoogleChrome/modern-web-guidance-src serving/lib/search.ts.
// Changes for Uli: validation, deterministic ties, generic metadata, no telemetry.
export function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length || [...a,...b].some(x => !Number.isFinite(x))) throw Error('Invalid or incompatible embedding vectors. Rebuild the index.');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; aa += a[i]*a[i]; bb += b[i]*b[i]; }
  return aa && bb ? dot / Math.sqrt(aa*bb) : -Infinity;
}
export function rank(index, queryVector, { topK = 5, threshold = 0.3 } = {}) {
  if (!Number.isSafeInteger(topK) || topK < 1 || !Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw Error('Invalid search options.');
  const best = new Map();
  for (const chunk of index.chunks) {
    const score = cosineSimilarity(queryVector, chunk.vector);
    if (score >= threshold && (!best.has(chunk.id) || score > best.get(chunk.id))) best.set(chunk.id, score);
  }
  return index.documents.filter(d => best.has(d.id)).map(d => ({
    id: d.id, description: d.description, category: d.category, tags: d.tags,
    tokenCount: d.tokenCount, similarity: best.get(d.id)
  })).sort((a,b) => b.similarity - a.similarity || a.id.localeCompare(b.id)).slice(0, topK)
    .map(r => ({ ...r, similarity: Number(r.similarity.toFixed(4)) }));
}
export function retrieve(index, id) {
  const doc = index.documents.find(d => d.id === id);
  if (!doc) throw Error(`Unknown document ID: ${id}`);
  return doc.body;
}
