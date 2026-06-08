# 🎛️ Pitch Studio

A single-file, in-browser music workstation: a pitch detector, a playable keyboard, an arpeggiator, a drum machine, and a beat-aligned timeline arranger — plus MIDI export, saveable sessions, and live spectrum visualizers. No build step, no dependencies, no samples (all sound is synthesized with the Web Audio API).

## Features

### Pitch detection & keyboard
- **Microphone pitch detection** via normalized autocorrelation with parabolic interpolation; shows the detected note, frequency, a cents-off tuner needle, and highlights the matching key.
- **Virtual keyboard** A1 → C6 with white/black keys, mouse/touch **glissando** (drag across keys), and computer-keyboard play (`a s d f g h j k l` white, `w e t y u o p` black).
- **In-tune playback** — equal temperament, A4 = 440 Hz — with selectable tone: sine / triangle / square / saw.
- **Keys & modes** — pick a root and one of the seven diatonic modes (Ionian → Locrian); in-key notes and the root are tinted on the keyboard, color-coded per mode.

### Arpeggiator
- Build a note sequence by clicking keys in "Add notes" mode (rests supported), preview it looping, then add it to the timeline as a clip.
- Rate selector (1/4, 1/8, 1/8 triplet, 1/16) tied to the global project tempo.

### Beat machine (8-piece synth kit)
- Synthesized **Kick, Snare, Closed Hat, Open Hat, Clap, Low Tom, Hi Tom, Cymbal**.
- Tap pads to audition, program a 16-step grid, or **live-record** pad taps into the grid while previewing. Add the pattern to the timeline as a beat clip.

### Timeline / arrangement
- Multi-track layers (multiple arp tracks + beat tracks); clips show their content and **duration as width**.
- **Drag clips** to reposition — snaps to the beat grid. Each clip has a **⟳ loop badge**: click it to set how many beats the pattern loops for.
- **Bar/beat guides** with a **time-signature** selector (4/4, 3/4, 2/4, 6/8, 5/4, 7/8, 12/8) and a global **Project BPM** (default 90).
- **Cycle region**: drag across the ruler to set a loop; toggle looping on/off; reset to the whole piece. Numeric (seconds) length field.
- Master transport scheduled on the Web Audio clock (sample-accurate, drift-free).

### Visualizers
- **Synth EQ** above the keyboard — frequency spectrum + oscilloscope overlay, so the four oscillator shapes are visible at a glance.
- **Master EQ** beside the timeline — the whole session's combined output.

### Export & sessions
- **Export MIDI** — writes a Standard MIDI File (format 1): arp tracks on melodic channels, drums on the GM percussion channel, with tempo and time-signature meta. Respects per-clip loop lengths.
- **Sessions** — save/load named sessions (label + description) to an in-browser **IndexedDB** store, with a stored format version for forward compatibility.

## Running

The microphone requires a **secure context**, so serve over `http://localhost` (or `https://`), not `file://`:

```bash
cd pitch-detector
python3 -m http.server 8000
# open http://localhost:8000
```

Click **Enable mic** and allow access to use pitch detection. Everything else works without the mic.

## How it works

- **Note → frequency:** `f = 440 · 2^((midi − 69) / 12)`
- **Frequency → note:** `midi = 69 + 12·log₂(f / 440)`; the fractional part × 100 gives cents off.
- **Audio graph:** synth voices → synth analyser → master gain → master analyser → output; drums route straight to the master gain. The analysers drive the two EQ displays.
- **Scheduling:** a 25 ms look-ahead scheduler queues note/drum events ~120 ms ahead on the audio clock for tight timing.
- **Safari:** a silent-buffer "unlock" plus an inaudible keep-warm tone are started on the first gesture so audio fires instantly.

Built as a single `index.html` — open it, read it, hack it.
