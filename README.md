# 🎛️ Pitch Studio

A single-file, in-browser music workstation: a pitch detector, a playable keyboard, an arpeggiator, a drum machine, and a beat-aligned timeline arranger — with per-track effects, a master EQ, voice recording, MIDI export, audio bounce/stems, saveable sessions, and live spectrum visualizers. No build step, no dependencies, no samples (all sound is synthesized with the Web Audio API).

**▶️ Live app:** https://rawq-us.github.io/pitch-detector/

## Features

### Pitch detection & keyboard
- **Microphone pitch detection** via normalized autocorrelation; shows the detected note, frequency, a cents-off tuner needle, and highlights the matching key.
- **Scale-aware guess:** under the detected note it shows the **nearest in-key note** for the current key/mode and how many cents off you are.
- **Virtual keyboard** A1 → C6 with white/black keys, mouse/touch **glissando**, and computer-keyboard play (`a s d f g h j k l` white, `w e t y u o p` black).
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
- Every section is **collapsible** (minimize/expand) and **drag-reorderable** by its header; order and collapsed-state persist (localStorage). The app opens focused on the core flow (sound & key → pitch detector → keyboard/arp), with sound-design, beats, and master EQ collapsed by default.

### Arpeggiator
- Build a note sequence by clicking keys (rests supported), preview it looping, then add it to the timeline as a clip. Rate: 1/4, 1/8, 1/8 triplet, 1/16.

### Beat machine (18-piece synth kit)
- Kick, snare, hats, clap, 3 toms, rim, cowbell, shaker, 2 congas, clave, tamb, crash, ride, snap — all synthesized.
- **6×6 = 36 performance pads** (top 18 = kit, bottom 18 = an octave up). Tap to audition or **live-record** into the grid.
- A 16th-note step grid whose **Length is set in bars/measures** and re-fits to the time signature (with a `?` tooltip explaining the math and a live steps/seconds readout).

### Timeline / arrangement
- Multi-track layers (multiple arp, beat, and voice tracks; starts with one of each); clips show content + **duration as width**.
- **Drag clips** to reposition — snaps to the beat. Each non-voice clip has a **⟳ loop badge** to set how many beats it loops for. Per-track **FX ▸** and **✕ layer** buttons.
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
- **Safari:** a silent-buffer "unlock" + inaudible keep-warm tone start on the first gesture so audio fires instantly.

Built as a single `index.html` — open it, read it, hack it.
