// Roadmap WebRTC item — the wire protocol (rtcEncode/rtcDecode/peerColor) is DOM-free, so we lift it
// out of index.html and exercise its framing + validation in Node. The peer connection itself needs two
// live browsers and is covered by the manual smoke test.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();
const harness =
  extractConstLine(src, "RTC_PROTO") + "\n" +
  extractFunction(src, "rtcEncode") + "\n" +
  extractFunction(src, "rtcDecode") + "\n" +
  extractFunction(src, "peerColor") + "\n" +
  "; return { RTC_PROTO, rtcEncode, rtcDecode, peerColor };";
const M = new Function(harness)();

test("rtcEncode/rtcDecode round-trip a typed message", () => {
  const wire = M.rtcEncode("transport", { action: "play", pos: 1.5 });
  const msg = M.rtcDecode(wire);
  assert.deepEqual(msg, { type: "transport", data: { action: "play", pos: 1.5 } });
});

test("rtcEncode normalises undefined data to null", () => {
  const msg = M.rtcDecode(M.rtcEncode("bye"));
  assert.deepEqual(msg, { type: "bye", data: null });
});

test("rtcDecode rejects malformed or hostile input (inbound is validated)", () => {
  assert.equal(M.rtcDecode("not json"), null);
  assert.equal(M.rtcDecode("42"), null, "non-object");
  assert.equal(M.rtcDecode(JSON.stringify({ type: "state", data: {} })), null, "missing protocol version");
  assert.equal(M.rtcDecode(JSON.stringify({ v: 999, type: "state", data: {} })), null, "wrong version");
  assert.equal(M.rtcDecode(JSON.stringify({ v: 1, type: "evil_exec", data: {} })), null, "unknown type dropped");
  assert.equal(M.rtcDecode(JSON.stringify({ v: 1 })), null, "no type");
});

test("all real message types decode", () => {
  for (const t of ["hello", "bye", "transport", "state", "cursor"]) {
    assert.equal(M.rtcDecode(M.rtcEncode(t, { x: 1 })).type, t);
  }
});

test("peerColor is deterministic and an hsl string", () => {
  assert.equal(M.peerColor("Alex"), M.peerColor("Alex"));
  assert.notEqual(M.peerColor("Alex"), M.peerColor("Sam"));
  assert.match(M.peerColor("Alex"), /^hsl\(\d+,70%,60%\)$/);
});
