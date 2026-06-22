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
  extractFunction(src, "chordsToProgression") + "\n" +
  extractFunction(src, "backingDrumPattern") + "\n" +
  extractFunction(src, "buildBacking") + "\n" +
  extractFunction(src, "buildBackingPrompt") + "\n" +
  "; return { CHORD_QUAL, chordQualityFromSuffix, parseProgression, voiceProgression, chordsToProgression, backingDrumPattern, buildBacking, buildBackingPrompt };";
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

test("chordsToProgression maps detected memo spans through the suffix table", () => {
  const spans = [
    { root: 9, quality: "m" }, { root: 5, quality: "" },
    { root: 0, quality: "maj7" }, { root: 7, quality: "7" }, { root: 11, quality: "dim" },
  ];
  assert.deepEqual(M.chordsToProgression(spans), [
    { root: 9, quality: "min" }, { root: 5, quality: "maj" },
    { root: 0, quality: "maj7" }, { root: 7, quality: "dom7" }, { root: 11, quality: "dim" },
  ]);
  assert.deepEqual(M.chordsToProgression([]), []);
});

test("backingDrumPattern places kick/snare/hat on a 16-step bar", () => {
  const straight = M.backingDrumPattern(16, "straight");
  assert.deepEqual(straight.kick, [0, 8], "kick on beats 1 & 3");
  assert.deepEqual(straight.snare, [4, 12], "snare on the backbeats");
  assert.deepEqual(straight.hat, [0, 2, 4, 6, 8, 10, 12, 14], "closed hat on eighths");
  const swung = M.backingDrumPattern(16, "swung");
  assert.deepEqual(swung.hat, [0, 4, 8, 12], "swung hat thins to quarters");
});

test("buildBacking yields one spec per role with the right shape", () => {
  const prog = M.parseProgression("C G Am F");
  const specs = M.buildBacking(prog, { roles: ["pad", "bass", "arp", "drums"], bpb: 4 });
  assert.equal(specs.length, 4);
  assert.deepEqual(specs.map((s) => s.role), ["pad", "bass", "arp", "drums"]);
  const pad = specs[0], drums = specs[3];
  assert.equal(pad.type, "midi");
  assert.ok(pad.notes.length > 0 && pad.lengthBeats === 16);
  assert.equal(drums.type, "beat");
  assert.ok(drums.pattern && drums.pattern.kick.length === 2);
  assert.equal(drums.lengthBeats, 16);
  // default roles when none given
  assert.deepEqual(M.buildBacking(prog).map((s) => s.role), ["pad", "bass", "arp"]);
});

test("buildBackingPrompt names the key/mode and chord count, no prose leak", () => {
  const p = M.buildBackingPrompt({ root: 9, mode: "aeolian", bars: 6, style: "neo-soul" });
  assert.match(p, /A aeolian/);
  assert.match(p, /6-chord/);
  assert.match(p, /neo-soul/);
  assert.match(p, /JSON only/);
});
