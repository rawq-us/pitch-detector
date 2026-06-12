# Testing

Three layers, cheapest first. Run layer 1 before every commit; layer 2
before releases that touch audio/UI behavior; layer 3 when changing
anything in the transcription or analysis quality path.

## 1. Node test suite (automated, CI-enforced)

```bash
npm test        # ~4 s, zero dependencies (node:test)
```

Runs on every push/PR via `.github/workflows/test.yml`.

How it works without a build step: `test/extract.mjs` lifts the
deliberately self-contained functions (`memoWorkerMain`, `buildMemoMidi`,
`makeZip`, `crc32`, `memoLrc`, `memoLabels`, …) out of `index.html`
textually and instantiates them in Node. `test/fixtures.mjs` synthesizes
ground-truth audio in pure JS (deterministic noise, exact frequencies).

What's pinned:

- **DSP acceptance** (`dsp.test.mjs`): 120 BPM click track tracked ±2 BPM;
  C–Am–F–G detected exactly and diatonic; key = C ionian; melody pitches
  exact with cents within ±4 (including deliberate −20¢/+30¢ detunes);
  out-of-key notes flagged ~100¢ from the mode; mode-awareness (forcing
  C aeolian flips E natural/Eb correctly); no phantom notes from chords, no
  phantom chords from melody; dropout-split notes rejoin; stab flickers
  absorbed (16 real changes → exactly 16 spans, ≥1 s each); silence falls
  back to a grid instead of fabricating a tempo.
- **Export formats** (`formats.test.mjs`): SMF varlen spec vectors; crc32
  standard check value; full structural parse of the memo MIDI (format 1,
  480 PPQ, tempo/timesig/keysig metas, chord markers in order, melody
  note-ons, lyric events, chord-track triads, monotonic ticks, no trailing
  bytes); zip signatures + per-entry CRC; LRC line grouping; Audacity label
  format.
- **Page contract** (`page.test.mjs`): inline script parses; required
  element ids and function names exist; FORMAT_VERSION declared.

If you add analysis behavior, add a fixture + assertion here. The suite's
first-ever run caught a real bug (silence → fake 224.7 BPM).

## 2. Browser smoke (manual, ~3 minutes)

Serve locally (`npm start`), then:

1. First-run: demo loads ("Bach Prelude in C — Trap"), Play works.
2. Add a memo layer (＋📝) → Rec (or ⬆ Import a file) → waveform + chips
   appear after analysis; session length grew to the take.
3. Open the memo editor: zoom (buttons + ctrl+scroll), Play with playhead,
   click a chord chip (auditions + popup edits), downbeat nudge,
   re-analyze in a forced key (colors shift accordingly).
4. Transcribe (pick a language) → words land on the canvas; edit the text.
5. Export bundle → zip downloads; spot-check the .mid opens in a DAW.
6. Save session, reload page, load session → memo intact (audio, analysis,
   lyrics).
7. ⟳ popup → ∞ Fill session on a beat clip → it tiles to the session end;
   timeline zoom in/out/100%.
8. Console: zero errors/warnings throughout.

## 3. Real-audio benchmark (when touching transcription/analysis quality)

Method: run a real vocal recording with a known lyric sheet through the
production path, score the transcript (vocab hit rate = % of transcript
words present in the sheet; bigram rate = % of consecutive word pairs).
Local test audio lives in `Heavy Cream/` (gitignored — never commit it).

Current reference scores (3:55 isolated vocal stem, rap/sung, English):

| Model | vocab | bigram | notes |
|---|---|---|---|
| whisper-tiny_timestamped (Fast) | 74% | 30% | default |
| whisper-base_timestamped (Better) | 82% | 45% | recommended; no slower than Fast |
| whisper-small_timestamped (Best) | 88% | 49% | |
| moonshine-base (Experimental) | 85% | 53% | English-only, phrase timing |
| distil-small.en (Experimental) | 82% | 47% | English-only, phrase timing |

Also verified on this material: full-length coverage (no truncation at
instrumental breaks), timestamps ≤ clip duration, analysis granularity
(74 chord spans on a full song, median 2.4 s), drums stem tempo 92.3 vs
the track's actual 92.

When trying a future model: add it via the Model picker ("＋ Add custom
model"), transcribe the same material, score the same way, and record the
numbers here.
