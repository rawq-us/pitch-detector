// Roadmap item 2 — clip editing. The model ops (splitMidiNotes, splitClipData, cloneClipData) are
// DOM-free, so we lift them out of index.html and exercise them in Node. cloneClipData delegates to
// snapClip (the undo cloner), so we pull that in too.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  extractFunction(src, "snapClip") + "\n" +
  extractFunction(src, "cloneClipData") + "\n" +
  extractFunction(src, "splitMidiNotes") + "\n" +
  extractFunction(src, "splitClipData") + "\n" +
  "; return { snapClip, cloneClipData, splitMidiNotes, splitClipData };";
const M = new Function(harness)();

test("splitMidiNotes partitions notes around the cut", () => {
  const notes = [
    { midi: 60, beat: 0, dur: 1, vel: 100 },   // wholly left
    { midi: 62, beat: 2, dur: 1, vel: 90 },     // wholly right
  ];
  const { left, right } = M.splitMidiNotes(notes, 2);
  assert.equal(left.length, 1);
  assert.equal(left[0].midi, 60);
  assert.equal(right.length, 1);
  assert.equal(right[0].midi, 62);
  assert.equal(right[0].beat, 0, "right side is rebased to beat 0");
});

test("splitMidiNotes splits a note straddling the cut into head + tail", () => {
  const notes = [{ midi: 64, beat: 1, dur: 2, vel: 100 }];   // spans beats 1..3
  const { left, right } = M.splitMidiNotes(notes, 2);
  assert.equal(left.length, 1);
  assert.equal(left[0].dur, 1, "head clamped to the cut (beat 1 → 2)");
  assert.equal(right.length, 1);
  assert.equal(right[0].beat, 0, "tail starts the right clip");
  assert.equal(right[0].dur, 1, "tail carries the remaining duration");
});

test("splitClipData produces two MIDI clip payloads with correct lengths", () => {
  const clip = { id: 7, start: 0, lengthBeats: 8, notes: [{ midi: 60, beat: 0, dur: 1 }, { midi: 67, beat: 5, dur: 1 }] };
  const parts = M.splitClipData("midi", clip, 4, 8);
  assert.ok(parts, "split inside the clip succeeds");
  assert.equal(parts.left.lengthBeats, 4);
  assert.equal(parts.right.lengthBeats, 4);
  assert.equal(parts.left.notes.length, 1);
  assert.equal(parts.right.notes.length, 1);
  assert.equal(parts.right.notes[0].beat, 1, "5 - 4 = 1, rebased");
  assert.equal(parts.left.id, undefined, "payloads carry no id (caller assigns)");
});

test("splitClipData refuses a cut outside the clip or a non-MIDI type", () => {
  const clip = { lengthBeats: 8, notes: [] };
  assert.equal(M.splitClipData("midi", clip, 0, 8), null, "cut at 0 is rejected");
  assert.equal(M.splitClipData("midi", clip, 8, 8), null, "cut at the end is rejected");
  assert.equal(M.splitClipData("beat", clip, 4, 8), null, "looping pattern types aren't split");
});

test("cloneClipData deep-copies arrays but shares the decoded buffer, and drops id/start", () => {
  const buf = { __pcm: true };
  const clip = { id: 3, start: 12, audioDur: 4, offset: 1, length: 2, blob: { size: 1 }, buffer: buf };
  const d = M.cloneClipData("voice", clip);
  assert.equal(d.id, undefined);
  assert.equal(d.start, undefined);
  assert.equal(d.offset, 1);
  assert.equal(d.length, 2);
  assert.equal(d.buffer, buf, "decoded PCM shared by reference, never copied");

  const midi = { id: 1, start: 0, lengthBeats: 4, notes: [{ midi: 60, beat: 0, dur: 1 }] };
  const dm = M.cloneClipData("midi", midi);
  dm.notes[0].midi = 72;
  assert.equal(midi.notes[0].midi, 60, "note array is deep-copied, not shared");
});
