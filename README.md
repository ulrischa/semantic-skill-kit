# Semantic Skill Kit

Create topic-specific agent skills from interchangeable Markdown knowledge bases. Local Node.js semantic retrieval adapted from [Google Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance-src). Created for Uli. Apache-2.0.

## Inspiration and attribution

The original idea comes from **Google's [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)**: a small skill instructs an agent to search a curated collection using local embeddings, then retrieve only the relevant Markdown guides. This project generalizes that approach so the same framework can build skills for other topics by replacing the knowledge base.

The implementation is adapted from Google's [source repository](https://github.com/GoogleChrome/modern-web-guidance-src), specifically its heading-based chunking, embedding pipeline and best-chunk-per-document ranking. [NOTICE](NOTICE) records the source revision and adapted files; [LICENSE](LICENSE) includes Apache-2.0. The generic configuration, incremental rebuilding, watcher and skill export are additions in this project. This is an independent derivative, not an official Google project.

## Quick start

Requires Node.js 22+. No Python, GPU or API key. Installation downloads npm dependencies; the first build downloads a local embedding model. Documents and queries are processed locally.

```bash
git clone https://github.com/ulrischa/semantic-skill-kit.git
cd semantic-skill-kit
npm ci
node src/cli.mjs init my-topic
```

Replace `my-topic/knowledge/example.md` with your Markdown files, and edit `name` and `description` in `my-topic/skill-kit.json`.

```bash
node src/cli.mjs build --project my-topic
node src/cli.mjs watch --project my-topic
```

The watcher stays running; stop it with Ctrl+C. In another terminal:

```bash
node src/cli.mjs search "How can I recover deleted files?" --project my-topic
node src/cli.mjs retrieve "<id-from-search>" --project my-topic
node src/cli.mjs export dist/my-topic --project my-topic
```

Run `npm ci` once inside the exported skill. Its `SKILL.md` instructs an agent to search, retrieve only selected documents, and apply their guidance. The target environment must support Node execution and dependency installation. An upload alone does not provide that capability. This framework does not automatically install personal ChatGPT skills.

Optional: run `npm link` in this repository and use `skill-kit` instead of `node src/cli.mjs`. This project has not been published under a guaranteed npm package name.

## Example

```bash
node src/cli.mjs build --project examples/home-guidance
node src/cli.mjs search "recover deleted documents" --project examples/home-guidance
node src/cli.mjs retrieve restore-backup --project examples/home-guidance
```

A document can be plain Markdown or include YAML metadata:

```markdown
---
id: restore-backup
description: Restore deleted files from a backup archive.
category: backups
tags: [restore, recovery]
---

# Restore a backup

Write your actual guidance here.
```

Nested folders are supported. Without frontmatter, the relative filename becomes the ID. IDs must be unique. Empty documents, invalid YAML, duplicate IDs and symlinks cause a build error. Hidden files and non-Markdown files are ignored. Linked images, PDFs and other assets are not imported.

## Retrieval pipeline and provenance

1. Split Markdown at parsed headings using `marked`, plus a metadata chunk.
2. Add document ID, category and tags; split oversized text into overlapping token windows.
3. Run local `Xenova/all-MiniLM-L6-v2` feature extraction with mean pooling and normalization.
4. Save vectors and documents in a single atomic gzip JSON snapshot.
5. Compare query and chunk vectors using cosine similarity.
6. Keep the best chunk score per document, filter at 0.3, return the top 5.
7. Retrieve only selected complete document bodies.

Search ranking and heading chunking derive from Google's source. See `NOTICE` for exact source files and commits. Both build and query use Transformers.js/ONNX here; Google uses a separate TFJS query runtime. Scores are not promised to be identical. Google's telemetry, web-specific macros and browser-baseline processing are not included.

Incremental builds reuse unchanged chunk vectors. Model and chunking changes invalidate the cache. Index and document text are published together, so readers cannot mix different versions. Search returns metadata only; loading documents into process memory is not the same as putting them into an LLM context.

## Commands

| Command | Purpose |
|---|---|
| `init <directory>` | Create an independent knowledge project |
| `build` | Incrementally rebuild the index |
| `build --force` | Recompute all vectors; model cache is retained |
| `watch` | Continuously rebuild after stable changes |
| `search "query"` | Return ranked JSON metadata |
| `retrieve <id>` | Print one complete guide |
| `status` | Inspect index freshness and counts |
| `model` | Download/warm the configured model |
| `export <new-directory>` | Export a reusable skill snapshot |

All except `init` support `--project <directory>` (default: current directory). `search` also supports `--top-k` and `--threshold`. `--offline` requires a prepared model cache. Output is JSON or document text on stdout, diagnostics on stderr.

## Watcher behavior

The built-in polling watcher hashes file contents every 1,000 ms and requires 800 ms of stability. It handles edits, additions, renames, deletions, whole-directory replacement, and configuration changes without a third-party watcher. Builds are serialized. A mutation during inference prevents publishing that snapshot and is retried on the next cycle.

A missing directory or invalid document preserves the last valid index. An existing empty directory intentionally publishes an empty index. CLI search/retrieve reject stale indexes. To replace a large knowledge base, prepare a new folder first and swap it in; a paused copy can otherwise expose a valid intermediate state.

The watcher must remain running; it is not installed as a background service. Exports are independent snapshots and require a new export to update.

## Configuration and language

`init` writes all defaults. Configure `knowledge`, `output`, `cache`, `model`, `chunk`, `search` and `watch` in `skill-kit.json`. Paths must be separate subdirectories of the project. The default model revision is pinned to `751bff37182d3f1213fa05d7196b954e230abad9`.

| Setting | Purpose |
|---|---|
| `name`, `description` | Skill name and instructions for when agents should select it |
| `knowledge` | Markdown directory relative to the project |
| `output` | Index directory; defaults to `.skill-kit` |
| `cache` | Local model cache; defaults to `.cache/models` |
| `model.id`, `model.revision`, `model.dtype` | Embedding model, revision and quantization |
| `model.maxTokens` | Maximum model input length, including special tokens |
| `model.queryPrefix`, `model.documentPrefix` | Prefixes required by some embedding models |
| `chunk.maxTokens`, `chunk.overlap` | Token window size and overlap |
| `search.topK`, `search.threshold` | Result limit and minimum similarity |
| `watch.intervalMs`, `watch.settleMs` | Polling interval and stability delay |

The default MiniLM model is primarily intended for English. Use an appropriate multilingual Transformers.js-compatible sentence-embedding model for German or multilingual corpora. Mean pooling is used; models requiring another pooling strategy need code changes. Set the correct token limit, quantization and optional `queryPrefix` / `documentPrefix`. Changing model settings triggers a full rebuild. Prefer immutable model revisions over `main`.

`chunk.maxTokens` includes metadata context, and must leave room for model special tokens. Long sections are split into overlapping windows; retrieved documents remain unchanged. Scores are similarity values, not probabilities. Validate thresholds with representative questions. Linear vector scanning and in-memory snapshots suit curated knowledge bases, not millions of documents.

## Export structure

The export destination must not already exist. Export first ensures the index is current, then produces an independent skill directory:

```text
my-topic/
  SKILL.md
  skill-kit.json
  guides/
  data/index.json.gz
  src/
  assets/runtime-package-lock.json
  package.json
  package-lock.json
  LICENSE
  NOTICE
```

Install dependencies inside this directory with `npm ci`, then use the target agent's skill installation mechanism. Ordinary retrieval runs `node src/cli.mjs search "..."` followed by `node src/cli.mjs retrieve "<id>"` from the skill directory. Maintaining the knowledge base and rebuilding the index remain separate from ordinary agent use.

## Offline export

```bash
node src/cli.mjs model --project my-topic
node src/cli.mjs export dist/my-topic-offline --project my-topic --include-model
```

This includes the project's model cache and makes the generated skill use `search --offline`. Node and platform-specific npm dependencies still need installation on the target system first. `node_modules` is deliberately not copied between platforms. Model files are about 23 MB for the default model; a cache containing multiple models makes larger exports.

## Tests and development

```bash
npm test
npm run test:integration
```

Unit/integration tests with controlled vectors cover chunking, ranking, caching, deletion, atomic failure recovery, concurrent builds, folder replacement and export. The separate real-model test verifies MiniLM search, token windows and offline export. Its cache defaults to `examples/home-guidance/.cache/models`; override with `SKILL_KIT_TEST_CACHE`.

CI is configured for Node 22/24 on Linux and Windows; local validation was on Linux, Node 24. No TypeScript or compilation step. Library exports are available from `src/index.mjs`.

After dependency updates, copy `package-lock.json` to `assets/runtime-package-lock.json`. The latter ships with npm distributions so exports have a reproducible lockfile. Increment the pipeline version in `fingerprint()` when changing embedding semantics.

A crash can leave `.skill-kit/build.lock`; remove it only after checking no builder is running. For a damaged index, use `build --force`. If ONNX Runtime tries downloading CUDA, run `npm ci --onnxruntime-node-install-cuda=skip`; `.npmrc` already configures CPU-only installation. npm 11 may warn about this package-specific setting.

Independent derivative; not endorsed by Google. Dependency and model licenses remain applicable.
