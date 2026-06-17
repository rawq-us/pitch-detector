# Architecture

Everything lives in `index.html` (~2,900 lines): CSS, markup, and one
`<script>` block. Navigate by the `/* ===== section ===== */` banner
comments. This document is the map; it names sections rather than line
numbers (those drift).

## Why a single file

Deliberate. Zero build, zero dependencies, served as-is from GitHub Pages,
hackable by reading one file top to bottom. Workers don't break the rule:
they're spawned from Blob URLs whose source lives inline (a string, or
`memoWorkerMain.toString()`). See docs/DECISIONS.md #1.

## Script section map (in source order)

| Section | What it owns |
|---|---|
| Music theory | `NOTE_NAMES`, `SCALES` (7 modes), `MODE_COLORS`, midi↔freq |
| Audio engine | `getCtx()` singleton, master bus, per-track FX chains (`buildTrackChain`), synth voices (`spawnOscs`, `playNoteAt`), 18-piece synthesized drum kit (`playDrumAt`) |
| Keyboard | 88-key DOM keyboard, scale highlighting, glissando |
| Pitch detection (live) | `autoCorrelate` on a 2048 analyser frame — the *tuner*; moment-in-time only |
| Project / timing | `project` (bpm, timeSig, lengthSec, loop, tracks), `quarterSec`/`barSec` helpers |
| Arp editor / Beat machine | pattern builders that emit clips |
| Sample beat (sampler) | always-present collapsible section over a **global** `project.samplerKit`; expandable N×N pad bank (Play/Edit modes, drag-reorder) + step grid; `＋ Timeline` adds grid/loop clips to a `sampler` lane; `samplerClipEvents` (DOM-free) expands them |
| Timeline model | tracks → clips; `clipDuration` (incl. `loopFill` = repeat to session end), `addClip`, `growIfNeeded` |
| Timeline rendering | `renderTimeline()` rebuilds head column + lanes + clips; `PX_PER_SEC` is the zoom (28 = 100%, `setTimelineZoom`) |
| Transport | look-ahead scheduler (25 ms tick, ~120 ms ahead) on the Web Audio clock; `forEachClipEvent` expands clips to events |
| Voice recording | `MediaRecorder` → WebM blob (legacy path; memos use raw PCM) |
| **Memo layer** | see below |
| Offline render | `renderMix` via `OfflineAudioContext` → bounce/stems WAV |
| MIDI export (global) | `buildMidi` — SMF-1 of arp/beat/memo-melody at project tempo |
| Song package | `exportSongPackage` → zip: full mix + karaoke render + LRC/SRT/TXT + stems + cover + manifest. `encodeSongAudio` (WebCodecs MP3 → tagged WAV fallback), `buildId3`, `memoSrt`, `songMetadataJson`, `wavBytes16` (DOM-free) |
| AI Composer | stateful editor: `aiProjectSummary` sends the live project, the model replies with edit ops, `applyProjectOps` applies them (`applyProjectSpec` legacy fallback); provider-agnostic OpenAI-compatible `aiChat`/`aiParseSpec`; BYO key in `localStorage` |
| Sessions | `serializeProject`/`loadProject` + IndexedDB; `FORMAT_VERSION`. **Autosave**: live project mirrored to the `autosave` store, restored on reload |
| Layout / pop-out | collapsible/draggable `.csec` sections (order persisted); each can **pop out** into its own window (DOM moved into a child window; `getElementById` shimmed to search pop-outs) |
| Demo | Bach prelude over a trap beat, installed on first run |
| Visualizers, synth/FX UI, layout | oscilloscope, master EQ, collapsible/draggable `.csec` sections (order persisted) |

## The memo layer (the headline feature)

Data model — a `memo` track's clip:

```js
{ id, blob /* 24-bit WAV */, buffer /* AudioBuffer */, audioDur, start,
  analysis: { beats[], bpm, downbeat, beatsPerBar, key:{root,mode,conf},
              usedKey, chords:[{start,end,root,quality,conf,diatonic}],
              notes:[{start,dur,midi,cents,centsToScale,conf}] },
  lyricsText, lyricsWords:[{start,end,text}], analysisKey, lyricsLang }
```

Pipelines:

1. **Capture** — `startMemoRec`: AudioWorklet (`MEMO_CAP_SRC`) streams raw
   Float32 PCM; session length grows live (bar-aligned) and settles to the
   take on stop. Also: `memoImportTo` (decode any audio file) and
   `convertVoiceTrack` (voice layer → memo in place).
2. **Analysis** — `analyzeMemoClip` posts mono PCM to `memoWorkerMain`
   (Blob worker, fully self-contained):
   - STFT pass: 8192-pt FFT, hop 512 (1024 past 2 min) → spectral flux +
     soft-assigned chroma (58 Hz–2.2 kHz, 1/bin tilt) + RMS.
   - Beats: Ellis-style DP over the flux; silence guard; downbeat by onset
     phase. Output is a *tempo map* (beat times), not one BPM.
   - Key: chroma histogram vs all 12 roots × 7 modes.
   - Chords: per-beat chroma vs triad/7th templates, **diatonic-first**
     (in-mode chords win unless clearly beaten), third/fifth energy gate
     (no chords from single notes), then harmonic-rhythm smoothing
     (same-root merge, ~2-beat minimum span).
   - Melody: FFT-autocorrelation on 2× decimated audio, rectangular window,
     unbiased ACF, sub-octave guard, local-max requirement; segmentation +
     same-pitch rejoin (<80 ms gaps) + 130 ms minimum.
3. **Editor** — full-screen modal: zoomable canvas (chord band / colored
   waveform / note ribbons / lyric row), chip list with audition+correct
   popup, downbeat nudge, re-analyze in any of 84 key/mode combos,
   apply key/BPM to project.
4. **Lyrics** — `getWhisperWorker()` (module worker): transformers.js ASR,
   model picker (whisper tiers A/B-tested + experimental + custom HF ids),
   single-language default (UA-derived), self-sliced long-form (~28 s cuts
   at quiet points), load/inference fallback cascades, hallucination-loop
   collapse, timestamps clamped to clip length.
5. **Export** — `memoExportBundle`: zip (store-only, own writer) of WAV +
   `buildMemoMidi` (SMF-1: per-beat tempo map, key sig, chord markers,
   melody, chord track, lyric meta events) + LRC + Audacity labels + JSON.

## Persistence

IndexedDB `pitchStudioDB.sessions`; blobs stored as-is. `FORMAT_VERSION`
(currently 2) gates compatibility warnings in the session list. Layout
(section order/collapse) also mirrors to localStorage, as do the
transcription model/language choices.

## Testing seams

`memoWorkerMain` and the export builders are DOM-free **on purpose** so
`test/extract.mjs` can lift them into Node. If you add logic to either,
keep it that way — it's what makes the suite possible without a build step.
