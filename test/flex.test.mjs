// Flex time — WSOLA time-stretch + warp-to-grid acceptance tests.
// flexWarp and flexAnchorsToGrid are kept self-contained in index.html so they
// can be lifted out and exercised in Node against synthesized ground-truth audio.
// These assertions encode the guarantees the flex layer ships with: pitch is
// preserved across a stretch, length tracks the warp map, an identity map is a
// no-op, and beat→grid anchor derivation is monotonic and strength-controlled.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const flexWarp = new Function(extractFunction(src, "flexWarp") + "\nreturn flexWarp;")();
const flexAnchorsToGrid = new Function(extractFunction(src, "flexAnchorsToGrid") + "\nreturn flexAnchorsToGrid;")();

const SR = 16000;

function sine(freq, durSec, sr = SR){
  const n = Math.round(durSec * sr), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

// Dominant period via autocorrelation peak (in samples) over a plausible pitch range.
function dominantPeriod(x, sr = SR, loHz = 120, hiHz = 1000){
  const loLag = Math.floor(sr / hiHz), hiLag = Math.ceil(sr / loHz);
  let bestLag = loLag, best = -Infinity;
  for (let lag = loLag; lag <= hiLag; lag++){
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    if (s > best){ best = s; bestLag = lag; }
  }
  return bestLag;
}

function rms(x){ let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); }

test("flexWarp: 2x stretch doubles length and preserves pitch", () => {
  const f = 440, input = sine(f, 1.0);
  const anchors = [{ src: 0, dst: 0 }, { src: 1.0, dst: 2.0 }];   // stretch to 2x
  const out = flexWarp(input, SR, anchors);
  assert.ok(Math.abs(out.length - 2 * SR) < 0.05 * SR, `length ~2s, got ${(out.length/SR).toFixed(3)}s`);
  const expPeriod = SR / f;
  const got = dominantPeriod(out);
  assert.ok(Math.abs(got - expPeriod) <= 2, `pitch preserved: expected period ~${expPeriod.toFixed(1)}, got ${got}`);
});

test("flexWarp: 0.5x compression halves length and preserves pitch", () => {
  const f = 330, input = sine(f, 1.0);
  const anchors = [{ src: 0, dst: 0 }, { src: 1.0, dst: 0.5 }];
  const out = flexWarp(input, SR, anchors);
  assert.ok(Math.abs(out.length - 0.5 * SR) < 0.05 * SR, `length ~0.5s, got ${(out.length/SR).toFixed(3)}s`);
  const got = dominantPeriod(out), exp = SR / f;
  assert.ok(Math.abs(got - exp) <= 2, `pitch preserved: expected ~${exp.toFixed(1)}, got ${got}`);
});

test("flexWarp: identity map reproduces the signal (level + pitch)", () => {
  const f = 220, input = sine(f, 0.8);
  const out = flexWarp(input, SR, [{ src: 0, dst: 0 }, { src: 0.8, dst: 0.8 }]);
  assert.ok(Math.abs(out.length - input.length) < 0.03 * SR, "near-identical length");
  assert.ok(Math.abs(rms(out) - rms(input)) < 0.08, `level preserved: ${rms(input).toFixed(3)} -> ${rms(out).toFixed(3)}`);
  assert.ok(Math.abs(dominantPeriod(out) - SR / f) <= 2, "pitch preserved");
});

test("flexWarp: variable-rate map lands a mid anchor at its output time", () => {
  // first half stretched 2x, second half kept — the boundary transient should
  // appear near t=1.0s in the output.
  const sr = SR, n = 2 * sr, input = new Float32Array(n);
  for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  input[sr] = 4; input[sr + 1] = -4;   // sharp marker at src=1.0s
  const anchors = [{ src: 0, dst: 0 }, { src: 1.0, dst: 2.0 }, { src: 2.0, dst: 3.0 }];
  const out = flexWarp(input, sr, anchors);
  assert.ok(Math.abs(out.length - 3 * sr) < 0.05 * sr, "total length ~3s");
  // locate the loudest sample — the marker should have moved to ~2.0s
  let peakIdx = 0, peak = 0;
  for (let i = 0; i < out.length; i++){ const a = Math.abs(out[i]); if (a > peak){ peak = a; peakIdx = i; } }
  assert.ok(Math.abs(peakIdx / sr - 2.0) < 0.1, `marker near 2.0s, got ${(peakIdx/sr).toFixed(2)}s`);
});

test("flexAnchorsToGrid: already-on-grid beats yield a near-identity map", () => {
  const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];   // 120 BPM detected
  const anchors = flexAnchorsToGrid(beats, { bpm: 120, dur: 3.5, strength: 1 });
  assert.equal(anchors[0].src, 0); assert.equal(anchors[0].dst, 0);
  for (const a of anchors) assert.ok(Math.abs(a.dst - a.src) < 0.02, `dst~src at src=${a.src}`);
});

test("flexAnchorsToGrid: retargeting to a slower grid stretches monotonically", () => {
  const beats = [0.5, 1.0, 1.5, 2.0];             // detected at 120 BPM
  const anchors = flexAnchorsToGrid(beats, { bpm: 100, dur: 2.2, strength: 1 });  // target 100 BPM -> 0.6 s/beat
  // beat i (1-indexed) should map to i * 0.6
  const beatAnchors = anchors.filter(a => a.src > 0 && a.src <= 2.0);
  beatAnchors.forEach((a, i) => assert.ok(Math.abs(a.dst - (i + 1) * 0.6) < 0.02, `beat ${i+1} -> ${(i+1)*0.6}, got ${a.dst.toFixed(3)}`));
  for (let i = 1; i < anchors.length; i++) assert.ok(anchors[i].dst > anchors[i-1].dst, "dst strictly increasing");
});

test("tempo re-warp: a faster target tempo shortens the warped timeline", () => {
  const beats = [0.5, 1.0, 1.5, 2.0];
  const slow = flexAnchorsToGrid(beats, { bpm: 90, dur: 2.2, strength: 1 });
  const fast = flexAnchorsToGrid(beats, { bpm: 180, dur: 2.2, strength: 1 });
  const lastSlow = slow[slow.length-1].dst, lastFast = fast[fast.length-1].dst;
  assert.ok(lastFast < lastSlow, `180bpm grid (${lastFast.toFixed(2)}s) should be shorter than 90bpm (${lastSlow.toFixed(2)}s)`);
});

test("flexAnchorsToGrid: strength 0 is identity", () => {
  const beats = [0.5, 1.0, 1.5];
  const anchors = flexAnchorsToGrid(beats, { bpm: 80, dur: 2.0, strength: 0 });
  for (const a of anchors) assert.ok(Math.abs(a.dst - a.src) < 1e-6, `identity at src=${a.src}`);
});

test("flexAnchorsToGrid: a missed beat (double gap) advances two grid beats", () => {
  const beats = [0.5, 1.0, 2.0, 2.5];   // median gap 0.5s; the 1.0->2.0 gap is a missed beat
  const spb = 60 / 90;                   // retarget to 90 BPM so the grid differs from detection
  const anchors = flexAnchorsToGrid(beats, { bpm: 90, dur: 3.0, strength: 1 });
  // src=2.0 is the 4th grid beat (gap counted as 2), so dst = 4*spb, not 3*spb
  const a = anchors.find(x => Math.abs(x.src - 2.0) < 1e-6);
  assert.ok(a && Math.abs(a.dst - 4 * spb) < 0.02, `src 2.0 -> grid beat 4 (${(4*spb).toFixed(3)}s), got ${a && a.dst.toFixed(3)}`);
  assert.ok(Math.abs(a.dst - 3 * spb) > 0.1, "did not collapse the missed beat into grid beat 3");
});

const memoSliceAnalysis = new Function(extractFunction(src, "memoSliceAnalysis") + "\nreturn memoSliceAnalysis;")();
test("memoSliceAnalysis: shifts + clips beats/chords/notes to the kept region", () => {
  const a = { dur:10, beats:[1,2,3,4,5],
    chords:[{start:0,end:4,root:0,quality:""},{start:4,end:8,root:5,quality:"m"}],
    notes:[{start:1,dur:2,midi:60},{start:6,dur:2,midi:62}] };
  const v = memoSliceAnalysis(a, 3, 7);            // keep [3,7] → 4s window
  assert.equal(v.dur, 4);
  assert.deepEqual(v.beats, [0,1,2]);              // beats 3,4,5 → shifted
  assert.equal(v.chords.length, 2);
  assert.deepEqual(v.chords[0], {start:0,end:1,root:0,quality:""});   // 0–4 clipped to window head
  assert.deepEqual(v.chords[1], {start:1,end:4,root:5,quality:"m"});  // 4–8 clipped to window tail
  assert.equal(v.notes.length, 1);                 // note 1–3 ends at the boundary → dropped
  assert.equal(v.notes[0].start, 3); assert.equal(v.notes[0].dur, 1);
});
