// Collab signaling codec — the link encode/parse + base64url is DOM-free (btoa/atob exist in Node),
// so we lift it out of index.html and exercise it. The compression path uses CompressionStream
// (browser / Node 18+) and is covered by the in-browser preview check.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  extractFunction(src, "bytesToB64url") + "\n" +
  extractFunction(src, "b64urlToBytes") + "\n" +
  extractFunction(src, "buildSignalUrl") + "\n" +
  extractFunction(src, "parseSignalHash") + "\n" +
  "; return { bytesToB64url, b64urlToBytes, buildSignalUrl, parseSignalHash };";
const M = new Function(harness)();

test("base64url round-trips arbitrary bytes and is URL-safe", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 62, 63, 64]); // includes the +/ → -_ cases
  const enc = M.bytesToB64url(bytes);
  assert.ok(!/[+/=]/.test(enc), "no +, / or = in base64url output");
  assert.deepEqual([...M.b64urlToBytes(enc)], [...bytes]);
});

test("buildSignalUrl puts the payload in the #hash under the right kind", () => {
  const url = M.buildSignalUrl("https://x.app/pitch/", "invite", "PACKED123");
  assert.equal(url, "https://x.app/pitch/#invite=PACKED123");
});

test("parseSignalHash extracts kind + payload from a full URL or a bare hash", () => {
  assert.deepEqual(M.parseSignalHash("https://x.app/p/#invite=AbC-_123"), { kind: "invite", payload: "AbC-_123" });
  assert.deepEqual(M.parseSignalHash("#reply=ZZZ"), { kind: "reply", payload: "ZZZ" });
  assert.equal(M.parseSignalHash("https://x.app/p/"), null, "no signal hash → null");
  assert.equal(M.parseSignalHash("#other=123"), null, "unknown kind → null");
});

test("parseSignalHash payload survives a buildSignalUrl round-trip", () => {
  const payload = M.bytesToB64url(new TextEncoder().encode(JSON.stringify({ type: "offer", sdp: "v=0..." })));
  const url = M.buildSignalUrl("https://rawq-us.github.io/pitch-detector/", "invite", payload);
  const parsed = M.parseSignalHash(url);
  assert.equal(parsed.kind, "invite");
  assert.equal(parsed.payload, payload);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(M.b64urlToBytes(parsed.payload))), { type: "offer", sdp: "v=0..." });
});
