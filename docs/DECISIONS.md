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
