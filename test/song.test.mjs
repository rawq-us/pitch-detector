// Tests for the v1.8 builders: sampler event expansion, ID3 tag writer,
// SRT subtitles, song metadata, and the WAV writer with an embedded id3 chunk.
// Lifted out of index.html (DOM-free by design — see docs/TESTING.md).
import test from "node:test";
import assert from "node:assert/strict";
import { extractScript, extractFunction, extractConstLine } from "./extract.mjs";

const src = extractScript();

function sandbox(){
  const parts = [
    extractConstLine(src, "APP_VERSION"),
    extractFunction(src, "samplerClipEvents"),
    extractFunction(src, "lyricLines"),
    extractFunction(src, "memoSrt"),
    extractFunction(src, "songMetadataJson"),
    extractFunction(src, "buildId3"),
    extractFunction(src, "wavBytes16"),
  ].join("\n");
  return new Function(parts + `
    return { samplerClipEvents, memoSrt, songMetadataJson, buildId3, wavBytes16 };
  `)();
}
const fns = sandbox();

test("samplerClipEvents: a grid clip expands to one-shot pad triggers", () => {
  const grid = Array.from({ length: 8 }, () => new Array(16).fill(false));
  grid[0][0] = grid[0][8] = true;   // pad 0 on beats 1 and 3
  grid[1][4] = grid[1][12] = true;  // pad 1 on beats 2 and 4
  const evs = fns.samplerClipEvents({ kind: "grid", grid }, { stepSec: 0.25, clipDur: 4, patSec: 4, clipStart: 0 });
  assert.equal(evs.length, 4);
  assert.deepEqual(evs.map(e => ({ pad: e.pad, t: e.time })).sort((a, b) => a.t - b.t || a.pad - b.pad),
    [{ pad: 0, t: 0 }, { pad: 1, t: 1 }, { pad: 0, t: 2 }, { pad: 1, t: 3 }].sort((a, b) => a.t - b.t || a.pad - b.pad));
  assert.ok(evs.every(e => e.loop === false));
});

test("samplerClipEvents: a grid pattern repeats to fill the clip", () => {
  const grid = Array.from({ length: 8 }, () => new Array(16).fill(false));
  grid[0][0] = true;
  // patSec 4 s, clipDur 12 s → the single hit repeats 3 times
  const evs = fns.samplerClipEvents({ kind: "grid", grid }, { stepSec: 0.25, clipDur: 12, patSec: 4, clipStart: 0 });
  assert.deepEqual(evs.map(e => e.time), [0, 4, 8]);
});

test("samplerClipEvents: a loop clip yields one looped span", () => {
  const evs = fns.samplerClipEvents({ kind: "loop", pad: 2 }, { stepSec: 0.25, clipDur: 9.3, patSec: 2, clipStart: 1.5 });
  assert.equal(evs.length, 1);
  assert.deepEqual(evs[0], { time: 1.5, pad: 2, loop: true, dur: 9.3 });
});

test("buildId3: valid ID3v2.3 tag with text frames, USLT/SYLT and APIC cover", () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
  const tag = fns.buildId3({
    title: "Test", artist: "Me", album: "Album", genre: "Lo-fi", year: "2026", bpm: 90, key: "Am",
    unsyncedLyrics: "hello", syncedLyrics: [{ start: 1.5, text: "hello" }], coverJpeg: jpeg,
  });
  const txt = Array.from(tag).map(c => String.fromCharCode(c)).join("");
  assert.equal(txt.slice(0, 3), "ID3");
  assert.equal(tag[3], 3); assert.equal(tag[4], 0);              // v2.3.0
  for (const f of ["TIT2", "TPE1", "TALB", "TCON", "TYER", "TBPM", "TKEY", "USLT", "SYLT", "APIC"])
    assert.ok(txt.includes(f), "frame " + f);
  // size header (syncsafe) equals the byte count after the 10-byte header
  const size = (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];
  assert.equal(size, tag.length - 10);
  // APIC carries the JPEG SOI bytes
  assert.ok(txt.includes("\xFF\xD8\xFF\xE0"), "APIC contains the JPEG header");
});

test("memoSrt: numbered cues with HH:MM:SS,mmm timestamps", () => {
  const srt = fns.memoSrt({ lyricsWords: [
    { start: 1.5, end: 1.9, text: "hold" }, { start: 1.95, end: 2.2, text: "me" },
    { start: 4.0, end: 4.8, text: "now" },
  ]});
  const blocks = srt.trim().split("\n\n");
  assert.equal(blocks.length, 2, "a >0.8 s gap starts a new cue");
  assert.match(blocks[0], /^1\n00:00:01,500 --> 00:00:02,200\nhold me$/);
  assert.match(blocks[1], /^2\n00:00:04,000 --> 00:00:04,800\nnow$/);
});

test("songMetadataJson: round-trips the fields and stem manifest", () => {
  const j = JSON.parse(fns.songMetadataJson(
    { title: "T", artist: "A", genre: "G", bpm: 100, key: "C", unsyncedLyrics: "la", audioFormat: "MP3" },
    [{ name: "Arp 1", type: "arp", file: "stems/Arp1.wav" }]
  ));
  assert.equal(j.title, "T"); assert.equal(j.bpm, 100); assert.equal(j.lyrics, "la");
  assert.equal(j.format, "MP3"); assert.equal(j.stems.length, 1);
  assert.match(j.exportedFrom, /^Pitch Studio /);
});

test("wavBytes16: 16-bit PCM with an embedded id3 chunk", () => {
  const sr = 8000, len = 100;
  const ch = new Float32Array(len).fill(0.5);
  const buffer = { numberOfChannels: 1, sampleRate: sr, length: len, getChannelData: () => ch };
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 9, 9, 9]); // "ID3" + filler
  const out = fns.wavBytes16(buffer, [{ id: "id3 ", data: id3 }]);
  const txt = Array.from(out).map(c => String.fromCharCode(c)).join("");
  assert.equal(txt.slice(0, 4), "RIFF");
  assert.equal(txt.slice(8, 12), "WAVE");
  assert.ok(txt.includes("data"));
  const idx = txt.indexOf("id3 ");
  assert.ok(idx > 0, "id3 chunk present");
  const dv = new DataView(out.buffer);
  assert.equal(dv.getUint32(idx + 4, true), id3.length, "id3 chunk size");
  assert.equal(out[idx + 8], 0x49, "id3 payload starts with 'I'");
});
