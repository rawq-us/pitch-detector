// P2P sync spec (docs/P2P_SYNC_SPEC.md) — the merge brain is DOM-free: trackHash (content
// fingerprint), reconcile (3-way layer merge §5), clockMedianOffset (mini-NTP §2). Lifted from
// index.html and exercised in Node.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  extractFunction(src, "trackHash") + "\n" +
  extractFunction(src, "computeSyncBase") + "\n" +
  extractFunction(src, "trackSyncMeta") + "\n" +
  extractFunction(src, "reconcile") + "\n" +
  extractFunction(src, "clockMedianOffset") + "\n" +
  "; return { trackHash, computeSyncBase, trackSyncMeta, reconcile, clockMedianOffset };";
const M = new Function(harness)();

const trk = (uid, rev, name, extra) => ({ uid, rev, type: "midi", name, clips: [], fx: null, ...(extra || {}) });
// a sync record (what each side advertises) derived from a track
const rec = (t) => ({ uid: t.uid, rev: t.rev, hash: M.trackHash(t), updatedAt: t.updatedAt || 0 });

test("trackHash is deterministic and content-sensitive (ignores rev/uid/audio buffers)", () => {
  const a = trk("u1", 0, "Bass");
  const b = trk("u1", 9, "Bass"); // different rev, same content
  assert.equal(M.trackHash(a), M.trackHash(b), "rev/uid don't affect the content hash");
  const c = trk("u1", 0, "Bass", { transpose: 5 });
  assert.notEqual(M.trackHash(a), M.trackHash(c), "real content change → different hash");
  // empty automation lanes are ignored (match serializeAutomation pruning)
  assert.equal(M.trackHash(trk("u1", 0, "Bass", { automation: { volume: [], pan: [] } })), M.trackHash(a));
});

test("reconcile auto-takes a track added on only one side", () => {
  const local = [rec(trk("u1", 1, "Bass"))];
  const remote = [];
  const base = { sessionId: "s", tracks: {} };
  const { merged, conflicts } = M.reconcile(local, remote, base);
  assert.equal(conflicts.length, 0);
  assert.deepEqual(merged.find((m) => m.uid === "u1"), { uid: "u1", take: "local", reason: "added-local" });
});

test("reconcile fast-forwards a track changed on only one side (silent)", () => {
  const baseTrk = trk("u1", 1, "Bass");
  const base = { tracks: { u1: { rev: 1, hash: M.trackHash(baseTrk) } } };
  const localEdited = trk("u1", 2, "Bass", { transpose: 3 });    // local edited it
  const remoteSame = trk("u1", 1, "Bass");                        // remote untouched
  const { merged, conflicts } = M.reconcile([rec(localEdited)], [rec(remoteSame)], base);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.find((m) => m.uid === "u1").take, "local");
  assert.equal(merged.find((m) => m.uid === "u1").reason, "ff-local");
});

test("reconcile flags a conflict only when BOTH sides edited the same layer", () => {
  const baseTrk = trk("u1", 1, "Bass");
  const base = { tracks: { u1: { rev: 1, hash: M.trackHash(baseTrk) } } };
  const mine = rec(trk("u1", 2, "Bass", { transpose: 3 }));
  const theirs = rec(trk("u1", 2, "Bass", { transpose: -5 }));
  const { merged, conflicts } = M.reconcile([mine], [theirs], base);
  assert.equal(merged.length, 0, "no auto decision");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].uid, "u1");
  assert.equal(conflicts[0].localRev, 2);
  assert.equal(conflicts[0].remoteRev, 2);
});

test("reconcile takes a delete when the other side left the track untouched", () => {
  const baseTrk = trk("u1", 1, "Bass");
  const base = { tracks: { u1: { rev: 1, hash: M.trackHash(baseTrk) } } };
  // local still has it untouched, remote deleted it → take the delete
  const { merged, conflicts } = M.reconcile([rec(trk("u1", 1, "Bass"))], [], base);
  assert.equal(conflicts.length, 0);
  assert.equal(merged.find((m) => m.uid === "u1").take, "delete");
});

test("reconcile turns delete-vs-edit into a conflict (not a silent loss)", () => {
  const baseTrk = trk("u1", 1, "Bass");
  const base = { tracks: { u1: { rev: 1, hash: M.trackHash(baseTrk) } } };
  // local edited it; remote deleted it → conflict, surfaced for the user
  const { conflicts } = M.reconcile([rec(trk("u1", 2, "Bass", { transpose: 4 }))], [], base);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "delete-vs-edit");
  assert.equal(conflicts[0].deletedBy, "remote");
});

test("identical tracks on both sides are a no-op 'same'", () => {
  const t = trk("u1", 5, "Bass");
  const { merged, conflicts } = M.reconcile([rec(t)], [rec(t)], { tracks: {} });
  assert.equal(conflicts.length, 0);
  assert.equal(merged.find((m) => m.uid === "u1").take, "same");
});

test("clockMedianOffset takes the median offset across ping samples", () => {
  // remote clock is +1000ms ahead; symmetric 20ms RTT → offset ≈ 1000
  const samples = [
    { localSend: 0, remoteTime: 1010, localRecv: 20 },
    { localSend: 100, remoteTime: 1115, localRecv: 130 },
    { localSend: 200, remoteTime: 1205, localRecv: 220 },
  ];
  const off = M.clockMedianOffset(samples);
  assert.ok(Math.abs(off - 1000) <= 10, "recovers the ~+1000ms skew, got " + off);
  assert.equal(M.clockMedianOffset([]), 0, "no samples → 0");
});
