# 🎛️ Pitch Studio

A single-file, in-browser music workstation: a pitch detector, a playable keyboard, an arpeggiator, a drum machine, an **annotated memo recorder** (Music Memos-style whole-take analysis: chords, notes, tempo map, lyrics), and a beat-aligned timeline arranger — with per-track effects, a master EQ, voice recording, MIDI export, audio bounce/stems, saveable sessions, and live spectrum visualizers. No build step, no dependencies, no samples (all sound is synthesized with the Web Audio API).

**▶️ Live app:** https://rawq-us.github.io/pitch-detector/

## Features

### Pitch detection & keyboard
- **Microphone pitch detection** via normalized autocorrelation; shows the detected note, frequency, a cents-off tuner needle, and highlights the matching key.
- **Scale-aware guess:** under the detected note it shows the **nearest in-key note** for the current key/mode and how many cents off you are.
- **Full 88-key keyboard** (A0 → C8) with fixed-size keys (won't shrink), horizontal scroll, and ◀/▶ octave-jump buttons; auto-scrolls to the detected note. Mouse/touch **glissando** and computer-keyboard play (`a s d f g h j k l` white, `w e t y u o p` black).
- **In-tune playback** — equal temperament, A4 = 440 Hz.
- **Keys & modes** — root + the seven diatonic modes (Ionian → Locrian); in-key notes and the root are tinted per mode.

### Synth
- **Multi-oscillator** voice: starts with one oscillator; add up to 3, each with its own waveform, octave, semitone interval (e.g. +6 tritone), detune (doubling), level, and pan.
- **State-variable filter** (low/high/band-pass, cutoff + resonance) and a full **ADSR amp envelope**. Moving filter controls updates held notes live.
- A **live oscilloscope** of the real synth output (no faked/idealized shapes).

### Arp transpose & keyboard modes
- The on-screen keyboard switches between **Play notes** and **Transpose arp**; in Transpose mode each key jumps the selected arp layer to that offset from C4.
- A transpose stepper (−12 / −1 / +1 / +12 / Reset) and arrow keys (←/→ ±1, ↑/↓ ±octave), applied per selected arp layer.

### Layout
- Every section is **collapsible** (minimize/expand) and **drag-reorderable** by its header; order and collapsed-state persist in **localStorage and in saved sessions**. The app opens focused on the core flow (sound & key → pitch detector → timeline → synth — keys → arpeggiator), with beats and master EQ collapsed by default.
- The **Synth — keys** section groups the oscilloscope, keyboard (with the Play/Transpose mode toggle), filter & envelope, and oscillators. The **Arpeggiator** holds sequence building plus the per-layer transpose stepper.

### Arpeggiator
- Build a note sequence by clicking keys (rests supported), preview it looping, then add it to the timeline as a clip. Rate: 1/4, 1/8, 1/8 triplet, 1/16.

### Beat machine (18-piece synth kit)
- Kick, snare, hats, clap, 3 toms, rim, cowbell, shaker, 2 congas, clave, tamb, crash, ride, snap — all synthesized.
- **6×6 = 36 performance pads** (top 18 = kit, bottom 18 = an octave up). Tap to audition or **live-record** into the grid.
- A 16th-note step grid whose **Length is set in bars/measures** and re-fits to the time signature (with a `?` tooltip explaining the math and a live steps/seconds readout).

### Timeline / arrangement
- Multi-track layers (multiple arp, beat, and voice tracks; starts with one of each); clips show content + **duration as width**.
- **Drag clips** to reposition — snaps to the beat. Each non-voice clip has a **⟳ loop badge** to set how many beats it loops for, or **∞ Fill session** to repeat it to the end of the piece (a backing track while recording memos). Per-track **FX ▸** and **✕ layer** buttons.
- **Two-row ruler**: top = **seconds**, bottom = **bars · beats** (what clips snap to), with row labels so the axis is unambiguous.
- **Time-signature** selector (4/4, 3/4, 2/4, 6/8, 5/4, 7/8, 12/8) and a global **Project BPM** (default 90).
- **Count-in**: a Off / 1 / 2-bar pre-roll before position 0 — on Play the playhead starts in the pre-roll and a metronome counts you in, landing beat 1 exactly at 0.
- **Cycle region** (drag the ruler), loop on/off, numeric (seconds) length field.
- Master transport scheduled on the Web Audio clock (sample-accurate, drift-free).

### Effects & mixing
- **Per-layer FX rack** (opened from each track's **FX** button, in a modal): Level, Drive, Chorus, Phaser, Delay (tempo-syncable), Reverb (convolution), Compressor — each with an **On/Off** toggle that keeps your settings when bypassed; processed in series, independently per layer.
- **Master EQ**: 3-band (low shelf / mid peak / high shelf) + master level. The master bus is EQ-only.

### Built-in demo
- On first run (empty session DB) the app installs and loads **"Bach Prelude in C — Trap"**: BWV 846 on the arp layer over a trap beat, with per-layer effects. It's saved to your sessions so you can reload it anytime.

### Voice recording
- A **Voice track** type records mic snippets via `MediaRecorder`. Clips play in the transport, are stored as Blobs **in the IndexedDB session**, excluded from MIDI, and included in the audio bounce.

### Annotated memo layer 📝
An homage to Apple's discontinued **Music Memos**, rebuilt for the browser — record an idea and see the *whole take* mapped, not just a moment-in-time pitch readout:

- **Raw-PCM recording** via `AudioWorklet` (no lossy Opus step — stored as **24-bit WAV**). While recording, the **session length follows the take** (grows live, bar-aligned) and settles to the memo's end when you stop — no more bumping into the 32-second default. Pair it with the **∞ Fill session** loop mode on arp/beat clips for a dumb backing track to play against.
- **⬆ Import audio files** (WAV/MP3/M4A/OGG — anything the browser decodes; stereo is mixed down for analysis, kept for playback) straight into a memo layer and analyze them after the fact. And any existing **voice layer converts to a memo layer** (the **→📝** button on its header) — clips are losslessly rewrapped as 24-bit WAV and get the full analysis treatment.
- **Whole-take analysis** runs in a Web Worker after recording (re-run anytime, in any key):
  - **Tempo map** — spectral-flux onsets + dynamic-programming beat tracking. A beat-by-beat map like Music Memos (it follows you as you rush/drag), not a single BPM guess. Bar lines come from a nudgeable downbeat.
  - **Key & mode guess** across all 12 roots × the 7 diatonic modes, with confidence.
  - **Mode-aware chords** — chroma template matching that scores the **diatonic chords of your key/mode first**; outside-key guesses render amber with a `?`. Click any chord chip to audition and correct it.
  - **Melody with tuning coloration** — every detected note carries its cents deviation from the nearest in-mode pitch and paints the waveform: **teal** ±10¢, **amber** 10–35¢, **red** >35¢ or outside the mode. See exactly where you drifted in a take.
  - **Lyrics** — in-browser Whisper transcription (transformers.js, word-level timestamps, WebGPU with WASM fallback, optional translate-to-English), fully editable; or just type them. Transcription is **forced to a single language** (defaults to your browser's language) so the model doesn't hunt for languages that aren't there — with an explicit **Auto — multilingual / mixed** option for songs that genuinely mix languages (e.g. Spanglish). The choice is saved per memo. An **Accuracy** selector offers three model tiers — Fast (~50 MB), Better (~80 MB), Best (~250 MB) — A/B-tested against real vocals with known lyrics (consecutive-word accuracy: 30% / 45% / 49%); Better is the sweet spot and is no slower than Fast. Your tier choice is remembered.
- **Memo editor modal** — Music Memos-style canvas: chord band, tuning-colored waveform, note ribbons, timed lyric row; play with a moving playhead, click to seek, nudge the downbeat, re-analyze in any of the 84 key/mode combinations, and push the detected **key or BPM to the project** with one click.
- **Portable export bundle** (one zip, drops straight into Logic/GarageBand/Audacity/anything):
  - `*.wav` — the take, 24-bit PCM
  - `*.mid` — SMF format 1 with the **per-beat tempo map**, key signature, **chord markers**, the detected melody, a playable chord track, and **timed lyric meta events** (karaoke-style)
  - `lyrics.lrc` + `lyrics.txt` — timestamped and plain lyrics
  - `chords-labels.txt`, `notes-labels.txt`, `lyrics-labels.txt` — **Audacity label tracks** (File → Import → Labels)
  - `analysis.json` — the full analysis, lossless
- Memo audio plays in the transport, lands in **bounce and stems**, the detected melody joins the global MIDI export, and everything (audio, analysis, lyrics) persists in saved sessions.

### Visualizers
- **Synth EQ** above the keyboard — spectrum + oscilloscope overlay (compare the four oscillator shapes).
- **Master EQ visualizer** beside the timeline — the whole session's output.

### Export & sessions
- **Export MIDI** — Standard MIDI File (format 1): arp tracks on melodic channels, drums on GM channel 10, with tempo + time-signature meta. Respects per-clip loop lengths.
- **Bounce WAV** — renders the entire arrangement (synth, drums, voice, per-track FX, master EQ) offline to a 16-bit WAV.
- **Export stems** — each track rendered individually (with its own inserts, pre-master-EQ) as separate WAVs.
- **Sessions** — save/load named sessions (label + description) in IndexedDB, with a stored format version. Synth, master EQ, and per-track FX are all persisted.

## Running

The microphone requires a **secure context**, so serve over `http://localhost` (or `https://`), not `file://`:

```bash
cd pitch-detector
python3 -m http.server 8000
# open http://localhost:8000
```

Click **Enable mic** for pitch detection / voice recording; everything else works without it.

## How it works

- **Note → frequency:** `f = 440 · 2^((midi − 69) / 12)`; **frequency → note:** `midi = 69 + 12·log₂(f / 440)`.
- **Audio graph:** each track → its insert FX chain → master gain → master EQ → analyser → output; live keyboard → synth bus → master.
- **Beat length:** a bar = `numerator` beats; the 16th-note grid has `16/denominator` steps per beat, so `beats × steps-per-beat` steps per bar; each step = `(60/BPM)/4` s.
- **Scheduling:** a 25 ms look-ahead scheduler queues events ~120 ms ahead on the audio clock.
- **Bounce/stems:** rendered via `OfflineAudioContext` and encoded to WAV in-browser.
- **Memo analysis:** one STFT pass (8192-point FFT, soft-assigned chroma + spectral flux) feeds an Ellis-style DP beat tracker and per-beat chord templates; melody comes from an FFT-based autocorrelation (unbiased, parabolic-interpolated — accurate to a couple of cents) on a 2× decimated copy. All of it in a Blob Web Worker, ~2.5 s for a 90 s take.
- **Lyrics:** Whisper (`whisper-tiny_timestamped`, ~40–50 MB, cached by the browser after first use) via transformers.js in a module worker — local inference, nothing uploaded. On WebGPU it loads fp32-encoder/q4-decoder weights (q8 mis-decodes on WebGPU); WASM uses q8.
- **Safari:** a silent-buffer "unlock" + inaudible keep-warm tone start on the first gesture so audio fires instantly.

Built as a single `index.html` — open it, read it, hack it.
