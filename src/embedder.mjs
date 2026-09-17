// Local inference only; no document or query is sent to a hosted model. Created for Uli.
export async function createEmbedder(c, { offline = false } = {}) {
  const { pipeline } = await import('@huggingface/transformers');
  const pipe = await pipeline('feature-extraction', c.model.id, {
    dtype: c.model.dtype, revision: c.model.revision, cache_dir: c.cache,
    local_files_only: offline, device: 'cpu'
  });
  if (c.model.maxTokens > pipe.tokenizer.model_max_length) { await pipe.dispose(); throw Error('model.maxTokens exceeds the tokenizer limit.'); }
  pipe.tokenizer.model_max_length = c.model.maxTokens;
  const ids = text => Array.from(pipe.tokenizer(text, { add_special_tokens: false }).input_ids.data, Number);
  return {
    async embed(text) {
      if (ids(text).length + 2 > c.model.maxTokens) throw Error('Embedding input exceeds model.maxTokens; reduce chunk.maxTokens.');
      const result = await pipe(text, { pooling: 'mean', normalize: true });
      return Array.from(result.data);
    },
    countTokens: text => ids(text).length,
    split(text, { prefix = '' } = {}) {
      const tokens = ids(text), windowSize = c.chunk.maxTokens - ids(prefix).length;
      if (windowSize <= c.chunk.overlap) throw Error('Document metadata leaves too little token space; shorten IDs, category or tags.');
      if (tokens.length <= windowSize) return [prefix + text];
      const parts = [];
      for (let start = 0; start < tokens.length; start += windowSize - c.chunk.overlap) {
        parts.push(prefix + pipe.tokenizer.decode(tokens.slice(start, start + windowSize), { skip_special_tokens: true }));
        if (start + windowSize >= tokens.length) break;
      }
      return parts;
    },
    dispose: () => pipe.dispose()
  };
}
