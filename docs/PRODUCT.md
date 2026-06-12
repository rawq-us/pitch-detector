# Product — purpose, goals, non-goals

## Purpose

Pitch Studio replaces bad pitch detectors with a suite of tools for
**capturing and developing song ideas using music theory and musical modes**.
It combines the things its author loved from multiple discontinued or
scattered apps — most centrally Apple's **Music Memos** (2016–2021), which
let a musician record a rough take and instantly see chords, tempo and
structure mapped over the waveform.

> "We're not competing with native DAWs. We're replacing bad pitch detectors
> with an awesome suite of tools that combine the things I love from
> multiple apps and what I want to better craft song ideas using music
> theory and musical modes."

## Goals

1. **Capture before the idea evaporates.** One click to record a memo; the
   session length follows the take instead of cutting it off.
2. **Map the whole take, not a moment.** Tempo map (beat by beat, like Music
   Memos), key/mode guess, chords, melody — visible across the entire
   recording afterward, not just a live tuner needle.
3. **Mode-aware everything.** The seven diatonic modes are first-class:
   chord detection scores in-mode chords first, melody coloration shows
   cents deviation *from the mode* (teal/amber/red), key guessing spans all
   12 roots × 7 modes.
4. **Practice feedback.** "See how off you were" — the tuning coloration is
   a practice tool as much as a writing tool.
5. **Portable out.** One export bundle (24-bit WAV + SMF-1 MIDI with tempo
   map/chord markers/timed lyrics + LRC + Audacity labels + JSON) that drops
   into Logic, GarageBand, Audacity, or anything else.
6. **Private and free to run.** Everything — including speech-to-text —
   runs locally in the browser. Nothing is uploaded anywhere.

## Non-goals

- **Not a DAW.** No mixing console ambitions, no plugin hosting, no
  multitrack comping. Bounce/stems exist to hand off, not to finish.
- **Not perfect transcription.** Lyrics are a draft ("better than nothing,
  close to good enough"); detected chords/notes are correctable guesses.
  The UI always lets the human fix the machine.
- **Not a hosted service.** Single static file on GitHub Pages, forever
  hackable by opening it in an editor.

## Quality bar

- Monophonic material (sung/played lines): pitch accurate to a few cents,
  notes and cents asserted exactly in the test suite.
- Polyphonic material: chords are the reliable output; melody-over-chords
  is approximate (documented limitation, same as Music Memos).
- Analysis must reflect *musical* reality: realistic harmonic rhythm
  (no chord changes every beat), notes that survive breath-length dropouts.
- Every release: `npm test` green + the browser smoke pass in
  [TESTING.md](TESTING.md).
