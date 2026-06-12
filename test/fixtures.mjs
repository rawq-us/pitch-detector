// Synthesized ground-truth audio fixtures (pure JS, no Web Audio).
// These mirror the browser acceptance tests that validated the memo layer:
// known chords, known melody cents, known tempo — so the DSP's output can be
// asserted exactly.
export const SR = 44100;

const midiF = (m) => 440 * Math.pow(2, (m - 69) / 12);

// deterministic noise (LCG) so test runs are reproducible
function makeRng(seed = 42){
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF * 2 - 1; };
}

function addTone(buf, type, freq, t0, t1, amp, atk = 0.03, rel = 0.05){
  const a = Math.floor(t0 * SR), b = Math.min(buf.length, Math.floor(t1 * SR));
  for (let i = a; i < b; i++){
    const t = i / SR;
    const ph = (freq * t) % 1;
    const v = type === "sine" ? Math.sin(2 * Math.PI * freq * t) : (2 * Math.abs(2 * ph - 1) - 1); // triangle
    let env = 1;
    if (t - t0 < atk) env = (t - t0) / atk;
    else if (t1 - t < rel) env = (t1 - t) / rel;
    buf[i] += v * amp * env;
  }
}

function addClick(buf, t0, rng, amp = 0.5, dur = 0.05){
  const a = Math.floor(t0 * SR), b = Math.min(buf.length, a + Math.floor(dur * SR));
  for (let i = a; i < b; i++) buf[i] += rng() * amp * Math.exp(-(i - a) / 300);
}

// C, Am, F, G triads (2 s each) + click every 0.5 s → 120 BPM, C ionian, 4 chords
export function chordsAndClicks(){
  const buf = new Float32Array(SR * 8), rng = makeRng(7);
  const prog = [[48,52,55],[45,48,52],[41,45,48],[43,47,50]];
  prog.forEach((pcs, i) => pcs.forEach(m => addTone(buf, "tri", midiF(m), i * 2, i * 2 + 2, 0.16)));
  for (let t = 0; t < 8; t += 0.5) addClick(buf, t, rng);
  return buf;
}

// scale run with deliberate detunes and one out-of-key note
// C4 D4 E4 F4(-20¢) G4 A4(+30¢) B4 C5 D#4(out of C major)
export const MELODY = [
  { midi:60, cents:0 }, { midi:62, cents:0 }, { midi:64, cents:0 }, { midi:65, cents:-20 },
  { midi:67, cents:0 }, { midi:69, cents:30 }, { midi:71, cents:0 }, { midi:72, cents:0 },
  { midi:63, cents:0 },
];
export function melodyScale(){
  const buf = new Float32Array(SR * 6);
  MELODY.forEach(({midi, cents}, i) => {
    const t0 = 0.2 + i * 0.6;
    addTone(buf, "sine", midiF(midi) * Math.pow(2, cents / 1200), t0, t0 + 0.5, 0.3, 0.02, 0.04);
  });
  return buf;
}

// one sustained E5 broken by two ~40 ms dropouts — must come back as ONE note
export function brokenNote(){
  const buf = new Float32Array(SR * 4);
  [[1.0,1.5],[1.54,2.1],[2.14,2.8]].forEach(([t0,t1]) => addTone(buf, "sine", midiF(76), t0, t1, 0.4, 0.02, 0.03));
  return buf;
}

// 16 chord changes (4 s each) with a brief 0.4 s wrong-chord stab at every change
// — the stabs must be absorbed, leaving exactly 16 spans
export function chordsWithStabs(){
  const dur = 64, buf = new Float32Array(SR * dur);
  const prog = [[48,52,55],[45,48,52],[41,45,48],[43,47,50]];
  for (let t = 0; t < dur; t += 4){
    prog[(t / 4 | 0) % 4].forEach(m => addTone(buf, "tri", midiF(m), t, t + 3.95, 0.16));
    [50,53,57].forEach(m => addTone(buf, "tri", midiF(m), t + 1.8, t + 2.2, 0.12, 0.02, 0.03)); // Dm stab
  }
  return buf;
}
