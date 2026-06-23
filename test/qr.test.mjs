// QR encoder core (byte mode, EC level L) — the math is DOM-free, so we lift it out of index.html and
// validate it against known QR/GF(256) reference values. (Full scan-fidelity is checked on a phone.)
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();
const harness =
  extractConstLine(src, "QR_ECC_L") + "\n" +
  extractConstLine(src, "QR_BLK_L") + "\n" +
  "let _qrExp=null,_qrLog=null;\n" +
  extractFunction(src, "qrGfInit") + "\n" +
  extractFunction(src, "qrGfMul") + "\n" +
  extractFunction(src, "qrRsGen") + "\n" +
  extractFunction(src, "qrRsEc") + "\n" +
  extractFunction(src, "qrRawDataModules") + "\n" +
  extractFunction(src, "qrDataCodewords") + "\n" +
  extractFunction(src, "qrChooseVersion") + "\n" +
  extractFunction(src, "qrMakeMatrix") + "\n" +
  extractFunction(src, "qrDrawFormat") + "\n" +
  extractFunction(src, "qrDrawVersion") + "\n" +
  extractFunction(src, "qrBch") + "\n" +
  extractFunction(src, "qrAlignPositions") + "\n" +
  extractFunction(src, "qrPenalty") + "\n" +
  "; return { qrGfMul, qrRsGen, qrChooseVersion, qrDataCodewords, qrMakeMatrix, _exp:()=>_qrLog };";
const M = new Function(harness)();

test("GF(256) multiply uses the QR field (primitive polynomial 0x11D)", () => {
  assert.equal(M.qrGfMul(2, 2), 4, "α·α = α²");
  assert.equal(M.qrGfMul(2, 0x80), 0x1d, "0x80·2 overflows and reduces by 0x11D → 0x1D");
  assert.equal(M.qrGfMul(0, 123), 0);
  assert.equal(M.qrGfMul(1, 0xab), 0xab, "1 is the identity");
});

test("the degree-7 Reed-Solomon generator matches the QR reference exponents", () => {
  // The canonical QR g₇(x) coefficients (excluding the implicit leading 1), high→low, as α-exponents
  const gen = M.qrRsGen(7);
  const exp = new Array(255); { let x = 1; for (let i = 0; i < 255; i++) { exp[i] = x; x <<= 1; if (x & 0x100) x ^= 0x11d; } }
  const log = {}; exp.forEach((v, i) => (log[v] = i));
  assert.deepEqual(gen.map((c) => log[c]), [87, 229, 146, 149, 238, 102, 21]);
});

test("version is chosen by byte capacity (level L)", () => {
  // v1-L holds 19 data codewords → (19*8 − 4 − 8)/8 = 17 bytes
  assert.equal(M.qrDataCodewords(1), 19);
  assert.equal(M.qrChooseVersion(17), 1);
  assert.equal(M.qrChooseVersion(18), 2, "one byte over v1 capacity rolls to v2");
  assert.ok(M.qrChooseVersion(700) >= 17, "a ~700-byte link needs a mid-size QR");
});

test("qrMakeMatrix produces a square, correctly-sized matrix with finder patterns", () => {
  const q = M.qrMakeMatrix("HELLO PITCH STUDIO");
  assert.ok(q, "encodes");
  assert.equal(q.matrix.length, q.size);
  assert.equal(q.size, 17 + 4 * q.version, "module count matches the version");
  // a finder pattern's centre 3×3 is dark and its surrounding ring (the white separator) is light
  const m = q.matrix, n = q.size;
  for (const [oy, ox] of [[3, 3], [3, n - 4], [n - 4, 3]]) {
    assert.equal(m[oy][ox], true, "finder centre dark");
    assert.equal(m[oy][ox + 2], true, "finder inner-ring corner dark");
    assert.equal(m[oy + 1][ox + 1], false, "finder white ring");
  }
  assert.ok(q.mask >= 0 && q.mask < 8, "a mask was chosen");
});

test("a long link still encodes (the real use case)", () => {
  const link = "https://rawq-us.github.io/pitch-detector/#invite=" + "c" + "A".repeat(640);
  const q = M.qrMakeMatrix(link);
  assert.ok(q && q.version >= 17 && q.version <= 28, "fits a mid-size QR, got v" + (q && q.version));
});
