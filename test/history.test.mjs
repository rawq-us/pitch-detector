// Roadmap item 1 — undo/redo. The history stack (makeHistory) is DOM-free, so we lift it out of
// index.html and exercise its semantics in Node. The acceptance round-trip (mutate → undo → equal)
// is modelled here with plain-object snapshots, mirroring how snapshotProject/restoreProject pair up.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness = extractFunction(src, "makeHistory") + "\n; return { makeHistory };";
const M = new Function(harness)();

test("push/undo/redo returns the opposite-direction entries", () => {
  const h = M.makeHistory(100);
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  h.push({ label: "a", snap: 1 });
  h.push({ label: "b", snap: 2 });
  assert.equal(h.canUndo(), true);
  // undoing returns the most recent entry; the current state is parked for redo
  const u = h.undo({ label: "b", snap: 99 });
  assert.deepEqual(u, { label: "b", snap: 2 });
  assert.equal(h.canRedo(), true);
  const r = h.redo({ label: "b", snap: 2 });
  assert.deepEqual(r, { label: "b", snap: 99 });
});

test("a fresh push clears the redo branch", () => {
  const h = M.makeHistory(100);
  h.push({ label: "a", snap: 1 });
  h.undo({ label: "a", snap: 2 });
  assert.equal(h.canRedo(), true);
  h.push({ label: "c", snap: 3 });   // new action invalidates redo
  assert.equal(h.canRedo(), false);
});

test("depth cap drops the oldest entries", () => {
  const h = M.makeHistory(3);
  for (let i = 0; i < 5; i++) h.push({ label: "e" + i, snap: i });
  assert.equal(h.sizes().undo, 3, "capped at depth");
  // the three survivors are the newest (e2,e3,e4); peekUndo is the newest
  assert.equal(h.peekUndo().label, "e4");
});

test("peek labels drive the button tooltips without mutating", () => {
  const h = M.makeHistory(100);
  assert.equal(h.peekUndo(), null);
  h.push({ label: "move clip", snap: {} });
  assert.equal(h.peekUndo().label, "move clip");
  assert.equal(h.sizes().undo, 1, "peek does not pop");
});

test("undo/redo round-trip restores an equal snapshot (acceptance)", () => {
  const h = M.makeHistory(100);
  // model: state is a serializable project slice; snapshot = structuredClone
  const state = { tracks: [{ id: 1, clips: [{ id: 1, start: 0 }] }], lengthSec: 32 };
  const snap = (s) => JSON.parse(JSON.stringify(s));
  const before = snap(state);
  h.push({ label: "move clip", snap: before });
  // mutate
  state.tracks[0].clips[0].start = 4;
  state.lengthSec = 40;
  // undo: park current, restore before
  const u = h.undo({ label: "move clip", snap: snap(state) });
  const restored = u.snap;
  assert.deepEqual(restored, { tracks: [{ id: 1, clips: [{ id: 1, start: 0 }] }], lengthSec: 32 });
  // redo: returns the mutated state we parked
  const r = h.redo({ label: "move clip", snap: restored });
  assert.deepEqual(r.snap, { tracks: [{ id: 1, clips: [{ id: 1, start: 4 }] }], lengthSec: 40 });
});

test("undo on an empty stack is a no-op (returns null)", () => {
  const h = M.makeHistory(100);
  assert.equal(h.undo({ label: "x", snap: 0 }), null);
  assert.equal(h.canRedo(), false, "a no-op undo must not seed redo");
});
