// Roadmap item 7 — level meters. The signal math (RMS/peak of a time-domain frame → a dB-scaled
// 0..1 bar) is DOM-free; we lift it out of index.html and exercise it in Node.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  "const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));\n" +
  extractFunction(src, "analyserRms") + "\n" +
  extractFunction(src, "analyserPeak") + "\n" +
  extractFunction(src, "linToDb") + "\n" +
  extractFunction(src, "dbToFrac") + "\n" +
  extractFunction(src, "meterFrac") + "\n" +
  "; return { analyserRms, analyserPeak, linToDb, dbToFrac, meterFrac };";
const M = new Function(harness)();

test("analyserRms is the root-mean-square of the frame", () => {
  assert.equal(M.analyserRms([1, 1, 1, 1]), 1);
  assert.equal(M.analyserRms([0, 0, 0, 0]), 0);
  assert.ok(Math.abs(M.analyserRms([1, -1, 1, -1]) - 1) < 1e-9, "full-scale square wave → 1");
  assert.ok(Math.abs(M.analyserRms([0.5, -0.5]) - 0.5) < 1e-9);
});

test("analyserPeak is the max absolute sample", () => {
  assert.equal(M.analyserPeak([0.2, -0.9, 0.5]), 0.9);
  assert.equal(M.analyserPeak([]), 0);
});

test("linToDb maps amplitude to decibels (0 dB at full scale)", () => {
  assert.ok(Math.abs(M.linToDb(1) - 0) < 1e-9, "1.0 → 0 dB");
  assert.ok(Math.abs(M.linToDb(0.5) - (-6.0206)) < 0.01, "half amplitude ≈ -6 dB");
  assert.ok(M.linToDb(0) <= -100, "silence floors out");
});

test("meterFrac fills 0..1 across the dB floor", () => {
  assert.equal(M.meterFrac(0), 0, "silence reads empty");
  assert.equal(M.meterFrac(1), 1, "full scale reads full");
  const half = M.meterFrac(0.5); // -6 dB over a -60 floor → 54/60 = 0.9
  assert.ok(half > 0.85 && half < 0.95, "-6 dB sits near the top");
  const quiet = M.meterFrac(0.001); // -60 dB → 0
  assert.ok(quiet <= 0.01, "at the floor reads empty");
});

test("meterFrac respects a custom floor and never escapes 0..1", () => {
  // -6 dB over a -12 floor sits halfway: (−6 − −12)/(0 − −12) = 0.5
  assert.ok(Math.abs(M.meterFrac(0.5, -12) - 0.5) < 0.02, "-6 dB is mid-scale on a -12 floor");
  assert.equal(M.meterFrac(2, -60), 1, "above 0 dB clamps to 1");
  assert.equal(M.meterFrac(0.0001, -12), 0, "well below the floor clamps to 0");
});
