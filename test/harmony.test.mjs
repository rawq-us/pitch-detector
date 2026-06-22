// Roadmap item 5 — harmony assistant. The theory engine (diatonicChords, suggestChords,
// suggestProgression, voiceLead) is DOM-free; we lift it (and the SCALES/MODE_LABEL tables it needs)
// out of index.html and exercise it in Node.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();
const harness =
  extractConstLine(src, "SCALES") + "\n" +
  extractConstLine(src, "MODE_LABEL") + "\n" +
  extractConstLine(src, "NOTE_NAMES") + "\n" +
  extractConstLine(src, "ROMAN_BASE") + "\n" +
  extractConstLine(src, "HARMONY_TENDENCY") + "\n" +
  extractFunction(src, "triadQuality") + "\n" +
  extractFunction(src, "romanFor") + "\n" +
  extractFunction(src, "diatonicChords") + "\n" +
  extractFunction(src, "suggestChords") + "\n" +
  extractFunction(src, "suggestProgression") + "\n" +
  extractFunction(src, "voiceLead") + "\n" +
  extractFunction(src, "chordSuffix") + "\n" +
  extractFunction(src, "progressionToText") + "\n" +
  "; return { diatonicChords, suggestChords, suggestProgression, voiceLead, progressionToText };";
const M = new Function(harness)();

const pcOf = (m) => ((m % 12) + 12) % 12;

test("diatonicChords of C major has the textbook qualities and Roman numerals", () => {
  const d = M.diatonicChords(0, "ionian");
  assert.deepEqual(d.map((c) => c.roman), ["I", "ii", "iii", "IV", "V", "vi", "vii°"]);
  assert.deepEqual(d.map((c) => c.root), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(d.map((c) => c.quality), ["maj", "min", "min", "maj", "maj", "min", "dim"]);
});

test("diatonicChords of A Dorian carries the Dorian colour (major IV)", () => {
  const d = M.diatonicChords(9, "dorian");
  assert.equal(d[0].quality, "min", "i is minor");
  assert.equal(d[3].quality, "maj", "the bright major IV is Dorian's signature");
});

test("suggestChords from A major proposes a sensible diatonic set with correct numerals (acceptance)", () => {
  const s = M.suggestChords(9, "ionian", [{ root: 9, quality: "maj" }]); // after the I chord
  assert.ok(s.length >= 3);
  const scale = new Set([9, 11, 1, 2, 4, 6, 8]); // A major pitch classes
  assert.ok(s.every((c) => scale.has(c.root)), "every diatonic suggestion is in key");
  // the strongest move after I is to the dominant (E major = V)
  assert.equal(s[0].roman, "V");
  assert.equal(s[0].root, 4);
  assert.ok(s.every((c) => c.rationale && c.rationale.length), "each comes with a rationale");
});

test("suggestChords offers at least one tasteful borrowed option when asked (acceptance)", () => {
  const s = M.suggestChords(0, "ionian", [{ root: 5, quality: "maj" }], { borrow: true });
  const borrowed = s.filter((c) => c.borrowed);
  assert.ok(borrowed.length >= 1, "borrowed chords appear");
  // from C major's parallel minor: iv (Fm), ♭VI (Ab), ♭VII (Bb) — none are diatonic to C major
  assert.ok(borrowed.some((c) => c.root === 5 && c.quality === "min"), "iv (Fm) is offered");
});

test("secondary dominants are dominant-7 chords a fifth above their target", () => {
  const s = M.suggestChords(0, "ionian", [{ root: 0, quality: "maj" }], { secondaryDominants: true });
  const v_of_V = s.find((c) => c.roman === "V7/V");
  assert.ok(v_of_V, "V7/V offered");
  assert.equal(v_of_V.root, 2, "D7 tonicizes G (the V)");
  assert.equal(v_of_V.quality, "dom7");
});

test("suggestProgression builds an in-key chain starting on the tonic", () => {
  const prog = M.suggestProgression(7, "ionian", 4); // G major
  assert.equal(prog.length, 4);
  assert.equal(prog[0].root, 7, "starts on the tonic");
  const scale = new Set([7, 9, 11, 0, 2, 4, 6]); // G major
  assert.ok(prog.every((c) => scale.has(c.root)), "all chords diatonic");
  // no immediate repeats
  for (let i = 1; i < prog.length; i++) assert.ok(!(prog[i].root === prog[i - 1].root && prog[i].quality === prog[i - 1].quality));
  assert.equal(M.progressionToText(prog).split(" ").length, 4, "round-trips to a 4-token text");
});

test("voiceLead places target tones in the octave nearest the previous voicing (minimal motion)", () => {
  const from = [60, 64, 67]; // C major triad
  const to = M.voiceLead(from, [7, 11, 2]); // → G major (G B D)
  assert.deepEqual(to.map(pcOf).sort((a, b) => a - b), [2, 7, 11]);
  // every note lands within a tritone of the previous chord's centre (~64) → no octave leaps
  assert.ok(to.every((m) => Math.abs(m - 64) <= 6), "tones stay near the register, minimizing travel");
});
