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

## 18. Fader orientation (v1.8)
Sliders carry meaning by axis: level/volume/gain/mix/amount (and sustain)
are **vertical** faders (`.knob.vert`, `writing-mode: vertical-lr`); pan and
frequency/time *sweeps* (cutoff, attack/decay/release, glide, FX rate/time/
depth) stay **horizontal**. No JS change — the element is still an
`input[type=range]`, so `bindR`/`setVal` are untouched. FX cards switched to
a bottom-aligned wrapping row so mixed orientations coexist like a hardware
strip.

## 19. Glide (v1.8)
`synthParams.glide` (seconds) makes each oscillator start at the previous
note's pitch and `exponentialRampToValueAtTime` to the new one. The live
keyboard glides from `lastLiveMidi`; sequenced arp notes glide from a
per-track previous-pitch map kept in the realtime scheduler
(`transport._glidePrev`) and the offline render. Additive — old sessions
default to 0, no format bump.

## 20. Sampler layer (v1.8, FORMAT_VERSION → 3)
A `sampler` track owns a pad bank (≤8 decoded samples) plus clips that are
either `{kind:"grid", grid}` (one-shot triggers on the beat-machine 16-step
grid → sampled beats) or `{kind:"loop", pad}` (a single buffer with
`source.loop=true`, loop-filled → sampled loops). Event expansion is the
DOM-free, tested `samplerClipEvents`; the transport and offline render gained
a `sample` event kind. Pads (blob + name/gain/loop) and clips serialize;
pad blobs decode asynchronously on load like voice/memo clips. AudioBuffers
decoded in the live context are reused directly in the OfflineAudioContext
(same sample rate) rather than re-decoded.
**v1.11.1:** pads must store a plain in-memory `Blob` (a copy of the picked
file's bytes), NOT the `File` from the input — Safari can't read `File` objects
back out of IndexedDB after a reload (`WebKitBlobResource error 1`), which left
restored pads silent. memos/voice clips already stored fresh Blobs, so only the
sampler hit this. Pre-fix sessions keep their pad names but need the samples
re-imported once.

## 21. Song package + MP3 reality (v1.8)
"Export song…" bounces a finished track plus a karaoke (instrumental)
render, synced lyrics (LRC/SRT/TXT, Musixmatch-friendly), isolated stems,
cover art, and a `metadata.json` manifest — all in one store-only zip.
Audio uses the browser's `AudioEncoder` (WebCodecs) MP3 when supported
(frames concatenate into a valid `.mp3`, ID3v2.3 prepended); **most
Chromium builds don't support MP3 *encoding***, so it falls back to a 16-bit
WAV carrying the same ID3 tag in an embedded `id3 ` RIFF chunk. The chosen
format is reported in the export status. `buildId3` writes UTF-16 text
frames + USLT/SYLT lyrics + APIC cover; all builders are DOM-free and tested.

## 22. AI Composer: compose, don't synthesize (v1.8)
A bring-your-own-key, OpenAI-compatible chat call (OpenRouter / Hugging Face
router / custom base URL) returns a strict-JSON arrangement spec that
`applyProjectSpec` renders with the app's own synth/drum engine — so every
generated part is its own isolated stem by construction. The LLM composes
structure + lyrics; it does **not** generate audio. An optional, off-by-
default audio endpoint can POST the prompt and import returned audio as a
stem, but no chat provider emits music audio, so that path is scaffolding
until a suitable CORS-friendly audio model is supplied. Keys live only in
`localStorage` (`ps_ai_cfg`); nothing is hardcoded or committed.

## 23. Sampler is a global-kit section, not a per-track modal (v1.9)
The sampler was reworked to mirror the synth beat machine: one **global**
`project.samplerKit` (not per-track pads) drives an always-present, collapsible/
draggable **"Sample beat"** section. The pad bank is an expandable N×N grid
(2×2→8×8) with **Play** mode (tap to audition) and **Edit** mode (load / rename
/ vol / mark-loop / clear, plus **drag pads to reorder & group** — swapping a pad
also swaps its step-grid row). `＋ Timeline` ensures a Sampler lane and drops the
grid pattern; a loop pad drops a continuous loop clip. Playback looks the pad up
in `project.samplerKit[pad]`. Same model as beat clips: clips are immutable grid
snapshots. The kit (blobs + name/gain/loop) serializes once at project level.

## 24. Working-session autosave (v1.9, DB_VER → 2)
Clips/audio weren't restored on reload because sessions were manual save/load
only. Now the live project (tracks, audio blobs, sampler kit, meta) is mirrored
to a dedicated IndexedDB `autosave` store (key `"current"`), debounced 1.5 s off
`renderTimeline`/control-change and flushed on `pagehide`. Startup loads the
autosave if present, else seeds the demo. Named sessions (the `sessions` store)
are unchanged. An `autosaveReady` guard prevents the empty boot state from
clobbering a good autosave before the restore completes.

## 25. Section pop-out windows via DOM move + getElementById shim (v1.9)
Each section has a ⧉ button (next to minimize) that **moves its DOM node into a
child `window.open`** (CSS copied in). Handlers and audio keep running in the
main realm, so state stays synced with zero message-passing. The catch: the
codebase looks elements up by id, and a moved node leaves the main document — so
`document.getElementById` is wrapped to also search open pop-out windows. Closing
a pop-out returns its section to a placeholder slot; the main window's `pagehide`
sets `mainClosing` and closes all children (so children don't try to re-home into
a closing parent). Pop-ups need a user gesture and the pop-up blocker allowed.

## 26. AI Composer is a stateful editor, not a one-shot generator (v1.10)
The request now carries `aiProjectSummary()` — a compact view of the live project
(tempo, key, length, each track + what it plays, loaded sampler-pad names, lyrics;
**no audio is uploaded**). The model replies with a list of **edit operations**
(`{note, ops:[…]}`) that `applyProjectOps` executes against the live project:
`setTempo / setKey / setLength / addArp / addBeat / addSampler / clearType /
removeTrack / setLyrics`. So it *edits and extends* what's there ("make the beat
busier", "use my Kick & Snare pads for a trap pattern", "switch to D minor")
rather than replacing the arrangement. `addSampler` references loaded pads **by
name** from the summary. Every op is clamped/whitelisted; unknown ops are skipped.
The legacy full-`projectSpec` reply (`applyProjectSpec`) is still accepted as a
fallback. Still no provider-side JSON-schema constraint or tool-calling — that's
the next step if reliability on weaker models matters.

## 28. Per-sound pitch-map editor + live record (v1.11)
Each sound (drum voice or sampler pad) can be retuned per step in a piano-roll modal
opened from its grid row label (♪). Pitch is stored as a sparse semitone-offset map
parallel to the boolean grid — working maps `beatPitch` / `samplerEdit.pitch`, snapshot
into clips as `clip.pitch` (`{"row,step": semitones}`) on "+ Timeline"; loop clips use a
single `clip.off`. Playback threads the offset through `forEachClipEvent` →
`buildEvents`/transport/`renderMix`: synth-beat drums shift frequency
(`playDrumAt(.., 2^(off/12))`), samples shift `playbackRate`. The synth-beat editor shows
musical note lanes (base C4) with a **scale-lock** toggle that snaps drags into the
current mode; the sampler editor shows chromatic semitone offsets (no key known). Dragging
a hit re-triggers the sound at the new pitch (samples stop the prior source). Kept the
boolean grid + sparse pitch map (rather than per-cell objects) so renderGrid, serialize,
tests, and AI ops stay unchanged for un-pitched patterns.

**Live record** now auto-starts the section preview when enabled (you couldn't record
because nothing ran the playhead) and the sampler gained the same Live-record button —
tap pads in Play mode while it runs to write hits at the playhead.

## 32. Session style tags + full-song AI prompt, and a key/mode map over time (v1.14)
Two features aimed at the "take a song idea to a music-gen service, then to a DAW" loop.

- **Session-level style tags, Vozart-aligned.** A `<details>` "Style tags" block in the Lyrics
  section. First cut had free-text genre/mood/**influences**/production fields — the influences
  field was a mistake: it invited artist/song/album names, which are **trademarked and rejected
  by generators** (user, who actually uses Vozart). Rebuilt around Vozart's real clickable
  vocabulary (`VOZART_TAGS`: Genre / Mood / Vocals[gender+voices] / Instruments) as toggle chips
  plus one free **Custom / texture** field for everything else. **v1.14 follow-up:** that split
  (toggle chips as state + a tiny custom input) was wrong — most real style words aren't in the
  presets, so the small input dominated. Rebuilt to mirror Vozart exactly: **one big Style
  textarea is the source of truth** (`#styText`, a comma list), the tag buttons just toggle tokens
  in/out of it and highlight when their token is present (`styHasTag`), and custom tags are typed
  straight in. Copy buttons + a `n/1000` count sit right under the textarea. Stored as
  `project.meta.style = {text:"…"}`; older `{tags,custom}` and `{genre,mood,…}` shapes migrate to
  the joined text and the legacy keys are stripped. Kept session-level (not in the
  lyrics DSL) so the same tags reproduce across regenerations — the "tweak-and-regenerate master
  session" ask. The UI explicitly warns off names and reverse-engineering the vibe into tags.
- **`buildSongPrompt(o)` is DOM-free and tested.** It folds meta + a flat tag line + structure
  (per-section key) + instrumentation + timed lyrics into one rich prompt for
  Vozart/Suno/Udio/ElevenLabs. The tag line is Vozart-shaped: tempo first (`74bpm`), then the
  comma-joined `styleTags`. The app-side `gatherSongPrompt()` assembles `o` from live state
  (`styleTags: styleTagsList()` = selected chips + custom, de-duped); "Copy full-song prompt" +
  the `song` export menu item emit it. The prompt also tells the model to use only the
  descriptive tags — no artist/song/album names. Empty fields are omitted — verified by test.
- **Copy targets the generator's *fields*, not one brick (v1.14).** Vozart/Suno "Custom" mode
  has *separate* boxes with hard limits — Lyrics (5000), Style (1000), Style-to-avoid (1000),
  Title (80); Simple/Instrumental is one 400-char prompt. A single combined prompt can't be
  pasted into any of them. So the Style panel has three field-copy buttons — **Style** (the
  `<bpm>bpm, tag, tag…` line), **Lyrics** (`vozartLyricsRaw`: section tags + words + `(bg)`, with
  timecodes/pitch-tags/singer-defs stripped — Vozart's lyric box doesn't want those), **Title** —
  each trimmed to its limit with a live `n/limit` badge (red when over). `buildSongPrompt` (the
  combined brick) stays only as a download for single-prompt tools/LLMs.
- **Audio APIs vs LLMs (the integration reality).** OpenRouter/Gemini are text LLMs — great for
  the *text brain* (lyrics, style-tag suggestions, prompt-enhance; Gemini likely powers Vozart's
  "Generate with AI"/"Enhance") but they emit **no music audio**. Actual sung-song generation
  needs a dedicated model — **Mureka** (API + stems), **ElevenLabs Music**, **Suno/Udio**
  (gated) — none reachable via OpenRouter, all server-side (CORS + key-exposure block direct
  browser calls from this static app). Hence: LLM helpers can run in-browser BYO-key; song audio
  stays copy-paste (or a future proxy). "Vozart 5" itself is proprietary/opaque.
- **Central Settings modal owns the API keys (v1.14).** A ⚙ gear top-right opens the one
  canonical editor of `ps_ai_cfg` (provider/model/key/baseUrl/audioUrl) with a prominent privacy
  notice: keys live in `localStorage` only and are sent only to the chosen vendor — the app has
  no server and stores/tracks nothing else. The key fields were *moved out of* the AI Composer
  into Settings (same element ids, so `aiProvider.value` etc. keep resolving via the named-element
  globals); the composer now shows a read-only summary line + "⚙ Settings" button and the run
  handler reads `aiLoadCfg()` instead of its own inputs. Settings has Save / Test connection
  (a tiny `aiChat` round-trip) / Clear keys. This is the "smooth out the awkward OpenRouter
  handling" step — one place to manage keys, reused by every AI feature.
- **Stems strategy (documented, not yet built):** no service gives {rich prompt + true
  stems + reproducible} at once. The intended path is hybrid — keep the in-app synth/MIDI/
  sampler parts as real isolated stems, use AI only for vocals/full bed, then run pro stem
  separation (AudioShake/LALAL/Demucs) on whatever comes back compressed. A "stem-separation
  import" path was offered but deferred.
- **Key/mode map.** `project.keyMap` is an array of OVERRIDE regions `{beat,root,mode}`; the
  global `rootSel`/`modeSel` is the default from beat 0. `keyAtBeat(beat)` returns the active
  key. Empty map ⇒ one key throughout (simple stays simple) — deliberately non-prescriptive,
  since real songs break "one key per song" constantly (modal interchange, section
  modulation, final-chorus bump). A timeline **key lane** (`renderKeyLane`) shows a chip per
  change; click the lane to add, click a chip to edit/delete via `#keyPopup`, drag to re-time
  (reuses the lyrics-lane beat math + snap). `keyChangeSummary()` feeds the AI prompt and
  per-section structure. **No FORMAT_VERSION bump** — additive and forward/back compatible
  (old builds ignore `keyMap`; new builds default it to `[]`).

## 52. Timeline track-header cleanup (v1.24.1)
- The per-track header column was a wrapping mess (the wide "meter: global" select + FX/Rec/Import/
  Convert/Delete crammed into ~160px wrapped into the next row). Rebuilt: the **compact meter select**
  ("global") moves onto the name row (right-aligned); the name is a `.tnm` span that ellipsizes
  gracefully instead of the whole `.tname`. All actions are now uniform `.thd-btn` chips on one
  non-wrapping row — labels without redundant icons (FX, Rec, Import, Pads, → Memo) and icon-only only
  where unambiguous (🗑). `.tl-head` got `overflow:hidden` as a safety; head/lane heights stay coupled
  at 58 px. No more vertical spill.

## 58. Song structure layer — arrangement scaffold that feeds the lyrics (v1.28)
- `project.structure` = an ordered set of sections `{id, type, beat, bars}` (`SECTION_TYPES`:
  intro/verse/prechorus/chorus/bridge/solo/outro, each a colour + default bars). It's the same kind of
  scaffold as BPM/time-sig/key. `structLabel` auto-numbers repeats ("Verse 1/2"). Serialized/loaded.
- **A new "Structure" timeline lane** (`renderStructureLane`) sits in the top meta stack. Lane order is
  now **key/mode → structure → lyrics → instrument tracks** (the lyrics lane moved up). Section blocks are
  colour-coded, positioned by beat, **draggable** (snap to bar via the shared `lyrSnap`), and click-to-edit
  (`#structPopup`: type / bars / delete). "＋ section" in the lane head opens a type menu (`#structAddMenu`).
- **Header-right "intelligence"** (`#structSummary`, where the old loop readout was): the arrangement as
  colour chips + total bars + a **↓ to lyrics** button. `structToLyrics` writes `[Verse 1 - Singer]`-style
  section placeholders into the lyrics editor (adds a default singer if none), then re-parses.
- DEFERRED (noted to user): bidirectional drag-sync (moving a block reorders the lyric declarations) and a
  length×quantity generator. This ships the model + lane + summary + one-way lyric derivation.

## 63. Tuner made usable for a real instrument (v1.30.1)
Three complaints from tuning an actual guitar, three fixes:
- **Over-aggressive noise gate** — `autoCorrelate` only returned a pitch above `rms 0.01`, so only hard
  strums registered. Lowered to `0.0035` (+ edge-trim `thres` 0.2→0.12) and added a **clarity gate**
  (`maxval/c[0] < 0.38 → reject`): the peak-autocorrelation-to-zero-lag-energy ratio is high for periodic
  tones and low for broadband room noise, so sensitivity can go up without phantom notes appearing.
- **Note didn't persist while ringing** — `detectLoop` cleared to "listening…" the instant one frame fell
  below the gate. Now it **holds the last reading for `DET_HOLD_MS` (2.5 s)** (`detHoldMidi`/`detHoldAt`),
  re-rendering it with a "ringing…" tag. Refactored the display body into `renderDetection(midiFloat, held,
  freq)` so both the live and held paths share it; `tunerLiveUpdate` gained a `held` arg (dims the meter via
  `.holding`). Fresh detections keep refreshing the hold, so a decaying string stays on screen.
- **Reference tone didn't sustain** — string cards played a fixed 1.5 s `playNoteAt`, useless for tuning by
  ear. Replaced with a **toggleable drone** (`startTunerDrone`/`stopTunerDrone`): sine + a slightly detuned
  triangle straight to `ctx.destination` (always audible regardless of master level). Click a string to hold
  the tone, click it again (or change tuning / close the modal) to silence it; the `.playing` card stays lit
  while it sounds.

## 72. Collab signaling — invite links, compression, QR (v1.42.0 / v1.43.0)
The copy/paste SDP handshake became clickable links. **Why not one link:** WebRTC needs a two-way
exchange (offer ↔ answer), so each leg is its own link — a single self-contained link is impossible
without a rendezvous server (the backend we refuse). Each leg's payload rides in the URL `#hash`,
which is never sent to any server.
- **Codec (DOM-free, tested):** `packSignal` = JSON → `deflate-raw` (CompressionStream) → base64url,
  tagged `c`/`u` with a graceful fallback; `unpackSignal` reverses and also tolerates a raw-JSON paste.
  A real offer shrinks ~60% (~700-char link). `buildSignalUrl`/`parseSignalHash` put/extract the
  payload under `#invite=`/`#reply=`. base64url uses `btoa`/`atob` (present in Node) so it unit-tests.
- **Auto-join:** `checkInviteUrl` fires on load — opening an invite link auto-opens collab in join mode,
  generates the reply link, and `history.replaceState`s the hash away so refresh won't re-trigger.
- **QR (v1.43.0):** an inline, dependency-free QR encoder (byte mode, EC level L, auto version to v40)
  renders a scannable QR beside each link. GF(256) over the QR polynomial **0x11D** (not AES's 0x11B —
  a trap I tested against), Reed-Solomon EC, 8-mask penalty selection, format + version info.
  **The RS generator coefficient order is the load-bearing detail** — my first pass had it reversed,
  which produces structurally-valid but unscannable QRs; the unit test pins it to the canonical
  exponents `[87,229,146,149,238,102,21]`. test/qr.test.mjs + test/signal.test.mjs (9 tests; 106 total).
  Final scan fidelity is a real-phone check, like the 2-browser collab test.

## 71. P2P sync — identity model + 3-way reconcile (docs/P2P_SYNC_SPEC.md, v1.39.0)
Implements the testable spine of the sync spec; replaces the old whole-project last-writer-wins clobber
with a per-track merge. Signaling stays the copy/paste handshake — all sync rides the data channel.
- **§1 Identity (`FORMAT_VERSION` 3→4).** `project.sessionId` (UUID, the song's identity across machines),
  per-track `uid`/`ownerId`/`rev`/`updatedAt`, and `project.syncBase` (the last-synced `{sessionId,
  tracks:{uid:{rev,hash}}}`). `peerId` lives in localStorage and becomes `ownerId`. Minted in `addTrack`,
  carried through serialize/load and snapshot/restore (so undo preserves identity). **Deviation from the
  spec:** the spec says `track.id` = UUID, but the app keys runtime state (chains, selection, DOM) on the
  existing numeric `track.id` everywhere — retrofitting that to a UUID is a large, destabilizing change.
  So identity lives on a parallel `track.uid` (the stable cross-machine key the sync layer uses), and
  numeric `id` stays for runtime. Same intent, no refactor blast radius.
- **rev bumps automatically.** `commit()`/`endEdit()` diff each track's content hash before/after via
  `bumpChangedRevs`; only genuinely-changed tracks `++rev` + stamp `updatedAt`. Verified: editing one
  track doesn't touch another's rev.
- **§5 reconcile (DOM-free, tested).** `trackHash` is an FNV-1a fingerprint over an audio-free, automation-
  normalized projection of a track. `reconcile(local, remote, base)` → `{merged, conflicts}`: added-one-
  side → take it; changed-one-side → silent fast-forward; changed-both → conflict; deleted-one-side-
  untouched-other → take the delete; delete-vs-edit → conflict (never a silent loss). `mergeRemoteState`
  applies this to an incoming snapshot, taking each track from local or remote by uid, keeping local PCM
  buffers on kept tracks, and recomputing `syncBase`. An empty peer adopts the remote `sessionId` and
  takes everything. Conflicts default to keep-mine (non-destructive) with a status line; the layer-diff
  resolution UI (Keep mine/theirs/both) is deferred. Verified live in-browser: add + fast-forward + conflict.
- **§2 clock offset (`clockMedianOffset`, tested):** median of `remoteTime − (localSend + rtt/2)` over
  ping samples — recovers a ~+1000 ms skew. Ready for §3 (clock-synced transport), not yet wired.
- **Tests:** test/p2psync.test.mjs (8; 97 total). **Remaining (need 2-browser manual testing):** §3 clock-
  scheduled transport/record-arm, §4 per-track soft-lock live ops + claim, chunked audio-blob transfer so
  stems are audible peer-to-peer, multi-person host-relay topology, MediaStream voice/video, and the
  conflict-resolution UI.

## 70. WebRTC live collaboration — P2P transport + edit sync (Roadmap WebRTC, v1.37.0)
Two browsers edit the same session live, with **no server we host and no accounts**.
- **Signaling is copy/paste SDP** (non-trickle): host clicks "Create invite" → `createOffer` →
  `iceComplete` waits for gathering (2.5 s cap) → the full `localDescription` JSON is shown to copy.
  The joiner pastes it, `createAnswer`s, and pastes the reply back. A public Google STUN server helps
  NAT traversal (not ours; BYO/relay is the documented upgrade path). One `RTCDataChannel` carries everything.
- **Wire protocol (DOM-free, tested):** `rtcEncode(type,data)` / `rtcDecode(str)` frame versioned JSON
  and **validate every inbound message** — bad JSON, wrong version, missing or unknown type are dropped
  (acceptance: "inbound ops are validated"). Types: `hello`/`bye` (presence), `transport`, `state`,
  `cursor`. `peerColor` derives a stable hue from a name.
- **Edit sync reuses the snapshot layer, not a separate op format.** Rather than build an operation
  protocol, every local `commit`/`endEdit`/`undo`/`redo` broadcasts the scoped arrangement snapshot with
  audio stripped (`rtcStateForWire` deletes `buffer`/`blob` — AudioBuffers aren't serializable and blobs
  are heavy). The peer applies it via `applyRemoteState`, which re-attaches its OWN decoded audio by
  clip id, then runs `restoreProject` under `_histMuted` + `_rtcApplying` (so remote edits don't enter
  local undo and don't echo back). Last-writer-wins. Trade-off: audio bytes don't cross the wire — peers
  share the saved session for actual audio; structure/MIDI/automation/keymap all sync live.
- **Transport sync:** `transportPlay`/`transportStop` broadcast `{action,pos}`; the receiver starts/stops
  under `_rtcApplying` so it doesn't bounce back.
- **What's verified vs. manual:** the protocol is unit-tested (test/collab.test.mjs); offer generation
  produces a valid data-channel SDP in-browser (checked in preview). A true two-peer connection needs two
  real browsers + network and is the documented manual smoke test — the headless single-page loopback
  can't reliably complete ICE.

## 69. Track automation lanes — volume + pan (Roadmap item 8, v1.36.0)
Per-track timeline automation, gated behind a head toggle, kept to a few core params.
- **Scope: volume, pan, and cutoff.** `track.automation = { volume:[{beat,val}], pan:[...], cutoff:[...] }`,
  piecewise-linear. (Cutoff was added in v1.38.0 — see the addendum at the end of this entry.)
- **Engine (DOM-free, tested):** `automationValueAt(points, beat, dflt)` interpolates linearly, holds
  edge values outside the range, tolerates unsorted points, and returns the default for an empty lane
  (so absent automation is a true no-op). `serializeAutomation` prunes empty lanes → `undefined` (clean
  sessions, no FORMAT bump).
- **Two apply paths.** Live: `applyLiveAutomation(posSec)` runs each transport tick, setting
  `chain.level.gain.value = fx.level × vol(beat)` and `chain.pan.pan.value = pan(beat)` — follows the
  playhead and loops naturally; `transportStop` releases the override back to the static fader/centre.
  Offline: `renderMix` schedules the points as `linearRampToValueAtTime` curves on each chain's
  `level`/`pan` params, so the bounce matches playback. `buildTrackChain` gained a `StereoPanner`
  (transparent at 0) for the pan tap. Verified: a 1→0 volume ramp reads ×0.5 at its midpoint live, and
  the offline bounce renders cleanly.
- **UI:** a head "Auto" button cycles off → volume → pan; when on, an SVG overlay on the clip lane shows
  the curve with draggable point handles — click empty to add, drag to shape, right-click to delete.
  Every edit (add/move/delete) routes through `commit()` so it's undoable. Automation persists via
  serialize/load and snapshot. Tests: test/automation.test.mjs (5; 84 total).
- **Addendum (v1.38.0) — cutoff automation.** `buildTrackChain` gained a lowpass `BiquadFilter`
  (`type:"lowpass"`, default 20 kHz Q 0.7 → transparent when un-automated) after the FX chain, before the
  panner. Cutoff points store the frequency in **Hz directly**, so live (`frequency.value`) and offline
  (`linearRampToValueAtTime`) interpolate identically in Hz — same exactness as volume/pan, no sampled
  curves. The lane editor maps Hz on a **log scale** (`AUTO_PARAMS.cutoff.log`) so the musical low end
  isn't crushed into a sliver. The head toggle now cycles off → volume → pan → cutoff. Verified live
  (18 kHz→9.1 kHz→300 Hz sweep) and offline bounce. This completes Item 8's volume/pan/cutoff scope.

## 68. Per-track + master level meters (Roadmap item 7, v1.35.0)
Live feedback, not a console — a slim meter per track head plus a master meter in the transport row.
- **Tap, don't rewire.** `buildTrackChain` gained an `AnalyserNode` (`fftSize 256`) fed from the chain's
  final output — which sits *after* the mute gain, so a muted or un-soloed track's tap is silent and the
  meter reads 0 with zero extra logic (mute/solo-aware for free). The master meter reuses the existing
  `masterAnalyser`. Offline `renderMix` builds its own chains and never reads these, so the bounce is
  unaffected.
- **DOM-free signal math (tested):** `analyserRms`/`analyserPeak` over a time-domain frame, `linToDb`
  (0 dB at full scale), `dbToFrac` (0..1 over a −60 dB floor, clamped), `meterFrac`. Verified a
  −13 dBFS tone reads ~0.76.
- **One shared rAF.** `drawMeters` is called from the existing `startViz` loop (no new animation frame);
  `readLevel` caches a Float32 buffer on each analyser node. Fast attack, eased release (−5%/frame). Track
  fills are stored on `track._meterFill` and refreshed on each `renderTimeline` head rebuild.

## 67. Harmony assistant — mode-aware suggestions + voice leading (Roadmap item 5, v1.34.0)
A pure-theory engine (DOM-free, tested) that feeds the backing generator and explains itself.
- **`diatonicChords(root, mode)`** builds the seven triads of any mode from `SCALES`, deriving each
  quality from its third/fifth intervals (`triadQuality`) and a Roman numeral (`romanFor`: case by
  quality, `°`/`+` for dim/aug). C major → I ii iii IV V vi vii°; A Dorian keeps its signature major IV.
- **`suggestChords(root, mode, prev, opts)`** ranks the next chord from a functional-tendency table
  keyed by the last chord's scale degree (V→I strongest, ii→V, vi→IV…), each with a one-line rationale.
  `opts.borrow` adds parallel-mode chords (C major → Fm/A♭/B♭, flagged `borrowed`); `opts.secondaryDominants`
  adds `V7/x` a fifth above each diatonic target. De-duped by root+quality, best-first.
- **`suggestProgression(root, mode, bars, opts)`** chains the suggester, starting on the tonic and
  avoiding the last two chords each step so the default is musical, not I–V–I–V — A major yields the
  "A E F#m D" axis, C major over 6 bars resolves home ("C G Am F G C").
- **`voiceLead(fromMidi, toPCs)`** places each target pitch-class in the octave nearest the previous
  voicing's centre, so chords move with minimal total semitone travel (no octave leaps).
- **UI:** a "✨ Suggest" button in the backing modal fills the progression box from the session key
  (`keyAtBeat(0)`) for the chosen chord count, then runs through Item 4. Deeper hooks (next-chord chips
  in the chord/key popups, AI-augmented "make it more neo-soul") are deferred — the deterministic engine
  is the foundation. Tests: test/harmony.test.mjs (7; 74 total). SCALES/HARMONY_TENDENCY were collapsed
  to one line each so `extractConstLine` can lift them for the harness.

## 66. Clip editing — split · duplicate · copy/paste · edge-resize (Roadmap item 2, v1.33.0)
Operates on the in-memory clip model; every op routes through item-1 `commit()` so it's undoable.
- **DOM-free core (tested):** `splitMidiNotes(notes, atBeat)` partitions notes around a cut, splitting
  any straddling note into a clamped head + a rebased tail; `splitClipData` wraps it into two MIDI
  clip payloads; `cloneClipData` deep-copies a clip's editable payload (sharing `buffer`/`blob` by
  reference, dropping id/start) — built on the undo `snapClip` cloner.
- **Audio clips gain `offset`/`length` (seconds into the buffer).** This is the buffer-offset render
  path the roadmap called for: `clipDuration` honors `length`; `forEachClipEvent` emits `aoff`/`alen`
  on voice events; both the live scheduler (`transportScheduler`) and the **offline bounce**
  (`renderMix`) call `bufferSource.start(when, offset, duration)`. An untrimmed clip passes
  `offset 0, duration audioDur` → identical to before. Splitting an audio clip is pure offset/length
  arithmetic (no PCM copied); verified a 6 s clip splits into 0–2.5 s / 2.5–6 s halves sharing one buffer.
- **UX:** click selects a clip (outline); right-click opens a context menu (Split here · Duplicate ·
  Copy · Paste here · Delete) acting at the click point; ⌘D/⌘C/⌘V act on the selection (gated off
  while the MIDI editor owns the keyboard); a right-edge `.cresize` handle drags to change `lengthBeats`
  (event clips, snaps to beat, clears loop-fill) or `length` (audio trim). Paste lands on the
  selected same-type track at the playhead (`playheadSec()` = live head while playing, else cycle start).
- **Split keeps an open MIDI editor valid** by repointing `midiEd.clip` to the head half (the left
  reuses the original clip id). Offset/length persist via serialize/load and snapshot (undo).
- Split is offered for MIDI + audio only — arp/beat/sampler clips loop a pattern, so a positional cut
  isn't meaningful (they're resized/duplicated instead). Tests: test/clipedit.test.mjs (5; 67 total).

## 65. Undo / redo — scoped snapshot command stack (Roadmap item 1, v1.32.0)
A single `commit(label, doFn)` envelope snapshots before a mutation, runs it, and records the
before-state; `undoEdit`/`redoEdit` swap snapshots. ⌘Z / ⇧⌘Z + a toolbar ↶/↷ (disabled-state +
label tooltips via `updateUndoUI`).
- **Snapshot is in-memory and SCOPED, not a serialize/loadProject round-trip.** `snapshotProject`
  deep-copies only the *arrangement* — `tracks · clips · keyMap · structure · lengthSec · loop ·
  selectedTrackId`. Decoded PCM (`clip.buffer`) and source blobs are carried **by reference, never
  copied**, so audio survives undo without re-decoding (the acceptance criterion). `restoreProject`
  rebuilds tracks from the snapshot, disconnects the old chains, and re-`ensureTrackChain`s — buffers
  intact. Verified in-browser: `clip.buffer===` the same object after undo.
- **Why scoped, not whole-project:** snapshot-based undo incorrectly reverts any state a restore
  touches but no `commit()` recorded. So the snapshot deliberately EXCLUDES synth/GLOBAL_VOICE,
  master-EQ, song metadata, sampler-kit, lyrics, bpm/timeSig/countIn — none of the wired mutators
  change them, so restoring never clobbers them. Those domains are simply not undoable yet (documented
  gap, not a bug). If they're later wired through `commit()`, add them to the snapshot together.
- **Wired mutators:** add/delete track, add/move/delete clip, loop-fill toggle, mute/solo, key-map
  add/edit/delete, structure add/edit/delete, backing generation (one atomic entry for all N tracks),
  and all MIDI-editor note ops (add/move/resize via a gesture-scoped `beginEdit`/`endEdit`, plus
  delete/clear/quantize/nudge/pattern-insert via `commit`). NOT yet wired: live MIDI recording,
  key-edge & structure-block drag-resize, synth/fx knob tweaks.
- **The MIDI editor holds object refs into the project**, which a restore replaces. `restoreProject`
  re-points `midiEd.track`/`midiEd.clip` by id (clearing the note selection), or closes the editor if
  its clip was undone away. Ids are preserved through snapshot/restore precisely so this matching works.
- **Robustness:** `undoEdit`/`redoEdit` restore inside try/finally so a render error can't leave the
  history muted; `commit` records only after `doFn` returns, so a throwing mutation leaves no bogus
  entry. History is depth-capped at 100 and cleared on session load (`loadProject`). The `makeHistory`
  stack is DOM-free and unit-tested (test/history.test.mjs); the snapshot/restore pair is preview-verified.

## 64. Chord-driven backing generation — UI on the inert engine (Roadmap item 4, v1.31.0)
The voicing engine (`parseProgression`, `chordQualityFromSuffix`, `voiceProgression`) shipped tested
but inert in v1.30.1. v1.31.0 adds the orchestration core + UI.
- **Every role becomes its own track**, not one multi-part clip. `buildBacking(prog, opts)` (DOM-free,
  tested) maps a source-agnostic progression `[{root,quality}]` to one layer spec per role: pad/bass/arp
  are **MIDI** stems (`voiceProgression` notes → a notes clip), drums is a **beat** track. This is the
  whole point of item 4 — generated parts are *born* as isolated, transposable, individually-exportable
  stems (`track.transpose` per track), editable in the existing MIDI/beat editors. No new clip machinery:
  `materializeBacking` just calls `addTrack`+`addClip` per spec.
- **Three chord sources, in priority order.** (1) **Typed** progression box (`parseProgression` — letters
  only: `A C#m F#m D`). (2) **Detected memo chords** — `chordsToProgression` maps a memo's
  `analysis.chords` spans to the engine shape; the span suffixes (`""`,`m`,`7`,`maj7`,`m7`,`dim`) already
  round-trip through `chordQualityFromSuffix`, so detect→voice is lossless. (3) **AI** via `aiComplete`
  with a strict-JSON system prompt (`BACKING_SYS`) + `buildBackingPrompt` (BYO key, defaults to
  `keyAtBeat(0)`); reply parsed with the existing `aiParseSpec`, qualities normalized through
  `chordQualityFromSuffix`. No audio model, no CORS — a chat completion only.
- **Drums are a static, genre-neutral pattern** (`backingDrumPattern`): kick on beats 1 & 3, snare on the
  backbeats, closed hat on eighths (straight) or quarters (laid-back). Returned as per-voice step indices
  so the UI maps kick/snare/hat onto rows 0/1/2 of the full `DRUMS` grid; `loopFill:true` repeats it under
  the harmonic layers. Kept dumb on purpose — a real beat generator is out of scope for this item.
- **Why MIDI for the arp role** (not an arp track): `voiceProgression`'s arp is an explicit eighth-note run
  through the chord tones — a melody, not an auto-arpeggiator pattern. A MIDI clip keeps it editable
  note-by-note and exportable as a clean stem, consistent with pad/bass.
- Explicit chords (typed/memo/AI) are absolute and do **not** auto-follow later key-map transpositions —
  that's musically correct (the user named the chords). The key-map awareness here is the AI path seeding
  its key from `keyAtBeat(0)`; the Roman-template-from-key-map source is item 5's job and is deferred.

## 62. Per-layer mute / solo on the timeline (v1.30.0)
- Each track head now carries **M** and **S** chips (between FX and the type-specific buttons), toggling
  `track.muted` / `track.soloed`. Audibility rule, in one helper trio: `soloActive()` (any track soloed),
  `trackAudible(t)` = `!t.muted && (!soloActive() || t.soloed)`, and `applyTrackMuteSolo()` which pushes
  the verdict to each chain.
- **Implemented as a gain node, not a graph rewire.** `buildTrackChain` gained a `mute` gain right after
  `input` (`input → mute → level → fx…`). Mute/solo only sets `chain.mute.gain` (0/1), leaving the FX
  `level` gain — and the user's fader value — untouched, so unmuting restores the exact level. Live
  playback already routes every event through `ensureTrackChain`, so it respects mute/solo for free;
  `ensureTrackChain` also seeds the mute gain on first build (covers tracks added mid-session).
- **Exports honour it too.** `renderMix(filter, eq, respectMuteSolo=true)` folds audibility into a single
  `pass(tr)` predicate. The full mix and the karaoke render respect mute/solo; **stem exports pass
  `respectMuteSolo=false`** so every layer still bounces in isolation regardless of its mute state (the
  whole point of stems). No FORMAT bump — `muted`/`soloed` are additive booleans on each track, defaulting
  to false on older sessions; persisted in `serializeProject`/`loadProject`, re-applied after load.
- Visual: muted/silenced heads dim (`.tl-head.muted .tname`), the **M** chip lights red (`var(--flat)`),
  the **S** chip lights green. Reuses the existing `.thd-btn` sizing so the row stays consistent.

## 61. Arp layers are clickable into the editor, with in-place editing (v1.29.2)
- Only MIDI clips in the section visualizers were wired to open their editor. `renderInstViz` now wires
  arp clips too: clicking one calls `openArpClip(t,c)` — loads the clip's steps into the arp `sequence`
  + its rate, selects the track, and opens the synth modal (parity with MIDI's `openMidiEditor`).
- **In-place editing**: `editingArp`/`setArpEditTarget` track which layer is loaded; the arp "＋ Timeline"
  button becomes "✓ Update layer" and writes the edited sequence back to that clip instead of adding a
  new one. `synthEditBtn` (general "open synth keys") clears the target → back to "＋ Timeline" (new arp).
  Arp clips get `cursor:pointer` + hover like MIDI clips.

## 60. Tuner instruments + 3-col header + structure↔lyrics one-way removed (v1.29.1)
- **Tuner**: Mandolin is now 8 strings (doubled GDAE courses); added **12-string Guitar** (12, octave
  pairs on the low courses), **Octave Mandolin** (8), and **Baritone** guitar tunings (B-standard
  BEADF#B and A-standard ADGCEA). The meter's nearest-string snap handles unison/octave pairs fine.
  (Baritone guitars aren't any of the old standard-pitch tunings — they sit a 4th/5th lower.)
- **Timeline header row 1 is now a strict 3-column grid** (`.tl-row1`: `1fr auto 1fr`) — left controls,
  centered transport, right structure summary — instead of flex with spacers that wrapped into
  "left·center·left". The structure summary wraps WITHIN its right column. Left column keeps min-content
  (no `min-width:0`) so the BPM/time-sig/length never collapse.
- **Removed the "↓ to lyrics" button**: structure→lyrics now happens automatically on any timeline edit
  (`syncStructureToLyrics`, gated on a non-empty structure so it never wipes lyrics). "↑ from lyrics"
  stays as the explicit re-infer.

## 59. Instrument tuner gets a live mic meter (v1.29)
- The tuner was reference-pitch-only (click a string to hear it). Added a real **mic tuning meter**:
  a "🎤 Enable mic" button (toggles the SAME global mic via `micBtn.click()`, `syncTunerMic` reflects
  state), a big detected-note readout, a **cents needle** (flat ← center → sharp), green in-tune state
  (±5¢), and "tune up/down" guidance. It **snaps to the nearest string** in the selected tuning and
  highlights that string card.
- Reuses the existing pitch detector: `detectLoop` already computes `midiFloat`; it now calls
  `tunerLiveUpdate(midiFloat)` (and `(null)` when there's no signal) whenever the tuner modal is open
  (`tunerOpen`). `renderStrings` populates `tunerStrings` ([{midi,name,idx}]) so the meter knows the
  targets. No second audio pipeline. Verified: flat low-E → "−20¢ ♭ tune up", in-tune A → green, sharp
  D3 → "+25¢ ♯ tune down", each snapping to the right string.

### 58c. One control-row standard + outline delete buttons (v1.28.3)
- `.ctl-row` is now the shared "every input/select/button is the same height (32px)" utility — applied to
  the timeline header (was `.tl-controls`, now both selectors share the rule), the MIDI toolbar (bumped
  30→32 to match), and the pitch-detector `det-keyrow` (fixes mic-button vs tuner-button size mismatch).
  Use `.ctl-row` on any future control row instead of re-tuning per element.
- **Delete buttons are red OUTLINE** (transparent fill, red text + border, faint red tint on hover) — both
  the track-header `.thd-btn.danger` "Delete" and the section-visualizer `.inst-viz-del`. No more salmon
  fill. The track-header Delete is the same `.thd-btn` (21px) as FX/Rec — verified identical height.

### 58b. Bidirectional structure↔lyrics + codified header format (v1.28.2)
- **Official section-header format** (codified + documented in the lyrics hint): `[<Structure + optional #>
  - <freeform label>]`. The keyword before a spaced dash is the HARD structure (matches `lyricSectionKind`);
  everything after the ` - ` is a freeform label (singer like "Lead"/"Rapper A", or directions). Singer
  *definitions* use a colon (`[Lead: C3-A4]`). "Pre-chorus" survives because the split is only on a spaced
  dash. Helpers: `structHeader`, `headerLabel`, `isSectionHeaderLine`, `lyricsBlocks`.
- **Timeline → lyrics sync.** Each structure section stores `_docIdx` (its lyric-block index, set at infer).
  Any timeline edit routes through `structChanged` → `syncStructureToLyrics`, which rewrites the lyric
  section HEADERS to match the structure (reorder / retype / add / remove), **preserving each section's
  label + body lines** (matched by `_docIdx`) and the singer-def preamble. Guarded by `_structSyncing`
  against the reparse loop; only runs when lyrics already have sections. Verified: retype Bridge→Outro
  keeps its body; dragging Chorus ahead of Verse moves the hook lines with it; delete drops the section.
- So lyrics↔structure are now two views of one thing: lyrics auto-seed the structure (when empty / via
  "↑ from lyrics"); structure edits flow back into the lyric headers.

### 58a. Structure inferred FROM lyrics (v1.28.1)
- The lyric sheet already encodes structure (`[Verse 1]`, `[Chorus]`, `[guitar solo]`…), and the parser
  already tags each section with `sec.kind` via `lyricSectionKind`. So `structFromLyrics()` maps those
  kinds → `SECTION_TYPES` (`kindToStructType`: refrain→chorus, instrumental→solo) and builds
  `project.structure` in document order — using the sections' synced beats when present (bars from the
  gaps), else laying them out sequentially with default lengths.
- **Auto:** `lyrParse` calls `structFromLyrics({auto:true})` — it populates only when the structure is
  empty, so it never clobbers a hand-built one. **Manual:** a "↑ from lyrics" button in the structure
  summary re-infers on demand. Lyrics are now the natural source of truth for structure, with `↓ to
  lyrics` as the reverse. Verified: a 9-section sheet auto-built Intro/Verse 1/Chorus 1/…/Solo/Bridge/
  Chorus 3/Outro with correct types + numbering.

## 57. Timeline header sizing + key-head + delete button (v1.27.1)
- Timeline-header controls were mismatched heights (inputs/iconbtns taller than selects/transport/zoom).
  Both header rows got a `.tl-controls` class that forces every input/select/button to 32 px (box-sizing
  border-box, inline-flex centering) — one consistent row.
- The key-lane head's "＋ key" button was clipping: `.tl-head` got `overflow:hidden` in #52, and the
  key-head stacked badge+title+button vertically past its 34 px. Fixed by laying the key-head out as a
  ROW (`flex-direction:row`, `overflow:visible`) so the title + button sit side by side and fit.
- The per-layer **Delete** button is now a plain red `.thd-btn.danger` reading "Delete" in white (no
  trash icon) — same `.thd-btn` size as the FX button (both 21 px), per request.

## 56. Per-region key/mode INSIDE the MIDI clip + pinch-zoom (v1.27)
- A MIDI clip can now span multiple key/mode regions (verse in one key, chorus in another) so a single
  loopable sequence carries real harmonic motion — instead of one key per clip + copy/paste.
  `keySegmentsInClip(clipB0, lenB)` returns the distinct spans (in local clip beats) from the timeline
  key map. `renderMidiRoll` shades each segment's in-key rows over its own x-range and draws a `.mr-keydiv`
  at each change; the gutter only colours when there's a single segment.
- **A labeled, clickable key ruler** (`#midiKeyRuler`, `renderMidiKeyRuler`) pins to the top of the grid
  (CSS sticky) and scrolls horizontally with it; each span opens the existing `keyPopup` to change its
  key (`midiRegionForSeg` resolves the segment → the covering key-map region / default). A **✚ Key change**
  button (`midiAddKeyChange`) inserts a region at the playhead/clip-middle bar. It's the SAME
  `project.keyMap` as the main timeline — set it here or there.
- **Enforcement is per-beat:** `midiSnapPitch(midi, localBeat)` snaps to the key in force at that note's
  own beat (`scaleSetAtLocalBeat`), so the verse and chorus each enforce their own scale. The audition
  keyboard + scale-lock follow the region under the playhead (in `midiStartPlay`'s loop).
- **Pinch / ⌃-scroll zoom** on the roll (`midiZoom` mutates `MR.BEAT_PX`; trackpad pinch = ctrl+wheel,
  Safari-compatible) plus −/+ buttons. There was no zoom before.

## 55. Per-layer synth voice — each MIDI layer is its own instrument (v1.26)
- The synth voice (oscillators/filter/envelope/glide) used to be one global object. Now: `GLOBAL_VOICE`
  is the song default + live-keyboard tone, and `synthParams` is a POINTER reassigned to a layer's own
  voice while its editor is open (then restored). `cloneVoice()` deep-copies a voice.
- **MIDI tracks get `track.synth`** (cloned from `GLOBAL_VOICE` at `addTrack`, serialized per track).
  Arp tracks stay on the global voice (designed in the synth modal) — extending arps to per-layer voice
  is the documented follow-up.
- **Scheduled/offline playback passes each track's voice explicitly** (`spawnOscs`/`createFilter`/
  `playNoteAt` gained a `voice` param) since many layers sound at once — it never relies on the pointer.
  The live keyboard + audition use the pointer (= the open layer's voice).
- **Editing reuses the whole synth UI.** Opening the MIDI editor points `synthParams` at the track's
  voice and *relocates the Filter&Envelope + Oscillators folds* into the editor's "Instrument voice"
  section (`midiVoiceToModal`/`midiVoiceRestore`), exactly like the keyboard relocation. The folds' home
  is the synth modal; mutual exclusion keeps only one editor open. Verified: editing one MIDI layer's
  cutoff/filter doesn't touch the global or another layer, and it round-trips through save/load.

## 54. MIDI editor toolbar polish + per-layer FX access (v1.25.1)
- `.midi-toolbar` gives every control (selects + `.mini` buttons) a uniform 30 px height with inline
  field labels (`.midi-tl-field`) so it reads as one tidy row instead of mismatched sizes.
- **Bars is now a preset dropdown** (`populateMidiBars`): common counts (2/4/8/12/16/24/32) plus
  **"· whole song"** (the project's bar count), with the clip's current length always selectable —
  anchored to real musical lengths instead of an arbitrary number field.
- **🎛 FX button in the MIDI editor** → `openFxModal(midiEd.track)`; `#fxModal` z-index raised to 200 so
  it stacks above the full-screen editor. Per-layer FX (phaser/chorus/delay/reverb/drive/comp/level)
  already existed per track — this just surfaces it from the editor. The deeper ask (per-layer *synth
  voice* — oscillators/filter/envelope, currently global) is the proposed next step.

## 53. The song's key palette is now first-class in the editors — info, hint, constraint, enforcement (v1.25)
- **Information + hinting:** `timelineKeys()` returns the distinct (root,mode) pairs actually used across
  the timeline (default region + every key-map change, with the bar each appears at). `renderKeyChips`
  shows them as a "SONG KEYS" chip row in BOTH editors; the clip's current key is highlighted (`.on`),
  and `clipKeySpan()` flags the chips whose regions the clip overlaps (`.covers`). So you can see — and
  one-click apply — the keys your song uses, instead of hunting through a blank 12×7 dropdown.
- **Constraint / quick-pick:** clicking a chip calls `midiApplyKey`/`synthApplyKey`, which drives the
  existing selectors and writes back to the covering timeline region.
- **Enforcement (toggleable):** a `🎵 In-key only` toolbar button in the MIDI editor (synced with the
  keyboard's scale-lock `kbScaleLock` via `syncInKeyBtns`). When on, `midiSnapPitch`/`nearestInScale`
  snap newly-added and dragged notes to the current scale; toggle to `🎹 All keys` for chromatic freedom.
- WHY: the user (rightly) noted the timeline's configured keys/modes were *completely* absent from the
  editors — not as info, hint, constraint, or enforcement. Now they're all four.

## 51. Editor key/mode selectors — timeline-derived, write back to the key map (v1.24)
- **Both editors now have real Key + Mode selectors in the header, and they are NOT a detached global.**
  MIDI editor: `#midiKeyRoot`/`#midiKeyMode` initialise from `keyAtBeat(clipStartBeat)` (the timeline
  region the clip sits in). Changing them runs `midiEditorSetKey`, which edits **the timeline region
  covering the clip** (`keyMapSorted` → last region with `beat<=pos`), or the base/default key
  (`rootSel`/`modeSel`) if the clip is in the default region — so the change shows on the timeline and
  persists. `renderMidiRoll` keeps the selectors in sync with `currentScaleSet()`, and `midiKeyChangeNote`
  flags when a clip spans key changes (shading uses the clip start). Mood is shown next to it.
- **Synth modal** gets `#synthKeyRoot`/`#synthKeyMode` ("Base key") wired to the song's default region
  (`rootSel`/`modeSel`) — the synth keyboard isn't at a timeline position, so the base key is its
  reference; during playback it still follows regions via `keyFollowTick`. `syncSynthKeySel` refreshes
  on open.
- WHY: the user (correctly) flagged that the editors showed a fixed key with no way to change it. The
  app already routed `activeKeyOverride = keyAtBeat(clipStart)`, but with no selector and no write-back it
  *felt* global. Now picking a mode is a first-class, timeline-aware action in the editor.

## 50. Pattern library — genre progressions/arps, in-key, in the MIDI editor (v1.23)
- **We generate the patterns ourselves, not from a public MIDI repo.** Chord progressions/scales aren't
  copyrightable, so `PATTERN_LIB` stores each as interval data (`[semitoneOffsetFromKeyRoot, quality]`
  per bar) — no external files, no licensing/trademark exposure (matches the no-artist-names rule), and
  it's tiny. `renderPattern(pat, keyRoot, bpb)` renders it into MIDI notes **in the current key** (block
  chords or eighth-note arp), so it always lands in tune. A few genres × a few progressions each (Pop,
  Hip-hop/Lo-fi, House/EDM, Rock, Jazz, Blues incl. a 12-bar). `CHORD_QUAL` maps qualities to intervals.
- **UX: a 📚 Patterns panel inside the MIDI editor** (`#midiLib`, overlay on the box, not the scroll
  wrapper). Genre select **defaults to the song's `meta.genre`**; each row has ▶ preview (plays via
  `playNoteAt` in the clip's key) and ＋ add (`midiLibAdd` inserts after the last note and grows the
  clip). This is the "Logic loops"-style plop-it-in-then-tweak flow the user wanted, and it leans on the
  song-genre metadata + the key/mode engine from the previous releases. Pure builders are test-listed.
- FUTURE: the arp section could get the same panel; more genres/progressions are just data additions.

## 49. Both instrument keyboards become visualizer sections + full-screen editors (v1.22)
- **Synth — keys is now a visualizer + Edit button.** At init `relocateSynth()` moves `#synthControls`
  (keyboard, arp, filter, oscillators) into `#synthModal` (a `.fs-box` full-screen modal). The SECTION
  keeps the oscilloscope + `#synthLayerViz` (a mini piano-roll preview of the arp layers) + the
  "Open Synth Keys" button. `openSynthModal`/`closeSynthModal` show/hide it and lock body scroll.
- **New MIDI — keys section** (`data-key="midikeys"`, in `DEFAULT_ORDER` after `synthkeys`): `#midiLayerViz`
  previews every MIDI clip (clickable → opens it) plus "＋ New MIDI layer" / "✎ Edit" buttons. The MIDI
  editor was already a full-screen modal.
- **One keyboard, never two listening.** The single `.kbd-row` lives in the synth modal; the MIDI editor
  borrows it (`midiKbToModal`) and the two modals are mutually exclusive (`openMidiEditor`→`closeSynthModal`).
  This is the architecture the user asked for twice: sections show layer visualizers, editing happens in
  a full-screen modal, and you can't have two keyboards competing for input.
- `renderInstViz(containerId,type)` draws the per-layer mini piano-roll (arp steps or MIDI notes as dots),
  refreshed from `renderTimeline` via `renderInstVizAll`. Each row has a 🗑 delete button (v1.23.1) so
  layers can be removed from the section, not only the timeline (same confirm + filter as the timeline's).
- **`applySectionLayout` now slots an unknown (newly-shipped) section into its `DEFAULT_ORDER` position**
  — right after its nearest known predecessor — instead of dumping it at the very end, so upgrading users
  see MIDI — keys land right under Synth — keys.

## 48. Theory-aware key/mode suggestions + song metadata header (v1.21)
- **`keySuggestions(fromRoot, fromMode)`** proposes smooth changes grounded in theory, ranked
  smoothest-first: **pivots** (the other modes that share the same 7 notes — relative major/minor
  surfaces first, then Dorian/Phrygian/Lydian/Mixolydian — `changed:0`), **circle-of-fifths** neighbours
  (±a 5th, same mode, one accidental), and **parallel modes** (same tonic, recoloured, with a
  brighter/darker hint from `MODE_BRIGHTNESS`). The key popup renders these as click-to-apply chips with
  a plain-language "why" + the mode's mood — the "from" key is the region *before* this one
  (`keyPopupFrom`), so it reads like "smooth changes from C major." Helpers `scalePCs`/`pcSetsEqual`/
  `pcOverlap` are pure and test-listed. This exists because the user (and most musicians) don't have the
  circle of fifths / modes memorised.
- **Song metadata in the header.** `project.meta` already held title/genre/etc.; added `take`. The
  header is now a button showing `songDisplayName()` = "Title — Genre · Take N" (was a bare session
  label, which the user found meaningless), opening a small editor (title / genre w/ datalist / take).
  `take` flows into `songMetadataJson` (export). Kept a hidden `#sessionLabel` so `setCurrentLabel` and
  the save system keep working. FUTURE: genre will seed common-progression suggestions.

## 47. MIDI editor — timeline key-awareness, moods, true full-screen (v1.20.1)
- **The editor now honors the key/mode the clip sits under on the timeline, not just the global
  default.** `openMidiEditor` sets `activeKeyOverride = keyAtBeat(clipStartBeat)` (restored on close),
  which `currentScaleSet()` already reads — so the grid shading, the keyboard's in-key highlight AND
  its scale-lock muting all follow the bar's key at once. Verified: a clip under a D-Dorian region
  shades D roots and tags "D Dorian" while global is C major.
- **`.kbd-foot` moves into the modal too** (not just `.kbd-row`), so the In-key/All-keys toggle + live
  key readout are available; the arp-transpose seg is hidden in-modal via `.midi-kb-host .kbd-mode`.
- **Mode → mood/genre map (`MODE_MOOD`)** surfaced as a "Feel / genres" readout next to the mode
  selector and appended to the editor key tag — musicians who don't think in modes get the feeling.
- **True full-screen:** `.midi-box` fills 100vw×100vh (radius 0) and `body.modal-locked` hides the page
  scrollbar behind it.
- **Removed the duplicate top Velocity input** — the Velocity *controller lane* is the real editor;
  new notes just start at 100. Bars/Snap share `input.midi-in` width (uniform). NOTE: the larger
  restructuring the user wants next — both keyboards as modal-launched editors with the section showing
  a layer *visualizer*, a MIDI-keys section, and a key ruler showing the full timeline inside the editor
  — is deferred pending alignment on the "timeline = the song; clips are key-aware spans; looping is a
  clip property, not the core model" concept.

## 46. MIDI editor v2 — full-screen, real keyboard, key-aware, control lanes (v1.20)
- **The editor reuses the ONE synth keyboard instead of drawing a second one.** Opening relocates the
  live `.kbd-row` DOM node into `#midiKbHost` (`midiKbToModal`/`midiKbRestore`, marker comment for the
  home slot) and forces `setKbMode("play")`; closing moves it back. Same `keyEls`, QWERTY map, ±4
  octave switch, in-key box and (critically) the same single input listener — so there is never a
  two-keyboard input conflict. This is why we did NOT need to modal-ize the synth keyboard or build
  layer visualizers (the user floated that; the full-screen modal already makes only one keyboard live).
- **No vertical piano.** The gutter is now note-name labels per row (`.mr-glabel`, like the pitch-map),
  and rows are shaded by the current key/mode via `currentScaleSet()` (`.mr-row.inkey/.root`), with the
  key name in the header (`#midiKeyTag`). Row height 12→14 for label legibility.
- **Input coordination:** the editor's keydown is on `document`, which bubbles BEFORE the synth's
  `window` handlers. It `stopPropagation()`s only the keys it owns (Esc, Space, ⌘A, Del, and arrows
  *when notes are selected*); letters and unselected ↑/↓ fall through so QWERTY still plays/records and
  ↑/↓ still shifts the keyboard octave. Don't move this handler to `window` or the coordination breaks.
- **Control lanes** (`MIDI_CTRLS`, collapsible `#midiCtrlBox`): Velocity (per-note bars, drives the
  synth), plus Pitch Bend / Modulation / Expression / Sustain as point automation (`clip.cc`, SVG
  polyline + draggable handles; sustain renders stepped; bend has a center line). Persisted in
  serialize/load. **MIDI export carries them**: `buildMidi` now writes per-note velocity, `0xB0` CCs
  (1/11/64) and `0xE0` pitch-bend. HONEST: our synth only renders velocity; bend/CC are edit + store +
  `.mid` export so they reach real tools. Signal's lane code is not drop-in compatible — this is ours.

## 45. Arpeggiator folded into Synth — keys; clearer collapse affordance (v1.19.1)
- **Arp is now a `synth-fold` inside the `synthkeys` panel** (above Filter & envelope), not a
  standalone `.csec` — removed from `DEFAULT_ORDER`. `applySectionLayout` already guards missing
  keys, so old saved layouts that list `"arp"` are harmless. All arp ids (`rateSel`, `seq`, `trMinus`…)
  were preserved so the existing wiring keeps working.
- **Collapse affordance:** the fold `<summary>` markers changed from a bullet/caret to a **+/− box**
  (`::before` = `–` open, `+` closed) — users couldn't tell the bullet sections were collapsible.
- **Transpose buttons are musical now:** `−8ve −W −½ / +½ +W +8ve` (added the whole-step ±2; relabelled
  the half-step ±1 and octave ±12) instead of the opaque `−12 −1 +1 +12`.
- **Arp sequence is bar-aware:** `renderSequence` lays steps as a grid padded out to whole bars, marks
  each bar start with an accent left-border, and `arpBarsOut` reads e.g. "2 bars · 11/16 steps".
  `arpStepsPerBar()` = `beatsPerBar() × rate`; re-renders on rate change. Empty trailing slots are
  click-to-fill-with-rests so you can space notes to fill the bar.

## 44. MIDI piano-roll layer + editor (v1.19)
- **New `midi` track type** holding clips with `notes:[{midi,beat,dur,vel}]` (beat/dur in beats).
  Integrated at every existing seam rather than a parallel system: `addTrack` name map, `patternSec`
  (loop length = `lengthBeats`), `forEachClipEvent` emits `kind:"note"` events — which the live
  scheduler, offline `renderMix`, and `buildMidi` export **already** handle (arp uses the same kind),
  so MIDI layers play, bounce, and export to .mid for free. `serializeProject`/`loadProject` round-trip
  `notes` (additive — no FORMAT_VERSION bump). Timeline clip shows the note count + double-click opens
  the editor; `＋🎼` button adds a layer and opens it on an empty 2-bar clip.
- **The editor** (`#midiModal`, `renderMidiRoll`): a DOM piano roll, pitch rows 36–96 × beats, notes as
  positioned divs. Click-empty adds, drag-body moves, right-edge resizes, drag-empty marquee-selects;
  ↑↓ transpose (⇧ = octave), ←→ nudge by snap, Del removes, ⌘/Ctrl-A selects all, gutter-click
  auditions a pitch. Snap (1/4…1/8T/off), per-note **velocity** lane (drag bars), Quantize, Clear.
- **Audition + record share one local transport** (`midiStartPlay`/`midiSchedWindow`): a 0.25 s
  look-ahead loop scheduler over `playNoteAt`, looping at `lengthBeats`. Recording arms `midiRec`, a
  hook fired from `playNote`/`stopNote` (+`recVelHint` carries hardware velocity through `midiNoteOn`),
  so live QWERTY / on-screen / **hardware-MIDI** notes land on the grid at the playhead beat (snapped),
  note-off setting duration. This keeps our keyboard as the input surface (Signal's editor, our input).
- SCOPE LANDED THIS ROUND: full editor + record + multi-select/transform + velocity. Pitch-bend / mod /
  CC / sustain-pedal capture lanes are the documented next layer (the hook + lane plumbing is in place).

## 43. Timeline header cleanup, instrument tuner, per-layer polymeter, collapsible synth (v1.18)
- **Collapsible synth sub-sections:** the oscilloscope, filter/envelope, and oscillators are now
  `<details class="synth-fold">` (oscillators collapsed by default) so they stop dominating the
  keyboard area; open state persists in localStorage (`ps_fold_*`). Hiding the scope is safe —
  `drawSynthEq` already bails when the canvas has zero size.
- **Header layout:** the BPM/time-sig/length/count-in fields share one width via `input.tl-in,
  select.tl-in {width:96px}` (the class needed an element-qualified selector to beat the base
  `input[type=number]{width:92px}` rule). Play/Loop/Count-in are centered (spacers either side of a
  `.tl-transport` group), Zoom moved to the right end of the second (track-button) row next to the
  timeline, and the unhelpful "Cycle region" readout was removed (the `#loopReadout` element stays
  hidden so `renderTimeline` keeps working).
- **Instrument tuner** (`#tunerModal`, opened from 🎸 Tuner in the detector): `TUNINGS` table for
  guitar/bass/mandolin/ukulele/guitalele in common tunings; clicking a string plays a reference via
  `playNoteAt` (bypasses the in-key filter so out-of-key strings still sound). Pair with the mic
  detector to tune.
- **Per-layer polymeter:** a track can declare its own `meter` (`trackMeter`/`trackBeatSec`) — drums
  in 3/4 over a 4/4 guitar, à la Led Zeppelin. The lane draws bar/beat guides at the layer's meter
  with a brighter bar line, plus a header badge + a `.trk-meter` selector; persisted in serialize/
  load. SCOPE: this **showcases and sets** the layer meter (visual guide for composing polymetrically
  + where the cadences reconverge at the LCM) — the scheduler still plays each clip's programmed
  pattern; meter-driven playback divergence is a deeper follow-up.

## 42. Bar-centric timeline (compose in bars, not seconds) (v1.17)
Musicians think in bars, not seconds, so the Length control is now **LENGTH (BARS)**: `projectBars()`
= round(lengthSec / barSec()), `setLengthBars(n)` = setLength(n·barSec). `setLength` shows bars in the
field; `loadProject` too. Crucially, **changing tempo or meter preserves the bar count** (the bpm and
time-sig handlers capture `projectBars()`, then `setLength(bars·barSec())` after) — seconds are derived,
bars are canonical. **Fit to bars** was rebuilt: instead of spreading lines across a fixed seconds-
length (the v1.16 weighted version, now superseded), it lays **one bar per line on the downbeat** and
**recalibrates the song length to the line count** (`setLengthBars(lines.length)`). Pasting a multi-line
sheet (`paste` event with ≥2 newlines) auto-runs it, so a pasted sheet resizes the song to the bars it
needs instead of being mashed into a fixed duration.

## 41. AI lyrics: generation wizard + mulligan rewriter (v1.17)
Two BYO-key (OpenRouter/Gemini) lyric features on a shared generic call.
- **`aiComplete(cfg, system, user, opts)`** — generic chat-completion; `aiChat` (project editor) now
  delegates to it, and the lyric features use it with their own system prompts.
- **Generation wizard** (`#lyrWizModal`): a structured config — theme, style refs (artists/songs/
  genres → *inferred* descriptors, names never echoed), genre, singers, bpm/key/mode, verses,
  couplets per verse/chorus, chorus hook-repeat interval, intro/outro/bridge(+placement), poetic
  form, rhyme scheme, syllables/line, allow-duplicate-rhymes. `buildLyricsWizPrompt` (DOM-free,
  tested) + `LYR_WIZ_SYSTEM` pin the OUTPUT to Pitch Studio's bracket DSL, so the reply parses
  straight back (singers, `[Key:]/[Mode:]/[Tempo:]` directives apply, sections, `(bg)`).
- **Mulligan** (`#lyrMullModal`): select lines in the editor → send the selection + full sheet +
  optional comments → `buildMulliganPrompt` asks for 6 JSON variations → `parseAiVariations`
  (handles `{variations:[…]}`, bare arrays, and numbered lists) → render 6 editable cards; "Use #n"
  splices the (possibly-edited) text back over the original selection; the generate button becomes
  "↻ Reprompt". The selection is read from the textarea's `selectionStart/End` at click time.

## 40. "Fit to bars" + lyric directive parsing (v1.16)
- **Fit to bars** (`lyrAutoDistribute`): spreads every lyric line across the song's bars, weighted
  by word count (longer lines get more time, like sung phrasing), overriding existing per-line
  timing. The one-click way to lay a pasted/imported sheet onto the timeline before fine-tuning with
  drag / tap-sync. The cumulative formula keeps the last line strictly inside the song length.
- **Lyric directive parsing.** `[Key: C#]`, `[Musical Mode: Dorian]` / `[Mode: …]`, `[Tempo: 96]` /
  `[BPM:]`, `[Time Sig: 4/4]` at the top of a sheet were being mis-parsed as *singers* (the colon-
  before-" - " rule caught them) — they showed up in the SINGERS list. Now a directive regex runs
  first and routes them to `doc.meta`; `applyLyricMeta` sets the project's global key/mode, tempo,
  and meter (idempotent). Section headers also accept `Key A#` (space, no colon), not just `key: …`.

## 39. The REAL Safari sampler-blob bug: decode detaches the Blob's buffer (v1.15.3)
v1.11.1 switched the sampler to store a plain `Blob` copy (not the `File`) — but pads still came
back silent in Safari with `WebKitBlobResource error 1`. Root cause was subtler: the load did
`blob = new Blob([ab]); decodeAudioData(ab)`, and **`decodeAudioData` detaches its input
ArrayBuffer**. Chrome's `Blob` copies the bytes eagerly so it survives; **Safari's `Blob` keeps
referencing `ab`**, so detaching it left the stored Blob backed by dead memory — unreadable from
IndexedDB on reload. Fix: decode from a copy — `decodeAudioData(ab.slice(0))` — so `ab` (and the
Blob built from it) stay intact. Verified: post-decode the source buffer stays `byteLength`-intact
and the Blob re-decodes on the reload path. NB: pads loaded *before* this fix are already corrupt in
their saved/autosaved sessions — they must be re-loaded once.

## 38. Key/mode popup gets an explicit Save button (v1.15.2)
The little key/mode editor applied live on dropdown `change` and only dismissed via a finicky
outside-click — users couldn't tell it had committed. Added a primary **✓ Save** button (applies +
closes) alongside a relabelled **🗑 Delete**, plus Esc-to-close. Live-apply stays for preview; Save
is the clean commit/close.

## 37. Key-edge drag fix + Settings save-on-close (v1.15.1)
- **Edge-drag was dead on arrival:** `attachKeyEdgeDrag` captured `const block=edge.parentElement`
  at attach time, but the edge is wired *before* `block.appendChild(edge)`, so `block` was `null`
  and the first `pointerdown` threw. Resolve `block` lazily inside `pointerdown` (the edge is in the
  DOM by then).
- **Settings now persist on close.** `closeSettings()` commits the field values (`aiSaveCfg`) before
  hiding — closing via ✕ or click-outside no longer silently discards edits. The explicit Save / Test
  buttons remain.

## 36. Key/mode lane → proportional region blocks (v1.15)
The first cut drew the key map as small text-sized chips at a point plus faint background bands —
which read nothing like the rest of the timeline (where clips fill their span) and made the default
key a locked, non-clickable "start" tag. Rebuilt so the lane is **full-width region blocks like
clips**: an ordered `[{default}, …keyMapSorted()]`, each block spanning from its beat to the next
change (the default fills 0→first change, the last fills →timeline end) — no gaps, sized by space
not by text. The **default block is clickable** and edits the song's *global* starting key
(`rootSel`/`modeSel`) via the same popup with Delete hidden (`reg.isDefault`). Adding a change has
three affordances: a **＋ key** button in the lane head, **right-click** the lane (`contextmenu`),
or drag a block's **left edge** (`.kr-edge`). The edge drag live-resizes the block and its left
neighbour without a full re-render (a full render mid-drag would destroy the element and drop the
pointer capture), rendering once on release.

## 35. File menu bar, real session lifecycle, key/mode relocation, zoom perf (v1.15)
- **Sticky File menu bar** replaces the old `.topbar`: brand + a **File** dropdown (New · Open… ·
  Save ⌘S · Save As… · Export ▸ MIDI/WAV/Stems/Song/Import · Recent) + the current session name +
  ⚙ Settings. Save/Open/Export were pulled out of the timeline toolbar (where they were "sprinkled
  at the end"). The export status used to flash on `exportBtn`; that toolbar button is gone, so the
  `exportBtn` variable now points at `fileMenuBtn` — one rename instead of touching 8 call sites.
- **Real session lifecycle.** Added `currentSessionId`; `saveSession(…, id)` now `put`s (overwrite)
  when an id is given, `add`s (new) otherwise. **Save** (⌘S) overwrites the loaded file, **Save As**
  creates a new one, **New** blanks the project (a blank-ified `serializeProject` through the tested
  `loadProject` path), **Open…** is the existing manager modal, **Recent** lists the last 6. The
  loaded id rides in the autosave record so ⌘S still overwrites the right file after a reload. The
  old workflow (one button that only ever created a new save) is gone.
- **Key/mode is no longer a global section.** Removed the standalone "Sound & key" panel; `rootSel`/
  `modeSel`/`micBtn` now live at the top of the **Pitch detector** (same ids, so every reference
  keeps working) — the detector's reference scale *is* the song's default key (beat-0 of the key
  map). The timeline **Key / mode lane** moved to the **top**, right under the bars·beats ruler, so
  per-section key changes are set where you read the time.
- **Pinch-zoom perf.** `setTimelineZoom` updated `PX_PER_SEC` and called the full `renderTimeline`
  on every wheel/pinch event — fine on a blank project, a crawl with clips. Now it coalesces the
  re-render to one `requestAnimationFrame`, capturing the anchor second on the frame's first event.

## 34. MIDI interop, scouted from ryohey/signal (v1.14)
We looked at signal (MIT browser MIDI sequencer) for ideas. Its niche (MIDI piano-roll, SoundFont
sounds, Firebase cloud) is different from ours; the two genuinely adoptable, constraint-friendly
ideas were Web MIDI input and MIDI file import.
- **Web MIDI input** (`initWebMIDI` → `navigator.requestMIDIAccess({sysex:false})`): a hardware
  keyboard/controller plays the synth. `onMidiMessage` maps note-on/off → `midiNoteOn/Off` (which
  reuse `playNote/stopNote` + key highlight + record), and CC 123 = all-notes-off. Held MIDI notes
  go in `heldKeys` under a `"midi:NN"` key so they never collide with PC-keyboard chars — and
  `reKeyHeldNotes` now skips entries whose char isn't in `KEY_MAP` (the octave switch must not
  re-pitch absolute hardware notes). Hot-plug via `onstatechange`; a `#midiStatus` chip shows the
  device. No deps — pure browser API.
- **MIDI file import** (`parseMidiFile`, DOM-free + tested): a Standard MIDI File parser (MThd/MTrk,
  VLQ, running status, tempo/timesig/name meta, note on/off, skips CC/sysex). `importMidiToProject`
  sets tempo+meter+length and turns each melodic track (channel 9 / drums skipped) into a 16th-note-
  quantized **monophonic arp** track (rate 4; highest note wins per step). Gotcha fixed: a note that
  starts at tick 0 stored `0`, which a truthy `if(o)` dropped — the open-note table must null-check.
- **SoundFonts / cloud-save: deliberately NOT adopted.** SoundFonts are the dry-GM sound we moved
  past (our synth+FX is the better answer); cloud/share belongs to the future backend/pro tier.
- **Tempo/meter map: deferred as a real project, not faked.** A correct per-section tempo/meter map
  needs piecewise beat↔second integration threaded through the scheduler, rendering, lyrics timing
  and the key map — a wide, risky refactor. A "documented-only" lane that doesn't actually ramp
  playback (and would desync MIDI export) would mislead, so we left it for a dedicated effort.

## 33. Key/mode map: make it visible, playable, exportable, typeable (v1.14)
The map (#32 data model) was internal-only; these four close that.
- **Keyboard follows the region (teaching payoff).** `activeKeyOverride` (set during playback by
  `keyFollowTick(pos)` = `keyAtBeat(pos/secPerBeat)`) makes `currentScaleSet()` return the region's
  key without touching `rootSel/modeSel`. So the in-key highlight, the in-key-only filter, AND the
  pitch-roll's in-scale rows all shift at the chorus. A `Key: <X>` readout (`#kbKeyNow`) by the
  keyboard turns accent-colored while a region is active; `keyFollowReset()` on Stop restores the
  global key. No-op when `keyMap` is empty.
- **Colored region bands on the timeline lane** (`.key-band`, tinted by `MODE_COLORS`) — only drawn
  when there are changes, so a single-key song stays neutral.
- **Carried into the Vozart copy.** Per-section key tag in the Lyrics field (`[Chorus] (key: A minor)`)
  shown only when the section's key differs from home; plus a `key …, key change bar X: …` suffix on
  the Style field. Generators have no key input so this is a best-effort hint, but lossless.
- **Inline `[Section - key: A minor]`** parses to `section.key` (`parseKeyName` → {root,mode}; DOM-free,
  tested). The singer-def vs section test is now "does the colon precede the first ` - `?" — a singer's
  style can contain ` - ` (e.g. `[Rapper B: E2–E4 - drawl - bass]`), so the old "has ` - `" heuristic was
  wrong. On sync, `keysFromLyrics()` mirrors a section's key onto the timeline `keyMap` (additive +
  idempotent: updates a region within 0.5 beat, never deletes). Caveat: a typed key re-asserts on the
  next parse, so deleting its timeline region won't stick while the `[key:]` tag is in the lyrics.

## 31. UI: modal fills, resizable track column, PC-keyboard octave switch (v1.13.1)
- Pitch-map modal: `#pitchModal .modal-box` is a flex column and the piano-roll
  (`.proll-wrap`) is `flex:1; min-height:0; overflow:auto` so it fills the tall modal and
  scrolls internally (the `min-height:0` is the load-bearing flexbox fix — without it the
  scroll child won't shrink to fill).
- Timeline track-name column is resizable: width is `var(--tlhead-w)` driven by a drag
  handle (`#tlHeadResize`), persisted in localStorage; names get `nowrap` + ellipsis.
- Computer-keyboard octave switch (Reface-YC-style vertical control, `kbOctave` −4..+4 = 9
  stops, persisted): shifts which octave the `a s d f …` keys play. The range is exactly what
  sweeps the fixed 17-note window (C4–E5) across **all 88 keys** and no further: A0 falls inside
  the window at −4, C8 at +4; ±5 would land the whole window off the board (silent). `setKbOctave`
  also `centerKeyboard()`s the scroll on the window's centre so the mapped keys (and the box)
  scroll into view when you shift — without it the bottom keys A0/A#0/B0 felt "unreachable"
  because the keyboard didn't follow the range. Each octave
  is 12 keys, so the 88-key piano is ~7⅓ octaves — the "8 notes per octave" is the diatonic
  white-key count, not the key count. The violet box still pins a sliver to the nearest edge
  (`.offscreen`) as a safety net if the window ever runs fully past the keys. `heldKeys` is a Map of
  char→sounding-midi; on an octave switch `reKeyHeldNotes()` re-pitches every held note to
  the new range (stop old midi → play new midi, glide carries the slide if set) — like an
  organ/Reface-YC octave switch. The Map also guarantees release stops the *sounding* midi,
  so a mid-hold shift never strands a note.
- **Range is shown as a bounding box, not per-key marks (v1.14).** The first cut recolored
  each mapped key (cyan underline) and wrote the QWERTY letter on it — both were a mistake:
  the cyan clashed with the in-key/root highlights, and non-musical letters on keys where you
  read note names is counter-intuitive (user feedback). Replaced with a single **violet**
  `.kb-range-box` overlay (positioned from the min/max `offsetLeft` of the mapped keys) so it
  never reads as a scale highlight; keys keep their note names. `↑/↓` arrows shift the range
  in Play-notes mode (in Transpose-arp mode arrows still nudge the arp). NB: the box has a CSS
  transition, so reading `offsetLeft` right after a shift returns the mid-animation value —
  read `style.left` (the target) when you need the destination synchronously.

## 30. Lyrics timing is line-level bar·beat, placed on a timeline lane (v1.13)
Timing moved from per-word seconds to **per-LINE musical position** (`ln.beat` = beats
from song start; null = unsynced). Rationale: word-level is overkill for karaoke (LRC is
line-based), error-prone, hostile to AI, and would wreck the timeline lane; line-level
matches reality. Storing **beats** (not seconds) makes it tempo-independent — exporters
take `secPerBeat` and convert at export time, so a tempo change keeps everything aligned.
A persistent, undeletable **Lyrics lane** sits at the bottom of the timeline
(`renderLyricsLane`): one draggable chip per line at its beat position, drag-to-retime with
an optional **snap-to-beat**; the playhead highlights the current line in both the lane and
the karaoke sheet (hover a line to see its bar·beat). Sync paths (From-memo, Tap-sync) now
stamp **lines**, persisted as `lineBeats[]`. AI export offers no-timing or inline
`[bar.beat]`; word-level "enhanced LRC" was dropped. **Init-order gotcha:** the lyrics
module's startup `lyrParse()` must NOT call `renderTimeline()` before the timeline's deps
(`trOut` et al., declared later) exist — gated behind `lyrTimelineReady`.

## 29. Lyrics: own the granular backbone, distill outward (v1.12)
No existing format carries **time + musical notation + AI hints** at once, so the
backbone is ours: a document of singers → sections → lines → word tokens, each
token holding optional pitch (MIDI) and time (seconds). Humans author it in a
readable bracket/paren DSL (the Suno/Udio/Vozart convention: `[Singer: C2–G5 style]`,
`[Verse - Singer]`, `[B2]word`, `(background)`, `[guitar solo]`); **time is never
typed** — it's added by sync. `parseLyricsDSL` builds the model (DOM-free, tested);
exporters distill to plain, round-trip DSL/AI-prompt, LRC, word-level "enhanced"
LRC, SRT, and **Apple-Music TTML** (singers → `ttm:agent`, parens → `ttm:role=x-bg`).
TTML is the backbone-of-record because it's the only *standard* that already models
multi-singer + background. Parser gotchas baked into tests: split section attrs only
on " - " (keep "Pre-chorus" intact), and test pre-chorus before chorus.

Sync (the Lyrics editor section): **auto-align** to a memo's Whisper word timings by
greedy text match (never falls through — a partial transcript syncs only its part),
plus **tap-sync** (play + Space per word) and a **Follow** mode that karaoke-highlights
the current word off the transport playhead. Times persist as an index-keyed overlay
so light edits keep their sync. The doc feeds the song-package zip (TTML / word-sync
LRC / AI-prompt) and the AI composer's project summary.

## 28. Live record + omnichord keyboard + standing scope tweaks (v1.11)
Live record auto-starts the section playhead and records to the step that *just*
played (so the tap doesn't double with the playhead). The synth keyboard has an
"In-key only" toggle (default on) that mutes out-of-mode keys — drag across the keys
and stay in tune. Synth value readouts became centered number inputs.

## 27. Editable value readouts (v1.10)
Synth filter/envelope and oscillator values are now `<input type=number>` boxes
bound two-way to their sliders via `bindKnob` (drag → box updates; type+Enter →
slider moves; both clamp to the slider's min/max). Replaces the old read-only
`<span>` readouts so values can be dialed in precisely.

## 30. Per-clip editors, arp roll, key-aware backing (v1.52.0)
A large editing/UX batch. The load-bearing, "don't undo this" choices:

- **Editors relocate, they don't duplicate.** Double-clicking a beat/sampler
  clip opens a full-screen modal that *borrows* the existing section's
  `.sec-body` (and restores it on close); the MIDI editor likewise borrows the
  shared keyboard (`.kbd-row`/`.kbd-foot`) and the Filter/Osc folds. There is
  exactly ONE of each surface — never two keyboards listening at once.
  `midiVoiceRestore` returns the folds *inside* `#synthControls` before the
  keyboard (which now lives at the bottom, matching the MIDI editor); restore
  order in `closeMidiEditor` is keyboard-then-voice for that reason.
- **Arp timing is summed, not uniform.** Each step has an optional `rate`
  (per-step subdivision) and `ratchet` (retriggers within its slot), so pattern
  length is the SUM of slots. `patternSec`, the live scheduler, the in-clip
  preview, and the in-editor preview all use `arpStepQ`/`arpPatternQ`/
  `arpStepStartsQ`. Step fields round-trip free via spread — no FORMAT_VERSION
  bump.
- **Scale tiers from diatonic triads.** `scaleTierSets` classifies pitch
  classes: major-triad degrees = primary (green), minor/dim = secondary (blue),
  chromatic = out (red). Drives roll shading + note colors in both rolls and the
  "Scale focus" hide. Geometry is never changed by Scale focus (drag math stays
  intact); out-of-key notes stay visible (red) so they're fixable.
- **The standard mode selector keeps native `<select>`s as hidden plumbing.**
  `openModeSel` is one popover wired to synth/MIDI/backing/memo via
  `attachModeButton`, which hides the real selects and writes back through them
  with `dispatchEvent('change')`. This preserves every downstream handler AND
  the page-contract IDs. `cfg.from` (the mode you're coming from) drives the
  "smooth changes" cards; omit it for the global default.
- **Backing follows key changes by scale degree.** A typed/detected progression
  is re-cast as scale degrees of the song's start key (`progToDegrees`) then
  rendered diatonically per region (`degreesToProg`) — I–V–vi–IV stays
  functional across modulations. The backing modal is a chip builder + preset
  library; the old text field survives hidden inside "Other sources" as the
  source of truth. `chordsPerBar` replaced `barsPerChord` (`span = bpb/cpb`;
  default 1 keeps the tests' span = bpb). Dropped per-region AI for simplicity.
- **Clips/layers are nameable.** Optional `clip.name` (round-trips, additive, no
  version bump) shown on the timeline; editable via right-click, every editor's
  header field, and double-click on the track name (`renameTrack`). Names are
  `escapeHtml`'d at render since they're now user input.
