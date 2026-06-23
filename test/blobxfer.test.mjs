// Collab audio-blob transfer — the chunk math (concatChunks, blobChunkCount) is DOM-free, so we lift
// it out of index.html and verify a split→reassemble round-trip. The live transfer is a 2-browser test.
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction } from "./extract.mjs";

const src = extractScript();
const harness =
  extractFunction(src, "concatChunks") + "\n" +
  extractFunction(src, "blobChunkCount") + "\n" +
  "const BLOB_CHUNK=12*1024;\n" +
  "; return { concatChunks, blobChunkCount, BLOB_CHUNK };";
const M = new Function(harness)();

test("blobChunkCount counts ceil(len / chunkSize)", () => {
  assert.equal(M.blobChunkCount(0, 100), 0);
  assert.equal(M.blobChunkCount(100, 100), 1);
  assert.equal(M.blobChunkCount(101, 100), 2);
  assert.equal(M.blobChunkCount(250, 100), 3);
});

test("split into chunks then concatChunks reassembles the exact bytes", () => {
  const size = M.BLOB_CHUNK;
  const data = new Uint8Array(size * 3 + 137);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) & 0xff;
  const n = M.blobChunkCount(data.length, size);
  assert.equal(n, 4, "3 full chunks + a tail");
  const chunks = [];
  for (let i = 0; i < n; i++) chunks.push(data.subarray(i * size, (i + 1) * size));
  const back = M.concatChunks(chunks);
  assert.equal(back.length, data.length);
  assert.deepEqual([...back], [...data]);
});

test("concatChunks tolerates a missing (null) chunk by skipping it", () => {
  const a = new Uint8Array([1, 2, 3]), b = new Uint8Array([4, 5]);
  assert.deepEqual([...M.concatChunks([a, null, b])], [1, 2, 3, 4, 5]);
});
