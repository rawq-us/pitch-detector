// Roadmap item 4 — chord-driven backing generation. The progression parser and the role
// voicers are DOM-free, so we lift them out of index.html and exercise them in Node.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();
const harness =
  extractConstLine(src, "CHORD_QUAL") + "\n" +
  extractFunction(src, "chordQualityFromSuffix") + "\n" +
  extractFunction(src, "parseProgression") + "\n" +
  extractFunction(src, "voiceProgression") + "\n" +
  "; return { CHORD_QUAL, chordQualityFromSuffix, parseProgression, voiceProgression };";
const M = new Function(harness)();

const pcOf = (m) => ((m % 12) + 12) % 12;

test("parseProgression reads roots, accidentals and qualities", () => {
  assert.deepEqual(M.parseProgression("A C#m F#m D"), [
    { root: 9, quality: "maj" }, { root: 1, quality: "min" },
    { root: 6, quality: "min" }, { root: 2, quality: "maj" },
  ]);
  // separators (comma / pipe / slash), flats, and sevenths
  assert.deepEqual(M.parseProgression("Bb, Dm7 | G7 / Cmaj7"), [
    { root: 10, quality: "maj" }, { root: 2, quality: "min7" },
    { root: 7, quality: "dom7" }, { root: 0, quality: "maj7" },
  ]);
  assert.deepEqual(M.parseProgression(""), []);
});

test("chordQualityFromSuffix maps the common ASCII forms", () => {
  const c = M.chordQualityFromSuffix;
  assert.equal(c(""), "maj"); assert.equal(c("m"), "min"); assert.equal(c("min"), "min");
  assert.equal(c("maj7"), "maj7"); assert.equal(c("m7"), "min7"); assert.equal(c("7"), "dom7");
  assert.equal(c("dim"), "dim"); assert.equal(c("sus4"), "sus4");
});

test("pad voicing of A major contains exactly the A-major triad pitch classes", () => {
  const { notes } = M.voiceProgression([{ root: 9, quality: "maj" }], "pad", 4);
  const pcs = new Set(notes.map((n) => pcOf(n.midi)));
  assert.deepEqual([...pcs].sort((a, b) => a - b), [1, 4, 9]); // C#, E, A
  assert.ok(notes.every((n) => n.beat === 0), "pad chord is a simultaneous block");
});

test("bass voicing puts the root on the downbeat and the fifth mid-bar", () => {
  const { notes } = M.voiceProgression([{ root: 2, quality: "min" }], "bass", 4); // D minor
  assert.equal(notes.length, 2);
  assert.equal(pcOf(notes[0].midi), 2, "downbeat = root D");
  assert.equal(notes[0].beat, 0);
  assert.equal(pcOf(notes[1].midi), 9, "mid-bar = fifth A");
  assert.equal(notes[1].beat, 2);
  assert.ok(notes[0].midi < 48, "bass sits in a low register");
});

test("arp voicing stays within the chord tones and spans the bar in eighths", () => {
  const chord = { root: 0, quality: "maj7" }; // C maj7 = C E G B
  const { notes, lengthBeats } = M.voiceProgression([chord], "arp", 4);
  assert.equal(lengthBeats, 4);
  assert.equal(notes.length, 8, "eighth-note run across a 4-beat bar");
  const allowed = new Set([0, 4, 7, 11]); // C E G B as pitch classes
  assert.ok(notes.every((n) => allowed.has(pcOf(n.midi))), "every arp note is a chord tone");
});

test("a multi-chord progression lays out sequentially by bar", () => {
  const prog = M.parseProgression("C G Am F");
  const { notes, lengthBeats } = M.voiceProgression(prog, "pad", 4);
  assert.equal(lengthBeats, 16, "4 chords × 4 beats");
  assert.equal(Math.min(...notes.map((n) => n.beat)), 0);
  assert.equal(Math.max(...notes.map((n) => n.beat)), 12, "last chord starts at bar 4");
});
