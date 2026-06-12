// The analysis worker (memoWorkerMain) is self-contained by design, so it can
// be lifted out of index.html and exercised in Node against synthesized
// ground-truth audio. These assertions encode the acceptance criteria the
// memo layer shipped with — if they fail, the musical output regressed.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";
import { SR, chordsAndClicks, melodyScale, brokenNote, chordsWithStabs, MELODY } from "./fixtures.mjs";

const SCALES = {
  ionian:[0,2,4,5,7,9,11], dorian:[0,2,3,5,7,9,10], phrygian:[0,1,3,5,7,8,10],
  lydian:[0,2,4,6,7,9,11], mixolydian:[0,2,4,5,7,9,10], aeolian:[0,2,3,5,7,8,10], locrian:[0,1,3,5,6,8,10],
};
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function makeWorker(){
  const fn = extractFunction(extractScript(), "memoWorkerMain");
  const messages = [];
  const self = { onmessage: null, postMessage: (m) => messages.push(m) };
  new Function("self", fn + "\nmemoWorkerMain();")(self);
  return {
    analyze(pcm, opts = {}){
      messages.length = 0;
      self.onmessage({ data: {
        id: 1, pcm: pcm.buffer, sr: SR, scales: SCALES, names: NOTE_NAMES,
        bpb: opts.bpb ?? 4, fallbackBpm: opts.fallbackBpm ?? 90,
        forceRoot: opts.forceRoot ?? null, forceMode: opts.forceMode ?? null,
      }});
      const done = messages.find(m => m.ok !== undefined);
      assert.ok(done, "worker produced no result message");
      assert.equal(done.ok, true, "analysis failed: " + done.error);
      return done.analysis;
    },
  };
}

const worker = makeWorker();
const label = (c) => NOTE_NAMES[c.root] + c.quality;

test("tempo: click track at 120 BPM is tracked within ±2 BPM", () => {
  const a = worker.analyze(chordsAndClicks());
  assert.ok(a.bpm > 118 && a.bpm < 122.5, `expected ~120 BPM, got ${a.bpm}`);
  assert.ok(a.beats.length >= 14, `expected ≥14 beats over 8 s, got ${a.beats.length}`);
});

test("chords: C–Am–F–G progression detected exactly, all diatonic", () => {
  const a = worker.analyze(chordsAndClicks());
  assert.deepEqual(a.chords.map(label), ["C","Am","F","G"]);
  assert.ok(a.chords.every(c => c.diatonic), "all four chords are in C major");
});

test("key guess: chord progression reads as C ionian", () => {
  const a = worker.analyze(chordsAndClicks());
  assert.equal(a.key.root, 0);
  assert.equal(a.key.mode, "ionian");
});

test("chordal audio produces no phantom melody notes", () => {
  const a = worker.analyze(chordsAndClicks());
  assert.equal(a.notes.length, 0, `got phantom notes: ${a.notes.map(n=>n.midi).join(",")}`);
});

test("melody: pitches exact, cents within ±4, out-of-key note flagged ~100¢ from the mode", () => {
  const a = worker.analyze(melodyScale());
  assert.equal(a.notes.length, MELODY.length, "one detected note per played note");
  a.notes.forEach((n, i) => {
    assert.equal(n.midi, MELODY[i].midi, `note ${i} pitch`);
    assert.ok(Math.abs(n.cents - MELODY[i].cents) <= 4, `note ${i} cents: expected ${MELODY[i].cents}, got ${n.cents}`);
  });
  const eb = a.notes[a.notes.length - 1]; // D#4 — not in C major
  assert.ok(Math.abs(Math.abs(eb.centsToScale) - 100) <= 10, `out-of-key note should sit ~100¢ from the mode, got ${eb.centsToScale}`);
});

test("melody audio produces no phantom chord spans", () => {
  const a = worker.analyze(melodyScale());
  assert.equal(a.chords.length, 0, `got phantom chords: ${a.chords.map(label).join(",")}`);
});

test("mode-awareness: forcing C aeolian flips E natural out and Eb in", () => {
  const a = worker.analyze(melodyScale(), { forceRoot: 0, forceMode: "aeolian" });
  assert.equal(a.usedKey.root, 0);
  assert.equal(a.usedKey.mode, "aeolian");
  const e4 = a.notes.find(n => n.midi === 64);   // E natural — out of C aeolian
  const eb4 = a.notes.find(n => n.midi === 63);  // Eb — in C aeolian
  assert.ok(Math.abs(Math.abs(e4.centsToScale) - 100) <= 10, `E4 should be ~100¢ out, got ${e4.centsToScale}`);
  assert.ok(Math.abs(eb4.centsToScale) <= 10, `Eb4 should be in-mode, got ${eb4.centsToScale}`);
});

test("note fidelity: a note split by ~40 ms dropouts re-joins as one note", () => {
  const a = worker.analyze(brokenNote());
  const e5 = a.notes.filter(n => n.midi === 76);
  assert.equal(e5.length, 1, `expected 1 merged E5, got ${e5.length}`);
  assert.ok(e5[0].dur > 1.5, `merged duration should span the dropouts, got ${e5[0].dur}`);
});

test("chord fidelity: 0.4 s stab flickers are absorbed; spans respect ~2-beat minimum", () => {
  const a = worker.analyze(chordsWithStabs());
  assert.equal(a.chords.length, 16, `expected 16 spans for 16 real changes, got ${a.chords.length}`);
  const minSpan = Math.min(...a.chords.map(c => c.end - c.start));
  assert.ok(minSpan >= 1.0, `min span should be ≥1 s, got ${minSpan.toFixed(2)}`);
  const expected = ["C","Am","F","G"];
  a.chords.forEach((c, i) => assert.equal(label(c), expected[i % 4], `span ${i}`));
});

test("quiet/ambient audio falls back to a tempo grid without failing", () => {
  const a = worker.analyze(new Float32Array(SR * 5), { fallbackBpm: 100 });
  assert.equal(a.bpm, null, "no confident tempo on silence");
  assert.ok(a.beats.length > 0, "fallback beat grid exists");
  assert.equal(a.notes.length, 0);
  assert.equal(a.chords.length, 0);
});
