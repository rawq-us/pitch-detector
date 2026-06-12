# Decision log

Why things are the way they are. Each entry is a decision a future change
could silently undo — check here before "fixing" something odd. Newest last.

## 1. Single file, no build, no dependencies
The app is one `index.html`. Chosen for hackability, zero-toolchain
deploys to GitHub Pages, and longevity. Workers are spawned from Blob URLs
with inline source. Cost: the file is large; mitigated by section banners,
docs/ARCHITECTURE.md, and extraction-based tests.

## 2. Hand-rolled DSP instead of essentia.js / aubio
The analysis (FFT, beat tracking, chroma chords, pitch) is written in plain
JS inside `memoWorkerMain`. essentia.js is AGPL and both it and aubio add a
WASM dependency to a deliberately dependency-free app. The algorithms are
well-trodden (Ellis DP beat tracker, chroma templates, ACF pitch) and the
test suite pins their behavior.

## 3. Static hosting rules out threads
GitHub Pages can't set COOP/COEP headers, so `SharedArrayBuffer` (multi-
threaded WASM) is unavailable. All ML runs single-threaded WASM or WebGPU.
A `coi-serviceworker` shim exists if threads are ever truly needed.

## 4. Memos record raw PCM, not MediaRecorder
Voice layers use MediaRecorder (WebM/Opus — lossy). Memos capture raw
Float32 via AudioWorklet and store 24-bit WAV, so analysis and exports work
from unmolested audio (Music Memos recorded 24-bit/44.1 too). Conversion of
voice→memo rewraps decoded PCM losslessly but can't undo Opus.

## 5. Tempo is a map, not a number
Beat tracking outputs beat *times* (the memo's own grid); BPM shown is the
median interval. This mirrors Music Memos (tempo event per beat in its
exports) and survives rubato. The exported MIDI writes a tempo meta event
whenever the beat interval moves >1%.
**Learning:** tempo from isolated vocals is genuinely ambiguous (a real
a-cappella stem read 123 vs the track's 92; the drums stem read 92.3 dead
on). Workflow guidance, not a bug: analyze tempo from rhythmic material.

## 6. Pitch: rectangular window + unbiased ACF (the +30¢ bug)
A Hann window on the autocorrelation pitch pass skews the ACF peak toward
shorter lags — every note read ~+30¢ sharp. Fix: rectangular window and
unbiased normalization `acf[lag]/(W-lag)`, parabolic interpolation, and the
peak must be a true local max (boundary-pinned peaks are harmonic
artifacts). Monophonic accuracy is now ±3¢ and pinned by tests.

## 7. Chroma: 8192-point FFT, soft pitch-class assignment, linear magnitude
Three real bugs hid here: (a) 4096-pt bins are ~a semitone wide at B2, so
bass fundamentals landed in the wrong pitch class (G major read as Gm);
(b) sqrt-compression amplified -34 dB 7th-harmonic bleed into a phantom b7
(C ionian read as mixolydian); (c) hard bin→pc rounding loses energy.
Fixes: 8192-pt FFT, each bin's energy split between its two nearest
semitones, linear magnitude, band 58 Hz–2.2 kHz with 1/bin tilt.

## 8. Chords are mode-aware and gated
Diatonic chords of the analysis key win unless an outside chord clearly
beats them (≥1/0.85 score ratio) — outside guesses render with `?`. A chord
requires real harmony: third+fifth energy ≥12% of root, so single sung
notes don't produce chord spans. Manual edits set `diatonic:true` (a human
said so).

## 9. Realistic granularity (harmonic rhythm + note rejoin)
Raw per-beat chord decisions produced 317 "changes" on a 4-minute song.
Post-pass: same-root neighbors merge (B→Bmaj7 flicker), spans shorter than
~2 beats (≥1 s) are absorbed into neighbors or dropped if isolated. Notes:
same-pitch fragments separated by <80 ms rejoin; blips <130 ms drop.
A 16-change fixture with deliberate stabs must yield exactly 16 spans
(tested).

## 10. Whisper on WebGPU needs fp32/q4 (the gibberish bug)
q8 weights mis-decode on the WebGPU backend (onnxruntime-web precision
issue) producing multilingual garbage *identical regardless of options* —
it masqueraded as a language-detection problem. WebGPU loads
`{encoder_model:"fp32", decoder_model_merged:"q4"}` (whisper-web's proven
config); WASM keeps q8. If transcription ever turns to gibberish again,
check the device/dtype pairing first.

## 11. Single-language transcription by default
Auto language detection on short/sung audio makes Whisper hunt for
languages that aren't there. Default = browser UI language; explicit
"Auto — multilingual / mixed" remains for e.g. Spanglish. Choice saved per
memo. Whisper's `translate` task only targets English (model limitation).

## 12. Long-form audio is sliced by us, not transformers.js
Its internal 30 s chunk-stitching silently drops everything after a chunk
whose timestamps it can't align (typically the instrumental break after a
chorus — real songs truncated there). We cut ~28 s windows at the quietest
nearby sample, transcribe each as a single chunk, stitch with offsets.
A bad slice costs only itself (`· N part(s) failed`).

## 13. Model picker: whisper tiers as Recommended, others as Experimental
A/B on a real vocal stem with a known lyric sheet (vocab/bigram):
tiny 74/30 · base 82/45 · small 88/49 · moonshine-base 85/53 ·
distil-small.en 82/47. Moonshine/distil win raw text but lack word
timestamps (which drive LRC, MIDI lyric events, canvas word placement) and
are English-only — kept selectable as Experimental, not Recommended.
Custom HF model ids are supported for future testing; the worker has load
and inference fallback cascades (English-only models reject
`language`/`task`; timestamp-less models return text without chunks —
both handled). The Web Speech API is excluded permanently: it cannot
process recorded audio.

## 14. Whisper hallucination handling
On non-speech audio Whisper loops a phrase forever. Post-pass keeps at most
two consecutive copies of any repeated 1–8-word sequence (preserves real
"la la" repeats, kills 40× loops). Word timestamps are clamped to the clip
duration (chunks can overshoot the audio's end).

## 15. Session format versioning
`FORMAT_VERSION` (2 since memos/loopFill) is stored per saved session; the
session list flags mismatches. Bump it whenever older builds couldn't load
the new shape.

## 16. Zoom limits
Canvases cap at 16,000 px wide (browser limit ~32k; headroom kept).
Timeline zoom 4–280 px/s (28 = 100%); memo zoom 1× to 16000/baseWidth.
Trackpad pinch arrives as ctrl+wheel; touch pinch is handled by
`attachPinch` with per-event factor clamping.

## 17. Test strategy: extraction over framework
No bundler means no import seams, so tests lift `memoWorkerMain` and the
export builders out of index.html textually (brace matching) and run them
under `node:test` against synthesized ground-truth audio. Constraint that
keeps this working: those functions stay DOM-free and avoid string literals
with unbalanced braces. First run of the suite caught a real bug (silence
fabricated a 224.7 BPM tempo map → silence guard in trackBeats).
