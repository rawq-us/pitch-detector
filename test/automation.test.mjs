// Roadmap item 8 — track automation. The interpolation (automationValueAt) and the serializer
// (serializeAutomation) are DOM-free; we lift them out of index.html and exercise them in Node.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  extractFunction(src, "automationValueAt") + "\n" +
  extractFunction(src, "serializeAutomation") + "\n" +
  "; return { automationValueAt, serializeAutomation };";
const M = new Function(harness)();

test("automationValueAt interpolates linearly between points", () => {
  const pts = [{ beat: 0, val: 0 }, { beat: 4, val: 1 }];
  assert.equal(M.automationValueAt(pts, 0, 1), 0);
  assert.equal(M.automationValueAt(pts, 2, 1), 0.5, "halfway → 0.5");
  assert.equal(M.automationValueAt(pts, 4, 1), 1);
  assert.equal(M.automationValueAt(pts, 1, 1), 0.25);
});

test("automationValueAt holds the edge values outside the point range", () => {
  const pts = [{ beat: 2, val: 0.3 }, { beat: 6, val: 0.9 }];
  assert.equal(M.automationValueAt(pts, 0, 1), 0.3, "before the first point holds its value");
  assert.equal(M.automationValueAt(pts, 99, 1), 0.9, "after the last holds its value");
});

test("automationValueAt returns the default for an empty/absent lane (no effect)", () => {
  assert.equal(M.automationValueAt([], 3, 1), 1);
  assert.equal(M.automationValueAt(null, 3, 0), 0);
  assert.equal(M.automationValueAt(undefined, 3, 0.7), 0.7);
});

test("automationValueAt tolerates unsorted points", () => {
  const pts = [{ beat: 4, val: 1 }, { beat: 0, val: 0 }, { beat: 2, val: 0.5 }];
  assert.equal(M.automationValueAt(pts, 1, 0), 0.25);
  assert.equal(M.automationValueAt(pts, 3, 0), 0.75);
});

test("serializeAutomation drops empty maps and deep-copies non-empty ones", () => {
  assert.equal(M.serializeAutomation(null), undefined);
  assert.equal(M.serializeAutomation({ volume: [], pan: [] }), undefined, "all-empty → undefined (clean session)");
  const a = { volume: [{ beat: 0, val: 1 }], pan: [] };
  const s = M.serializeAutomation(a);
  assert.deepEqual(s, { volume: [{ beat: 0, val: 1 }] }, "empty lanes pruned");
  s.volume[0].val = 0;
  assert.equal(a.volume[0].val, 1, "deep-copied, not shared");
});
