# Pitch Studio — project guide for AI-assisted development

Read this before editing. It exists so changes are made with the project's
constraints and accumulated learnings in mind, not re-derived (or worse,
re-broken) each session.

## What this is

A single-file, in-browser music workstation. The product thesis, goals and
non-goals live in [docs/PRODUCT.md](docs/PRODUCT.md). The one-line version:
**replace bad pitch detectors with a mode-aware suite for capturing and
developing song ideas** — an homage to Apple's discontinued Music Memos,
not a DAW replacement.

## Hard constraints (do not break casually)

- **One file.** The entire app is `index.html` — markup, CSS, JS. No build
  step, no bundler, no runtime dependencies. Web Workers are spawned from
  Blob URLs built from inline source (strings or `function.toString()`).
- **Static hosting.** Deployed to GitHub Pages (push to `main` auto-deploys
  via `.github/workflows/pages.yml`). No server, no custom HTTP headers —
  so no `SharedArrayBuffer`/COOP/COEP; workers must be single-threaded WASM
  or WebGPU.
- **Lazy ML.** transformers.js + Whisper models load **only** when the user
  clicks Transcribe. The base app must stay dependency-free and instant.
- **Testable extraction.** `memoWorkerMain` (the DSP worker) and the export
  builders (`buildMemoMidi`, `makeZip`, `crc32`, `memoLrc`, `memoLabels`)
  are deliberately self-contained so `test/extract.mjs` can lift them out
  of index.html and run them in Node. Keep them free of DOM references and
  of string literals containing unbalanced braces.

## Commands

```bash
npm test                      # Node test suite (DSP + export formats + page contract), ~4 s
python3 -m http.server 8000   # serve locally (mic needs localhost/https)
awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' index.html | node --check /dev/stdin   # quick syntax check
```

Always run `npm test` before committing. CI (`.github/workflows/test.yml`)
runs it on every push and PR.

## Where things live

- `index.html` — everything. Navigate by the `/* ===== section ===== */`
  banner comments. Map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- `docs/DECISIONS.md` — **the decision log.** Every non-obvious technical
  choice and every bug whose root cause cost real effort is recorded there.
  Check it before "fixing" something that looks odd — it may be load-bearing.
  Add an entry whenever you make a decision a future session might undo.
- `docs/TESTING.md` — test strategy, including the browser smoke procedure
  and the real-audio benchmark method used to pick transcription models.
- `test/` — Node test suite (`node:test`, zero dependencies).

## Conventions

- Compact JS, 2-space indent, semicolons, `const`/`let`, no classes for app
  state — plain objects + functions, mirroring the existing style.
- CSS custom properties in `:root`; panels use `.panel`/`.csec` patterns.
- New persistent fields → extend `serializeProject()`/`loadProject()` AND
  bump `FORMAT_VERSION` when older builds couldn't read the session.
- Workers: analysis = `memoWorkerMain` (plain worker), speech-to-text =
  module worker in `getWhisperWorker()` (string source).
- Reference commits in messages; releases are tagged `vX.Y.Z` with full
  notes via `gh release create` (see Release process below).

## Release process

1. `npm test` green; verify in the browser preview (see docs/TESTING.md).
2. **Bump the version in BOTH places**: `APP_VERSION` in index.html and
   `version` in package.json (a test fails if they diverge). The version
   renders next to the tagline — it's how anyone tells what build is live.
3. Commit to `main` (or merge a feature branch with `--no-ff`).
4. `git tag -a vX.Y.Z -m "…" && git push origin main vX.Y.Z`
5. `gh release create vX.Y.Z --title "…" --notes "…"` — notes describe
   user-visible changes AND root causes of fixes.
6. Pages deploys automatically; verify `https://rawq-us.github.io/pitch-detector/`
   serves the change (curl + grep for a new symbol).

## Top gotchas (full list in docs/DECISIONS.md)

- **q8 weights mis-decode on WebGPU** → multilingual gibberish. WebGPU must
  use `{encoder_model:"fp32", decoder_model_merged:"q4"}`; WASM uses q8.
- **transformers.js long-form chunking silently truncates** after a chunk it
  can't align. We slice audio ourselves (~28 s at quiet points) — don't hand
  it more than ~30 s per call.
- **Hann-windowed ACF reads sharp** (~+30¢). The pitch pass uses a
  rectangular window + unbiased normalization `acf[lag]/(W-lag)`.
- **Chroma needs 8192-point FFT + soft pitch-class assignment** or bass
  fundamentals land in the wrong semitone bin (G chord → Gm bugs).
- **Canvas width caps ~16k px** — all zoomable canvases clamp to 16000.
- **Web Speech API can't process recorded audio** (mic-only) — it is not an
  option for memo transcription, ever.
- **`Heavy Cream/` is local test audio** — gitignored, never commit it.
