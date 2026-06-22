# Roadmap — toward a browser-native, AI-layered idea studio

This is the working spec for the next phase of Pitch Studio. It exists so the build
stays pointed at one thesis instead of drifting into a generic DAW. Read it with
[PRODUCT.md](PRODUCT.md) (purpose/goals/non-goals) and [DECISIONS.md](DECISIONS.md)
(why things are the way they are).

> **Status:** living document. Each work item below has Goal → Design → Data model →
> UX → Risks → Acceptance. Build order and the "loop" method are at the bottom. Check
> items off in the Build Ledger as they ship.

---

## 0. The thesis (why we're building, and the exit angle)

Pitch Studio is **not** trying to be Logic or Pro Tools, and **not** trying to be a
publishing/hosting platform. It is:

- **A jumping-off point** — capture a rough idea (hum, strum, type), develop it with
  music theory and modes, hand it off clean. Music Memos' soul, with teeth.
- **AI-integration-first.** The product's real differentiator is not another voice
  changer or another loop pack — services already do those. It's that **the AI produces
  clean, layer-separated parts that already play together inside a browser DAW**, with
  key/mode/structure metadata attached. That's the thing generative-music services
  (Suno, Vozart, etc.) *don't* hand you today: their output is a stereo bounce with no
  stems, no editable layers, no easy vocal replacement, no transposition handle.
- **The pitch to an acquirer:** "Your model makes the audio; we make it *workable*.
  Generate into our layered, mode-aware, exportable session and your users can actually
  produce with it — replace a vocal, reharmonize a chorus, export stems — all in the
  browser, no install, no account." This roadmap is built to make that demo real.

### Target user (explicit — we do not design for the lowest-end machine)
Mac users on **M1 Pro / M1 Max with healthy RAM** who want to collaborate and refuse to
rent Logic forever. Free-to-cheap, ad-free, collaborative, deeply AI-integratable, fun
for a whole project even though it's really a launchpad. We accept a memory ceiling that
a base-RAM laptop might hit; we do **not** cripple the experience to fit one.

### Hard constraints that still hold (never break casually)
One file (`index.html`), no build, no runtime deps, static GitHub Pages hosting (no
custom headers → no SharedArrayBuffer/COOP/COEP). Lazy-load ML only on demand. Keep the
DOM-free builders extractable for `test/extract.mjs`. AI keys live only in localStorage.
No trademarked artist/song/album names in generated output (descriptors only).

### What we explicitly will NOT build (re-affirmed)
VST/AU plugin hosting · bundled commercial sample/instrument libraries · take-lane
comping · a full mixing console · a voice changer / vocal cloner (integrate one, don't
build it) · cloud storage or a publishing pipeline. These either violate the non-goals,
blow the memory/size budget, or duplicate what acquirers already do better.

---

## 1. North star: AI generates clean, separable, playable layers

This is the spine the priority order serves. Everything else either feeds it (a place
for the layers to live and be edited) or follows from it.

**Problem with today's generative output:** one stereo file. No stems. Can't swap the
vocal because there was never an instrumental-plus-vocal structure. Can't transpose the
vocal independently. Can't reharmonize.

**Our answer — two complementary generation paths:**

1. **Symbolic-first (ships now, fully local, zero audio model).** The AI returns a
   structured *project spec* — per-layer chords/arps/bass/pads/drums as MIDI-like events
   plus lyrics with section/key/mode metadata. We render each part on its **own track**
   with the existing engine, so every layer is *born* as an isolated, editable,
   transposable stem. This is item 4 (chord-driven backing) generalized to a full
   arrangement. No CORS, no audio bytes, no cost beyond a chat completion.
2. **Audio-import-as-stem (pluggable, opt-in).** When the user has access to an audio
   endpoint (a Suno/Vozart-style service, or a stem-separation service), we provide a
   documented "generate/return audio → import as a labeled track" path. We attach our
   key/mode/structure metadata to the imported stem and time-align it. We do **not** ship
   or guarantee a specific audio model; we ship the *socket*.

The bridge between them is a single in-app representation: **a Layer** (track) carries
type, role (`lead`/`harmony`/`bass`/`drums`/`pad`/`vocal`), key/mode awareness, and
clean export. Generation — symbolic or audio — always lands as Layers.

---

## 2. Work items (priority order as set by the owner)

Order: **4 → 1 → 2 → 5 → 7 → 8 → WebRTC → 3 → 6.**

### Item 4 — Chord-driven backing-track generation  *(the differentiator; first)*
**Goal.** Turn a chord source — a detected memo, the key/mode map, a typed progression,
or an AI suggestion — into in-key backing **layers** (pad/bass/arp, optional simple
drums), each on its own track, mode-aware, editable, transposable.

**Design.**
- A **chord model** independent of any one source: `progression = [{beat, bars, chord:{root,
  quality, extensions[], bassPC?}}]`. Sources that can fill it: (a) a memo's detected
  `analysis.chords`; (b) the key/mode map + a Roman-numeral template; (c) user-typed
  `A C#m F#m D` parsed by an existing chord parser; (d) AI (`aiComplete` → strict JSON).
- **Voicing engine** (DOM-free, testable: `voiceChord(chord, mode, role, register)`):
  close/drop-2 voicings for pads, root-fifth-octave for bass, mode-aware passing tones
  for arps. Respects the active key/mode so generated notes stay diatonic unless the
  chord demands a borrowed tone.
- **Generators** (each emits clip events for one track/role): `genPad`, `genBass`,
  `genArp`, `genDrums` (reuse the beat engine). All take `(progression, mode, feel)` and
  return the same event shape the scheduler/exporters already consume.
- **AI hook:** `buildBackingPrompt(context)` → progression + per-role rhythmic feel;
  reuses item 5's harmony brain for "suggest a progression in this key/mode."

**UX.** A "Generate backing" action (from a memo's detected chords, from the timeline
key map, or from a typed box). A small panel: choose roles (pad/bass/arp/drums), feel
(straight/swung, density), and "follow the key map" toggle. Generates N new tracks; each
is immediately editable in the existing MIDI/arp editors and individually exportable.

**Risks.** Voicings sounding generic → mitigate with role-specific templates and the
mode awareness we already have. Keep it musical, not just correct (DECISIONS #9 ethos).

**Acceptance.** From a memo whose chords were detected, one click yields ≥3 isolated,
in-key tracks that play together and bounce as clean separate stems; transposing the key
map moves them in-key; a Node test asserts `voiceChord` and one generator produce
expected in-scale pitch sets.

### Item 1 — Undo / redo  *(table stakes; unblocks fearless editing)*
**Goal.** Global, reliable undo/redo across project edits.

**Design.** A command stack over the project object. Two viable models; pick **snapshot
-of-diff** for simplicity and one-file fit: each user-level mutation pushes a compact
inverse (or a structural snapshot of the touched slice) onto `history.undo[]`; redo
mirrors. Wrap the existing mutators (add/delete/move clip, edit notes, key/mode change,
structure edit, track add/remove, mute/solo, fx) through a single `commit(label, doFn)`
that records before/after. Cap depth (e.g. 100) to bound memory; **never snapshot
decoded audio buffers** — snapshot references/blobs, not PCM.

**UX.** ⌘Z / ⌘⇧Z, toolbar ↶/↷ (already present in many DAW headers — see BandLab),
a small "Undo <label>" tooltip. Autosave coexists (undo is in-memory session history).

**Risks.** Audio-buffer bloat (avoid by reference-only snapshots); missing a mutation
path (audit all `renderTimeline()`-triggering writes). 

**Acceptance.** Every destructive action is reversible; redo restores exactly; audio
clips survive undo without re-decoding; depth cap holds; a Node test round-trips a
serialize→mutate→undo→serialize equality on a sample project.

### Item 2 — Clip editing on the timeline
**Goal.** Split, trim/crop, duplicate, copy/paste, and edge-resize clips (audio, arp,
beat, MIDI, sampler).

**Design.** Operate on the clip model already serialized. `splitClip(track, clip,
atSec)`, `trimClip(clip, startΔ, endΔ)` (audio clips gain `offset`/`length` into the
buffer; non-audio adjust `lengthBeats`/event window), `duplicateClip`, clipboard
(`copyClip`/`pasteClip` at playhead). Edge-resize via existing drag infra (mirror the
key-lane `.kr-edge` pattern — render once on release). All routed through item 1's
`commit()`.

**UX.** Marquee/select a clip → context actions + keyboard (⌘C/⌘V/⌘D, S to split at
playhead, drag edges to resize). Snap to beat (reuse `lyrSnap`).

**Risks.** Audio trim needs a buffer-offset render path in `renderMix`/scheduler (add
`clip.offset`); test the bounce respects it. Depends on item 1 for safe reversibility.

**Acceptance.** A loop can be split and one half deleted; an audio clip trimmed to a
sub-region plays and bounces only that region; paste lands at the playhead; all
reversible.

### Item 5 — Harmony assistant (mode-aware suggestions)
**Goal.** Given the key/mode map, suggest next chords, reharms, borrowed chords, and
voice-leading hints. Feeds item 4.

**Design.** Pure theory module (DOM-free, testable): `suggestChords(key, mode, prev[],
{borrow, secondaryDominants})` → ranked candidates with Roman numerals and a one-line
rationale; `voiceLead(fromChord, toChord)` → minimal-motion voicing. Reuse existing
mode scaffolding (`scalePCs`, `modeMood`, `keySuggestions`).

**UX.** In the chord/key popups and the item-4 generator: "suggest progression",
"reharmonize this section", inline next-chord chips. Optionally AI-augmented for style
("make it more neo-soul") via `aiComplete`, but the deterministic engine works offline.

**Risks.** Keep suggestions musical and explainable; don't overwhelm. Scope creep into a
full theory tutor — hold the line at *suggestions that feed generation/editing*.

**Acceptance.** From `Amaj`/Ionian it proposes a sensible diatonic set with correct
Roman numerals and at least one tasteful borrowed option; voice-leading output minimizes
total semitone motion; Node test asserts numerals + in-scale membership.

### Item 7 — Per-track level meters  *(feedback, allowed under non-goals)*
**Goal.** A live level meter per track (and master), as practice/mix feedback — not a
console.

**Design.** Tap each track chain's output with an `AnalyserNode` (we already have
`masterAnalyser`/`synthAnalyser`); compute peak/RMS per rAF; draw a slim meter in the
track head. Reuse the existing viz loop (`startViz`) to avoid extra rAFs.

**UX.** Thin vertical meter in each track header beside the fader; master meter in the
transport. Peak-hold tick. Zero layout disruption (fits the existing head).

**Risks.** Per-track analysers add nodes — fine for our target machine; cap redraw to
the shared viz loop. 

**Acceptance.** Meters track real output, sit at −∞ on silence, respect mute/solo (a
muted track reads silent), and cost one shared rAF.

### Item 8 — Track-level automation
**Goal.** Draw volume/pan/filter-cutoff over time per track (timeline automation lanes),
distinct from the per-note CC lanes already in the MIDI editor.

**Design.** `track.automation = { volume:[{beat,val}], pan:[...], cutoff:[...] }`,
piecewise-linear. Scheduler + `renderMix` apply via `setValueCurveAtTime` /
`linearRampToValueAtTime` on the corresponding chain params (the chain already exposes
`level`, and we add pan/filter taps). Serialize (additive; no FORMAT bump if defaulting
empty). Reuse the MIDI control-lane rendering (`renderMidiRoll` point-automation code) on
the timeline.

**UX.** A collapsible automation lane under a track (toggle from the head). Click to add
points, drag to shape, right-click to delete. Snap optional.

**Risks.** This is the closest we get to "becoming a DAW" — **gate it** behind a
per-track toggle, keep it to a few core params, resist adding plugin automation. Depends
on item 1 (reversible) and benefits from item 2's edge-drag infra.

**Acceptance.** A volume ramp audibly fades a track and bounces identically offline; pan
sweep is audible; points are reversible via undo; empty automation changes nothing.

### WebRTC — live collaboration  *(the "absolutely sick" feature)*
**Goal.** Two+ people in the same session live: shared transport, shared edits, presence
cursors. **No cloud storage, no accounts, no hosting** — peer-to-peer.

**Design.**
- **Transport:** WebRTC `RTCDataChannel` peer-to-peer for project ops; a tiny signaling
  step to exchange SDP/ICE. Signaling options that respect "no server we run": paste-a-
  code (manual SDP copy), or a free/public signaling relay the user supplies, or a
  serverless broker via the user's own config. Document the trade-offs; default to a
  copy/paste or QR handshake so it works with zero infrastructure.
- **Sync model:** operations, not snapshots. Reuse item 1's `commit()` envelope — every
  command becomes a serializable op broadcast to peers and applied through the same
  mutator. Conflict strategy: last-writer-wins per object with an op clock; lock a clip
  while a peer drags it (presence-aware). This is why **item 1 comes before WebRTC** —
  the command layer is the wire format.
- **Presence:** name + color + selection/cursor over the data channel; render peer
  carets on the timeline.
- **Audio:** sync *edits and transport*, not live audio streams (low-latency multitrack
  audio P2P is out of scope and a different product). Optionally an opt-in voice-chat
  `MediaStream` channel for talking while writing — clearly separate from project audio.

**Risks.** NAT traversal without our own TURN (document a BYO-TURN/relay option);
op-ordering bugs (keep ops small, idempotent, clocked); security (validate every inbound
op — peers are untrusted input). Big surface; ship in slices: (a) 2-peer shared transport
+ presence, (b) shared edits via ops, (c) locking/conflict polish, (d) optional voice.

**Acceptance.** Two browsers connect via the handshake with no server we host; pressing
play on one starts both; adding/editing a clip on one appears on the other within a beat;
disconnect/reconnect recovers; inbound ops are validated.

### Item 3 — Tempo / meter map (conductor lane)  *(on-thesis, but sequenced late)*
**Owner's worry, addressed:** *will tempo changes be jarring and poorly threaded through
the project?* They can be — which is exactly why this is **not a blocker** for 4/1/2/5/7/
8/WebRTC and is sequenced after them. It is **additive**: a conductor lane mapping
`beat → bpm` (and meter changes), layered over the existing bar-centric model, rather
than a rewrite of the timing core.

**Design.** `project.tempoMap = [{beat, bpm}]` (and the existing meter map). A single
`beatToSec(beat)` / `secToBeat(sec)` integrator becomes the **one** place tempo is
resolved; every scheduler/render/zoom site already derives seconds from beats, so we
route them through the integrator instead of a constant `bpm`. Default map = one point =
today's behavior (zero UX change until used). Memos keep their per-beat detected tempo
(goal #2) and can *populate* the map.

**Risks.** The threading risk is real: audit every `bpm`/`barSec()`/`quarterSec()` use
and centralize. Do it behind a feature where the default single-point map is a no-op, so
nothing changes for existing sessions until a user adds a tempo point. Verify exports
bit-match before/after for a constant-tempo project.

**Acceptance.** A constant-tempo project is byte-identical pre/post change; adding a tempo
ramp audibly accelerates playback and bounce; a memo's detected tempo can seed the map;
zoom/playhead stay aligned.

### Item 6 — Audio warp / flex (quantize a clip to the grid)  *(hardest; last)*
**Owner's question, confirmed:** yes — this is **Logic-style Flex Time**: detect
transients in an audio clip and time-stretch regions so hits land on the grid. And yes,
it's **computationally expensive and complex** — transient detection + high-quality
time-stretch (phase-vocoder or WSOLA) running in-browser, single-threaded WASM (no
SharedArrayBuffer for us). That's why it's **last and strictly opt-in per clip**, not an
always-on engine.

**Design.** `detectTransients(buffer)` → onset times; `warpClip(clip, anchors→grid)`
time-stretches between anchors via a WSOLA/phase-vocoder kernel (inline WASM or a tuned
JS kernel for short clips). Non-destructive: store warp markers + target grid; render
applies the stretch. Start with **tempo-match a loop** (single ratio stretch — cheap and
high-value) before per-transient flex (expensive).

**Risks.** Quality/artifacts; CPU on long clips (scope to loops/short takes; show cost,
no silent truncation per our logging ethos). Depends conceptually on item 3 (a grid that
can vary) but the simple "stretch a loop to the session tempo" case does not.

**Acceptance.** A loop recorded at the wrong tempo can be one-click matched to the session
tempo and stays in sync around the loop; per-transient flex nudges an off hit onto the
beat with acceptable artifacts; clearly opt-in and reversible.

---

## 3. Cross-cutting (every item)
- **Tests:** extend `test/extract.mjs` for each new DOM-free builder (`voiceChord`,
  generators, `suggestChords`/`voiceLead`, `beatToSec` integrator, ID/transient helpers);
  add `*.test.mjs` cases. `test/page.test.mjs` asserts new element ids + function names.
- **Versioning:** bump `APP_VERSION` + `package.json` together every release. Bump
  `FORMAT_VERSION` only when an older build genuinely couldn't read the session.
- **Docs:** log every non-obvious decision in DECISIONS.md; update ARCHITECTURE.md's
  section map; check items off the Build Ledger below.
- **Verify in the browser preview** before calling anything done; never push without
  explicit per-action authorization.
- **Memory discipline:** decoded PCM is the budget sink. Undo/automation/collab snapshot
  references and ops, never buffers. Revisit decode-on-demand/eviction when a real session
  starts hitting RAM (our target machine has headroom, but the ceiling is real).

## 4. The loop (how we execute)
For each item, in priority order:
1. Design lock (this doc) → 2. Implement the DOM-free core + tests → 3. Wire the UI →
4. `npm test` + syntax check green → 5. Preview-verify the real behavior → 6. DECISIONS
entry + Build Ledger check → 7. Version bump → 8. Report; ship on go-ahead. Then next item.
Slice big items (WebRTC, warp) into sub-phases and loop those internally.

## 5. Build Ledger
- [x] **Item 4** — Chord-driven backing generation (chord model · voicing engine · pad/bass/arp/drum generators · AI hook · UI) — **shipped v1.31.0.** `buildBacking`/`materializeBacking` turn a typed / detected-memo / AI progression into isolated pad·bass·arp MIDI stems + optional drums, each its own transposable track. (DECISIONS #64)
- [x] **Item 1** — Undo/redo command stack (`commit()` envelope, all mutators routed, depth cap) — **shipped v1.32.0.** Scoped in-memory snapshots (PCM by reference, no re-decode), ⌘Z/⇧⌘Z + toolbar, MIDI-editor note ops covered, depth 100. (DECISIONS #65)
- [x] **Item 2** — Clip editing (split/trim/duplicate/copy-paste/edge-resize · audio buffer offset) — **shipped v1.33.0.** Context menu + ⌘D/⌘C/⌘V + edge-resize; audio clips gained offset/length honored by live + offline render; all routed through commit(). (DECISIONS #66)
- [x] **Item 5** — Harmony assistant (`suggestChords` · `voiceLead` · popups + generator hook) — **shipped v1.34.0.** diatonicChords/suggestChords/suggestProgression/voiceLead (DOM-free, tested) + a ✨ Suggest button in the backing modal. Popup chips + AI-augment deferred. (DECISIONS #67)
- [ ] **Item 7** — Per-track + master meters (shared viz loop, mute/solo-aware)
- [ ] **Item 8** — Track automation lanes (volume/pan/cutoff · scheduler + offline apply)
- [ ] **WebRTC** — live collab: (a) transport+presence · (b) shared edit ops · (c) locking/conflict · (d) optional voice
- [ ] **Item 3** — Tempo/meter conductor lane (centralized `beatToSec` integrator · no-op default)
- [ ] **Item 6** — Audio warp/flex: (a) loop tempo-match · (b) per-transient flex

## 6. Release strategy (owner-set 2026-06-22)
- **Items 4 → 1 → 2 → 5 → 7 → 8 → WebRTC ship as additive `1.x` minor releases on `main`.** Each is a
  pure feature-add that contributes functionality without breaking existing sessions or the timing
  model. Ship each one its own release (npm test green + preview-verify + DECISIONS entry + version
  bump), one per session, on explicit go-ahead.
- **Items 3 (tempo/conductor lane) and 6 (audio warp/flex) are a `2.0.0` major release on a dedicated
  branch.** They change the timing core (variable tempo) and are breaking enough — old constant-tempo
  assumptions, session-format implications, and the flex engine — to warrant a major revision. Branch
  off `main` once everything through WebRTC has shipped, build 3 + 6 there together, validate hard
  (constant-tempo sessions must stay byte-identical until a tempo point is added), then roll out as
  **v2.0.0**. Do NOT do 3 or 6 piecemeal on `main`.
- One item (or one WebRTC sub-phase) per session. Don't batch features into a session — context
  exhaustion produces half-built work that fails the quality bar.
